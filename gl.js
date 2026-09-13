// Fold Flyer — tiny WebGL1 renderer: one lit, fogged, two-sided vertex-colour program.
(function (root) {
  'use strict';

  const VS = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol;
    uniform mat4 uProj, uView;
    varying vec3 vNrm, vCol, vPos;
    void main() {
      vec4 wp = vec4(aPos, 1.0);
      vec4 vp = uView * wp;
      vPos = vp.xyz; vNrm = mat3(uView) * aNrm; vCol = aCol;
      gl_Position = uProj * vp;
    }`;
  const FS = `
    precision mediump float;
    varying vec3 vNrm, vCol, vPos;
    uniform vec3 uLight; uniform vec3 uFog; uniform vec2 uFogRange; uniform float uAmbient; uniform float uUnlit; uniform float uAlpha; uniform vec3 uNear;
    void main() {
      float d = length(vPos);
      // Geometry right on the lens has to go: a helix ribbon is 0.4 A thick, so a surface a fraction of
      // an angstrom off the camera fills the screen with one flat colour and the player is blind. It is
      // drawn twice — once with everything inside uNear.y cut away, then once with only that near shell,
      // faded out towards the lens. A dithered dissolve was tried first and is worse: a large surface
      // half-dissolved is television static.
      if (uNear.z > 1.5) { if (d < uNear.y) discard; }
      else if (uNear.z > 0.5) { if (d >= uNear.y) discard; }
      // Cut hidden fragments before lighting. Unlit effects need none of the normal/specular work.
      vec3 c = vCol;
      if (uUnlit < 0.5) {
        vec3 n = normalize(vNrm);
        if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(-vPos);
        if (dot(n, v) < 0.0) n = -n;
        float wrap = 0.5;
        float diff = max(0.0, (dot(n, uLight) + wrap) / (1.0 + wrap));
        vec3 h = normalize(uLight + v);
        // Fixed world key + broad camera fill, with the same restrained satin highlight.
        float fill = max(0.0, dot(n, v));
        float spec = pow(max(0.0, dot(n, h)), 22.0) * 0.13;
        c = vCol * (uAmbient + diff * 0.48 + fill * 0.24) + vec3(0.95, 0.97, 1.0) * spec;
      }
      float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
      f = f * f * (3.0 - 2.0 * f);
      float na = 1.0;
      if (uNear.z > 0.5 && uNear.z < 1.5) {
        na = clamp((d - uNear.x) / max(0.001, uNear.y - uNear.x), 0.0, 1.0);
        na = na * na * (3.0 - 2.0 * na);
        na = na * na;   // a surface the lens is INSIDE covers every direction at once, so the near half
                        // of the band has to be nearly gone or the whole screen washes out milky
      }
      gl_FragColor = vec4(mix(c, uFog, f), uAlpha * na);
    }`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  function createRenderer(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL not available');
    const uint = gl.getExtension('OES_element_index_uint');
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const A = { pos: gl.getAttribLocation(prog, 'aPos'), nrm: gl.getAttribLocation(prog, 'aNrm'), col: gl.getAttribLocation(prog, 'aCol') };
    const U = {};
    for (const nm of ['uProj', 'uView', 'uLight', 'uFog', 'uFogRange', 'uAmbient', 'uUnlit', 'uAlpha', 'uNear']) U[nm] = gl.getUniformLocation(prog, nm);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    function upload(mesh, m) {
      m = m || { vPos: gl.createBuffer(), vNrm: gl.createBuffer(), vCol: gl.createBuffer(), ibo: gl.createBuffer(), count: 0, type: gl.UNSIGNED_SHORT };
      const buf = (b, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); };
      buf(m.vPos, mesh.pos); buf(m.vNrm, mesh.nrm); buf(m.vCol, mesh.col);
      let idx = mesh.idx;
      if (idx instanceof Uint32Array && !uint) idx = new Uint16Array(idx);
      m.type = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
      m.count = idx.length;
      // Optional second index set over the SAME vertices, drawn with back-face culling. Used for β-sheet
      // strands, whose undersides are only ever seen when the camera is on the wrong side of the deck.
      m.countCull = 0;
      if (mesh.idxCull && mesh.idxCull.length) {
        let ic = mesh.idxCull;
        if (ic instanceof Uint32Array && !uint) ic = new Uint16Array(ic);
        m.typeCull = ic instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        if (!m.iboCull) m.iboCull = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.iboCull); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ic, gl.DYNAMIC_DRAW);
        m.countCull = ic.length;
      }
      return m;
    }

    // Free a mesh's GL buffers. Loading a fold rebuilds the side-chain chunks and the cofactor mesh;
    // without this their buffers are orphaned on the GPU every time, and a player who flies the whole
    // ten-fold campaign in one sitting leaks every one of them.
    function dispose(m) {
      if (!m) return;
      gl.deleteBuffer(m.vPos); gl.deleteBuffer(m.vNrm); gl.deleteBuffer(m.vCol); gl.deleteBuffer(m.ibo);
      if (m.iboCull) { gl.deleteBuffer(m.iboCull); m.iboCull = null; }
      m.count = 0; m.countCull = 0;
    }

    // overwrite a range of vertex colours in place (used for ribbon glow)
    function updateColours(m, cols, firstVert) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vCol);
      gl.bufferSubData(gl.ARRAY_BUFFER, firstVert * 12, cols);
    }

    // near: [start, end, mode] — mode 1 draws only the shell inside `end`, faded to nothing at `start`;
    // mode 2 draws everything outside `end`. Drawing a mesh with 2 then 1 makes near geometry melt away.
    function draw(m, unlit, alpha, additive, noDepth, near) {
      if (!m || (!m.count && !m.countCull)) return;
      gl.uniform3f(U.uNear, near ? near[0] : 0, near ? near[1] : 0, near ? near[2] : 0);
      const ghost = near && near[2] === 1;
      if (ghost) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      gl.uniform1f(U.uUnlit, unlit ? 1 : 0);
      const a = alpha === undefined ? 1 : alpha;
      gl.uniform1f(U.uAlpha, a);
      if (noDepth) gl.disable(gl.DEPTH_TEST);
      if (additive) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); } // honour distance-faded x-ray / ghost alpha
      else if (a < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      const attr = (loc, b) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); };
      attr(A.pos, m.vPos); attr(A.nrm, m.vNrm); attr(A.col, m.vCol);
      if (m.count) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
        gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
      }
      // the culled part, over the same vertices: β-sheet strands, so a deck seen from underneath is not
      // drawn at all rather than drawn as a solid wall
      if (m.countCull) {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.iboCull);
        gl.drawElements(gl.TRIANGLES, m.countCull, m.typeCull, 0);
        gl.disable(gl.CULL_FACE);
      }
      if (ghost || additive || a < 1) { gl.disable(gl.BLEND); gl.depthMask(true); }
      if (noDepth) gl.enable(gl.DEPTH_TEST);
    }

    function begin(w, h, proj, view, light, fog, fogNear, fogFar) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(fog[0], fog[1], fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.uProj, false, proj);
      gl.uniformMatrix4fv(U.uView, false, view);
      // light direction in view space
      const l = [view[0] * light[0] + view[4] * light[1] + view[8] * light[2], view[1] * light[0] + view[5] * light[1] + view[9] * light[2], view[2] * light[0] + view[6] * light[1] + view[10] * light[2]];
      const ll = Math.hypot(l[0], l[1], l[2]) || 1;
      gl.uniform3f(U.uLight, l[0] / ll, l[1] / ll, l[2] / ll);
      gl.uniform3f(U.uFog, fog[0], fog[1], fog[2]);
      gl.uniform2f(U.uFogRange, fogNear, fogFar);
      gl.uniform1f(U.uAmbient, 0.34);
      gl.uniform1f(U.uUnlit, 0);
      gl.uniform1f(U.uAlpha, 1);
      gl.uniform3f(U.uNear, 0, 0, 0);
    }

    return { gl, upload, draw, begin, updateColours, dispose };
  }

  // --- matrices (column-major Float32Array[16]) ---
  function perspective(fovyDeg, aspect, near, far) {
    const f = 1 / Math.tan(fovyDeg * Math.PI / 360), nf = 1 / (near - far);
    const o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  }
  function lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const o = new Float32Array(16);
    o[0] = xx; o[4] = xy; o[8] = xz; o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    o[1] = yx; o[5] = yy; o[9] = yz; o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[2] = zx; o[6] = zy; o[10] = zz; o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    o[15] = 1;
    return o;
  }

  const api = { createRenderer, perspective, lookAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
