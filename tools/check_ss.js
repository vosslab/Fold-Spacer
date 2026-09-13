// Sanity check: P-SEA vs HELIX/SHEET records of a PDB file.
const fs = require('fs');
const { parseStructure } = require('../parse.js');
const { psea } = require('../ss.js');
for (const f of process.argv.slice(2)) {
  const text = fs.readFileSync(f, 'utf8');
  const st = parseStructure(text);
  const ss = psea(st.ca);
  // reference from HELIX/SHEET records for the picked chain
  const ref = new Array(st.num.length).fill('C');
  const idx = new Map(st.num.map((n, i) => [n, i]));
  for (const ln of text.split('\n')) {
    if (ln.startsWith('HELIX') && ln[19] === st.chain) {
      const a = parseInt(ln.substr(21, 4)), b = parseInt(ln.substr(33, 4));
      for (let r = a; r <= b; r++) if (idx.has(r)) ref[idx.get(r)] = 'H';
    }
    if (ln.startsWith('SHEET') && ln[21] === st.chain) {
      const a = parseInt(ln.substr(22, 4)), b = parseInt(ln.substr(33, 4));
      for (let r = a; r <= b; r++) if (idx.has(r)) ref[idx.get(r)] = 'E';
    }
  }
  let agree = 0;
  for (let i = 0; i < ss.length; i++) if (ss[i] === ref[i]) agree++;
  const cnt = (s, c) => (s.match(new RegExp(c, 'g')) || []).length;
  console.log(`${f} chain ${st.chain} n=${st.num.length} title="${st.title}"`);
  console.log('  psea H=%d E=%d | ref H=%d E=%d | agree %d%%', cnt(ss, 'H'), cnt(ss, 'E'), cnt(ref.join(''), 'H'), cnt(ref.join(''), 'E'), Math.round(100 * agree / ss.length));
  console.log('  psea ' + ss);
  console.log('  ref  ' + ref.join(''));
}
