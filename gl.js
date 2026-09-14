// Fold Spacer — tiny WebGL1 renderer: one lit, fogged, two-sided vertex-colour program.
(function (root) {
  'use strict';

  const VS = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol;
    uniform mat4 uProj, uView, uModel; uniform float uLocal;
    varying vec3 vNrm, vCol, vPos;
    void main() {
      vec4 wp = vec4(aPos, 1.0);
      vec3 normal = aNrm;
      if (uLocal > 0.5) { wp = uModel * wp; normal = mat3(uModel) * normal; }
      vec4 vp = uView * wp;
      vPos = vp.xyz; vNrm = mat3(uView) * normal; vCol = aCol;
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

  // Conservative AABBs over consecutive index ranges. Keep triangle order and the
  // strand index stream intact; visibility is spatial, never sequence-based.
  function meshRanges(pos, idx, step = 1536) {
    const out = [];
    for (let first = 0; first < idx.length; first += step) {
      const end = Math.min(idx.length, first + step);
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let j = first; j < end; j++) {
        const k = idx[j] * 3, x = pos[k], y = pos[k + 1], z = pos[k + 2];
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
      }
      const pad = 0.1 + Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1), Math.abs(z0), Math.abs(z1)) * 1e-5;
      out.push({ first, count: end - first, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
        rx: (x1 - x0) / 2 + pad, ry: (y1 - y0) / 2 + pad, rz: (z1 - z0) / 2 + pad });
    }
    return out;
  }

  function outsideFrustum(b, planes) {
    for (let i = 0; i < 24; i += 4) {
      const x = planes[i], y = planes[i + 1], z = planes[i + 2];
      if (x * b.x + y * b.y + z * b.z + planes[i + 3] +
          Math.abs(x) * b.rx + Math.abs(y) * b.ry + Math.abs(z) * b.rz < -0.001) return true;
    }
    return false;
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
    for (const nm of ['uProj', 'uView', 'uModel', 'uLocal', 'uLight', 'uFog', 'uFogRange', 'uAmbient', 'uUnlit', 'uAlpha', 'uNear']) U[nm] = gl.getUniformLocation(prog, nm);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const planes = new Float64Array(24), clip = new Float64Array(16);
    let frameId = 0;

    function upload(mesh, m) {
      m = m || { vPos: gl.createBuffer(), vNrm: gl.createBuffer(), vCol: gl.createBuffer(), ibo: gl.createBuffer(), count: 0, type: gl.UNSIGNED_SHORT };
      const buf = (b, data, key) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        if (mesh.stream && m[key] >= data.byteLength) { if (data.byteLength) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); }
        else if (mesh.stream) {
          m[key] = mesh.capacityBytes || data.byteLength;
          gl.bufferData(gl.ARRAY_BUFFER, m[key], gl.DYNAMIC_DRAW);
          if (data.byteLength) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
        } else { gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); m[key] = data.byteLength; }
      };
      buf(m.vPos, mesh.pos, 'posBytes'); buf(m.vNrm, mesh.nrm, 'nrmBytes'); buf(m.vCol, mesh.col, 'colBytes');
      let idx = mesh.idx;
      // Streamed quads have immutable indices; only their active count changes.
      if (!mesh.stream || m.indexSource !== idx) {
        m.indexSource = mesh.stream ? idx : null;
        if (idx instanceof Uint32Array && !uint) idx = new Uint16Array(idx);
        m.type = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
      }
      m.count = mesh.indexCount === undefined ? idx.length : mesh.indexCount;
      m.ranges = mesh.spatial ? meshRanges(mesh.pos, idx) : null;
      m.rangesCull = null; m.visibleFrame = -1; m.visible = m.visibleCull = null;
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
        if (mesh.spatial) m.rangesCull = meshRanges(mesh.pos, ic);
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

    // Update an animated chain's vertex span without resending its static topology.
    function updatePose(m, pos, nrm, firstVert) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vPos); gl.bufferSubData(gl.ARRAY_BUFFER, firstVert * 12, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vNrm); gl.bufferSubData(gl.ARRAY_BUFFER, firstVert * 12, nrm);
    }
    function updateBounds(m, pos) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
        y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
        z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
      }
      const pad = 0.1 + Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1), Math.abs(z0), Math.abs(z1)) * 1e-5;
      m.bounds = pos.length ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
        rx: (x1 - x0) / 2 + pad, ry: (y1 - y0) / 2 + pad, rz: (z1 - z0) / 2 + pad } : null;
    }

    function visibleRanges(ranges, reuse) {
      if (!ranges) return null;
      const visible = reuse || { data: new Uint32Array(ranges.length * 2), count: 0 };
      visible.count = 0;
      for (const b of ranges) {
        if (outsideFrustum(b, planes)) continue;
        const last = (visible.count - 1) * 2, data = visible.data;
        if (last >= 0 && data[last] + data[last + 1] === b.first) data[last + 1] += b.count;
        else { data[++visible.count * 2 - 2] = b.first; data[visible.count * 2 - 1] = b.count; }
      }
      return visible;
    }
    function drawIndices(count, type, ranges) {
      if (!ranges) gl.drawElements(gl.TRIANGLES, count, type, 0);
      else for (let i = 0; i < ranges.count * 2; i += 2) gl.drawElements(gl.TRIANGLES, ranges.data[i + 1], type, ranges.data[i] * (type === gl.UNSIGNED_INT ? 4 : 2));
    }

    // near: [start, end, mode] — mode 1 draws only the shell inside `end`, faded to nothing at `start`;
    // mode 2 draws everything outside `end`. Drawing a mesh with 2 then 1 makes near geometry melt away.
    function draw(m, unlit, alpha, additive, noDepth, near) {
      if (!m || (!m.count && !m.countCull)) return;
      if (!root.NO_FRUSTUM && m.bounds && outsideFrustum(m.bounds, planes)) return;
      if (m.visibleFrame !== frameId) {
        m.visible = visibleRanges(m.ranges, m.visible); m.visibleCull = visibleRanges(m.rangesCull, m.visibleCull); m.visibleFrame = frameId;
      }
      const ranges = root.NO_FRUSTUM ? null : m.visible, rangesCull = root.NO_FRUSTUM ? null : m.visibleCull;
      if ((!m.count || (ranges && !ranges.count)) && (!m.countCull || (rangesCull && !rangesCull.count))) return;
      gl.uniform1f(U.uLocal, m.model ? 1 : 0);
      if (m.model) gl.uniformMatrix4fv(U.uModel, false, m.model);
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
        drawIndices(m.count, m.type, ranges);
      }
      // the culled part, over the same vertices: β-sheet strands, so a deck seen from underneath is not
      // drawn at all rather than drawn as a solid wall
      if (m.countCull) {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.iboCull);
        drawIndices(m.countCull, m.typeCull, rangesCull);
        gl.disable(gl.CULL_FACE);
      }
      if (ghost || additive || a < 1) { gl.disable(gl.BLEND); gl.depthMask(true); }
      if (noDepth) gl.enable(gl.DEPTH_TEST);
    }

    function begin(w, h, proj, view, light, fog, fogNear, fogFar) {
      frameId++;
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        clip[c * 4 + r] = proj[r] * view[c * 4] + proj[4 + r] * view[c * 4 + 1] + proj[8 + r] * view[c * 4 + 2] + proj[12 + r] * view[c * 4 + 3];
      }
      for (let axis = 0; axis < 3; axis++) for (let side = 0; side < 2; side++) {
        const sign = side ? -1 : 1, off = (axis * 2 + side) * 4;
        for (let c = 0; c < 4; c++) planes[off + c] = clip[c * 4 + 3] + sign * clip[c * 4 + axis];
      }
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

    return { gl, upload, draw, begin, updateColours, updatePose, updateBounds, dispose };
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

  const api = { createRenderer, perspective, lookAt, meshRanges, outsideFrustum };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
