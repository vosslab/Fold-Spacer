// Generates folds.js: built-in campaign folds as residue lists + Cα coords at 0.1 Å.
// usage: node tools/make_folds.js > folds.js
const fs = require('fs');
const path = require('path');
const { parseStructure } = require('../parse.js');
const { psea, helixWeight } = require('../ss.js');
const { V, buildRail, SC } = require('../rail.js');
const DATA = path.join(__dirname, '..', 'data');

const LIST = [
  // Campaign order (playtested 2026-09-12; 1QJ8 moved 2nd -> 9th on 2026-09-13). Ordered by how much
  // SHEET each fold carries, because the trench run is the mechanic the player has to learn: the bundle
  // and the five helix folds are 0-5% sheet, then 1LDG and 1TIM at 16-17% introduce trenches a strand at
  // a time, and 1QJ8 (OmpX) at 67% is the one fold that is essentially all trench. It sat 2nd, straight
  // after a tutorial that is 84% helix and 0% sheet, and it is also the only fold the autopilot drops a
  // side chain on and the only one with must-slow segments in the fairness check.
  // More structures are in data/ and can be re-added here.
  ['1AEP', '1AEP.pdb', null, 'Apolipophorin III'],
  ['256B', '256B.pdb', null, 'Cytochrome b562'],
  ['2ABD', '2ABD.pdb', null, 'Acyl-CoA binding protein'],
  ['1BCF', '1BCF.pdb', null, 'Bacterioferritin'],
  ['1MBN', '1MBN.pdb', null, 'Myoglobin'],
  ['1LDG', '1LDG.pdb', null, 'Lactate dehydrogenase'],
  ['1TIM', '1TIM.pdb', null, 'Triosephosphate isomerase'],
  ['1QJ8', '1QJ8.pdb', null, 'Outer membrane protein X'],
  ['1M56', '1M56.pdb', 'A', 'Cytochrome c oxidase, subunit I'],
  // removed from the campaign: 1ENH, 1CRN, 2GB1, 1UBQ, 4HHB, 1A4Y, 3J9P(D), 1AO6, 1JB0, 1SU4, 1XI4,
  // 1JB0(*), 6EZ8, 3VKG, 1TTF, 1WIT
];

// --- idealised three-helix bundle: 3 × 40 helix residues + 2 × 12 loop residues = 144 ---
function bundle() {
  const R = 2.3, RISE = 1.5, TURN = 100 * Math.PI / 180;
  // heptad-patterned but varied sequences so the Clustal colours show; a/d positions hydrophobic
  const HELICES = [
    'DPEELIKKAVELMQRFNEWLKRHAEEVRKLTDEAYKIGQN',
    'SEEMLRKAIELNQKWFDEMRRLAEEVKKLNDQAYRIAEKG',
    'DPKTLIEEAMRLYKEFWDKLNRQAEEIRKLSEEAFKLAQR',
  ];
  const LOOPS = ['GSPNGTDYSGKP', 'GNPDGSRTGSYP'];
  for (const h of HELICES) if (h.length !== 40) throw new Error('helix seq length ' + h.length);
  for (const l of LOOPS) if (l.length !== 12) throw new Error('loop seq length ' + l.length);
  const centers = [[0, 0], [10.5, 0], [5.25, 9.1]];
  const pts = [], seq = [];
  let phase = 0;
  const helix = (hi, dir) => {
    const [cx, cy] = centers[hi];
    const out = [];
    for (let k = 0; k < 40; k++) {
      const z = dir > 0 ? k * RISE : (39 - k) * RISE;
      const a = phase + k * TURN * dir;
      out.push([cx + R * Math.cos(a), cy + R * Math.sin(a), z]);
      seq.push(HELICES[hi][k]);
    }
    phase += 40 * TURN * dir + 1.1;
    return out;
  };
  // Bezier loop from a to b bulging outward so that 13 steps of ≤4.8 Å fit
  let loopIdx = 0;
  const loop = (a, b, up) => {
    const LOOP = LOOPS[loopIdx++];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const away = [mid[0] - 5.25, mid[1] - 3.0, 0];
    const l = Math.hypot(away[0], away[1]) || 1;
    const bul = 9.0;
    const c = [mid[0] + away[0] / l * bul, mid[1] + away[1] / l * bul, mid[2] + up * 6.5];
    const bez = (t) => [0, 1, 2].map((k) => (1 - t) * (1 - t) * a[k] + 2 * (1 - t) * t * c[k] + t * t * b[k]);
    // arc-length resample into 13 equal steps -> 12 interior points
    const samp = []; for (let i = 0; i <= 400; i++) samp.push(bez(i / 400));
    const cum = [0]; for (let i = 1; i < samp.length; i++) cum.push(cum[i - 1] + Math.hypot(...[0, 1, 2].map((k) => samp[i][k] - samp[i - 1][k])));
    const L = cum[cum.length - 1];
    const out = [];
    for (let j = 1; j <= 12; j++) {
      const target = L * j / 13;
      let i = 1; while (cum[i] < target) i++;
      const f = (target - cum[i - 1]) / (cum[i] - cum[i - 1]);
      out.push([0, 1, 2].map((k) => samp[i - 1][k] + (samp[i][k] - samp[i - 1][k]) * f));
      seq.push(LOOP[j - 1]);
    }
    return out;
  };
  const h1 = helix(0, 1); pts.push(...h1);
  const h2start = (() => { const [cx, cy] = centers[1]; return [cx + R * Math.cos(phase), cy + R * Math.sin(phase), 39 * RISE]; })();
  pts.push(...loop(h1[39], h2start, 1));
  const h2 = helix(1, -1); pts.push(...h2);
  const h3start = (() => { const [cx, cy] = centers[2]; return [cx + R * Math.cos(phase), cy + R * Math.sin(phase), 0]; })();
  pts.push(...loop(h2[39], h3start, -1));
  const h3 = helix(2, 1); pts.push(...h3);
  // report max step
  let mx = 0; for (let i = 1; i < pts.length; i++) mx = Math.max(mx, Math.hypot(...[0, 1, 2].map((k) => pts[i][k] - pts[i - 1][k])));
  process.stderr.write(`bundle: ${pts.length} residues, max step ${mx.toFixed(2)} Å\n`);
  return { id: 'BUNDLE', title: 'Idealised three-helix bundle', seq: seq.join(''), num: pts.map((_, i) => i + 1), ca: pts.flat(), sc: null, meta: null };
}


// --- cofactors: the heme, NADH and metal sites the protein is actually built around.
// They are kept only when they sit close enough to the rail to be seen from the tunnel. Measured across
// the campaign, every one of them is 4.4-5.5 A off the rail against a corridor radius of ~2 A, so they
// are landmarks you fly PAST, never things you can fly through — see PLAYTEST.md.
const COF_KEEP = { HEM: 'heme', HEA: 'heme A', HEC: 'heme C', NAI: 'NADH', NAD: 'NAD', FAD: 'FAD', FMN: 'FMN',
                   CU: 'copper', CUA: 'copper', FE: 'iron', FE2: 'iron', MN: 'manganese', MG: 'magnesium', ZN: 'zinc' };
const COF_METAL = new Set(['CU', 'CUA', 'FE', 'FE2', 'MN', 'MG', 'ZN']);
const COF_NEAR = 12;   // A: nearest atom to the rail, or it is not visible from the tunnel
const COF_MAX = 3;     // keep at most this many per fold, nearest first

function cofactors(text, chain, ca, ss) {
  const rail = buildRail(ca, helixWeight(ss), ss);
  const groups = new Map();
  for (const ln of text.split(/\r?\n/)) {
    if (!ln.startsWith('HETATM')) continue;
    const rn = ln.substr(17, 3).trim();
    if (!(rn in COF_KEEP)) continue;
    if (chain && chain !== '*' && ln[21] !== chain) continue;
    const el = ln.substr(76, 2).trim();
    if (el === 'H' || el === 'D') continue;
    const key = rn + '/' + ln[21] + '/' + parseInt(ln.substr(22, 4), 10);
    if (!groups.has(key)) groups.set(key, { rn, atoms: [] });
    groups.get(key).atoms.push([+ln.substr(30, 8), +ln.substr(38, 8), +ln.substr(46, 8)]);
  }
  const out = [];
  for (const g of groups.values()) {
    let near = 1e9, nearS = 0;
    for (const a of g.atoms) {
      const w = [a[0] * SC, a[1] * SC, a[2] * SC];
      for (const nd of rail.nodes) { const d = V.len(V.sub(nd.p, w)); if (d < near) { near = d; nearS = nd.s; } }
    }
    if (near / SC > COF_NEAR) continue;
    const bonds = [];
    if (!COF_METAL.has(g.rn)) {
      for (let i = 0; i < g.atoms.length; i++) for (let j = i + 1; j < g.atoms.length; j++) {
        if (V.len(V.sub(g.atoms[i], g.atoms[j])) < 1.95) bonds.push([i, j]);
      }
    }
    out.push({ n: g.rn, name: COF_KEEP[g.rn], metal: COF_METAL.has(g.rn) ? 1 : 0,
               near: +(near / SC).toFixed(2), s: +(nearS / SC).toFixed(1),
               a: g.atoms.flat(), b: bonds });
  }
  out.sort((x, y) => x.near - y.near);
  return out.slice(0, COF_MAX);
}

const folds = [bundle()];
for (const [id, file, chain, title] of LIST) {
  const st = parseStructure(fs.readFileSync(path.join(DATA, file), 'utf8'), { chain });
  if (chain === '*') process.stderr.write(`${id}: all chains\n`);
  process.stderr.write(`${id}: chain ${st.chain} ${st.num.length} residues, "${st.title}"\n`);
  const nsc = st.sc ? st.sc.reduce((a, r) => a + r.length / 3, 0) : 0;
  process.stderr.write(`      ${nsc} side-chain atoms\n`);
  const meta = st.meta || {}; process.stderr.write(`      ${(meta.authors || []).slice(0, 3).join('; ')}${(meta.authors || []).length > 3 ? ' et al.' : ''} · ${meta.journal || '?'} ${meta.year || ''} · ${meta.doi || 'no DOI'}\n`);
  const cof = cofactors(fs.readFileSync(path.join(DATA, file), 'utf8'), chain, st.ca, psea(st.ca));
  if (cof.length) process.stderr.write(`      cofactors: ${cof.map((c) => `${c.n} ${c.a.length / 3} atoms, ${c.near} A off the rail at s=${c.s}`).join(' | ')}\n`);
  folds.push({ id, title: title || st.title, seq: st.seq, num: st.num, ca: st.ca, sc: st.sc, cof, meta: { authors: meta.authors || [], journal: meta.journal || '', year: meta.year || '', doi: meta.doi || '', citTitle: meta.citTitle || '' } });
}
// --- side-chain templates: one complete side chain per residue type and context (H / other),
// stored in the local Cα frame (t along the chain, b toward the bend centre, n = t × b), Å.
const EXPECT = { A: 1, R: 7, N: 4, D: 4, C: 2, Q: 5, E: 5, G: 0, H: 6, I: 4, L: 4, K: 5, M: 4, F: 7, P: 3, S: 2, T: 3, W: 10, Y: 8, V: 3 };
function caFrame(ca, i) {
  const c = (k) => [ca[3 * k], ca[3 * k + 1], ca[3 * k + 2]];
  const prev = c(i - 1), cur = c(i), next = c(i + 1);
  const t = V.norm(V.sub(next, prev));
  let b = V.perp(V.sub(V.add(prev, next), V.scale(cur, 2)), t);
  if (V.len(b) < 1e-3) return null;
  b = V.norm(b);
  return { t, b, n: V.cross(t, b) };
}
const templates = { H: {}, C: {} };
for (const f of folds.slice(1)) {
  if (!f.sc) continue;
  const ss = psea(f.ca);
  for (let i = 1; i < f.seq.length - 1; i++) {
    const aa = f.seq[i], ctx = ss[i] === 'H' ? 'H' : 'C';
    if (templates[ctx][aa] || !EXPECT[aa] || f.sc[i].length / 3 !== EXPECT[aa]) continue;
    const fr = caFrame(f.ca, i); if (!fr) continue;
    const loc = [];
    for (let k = 0; k < f.sc[i].length; k += 3) {
      const rel = [f.sc[i][k], f.sc[i][k + 1], f.sc[i][k + 2]];
      loc.push(+V.dot(rel, fr.t).toFixed(2), +V.dot(rel, fr.b).toFixed(2), +V.dot(rel, fr.n).toFixed(2));
    }
    templates[ctx][aa] = loc;
  }
}
for (const ctx of ['H', 'C']) for (const aa in EXPECT) if (EXPECT[aa] && !templates[ctx][aa]) { templates[ctx][aa] = templates[ctx === 'H' ? 'C' : 'H'][aa]; process.stderr.write(`template ${ctx}/${aa} borrowed\n`); }
process.stderr.write(`templates: H ${Object.keys(templates.H).length}, C ${Object.keys(templates.C).length}\n`);

let out = '// Generated by tools/make_folds.js — built-in folds (Cα at 0.1 Å, ×10 integers)\nwindow.FOLDS = [\n';
for (const f of folds) {
  // residue numbers: run-length as [start, count] pairs
  const runs = []; let s = f.num[0], c = 1;
  for (let i = 1; i < f.num.length; i++) { if (f.num[i] === f.num[i - 1] + 1) c++; else { runs.push([s, c]); s = f.num[i]; c = 1; } }
  runs.push([s, c]);
  const ca = f.ca.map((x) => Math.round(x * 10));
  const sc = f.sc ? '[' + f.sc.map((r) => '[' + r.map((x) => Math.round(x * 10)).join(',') + ']').join(',') + ']' : 'null';
  const cof = (f.cof && f.cof.length) ? '[' + f.cof.map((c) => `{n:${JSON.stringify(c.n)},name:${JSON.stringify(c.name)},metal:${c.metal},a:[${c.a.map((x) => Math.round(x * 10)).join(',')}],b:[${c.b.map((q) => '[' + q + ']').join(',')}]}`).join(',') + ']' : 'null';
  out += `{id:${JSON.stringify(f.id)},title:${JSON.stringify(f.title)},meta:${JSON.stringify(f.meta)},seq:${JSON.stringify(f.seq)},runs:${JSON.stringify(runs)},\n ca:[${ca.join(',')}],\n sc:${sc},\n cof:${cof}},\n`;
}
out += '];\n';
out += '// side-chain templates in the local Cα frame, for Cα-only chains\nwindow.SC_TEMPLATES = ' + JSON.stringify(templates) + ';\n';
process.stdout.write(out);
