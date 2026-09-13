// Fold Spacer — cartoon ribbon mesh from Cα only.
// buildRibbon(ca, ss, axis) -> { pos: Float32Array, nrm, col, idx: Uint32Array }
// ca in Å (flat), ss element string, axis: de-coiled helix-axis points in world units (from the rail).
(function (root) {
  'use strict';
  const SC = 7;
  const V = root.V || require('./rail.js').V;
  const COL = { H: [0.92, 0.70, 0.38], E: [0.48, 0.76, 0.69], C: [0.56, 0.61, 0.70] };

  // A bounded, two-sided approximation to occlusion, baked once per structure. Nearby Cα atoms
  // contribute a directional density tensor; excluding sequence neighbours avoids shading the
  // backbone by its own sampling density. The squared normal term also works inside a helix.
  function occlusionField(ca) {
    const radius = 9, cells = new Map(), field = [], n = ca.length / 3;
    const key = (x, y, z) => x + ',' + y + ',' + z;
    for (let i = 0; i < n; i++) {
      const k = key(Math.floor(ca[i * 3] / radius), Math.floor(ca[i * 3 + 1] / radius), Math.floor(ca[i * 3 + 2] / radius));
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(i);
    }
    for (let i = 0; i < n; i++) {
      const x = ca[i * 3], y = ca[i * 3 + 1], z = ca[i * 3 + 2];
      const cx = Math.floor(x / radius), cy = Math.floor(y / radius), cz = Math.floor(z / radius);
      const q = [0, 0, 0, 0, 0, 0, 0];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const bucket = cells.get(key(cx + a, cy + b, cz + c));
        if (!bucket) continue;
        for (const j of bucket) {
          if (Math.abs(i - j) <= 3) continue;
          const dx = ca[j * 3] - x, dy = ca[j * 3 + 1] - y, dz = ca[j * 3 + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 0.01 || d2 >= radius * radius) continue;
          const w = Math.pow(1 - d2 / (radius * radius), 2), s = w / d2;
          q[0] += w;
          q[1] += dx * dx * s; q[2] += dy * dy * s; q[3] += dz * dz * s;
          q[4] += dx * dy * s; q[5] += dx * dz * s; q[6] += dy * dz * s;
        }
      }
      field.push(q);
    }
    return field;
  }

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t, out = [0, 0, 0];
    for (let k = 0; k < 3; k++) out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    return out;
  }

  // Half-width / half-thickness (Å) per element.
  // A β-sheet is a continuous pleated surface, and its strands sit 4.8 Å apart, so a half-width of 2.35 Å
  // makes neighbours meet and the sheet reads as one wide road rather than a set of separate ribbons.
  const STRAND_W = 2.35, STRAND_ARROW = 3.3;
  function profile(e) {
    if (e === 'H') return [1.1, 0.2];
    if (e === 'E') return [STRAND_W, 0.2];
    return [0.6, 0.6];
  }

  function buildRibbon(ca, ss, axis, detail) {
    const n = ca.length / 3;
    const requestedSub = detail && detail.subdivisions || 8;
    // Keep larger imports on the previous geometry budget. The finer campaign mesh must not turn
    // a previously valid 16-bit mesh into an overflowing one on devices without the index extension.
    const detailed = (n - 1) * 12 * requestedSub + 12 <= 65535;
    const RING = detailed ? 12 : 10, SUB = detailed ? requestedSub : 5;
    const occ = occlusionField(ca);
    const P = [];
    for (let i = 0; i < n; i++) P.push([ca[3 * i] * SC, ca[3 * i + 1] * SC, ca[3 * i + 2] * SC]);
    const at = (i) => P[Math.max(0, Math.min(n - 1, i))];

    // per-residue tangent and preferred normal (thin direction of the ribbon)
    const tan = [], nrmPref = [];
    for (let i = 0; i < n; i++) tan.push(V.norm(V.sub(at(i + 1), at(i - 1))));
    let prev = null;
    for (let i = 0; i < n; i++) {
      let nv = null;
      if (ss[i] === 'H' && axis) nv = V.perp(V.sub(axis[i], P[i]), tan[i]);           // radial toward the axis
      else if (ss[i] === 'E' && i > 0 && i < n - 1) {                                   // pleat direction = sheet normal
        nv = V.perp(V.sub(V.add(at(i - 1), at(i + 1)), V.scale(P[i], 2)), tan[i]);
        if (prev && V.dot(nv, prev) < 0) nv = V.scale(nv, -1);
      }
      if (!nv || V.len(nv) < 1e-4) {
        nv = prev ? V.perp(prev, tan[i]) : V.perp(Math.abs(tan[i][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], tan[i]);
      }
      nv = V.norm(nv);
      nrmPref.push(nv);
      prev = nv;
    }

    // per-residue profile, with strand arrow heads and smooth element transitions
    const prof = [];
    for (let i = 0; i < n; i++) prof.push(profile(ss[i]));

    const pos = [], nrm = [], col = [], ao = [], idx = [], idxE = [];
    let ring = 0;
    const segs = n - 1;
    for (let i = 0; i < segs; i++) {
      const e0 = ss[i], e1 = ss[i + 1];
      const arrow = e0 === 'E' && e1 !== 'E'; // last strand residue -> arrow head over this segment
      const last = i === segs - 1;
      const kmax = last ? SUB : SUB - 1;
      for (let k = 0; k <= kmax; k++) {
        const t = k / SUB;
        const p = catmull(at(i - 1), at(i), at(i + 1), at(i + 2), t);
        const pn = catmull(at(i - 1), at(i), at(i + 1), at(i + 2), Math.min(1, t + 0.01));
        const pp = catmull(at(i - 1), at(i), at(i + 1), at(i + 2), Math.max(0, t - 0.01));
        const tg = V.norm(V.sub(pn, pp));
        let nv = V.norm(V.perp(V.lerp(nrmPref[i], nrmPref[i + 1], t), tg));
        const bn = V.norm(V.cross(tg, nv)); // wide direction
        let w, h;
        if (arrow) { w = t < 0.15 ? STRAND_W + (STRAND_ARROW - STRAND_W) * (t / 0.15) : STRAND_ARROW * (1 - (t - 0.15) / 0.85) + 0.05; h = 0.2 + (prof[i + 1][1] - 0.2) * t; }
        else { w = prof[i][0] + (prof[i + 1][0] - prof[i][0]) * t; h = prof[i][1] + (prof[i + 1][1] - prof[i][1]) * t; }
        w *= SC; h *= SC;
        const blend = t * t * (3 - 2 * t);
        const c = V.lerp(COL[e0] || COL.C, COL[e1] || COL.C, blend);
        const q = occ[i].map((v, j) => v + (occ[i + 1][j] - v) * blend);
        for (let r = 0; r < RING; r++) {
          const a = (r / RING) * Math.PI * 2, ca_ = Math.cos(a), sa = Math.sin(a);
          // elliptical cross-section: bn is the wide axis, nv the thin axis
          pos.push(p[0] + bn[0] * w * ca_ + nv[0] * h * sa, p[1] + bn[1] * w * ca_ + nv[1] * h * sa, p[2] + bn[2] * w * ca_ + nv[2] * h * sa);
          const nn = V.norm([bn[0] * ca_ / w + nv[0] * sa / h, bn[1] * ca_ / w + nv[1] * sa / h, bn[2] * ca_ / w + nv[2] * sa / h]);
          nrm.push(nn[0], nn[1], nn[2]);
          const x = nn[0], y = nn[1], z = nn[2];
          const density = 0.18 * q[0] + 0.82 * (q[1] * x * x + q[2] * y * y + q[3] * z * z + 2 * (q[4] * x * y + q[5] * x * z + q[6] * y * z));
          const shade = 1 - 0.24 * (1 - Math.exp(-0.20 * density));
          ao.push(shade);
          col.push(c[0] * shade, c[1] * shade, c[2] * shade);
        }
        if (ring > 0) {
          // A β-sheet is a slab you fly OVER and never inside, so its back faces are only ever visible
          // when the camera has slipped to the wrong side of it — and then the underside fills the frame
          // as a solid wall. Those triangles go in their own index buffer so the renderer can cull them.
          // A helix coil is the opposite: a tube you fly INSIDE, where the inner (back) face is the wall
          // you are meant to see. Culling those eats the helix, measured. Hence per-element, not global.
          const tgt = (e0 === 'E' && e1 === 'E') ? idxE : idx;
          const a0 = (ring - 1) * RING, b0 = ring * RING;
          for (let r = 0; r < RING; r++) {
            const r2 = (r + 1) % RING;
            tgt.push(a0 + r, b0 + r, b0 + r2, a0 + r, b0 + r2, a0 + r2);
          }
        }
        ring++;
      }
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col),
             idx: new Uint32Array(idx), idxCull: new Uint32Array(idxE),
             ao: new Float32Array(ao), ringSize: RING, subdivisions: SUB };
  }

  const api = { buildRibbon, COL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
