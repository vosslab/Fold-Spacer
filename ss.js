// Fold Spacer — P-SEA secondary structure from Cα geometry (Labesse et al. 1997).
// psea(ca) returns a STRING of 'H' / 'E' / 'C', one char per residue.
(function (root) {
  'use strict';

  function v(ca, i) { return [ca[3 * i], ca[3 * i + 1], ca[3 * i + 2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function dist(ca, i, j) { return len(sub(v(ca, i), v(ca, j))); }

  function angleAt(ca, i) { // angle Cα(i-1)–Cα(i)–Cα(i+1) in degrees
    const a = sub(v(ca, i - 1), v(ca, i)), b = sub(v(ca, i + 1), v(ca, i));
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) * 180 / Math.PI;
  }
  function torsionAt(ca, i) { // dihedral Cα(i-1), Cα(i), Cα(i+1), Cα(i+2) in degrees
    const p0 = v(ca, i - 1), p1 = v(ca, i), p2 = v(ca, i + 1), p3 = v(ca, i + 2);
    const b0 = sub(p1, p0), b1 = sub(p2, p1), b2 = sub(p3, p2);
    const n1 = cross(b0, b1), n2 = cross(b1, b2);
    const m1 = cross(n1, b1.map((x) => x / len(b1)));
    const x = dot(n1, n2), y = dot(m1, n2);
    return Math.atan2(y, x) * 180 / Math.PI;
  }
  const inR = (x, a, b) => x >= a && x <= b;

  function runFilter(arr, ch, minLen) {
    let i = 0;
    while (i < arr.length) {
      if (arr[i] !== ch) { i++; continue; }
      let j = i;
      while (j < arr.length && arr[j] === ch) j++;
      if (j - i < minLen) for (let k = i; k < j; k++) arr[k] = 'C';
      i = j;
    }
  }

  function psea(ca) {
    const n = ca.length / 3;
    const H = new Array(n).fill(false), E = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      // helix by distances: marks i..i+4
      if (i + 4 < n) {
        const d2 = dist(ca, i, i + 2), d3 = dist(ca, i, i + 3), d4 = dist(ca, i, i + 4);
        if (inR(d2, 5.0, 6.0) && inR(d3, 4.8, 5.8) && inR(d4, 5.8, 7.0)) for (let k = i; k <= i + 4; k++) H[k] = true;
        if (inR(d2, 6.1, 7.3) && inR(d3, 9.0, 10.8) && inR(d4, 11.3, 13.5)) E[i + 2] = true;
      }
      // helix / strand by virtual bond angle and torsion: marks i
      if (i >= 1 && i + 2 < n) {
        const ang = angleAt(ca, i), tor = torsionAt(ca, i);
        if (inR(ang, 77, 101) && inR(tor, 30, 70)) H[i] = true;
        if (inR(ang, 110, 138) && Math.abs(tor) >= 125) E[i] = true;
      }
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = H[i] ? 'H' : E[i] ? 'E' : 'C';
    runFilter(out, 'H', 5);
    runFilter(out, 'E', 3);
    return out.join('');
  }

  // helix weight in [0,1]: 1 where H, then four passes of the 1-2-1 kernel
  function helixWeight(ss) {
    const n = ss.length;
    let w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = ss[i] === 'H' ? 1 : 0;
    for (let pass = 0; pass < 4; pass++) {
      const q = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = w[Math.max(0, i - 1)], c = w[Math.min(n - 1, i + 1)];
        q[i] = (a + 2 * w[i] + c) / 4;
      }
      w = q;
    }
    return w;
  }

  const api = { psea, helixWeight };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
