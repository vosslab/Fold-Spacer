// Turning-rate metrics for the rail: how hard the camera has to turn per Å of flight.
// usage: node tools/rail_metrics.js [coilSmooth upRelax] files...
const fs = require('fs'), path = require('path');
const { parseStructure } = require('../parse.js');
const { psea, helixWeight } = require('../ss.js');
const { buildRail, V } = require('../rail.js');
const args = process.argv.slice(2);
let opts = null;
if (args[0] && args[0].startsWith('{')) opts = JSON.parse(args.shift());
const CHAIN = { '4HHB': 'A', '3J9P': 'D' };
console.log(`${'fold'.padEnd(6)} ${'n'.padStart(4)} ${'len Å'.padStart(6)} ${'turn°/Å'.padStart(8)} ${'p95'.padStart(6)} ${'max'.padStart(6)} ${'sharp'.padStart(5)} ${'roll°/Å'.padStart(8)}  ss`);
for (const f of args) {
  const id = path.basename(f).split('.')[0].toUpperCase();
  const st = parseStructure(fs.readFileSync(f, 'utf8'), { chain: CHAIN[id] });
  const ss = psea(st.ca), hw = helixWeight(ss);
  const rail = buildRail(st.ca, hw, ss, opts);
  const nd = rail.nodes, turns = [], rolls = [];
  let sharp = 0;
  for (let i = 1; i < nd.length; i++) {
    const ds = (nd[i].s - nd[i - 1].s) / 7; if (ds < 1e-6) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(nd[i].t, nd[i - 1].t)))) * 180 / Math.PI / ds;
    turns.push(ang); if (ang > 25) sharp++;
    // roll: rotation of u about t between samples, beyond what the tangent change forces
    const up = V.norm(V.perp(nd[i - 1].u, nd[i].t));
    rolls.push(Math.acos(Math.max(-1, Math.min(1, V.dot(up, nd[i].u)))) * 180 / Math.PI / ds);
  }
  turns.sort((a, b) => a - b);
  const mean = turns.reduce((a, b) => a + b, 0) / turns.length, p95 = turns[Math.floor(turns.length * 0.95)], mx = turns[turns.length - 1];
  const roll = rolls.reduce((a, b) => a + b, 0) / rolls.length;
  const cnt = (c) => (ss.match(new RegExp(c, 'g')) || []).length;
  console.log(`${id.padEnd(6)} ${String(st.num.length).padStart(4)} ${(rail.length / 7).toFixed(0).padStart(6)} ${mean.toFixed(1).padStart(8)} ${p95.toFixed(1).padStart(6)} ${mx.toFixed(0).padStart(6)} ${String(sharp).padStart(5)} ${roll.toFixed(2).padStart(8)}  H${cnt('H')} E${cnt('E')} C${cnt('C')}`);
}
