// Fold Flyer — the rail: de-coiled, offset, subdivided backbone with frames.
// buildRail(ca, hw, ss) -> { nodes, length, nodeAt(s), resNode(i) }
// ca: flat Å coordinates; hw: helix weight per residue; ss: element string.
(function (root) {
  'use strict';
  const SC = 7; // world units per Å

  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
    norm: (a) => { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    // remove the component of a along unit vector t
    perp: (a, t) => { const d = a[0] * t[0] + a[1] * t[1] + a[2] * t[2]; return [a[0] - t[0] * d, a[1] - t[1] * d, a[2] - t[2] * d]; },
  };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  function smooth121(pts, passes) {
    const n = pts.length;
    for (let p = 0; p < passes; p++) {
      const q = pts.slice();
      for (let i = 1; i < n - 1; i++) {
        q[i] = [
          (pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4,
          (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4,
          (pts[i - 1][2] + 2 * pts[i][2] + pts[i + 1][2]) / 4,
        ];
      }
      pts = q;
    }
    return pts;
  }

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    return out;
  }

  // opts: coilSmooth = extra 1-2-1 passes applied (weighted) to coil residues so turns are gentle;
  //       upRelax = per-sample pull of the frame's up vector toward world up in coil regions (kills roll drift)
  function buildRail(ca, hw, ss, opts) {
    opts = Object.assign({ decoil: 12, coilSmooth: 0, upRelax: 0.03, curvLimit: 70, curvIters: 250, loopBlend: 0, loopTan: 0.8, trenchH: 1.5, trenchClear: 1.6 }, opts || {}); // curvLimit 70: bends only true kinks; loopBlend still off (measured worse)
    const n = ca.length / 3;
    let pts = [];
    for (let i = 0; i < n; i++) pts.push([ca[3 * i] * SC, ca[3 * i + 1] * SC, ca[3 * i + 2] * SC]);

    // 2. de-coil: 12 passes so a helix collapses to its axis
    pts = smooth121(pts, opts.decoil);
    const axis = pts.map((p) => p.slice()); // helix axis points, used for inward block direction

    // 3. offset outside helices, away from the centroid, perpendicular to the tangent
    const cen = [0, 0, 0];
    for (const p of pts) { cen[0] += p[0] / n; cen[1] += p[1] / n; cen[2] += p[2] / n; }
    // trench run over β-sheets: for each strand run, the sheet normal (from the Cα pleat), signed toward the
    // emptier side of the sheet (the barrel lumen in a β-barrel, the solvent face of a surface sheet)
    const TRENCH_H = opts.trenchH; // Å above the Cα plane
    const sheetN = new Array(n).fill(null);
    const caP = (k) => [ca[3 * k], ca[3 * k + 1], ca[3 * k + 2]];
    {
      let i = 0;
      while (i < n) {
        if (ss[i] !== 'E') { i++; continue; }
        let j = i; while (j < n && ss[j] === 'E') j++;
        // candidate normals from the pleat, sign-aligned along the run
        let ref = null, acc = [0, 0, 0], cnt = 0, cen2 = [0, 0, 0];
        for (let k = Math.max(1, i); k < Math.min(n - 1, j); k++) {
          const t = V.norm(V.sub(caP(k + 1), caP(k - 1)));
          let nv = V.perp(V.sub(V.add(caP(k - 1), caP(k + 1)), V.scale(caP(k), 2)), t);
          if (V.len(nv) < 1e-3) continue;
          nv = V.norm(nv);
          if (ref && V.dot(nv, ref) < 0) nv = V.scale(nv, -1);
          if (!ref) ref = nv;
          acc = V.add(acc, nv); cnt++;
          cen2 = V.add(cen2, caP(k));
        }
        if (cnt >= 2 && j - i >= 3) { // a sheet floor needs at least three residues
          let nrm = V.norm(acc); cen2 = V.scale(cen2, 1 / cnt);
          // pick the emptier side: fewer Cα within 7 Å of a probe 4.5 Å off the sheet
          const probe = (sgn) => { const pp = V.add(cen2, V.scale(nrm, 4.5 * sgn)); let c = 0; for (let k = 0; k < n; k++) if (V.len(V.sub(caP(k), pp)) < 7) c++; return c; };
          if (probe(1) > probe(-1)) nrm = V.scale(nrm, -1);
          for (let k = i; k < j; k++) sheetN[k] = nrm;
        }
        i = j;
      }
    }
    // One floor for the whole sheet. Each strand run picks its normal independently, so without this the
    // deck can snap through 90° or invert where two runs meet, which is what makes a barrel unreadable.
    // 1. sign-align consecutive runs so the floor never inverts between them
    {
      let prev = null, i = 0;
      while (i < n) {
        if (!sheetN[i]) { i++; continue; }
        let j = i; while (j < n && sheetN[j] === sheetN[i]) j++;
        if (prev && V.dot(sheetN[i], prev) < 0) { const flip = V.scale(sheetN[i], -1); for (let k = i; k < j; k++) sheetN[k] = flip; }
        prev = sheetN[i];
        i = j;
      }
    }
    // 2. carry the floor across the hairpins between strands, so a sheet is one continuous road
    {
      let i = 0;
      while (i < n) {
        if (sheetN[i] || ss[i] === 'E') { i++; continue; }
        let j = i; while (j < n && !sheetN[j]) j++;
        if (i > 0 && sheetN[i - 1] && j < n && sheetN[j] && j - i <= 5 && V.dot(sheetN[i - 1], sheetN[j]) > 0.55) {
          const a0 = sheetN[i - 1], b0 = sheetN[j];
          for (let k = i; k < j; k++) sheetN[k] = V.norm(V.lerp(a0, b0, (k - i + 1) / (j - i + 1)));
        }
        i = Math.max(j, i + 1);
      }
    }
    // 3. smooth the normal field so the deck rolls rather than snaps
    for (let pass = 0; pass < 8; pass++) {
      const q = sheetN.slice();
      for (let i = 1; i < n - 1; i++) {
        if (!sheetN[i]) continue;
        const a0 = sheetN[i - 1] || sheetN[i], b0 = sheetN[i + 1] || sheetN[i];
        q[i] = V.norm(V.add(V.add(a0, b0), V.scale(sheetN[i], 2)));
      }
      for (let i = 0; i < n; i++) sheetN[i] = q[i];
    }
    // trench weight: 1 on strands with a sheet normal, smoothed so the offset and frame blend in and out
    let tw = new Array(n).fill(0).map((_, i) => (sheetN[i] ? 1 : 0));
    for (let pass = 0; pass < 3; pass++) { const q = tw.slice(); for (let i = 1; i < n - 1; i++) q[i] = (tw[i - 1] + 2 * tw[i] + tw[i + 1]) / 4; tw = q; }
    // nearest sheet normal for residues next to a strand (so the blend has a direction to blend toward)
    const nearN = sheetN.slice();
    for (let i = 0; i < n; i++) if (!nearN[i]) { for (let d = 1; d <= 3 && !nearN[i]; d++) nearN[i] = sheetN[i - d] || sheetN[i + d] || null; }
    // Two offsets per residue, smoothed separately and blended after: mixing them before smoothing let a
    // strand's neighbours drag the trench deck upward by a share of their 5.5 Å outward offset.
    const outwardA = [], lowA = [];
    for (let i = 0; i < n; i++) {
      const t = V.norm(V.sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
      let o = V.perp(V.sub(pts[i], cen), t);
      if (V.len(o) < 1e-6) o = V.perp([0, 1, 0], t);
      o = V.norm(o);
      const k = 1 - clamp01((hw[i] - 0.3) / 0.4);
      outwardA.push(V.scale(o, 5.5 * SC * k));
      if (nearN[i]) {
        // Height is measured from the sheet itself: correct only along the normal for however far the
        // de-coiled point has drifted off the Cα plane, so the ride stays smooth and the deck stays low.
        const caW = [ca[3 * i] * SC, ca[3 * i + 1] * SC, ca[3 * i + 2] * SC];
        const nrmT = V.norm(V.perp(nearN[i], t));
        lowA.push(V.scale(nrmT, V.dot(V.sub(caW, pts[i]), nrmT) + TRENCH_H * SC));
      } else lowA.push(null);
    }
    const outS = smooth121(outwardA, 6);
    const lowS = smooth121(lowA.map((q, i) => q || outwardA[i]), 2);
    let off = [];
    for (let i = 0; i < n; i++) off.push(lowA[i] ? V.lerp(outS[i], lowS[i], tw[i]) : outS[i]);
    // clearance over a sheet: lift trench points until no Cα is closer than trenchClear (barrel curvature brings
    // neighbouring strands close), then re-smooth the lift so it stays gentle
    for (let it = 0; it < 8; it++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (!nearN[i] || tw[i] < 0.3) continue;
        const p = V.add(pts[i], off[i]);
        let m = 1e9; for (let k = 0; k < n; k++) { const d = V.len(V.sub(p, [ca[3 * k] * SC, ca[3 * k + 1] * SC, ca[3 * k + 2] * SC])); if (d < m) m = d; }
        if (m < opts.trenchClear * SC) { off[i] = V.add(off[i], V.scale(nearN[i], (opts.trenchClear * SC - m) * 1.1)); changed = true; }
      }
      if (!changed) break;
      off = smooth121(off, 1);
    }
    for (let i = 0; i < n; i++) pts[i] = V.add(pts[i], off[i]);

    // 3b. loops as flight paths: a loop carries no side chains, so between two elements the rail follows a
    // tangent-continuous cubic Hermite from the exit of one element to the entry of the next, blended with
    // the real loop trace (loopBlend). Turns become arcs instead of the Cα trace's zigzag.
    if (opts.loopBlend > 0) {
      let i = 0;
      while (i < n) {
        if (ss[i] !== 'C') { i++; continue; }
        let j = i; while (j < n && ss[j] === 'C') j++;
        const a = i - 1, b = j; // last element residue before, first element residue after
        if (a >= 1 && b <= n - 2 && j - i >= 2) {
          const chord = V.len(V.sub(pts[b], pts[a]));
          const ta = V.scale(V.norm(V.sub(pts[a], pts[a - 1])), chord * opts.loopTan);
          const tb = V.scale(V.norm(V.sub(pts[b + 1], pts[b])), chord * opts.loopTan);
          for (let k = i; k < j; k++) {
            const t = (k - a) / (b - a), t2 = t * t, t3 = t2 * t;
            const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
            const hp = [0, 1, 2].map((c) => h00 * pts[a][c] + h10 * ta[c] + h01 * pts[b][c] + h11 * tb[c]);
            pts[k] = V.lerp(pts[k], hp, opts.loopBlend);
          }
        }
        i = j;
      }
    }
    // 3c. optional extra smoothing in coil
    if (opts.coilSmooth > 0) {
      let cw = new Array(n).fill(0).map((_, i) => (ss[i] === 'C' ? 1 : 0));
      cw = smooth121(cw.map((x) => [x, 0, 0]), 2).map((q) => q[0]);
      for (let pass = 0; pass < opts.coilSmooth; pass++) {
        const q = pts.slice();
        for (let i = 1; i < n - 1; i++) {
          const sm = [(pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4, (pts[i - 1][2] + 2 * pts[i][2] + pts[i + 1][2]) / 4];
          q[i] = V.lerp(pts[i], sm, cw[i]);
        }
        pts = q;
      }
    }

    // 4. subdivide with Catmull-Rom, 4 samples per residue
    const SUB = 4;
    const nodes = [];
    const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB;
        const res = i + t;
        const w = hw[i] + (hw[i + 1] - hw[i]) * t;
        const sn = sheetN[i] || sheetN[i + 1]; const tww = tw[i] + (tw[i + 1] - tw[i]) * t;
        nodes.push({ p: catmull(P(i - 1), P(i), P(i + 1), P(i + 2), t), res, hw: w, elem: ss[Math.round(res)], trench: tww, sheetN: sn });
      }
    }
    nodes.push({ p: pts[n - 1].slice(), res: n - 1, hw: hw[n - 1], elem: ss[n - 1], trench: tw[n - 1], sheetN: sheetN[n - 1] });
    for (const nd of nodes) nd.R = (3.0 + (2.0 - 3.0) * clamp01((nd.hw - 0.3) / 0.4)) * SC;

    // 4b. curvature limit on the fine samples: wherever the rail turns faster than curvLimit deg/Å,
    // pull that sample toward its neighbours' midpoint. Helix samples are anchored (they carry the coil),
    // coil samples move freely, so sharp loop corners become arcs while helices stay on their axes.
    if (opts.curvLimit > 0) {
      const m0 = nodes.length;
      const anchor = nodes.map((nd) => 1 - 0.95 * clamp01((nd.hw - 0.3) / 0.4));
      for (let it = 0; it < opts.curvIters; it++) {
        let moved = 0;
        const np = nodes.map((nd) => nd.p);
        for (let i = 1; i < m0 - 1; i++) {
          if (anchor[i] < 0.06) continue;
          const d0 = V.sub(nodes[i].p, nodes[i - 1].p), d1 = V.sub(nodes[i + 1].p, nodes[i].p);
          const l0 = V.len(d0), l1 = V.len(d1); if (l0 < 1e-6 || l1 < 1e-6) continue;
          const c = Math.max(-1, Math.min(1, V.dot(d0, d1) / (l0 * l1)));
          const rate = Math.acos(c) * 180 / Math.PI / ((l0 + l1) / 2 / SC);
          if (rate <= opts.curvLimit) continue;
          const w = Math.min(1, (rate - opts.curvLimit) / opts.curvLimit) * anchor[i] * 0.5;
          // move only across the local chord (pure bend reduction, no bunching of samples)
          const chord = V.norm(V.sub(nodes[i + 1].p, nodes[i - 1].p));
          const delta = V.perp(V.sub(V.scale(V.add(nodes[i - 1].p, nodes[i + 1].p), 0.5), nodes[i].p), chord);
          np[i] = V.add(nodes[i].p, V.scale(delta, w)); moved++;
        }
        for (let i = 0; i < m0; i++) nodes[i].p = np[i];
        if (!moved) break;
      }
      // even out sample spacing that the relaxation disturbed (keeps res/hw attached to positions)
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < m0 - 1; i++) {
          if (anchor[i] < 0.06) continue;
          nodes[i].p = V.lerp(nodes[i].p, V.scale(V.add(nodes[i - 1].p, nodes[i + 1].p), 0.5), 0.3 * anchor[i]);
        }
      }
    }

    // The rail is a smoothed line through a compact fold, so in places it runs inside the ribbon that is
    // actually drawn. Measuring to Cα points missed this: the ribbon is a solid 0.6 Å tube over coil and a
    // 2.35 Å wide slab over a sheet, so a rail 1 Å from the centre line can still be buried. Push it out
    // using the drawn profile, then smooth. Inside a helix the fix is to move back toward the axis, since
    // the coil there is the wall the corridor is meant to sit inside.
    {
      const caP = (k) => [ca[3 * k] * SC, ca[3 * k + 1] * SC, ca[3 * k + 2] * SC];
      const HW = { H: 1.1, E: 2.35, C: 0.6 }, HT = { H: 0.2, E: 0.2, C: 0.6 };
      const CLR = 0.5 * SC;
      // the ribbon's own frame at each residue: tangent, thin axis, wide axis (matches cartoon.js)
      const rt = [], rn = [], rb = [];
      let prevN = null;
      for (let i = 0; i < n; i++) {
        const t = V.norm(V.sub(caP(Math.min(n - 1, i + 1)), caP(Math.max(0, i - 1))));
        let nv = null;
        if (ss[i] === 'H') nv = V.perp(V.sub(axis[i], caP(i)), t);
        else if (sheetN[i]) nv = V.perp(sheetN[i], t);
        else if (i > 0 && i < n - 1) nv = V.perp(V.sub(V.add(caP(i - 1), caP(i + 1)), V.scale(caP(i), 2)), t);
        if (!nv || V.len(nv) < 1e-4) nv = prevN ? V.perp(prevN, t) : V.perp(Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], t);
        nv = V.norm(nv); prevN = nv;
        rt.push(t); rn.push(nv); rb.push(V.cross(t, nv));
      }
      for (let it = 0; it < 5; it++) {
        let moved = 0;
        for (let i = 1; i < nodes.length - 1; i++) {
          const nd = nodes[i], ri = Math.round(nd.res), inHel = nd.hw > 0.5;
          let push = [0, 0, 0], worst = 0;
          for (let k = 0; k < n; k++) {
            if (inHel && Math.abs(k - ri) <= 6) continue;          // its own coil is the corridor wall
            const rel = V.sub(nd.p, caP(k));
            const a = V.dot(rel, rt[k]);
            if (Math.abs(a) > 1.9 * SC) continue;
            const e = ss[k], w = HW[e] * SC + CLR, h = HT[e] * SC + CLR;
            const u = V.dot(rel, rb[k]), v = V.dot(rel, rn[k]);
            const q = (u * u) / (w * w) + (v * v) / (h * h);
            if (q >= 1) continue;                                   // outside this residue's ribbon
            const depth = 1 - Math.sqrt(q);
            if (depth > worst) {
              worst = depth;
              const outward = V.norm(V.add(V.scale(rb[k], u / (w * w)), V.scale(rn[k], v / (h * h))));
              push = V.scale(outward, depth * 0.9 * Math.max(w, h));
            }
          }
          if (worst > 0) {
            if (inHel && axis[ri]) {                                // in a helix, come back to the axis
              const toAxis = V.perp(V.sub(axis[ri], nd.p), nd.t || rt[Math.min(n - 1, ri)]);
              nd.p = V.add(nd.p, V.scale(toAxis, 0.35));
            } else nd.p = V.add(nd.p, push);
            moved++;
          }
        }
        if (!moved) break;
        for (let pass = 0; pass < 2; pass++) {
          const q = nodes.map((nd) => nd.p);
          for (let i = 1; i < nodes.length - 1; i++) nodes[i].p = [0, 1, 2].map((c) => (q[i - 1][c] + 2 * q[i][c] + q[i + 1][c]) / 4);
        }
      }
    }

    // arc length
    let s = 0;
    nodes[0].s = 0;
    for (let i = 1; i < nodes.length; i++) { s += V.len(V.sub(nodes[i].p, nodes[i - 1].p)); nodes[i].s = s; }
    const length = s;

    // 5. frames: tangent from neighbours, up by parallel transport, right = t × u
    const m = nodes.length;
    for (let i = 0; i < m; i++) {
      const a = nodes[Math.max(0, i - 1)].p, b = nodes[Math.min(m - 1, i + 1)].p;
      nodes[i].t = V.norm(V.sub(b, a));
    }
    let u = V.perp([0, 1, 0], nodes[0].t);
    if (V.len(u) < 1e-3) u = V.perp([1, 0, 0], nodes[0].t);
    u = V.norm(u);
    // The floor may never roll faster than MAX_ROLL degrees per Å. A β-barrel's hairpins would otherwise
    // snap the deck through 90° in a step, which is what makes a sheet unreadable to fly.
    const MAX_ROLL = 7;
    let prevU = null, prevS = 0;
    for (let i = 0; i < m; i++) {
      u = V.norm(V.perp(u, nodes[i].t));
      let signFlip = false;
      if (nodes[i].trench > 0.02 && nodes[i].sheetN) { // trench: up is the sheet normal, on the flight side
        const sn0 = V.perp(nodes[i].sheetN, nodes[i].t);
        if (V.len(sn0) > 0.2) {
          const sn = V.norm(sn0);
          // The deck is the sheet and the flight side is +sheetN, so the frame must be on that side. A 180°
          // correction cannot fit through the roll limit below, so flip outright and let that node through.
          if (V.dot(u, sn) < 0) { u = V.scale(u, -1); signFlip = true; }
          u = V.norm(V.lerp(u, sn, Math.min(1, nodes[i].trench * 1.5) * 0.85));
        }
      }
      if (opts.upRelax > 0 && nodes[i].elem === 'C') {           // relax toward world up in coil so the horizon settles
        const wu = V.perp([0, 1, 0], nodes[i].t);
        if (V.len(wu) > 0.2) u = V.norm(V.lerp(u, V.norm(wu), opts.upRelax * (1 - nodes[i].hw)));
      }
      if (prevU && !signFlip) {
        const pu = V.norm(V.perp(prevU, nodes[i].t));
        if (V.len(pu) > 0.2) {
          const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(pu, u)))) * 180 / Math.PI;
          const maxA = MAX_ROLL * Math.max(0.02, (nodes[i].s - prevS) / SC);
          if (ang > maxA) u = V.norm(V.lerp(pu, u, maxA / ang));
        }
      }
      prevU = u; prevS = nodes[i].s;
      nodes[i].u = u;
      nodes[i].r = V.norm(V.cross(nodes[i].t, u));
    }

    for (let i = 0; i < m; i++) {
      const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(m - 1, i + 1)];
      const ds = b.s - a.s;
      nodes[i].kr = ds > 1e-6 ? V.dot(V.scale(V.sub(b.t, a.t), 1 / ds), nodes[i].r) : 0;
    }

    // The corridor is a tube of fixed radius around the rail, blind to the rest of the fold, so where the
    // chain packs against another part of itself the tube passes straight through it. Shrink it to what is
    // actually free. Neighbours along the chain are skipped: they are the wall the corridor is meant to hug.
    {
      const caW = [];
      for (let k = 0; k < n; k++) caW.push([ca[3 * k] * SC, ca[3 * k + 1] * SC, ca[3 * k + 2] * SC]);
      const CLEAR = 0.8 * SC;
      for (let i = 0; i < m; i++) {
        const nd = nodes[i], ri = Math.round(nd.res);
        let lim = nd.R;
        for (let k = 0; k < n; k++) {
          if (Math.abs(k - ri) <= 4) continue;                       // the local backbone forms the corridor
          const rel = V.sub(caW[k], nd.p);
          if (Math.abs(V.dot(rel, nd.t)) > 3 * SC) continue;
          const d = V.len(rel);
          if (d - CLEAR < lim) lim = Math.max(0.55 * SC, d - CLEAR);
        }
        nd.Rfree = lim;
      }
      for (let pass = 0; pass < 4; pass++) {
        const r = nodes.map((q) => q.Rfree);
        for (let i = 1; i < m - 1; i++) nodes[i].Rfree = (r[i - 1] + 2 * r[i] + r[i + 1]) / 4;
      }
      for (let i = 0; i < m; i++) nodes[i].R = Math.min(nodes[i].R, nodes[i].Rfree);
    }

    // How far the trench slot actually extends each way before it meets structure. A fixed ±2.4 Å let the
    // craft steer into the next strand where a sheet curves, which is what flying through things looks like.
    {
      const caW = [];
      for (let k = 0; k < n; k++) caW.push([ca[3 * k] * SC, ca[3 * k + 1] * SC, ca[3 * k + 2] * SC]);
      const CLEAR = 1.15 * SC;
      for (let i = 0; i < m; i++) {
        const nd = nodes[i];
        if ((nd.trench || 0) < 0.3) { nd.slotL = nd.slotR = 2.4; continue; }
        let lo = 2.4, hi = 2.4;
        for (const q of caW) {
          const rel = V.sub(q, nd.p);
          if (Math.abs(V.dot(rel, nd.t)) > 2.0 * SC) continue;          // only what is beside us
          const x = V.dot(rel, nd.r), y = V.dot(rel, nd.u);
          if (Math.abs(y) > CLEAR) continue;                             // above or below the deck: no obstacle
          const reach = Math.abs(x) / SC - Math.sqrt(Math.max(0, CLEAR * CLEAR - y * y)) / SC;
          if (x > 0) hi = Math.min(hi, Math.max(0.35, reach));
          else lo = Math.min(lo, Math.max(0.35, reach));
        }
        nd.slotL = lo; nd.slotR = hi;
      }
      // smooth so the walls do not step
      for (let pass = 0; pass < 6; pass++) {
        const l = nodes.map((q) => q.slotL), r = nodes.map((q) => q.slotR);
        for (let i = 1; i < m - 1; i++) { nodes[i].slotL = (l[i - 1] + 2 * l[i] + l[i + 1]) / 4; nodes[i].slotR = (r[i - 1] + 2 * r[i] + r[i + 1]) / 4; }
      }
    }

    function nodeAt(sq) {
      if (sq <= 0) {
        // Extrapolate behind the start instead of clamping. The camera trails the craft by several Å, so
        // clamping put the lens exactly ON it for the first half second of every fold and the ship filled
        // the corner of the screen before the run had begun.
        const n0 = nodes[0];
        if (sq > -1e-9) return n0;
        return { p: V.add(n0.p, V.scale(n0.t, sq)), t: n0.t, u: n0.u, r: n0.r, R: n0.R, res: n0.res,
                 s: sq, kr: n0.kr, elem: n0.elem, hw: n0.hw, trench: n0.trench || 0,
                 slotL: n0.slotL, slotR: n0.slotR };
      }
      if (sq >= length) return nodes[m - 1];
      let lo = 0, hi = m - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (nodes[mid].s <= sq) lo = mid; else hi = mid; }
      const A = nodes[lo], B = nodes[hi];
      const f = (sq - A.s) / Math.max(1e-9, B.s - A.s);
      const t = V.norm(V.lerp(A.t, B.t, f));
      const uu = V.norm(V.perp(V.lerp(A.u, B.u, f), t));
      return {
        p: V.lerp(A.p, B.p, f), t, u: uu, r: V.norm(V.cross(t, uu)),
        R: A.R + (B.R - A.R) * f, res: A.res + (B.res - A.res) * f, s: sq, kr: A.kr + (B.kr - A.kr) * f,
        elem: f < 0.5 ? A.elem : B.elem, hw: A.hw + (B.hw - A.hw) * f, trench: (A.trench || 0) + ((B.trench || 0) - (A.trench || 0)) * f,
        slotL: (A.slotL || 2.4) + ((B.slotL || 2.4) - (A.slotL || 2.4)) * f, slotR: (A.slotR || 2.4) + ((B.slotR || 2.4) - (A.slotR || 2.4)) * f,
      };
    }
    const resNode = (i) => nodes[Math.min(m - 1, i * SUB)];

    return { nodes, length, nodeAt, resNode, axis, SC, SUB, tw };
  }

  const api = { buildRail, V, SC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
