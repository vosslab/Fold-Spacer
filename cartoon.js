// Fold Flyer — cartoon ribbon mesh from Cα only.
// buildRibbon(ca, ss, axis) -> { pos: Float32Array, nrm, col, idx: Uint32Array }
// ca in Å (flat), ss element string, axis: de-coiled helix-axis points in world units (from the rail).
(function (root) {
  'use strict';
  const SC = 7;
  const V = root.V || require('./rail.js').V;
  const COL = { H: [255 / 255, 179 / 255, 71 / 255], E: [127 / 255, 212 / 255, 193 / 255], C: [150 / 255, 158 / 255, 190 / 255] };
  const RING = 10, SUB = 5;

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

  function buildRibbon(ca, ss, axis) {
    const n = ca.length / 3;
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

    const pos = [], nrm = [], col = [], idx = [], idxE = [];
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
        const c = COL[t < 0.5 ? e0 : e1] || COL.C;
        for (let r = 0; r < RING; r++) {
          const a = (r / RING) * Math.PI * 2, ca_ = Math.cos(a), sa = Math.sin(a);
          // elliptical cross-section: bn is the wide axis, nv the thin axis
          pos.push(p[0] + bn[0] * w * ca_ + nv[0] * h * sa, p[1] + bn[1] * w * ca_ + nv[1] * h * sa, p[2] + bn[2] * w * ca_ + nv[2] * h * sa);
          const nn = V.norm([bn[0] * ca_ / w + nv[0] * sa / h, bn[1] * ca_ / w + nv[1] * sa / h, bn[2] * ca_ / w + nv[2] * sa / h]);
          nrm.push(nn[0], nn[1], nn[2]);
          col.push(c[0], c[1], c[2]);
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
             idx: new Uint32Array(idx), idxCull: new Uint32Array(idxE) };
  }

  const api = { buildRibbon, COL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
