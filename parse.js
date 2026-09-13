// Fold Flyer — structure parser (PDB + mmCIF, Cα only, first model).
// Works in the browser (global `parseStructure`) and in node (module.exports).
(function (root) {
  'use strict';

  const AA3 = {
    ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G',
    HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S',
    THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M', SEC: 'C', PYL: 'K',
  };
  const AA1 = {};
  for (const k in AA3) if (!(AA3[k] in AA1) || k.length === 3 && !['MSE', 'SEC', 'PYL'].includes(k)) AA1[AA3[k]] = k;

  function okAlt(a) { return a === '' || a === ' ' || a === '.' || a === '?' || a === 'A'; }

  const BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT']);
  // Group atoms by chain and residue; each residue keeps its Cα and its heavy side-chain atoms.
  function collect(atoms) {
    const chains = new Map();
    for (const a of atoms) {
      let arr = chains.get(a.chain);
      if (!arr) { arr = []; chains.set(a.chain, arr); }
      let res = arr.length ? arr[arr.length - 1] : null;
      if (!res || res.num !== a.num) { res = { name: a.name, num: a.num, ca: null, sc: [] }; arr.push(res); }
      if (a.atom === 'CA') { if (!res.ca) res.ca = [a.x, a.y, a.z]; }
      else if (!BACKBONE.has(a.atom) && !res.sc.some((q) => q.atom === a.atom)) res.sc.push({ atom: a.atom, x: a.x, y: a.y, z: a.z });
    }
    for (const [id, arr] of chains) chains.set(id, arr.filter((r) => r.ca));
    return chains;
  }
  const isHydrogen = (atom, elem) => elem ? elem === 'H' || elem === 'D' : /^[0-9]*[HD]/.test(atom) && !/^H[GEO]$/.test(atom) && !/^HE$/.test(atom);

  function parsePDB(text) {
    const atoms = [];
    let title = '', header = '';
    const meta = { authors: [], journal: '', year: '', doi: '', citTitle: '' };
    let authStr = '', jAuth = '', jTitl = '', jRef = '';
    const lines = text.split(/\r?\n/);
    for (const ln of lines) {
      const rec = ln.substr(0, 6);
      if (rec === 'ENDMDL') break;
      if (rec === 'HEADER') { header = ln.substr(10, 40).trim(); continue; }
      if (rec === 'AUTHOR') { authStr += (authStr && !authStr.endsWith(',') ? ',' : '') + ln.substr(10, 69).trim(); continue; }
      if (rec === 'JRNL  ') {
        const sub = ln.substr(12, 4).trim(), val = ln.substr(19, 60).trim();
        if (sub === 'AUTH') jAuth += (jAuth && !jAuth.endsWith(',') ? ',' : '') + val;
        else if (sub === 'TITL') jTitl += (jTitl ? ' ' : '') + val;
        else if (sub === 'REF') jRef += (jRef ? ' ' : '') + val;
        else if (sub === 'DOI') meta.doi = val.replace(/^DOI:\s*/i, '');
        continue;
      }
      if (rec === 'COMPND') {
        const m = /MOLECULE:\s*([^;]+)/.exec(ln);
        if (m && !title) title = m[1].trim();
        continue;
      }
      if (rec !== 'ATOM  ' && !(rec === 'HETATM' && ln.substr(17, 3) === 'MSE')) continue;
      if (!okAlt(ln[16])) continue;
      const resn = ln.substr(17, 3).trim();
      if (!(resn in AA3)) continue;
      const atom = ln.substr(12, 4).trim();
      const elem = ln.substr(76, 2).trim();
      if (isHydrogen(atom, elem)) continue;
      atoms.push({
        atom, name: resn, chain: ln[21], num: parseInt(ln.substr(22, 4), 10),
        x: parseFloat(ln.substr(30, 8)), y: parseFloat(ln.substr(38, 8)), z: parseFloat(ln.substr(46, 8)),
      });
    }
    const dep = authStr.split(',').map((a) => a.trim()).filter(Boolean), cit = jAuth.split(',').map((a) => a.trim()).filter(Boolean);
    const auth = dep.length >= 2 || !cit.length ? dep : cit; // depositors get the credit unless the record names only one
    meta.authors = auth.map((a) => { const m = /^([A-Z.\-]+\.)([A-Z][A-Za-z'\-()]+)$/.exec(a.replace(/\s+/g, '')); return m ? `${m[2]} ${m[1]}` : a; }); // H.C.WATSON -> WATSON H.C.
    meta.authors = meta.authors.map((a) => a.replace(/^([A-Z][A-Z'\-()]+)\b/, (w) => w.split(/([\-(])/).map((q) => q.length > 1 ? q[0] + q.slice(1).toLowerCase() : q).join('')));
    if (jRef && !/TO BE PUBLISHED/i.test(jRef)) { const y = /(19|20)\d\d\s*$/.exec(jRef); meta.year = y ? y[0].trim() : ''; meta.journal = jRef.replace(/\s+V\.\s+\d+.*$/, '').trim(); }
    meta.citTitle = jTitl;
    return { atoms, title: title || header || 'Untitled', meta };
  }

  // Tokenise one mmCIF data row (handles 'quoted' and "quoted" tokens).
  function cifTokens(ln) {
    const out = [];
    const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(ln))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    return out;
  }

  function parseCIF(text) {
    const lines = text.split(/\r?\n/);
    const atoms = [];
    let title = '';
    const meta = { authors: [], journal: '', year: '', doi: '', citTitle: '' };
    const cifVal = (i) => { const rest = lines[i].replace(/^\S+\s*/, '').trim(); if (rest) return cifTokens(rest)[0] || ''; const nx = lines[i + 1] || ''; return nx[0] === ';' ? nx.substr(1).trim() : (cifTokens(nx)[0] || ''); };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.startsWith('_citation.title') && !meta.citTitle) { meta.citTitle = cifVal(i); continue; }
      if (ln.startsWith('_citation.journal_abbrev') && !meta.journal) { meta.journal = cifVal(i); continue; }
      if (ln.startsWith('_citation.year') && !meta.year) { meta.year = cifVal(i); continue; }
      if (ln.startsWith('_citation.pdbx_database_id_DOI') && !meta.doi) { const v = cifVal(i); meta.doi = v === '?' ? '' : v; continue; }
      if (ln.startsWith('_struct.title')) {
        const rest = ln.substr(13).trim();
        if (rest) title = cifTokens(rest)[0] || '';
        else if (lines[i + 1] && lines[i + 1][0] === ';') title = lines[i + 1].substr(1).trim();
        else if (lines[i + 1]) title = cifTokens(lines[i + 1])[0] || '';
        continue;
      }
      if (ln.trim() !== 'loop_') continue;
      // read column headers
      const cols = [];
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith('_')) { cols.push(lines[j].trim().split(/\s+/)[0]); j++; }
      if (cols.length && cols[0].startsWith('_citation_author.')) { // primary citation authors
        const cId = cols.indexOf('_citation_author.citation_id'), cName = cols.indexOf('_citation_author.name');
        for (; j < lines.length; j++) { const row = lines[j]; if (!row || row[0] === '#' || row.startsWith('loop_') || row[0] === '_') break; const t = cifTokens(row); if (t.length >= cols.length && (cId < 0 || t[cId] === 'primary') && cName >= 0) meta.authors.push(t[cName]); }
        i = j - 1; continue;
      }
      if (cols.length && cols[0].startsWith('_audit_author.')) {
        const cName = cols.indexOf('_audit_author.name'); const tmp = [];
        for (; j < lines.length; j++) { const row = lines[j]; if (!row || row[0] === '#' || row.startsWith('loop_') || row[0] === '_') break; const t = cifTokens(row); if (t.length >= cols.length && cName >= 0) tmp.push(t[cName]); }
        meta.depositors = tmp; i = j - 1; continue;
      }
      if (!cols.length || !cols[0].startsWith('_atom_site.')) { i = j - 1; continue; }
      const ix = (n) => cols.indexOf('_atom_site.' + n);
      const cGroup = ix('group_PDB'), cAtom = ix('label_atom_id'), cAlt = ix('label_alt_id'),
        cComp = ix('label_comp_id'), cAuthAsym = ix('auth_asym_id'), cLabAsym = ix('label_asym_id'),
        cAuthSeq = ix('auth_seq_id'), cLabSeq = ix('label_seq_id'),
        cX = ix('Cartn_x'), cY = ix('Cartn_y'), cZ = ix('Cartn_z'), cModel = ix('pdbx_PDB_model_num'), cSym = ix('type_symbol');
      let firstModel = null;
      for (; j < lines.length; j++) {
        const row = lines[j];
        if (!row || row[0] === '#' || row.startsWith('loop_') || row[0] === '_' || row.startsWith('data_')) break;
        const t = cifTokens(row);
        if (t.length < cols.length) continue;
        if (cGroup >= 0 && t[cGroup] !== 'ATOM' && !(t[cGroup] === 'HETATM' && t[cComp] === 'MSE')) continue;
        if (cAlt >= 0 && !okAlt(t[cAlt])) continue;
        const atom = t[cAtom];
        if (isHydrogen(atom, cSym >= 0 ? t[cSym].toUpperCase() : '')) continue;
        if (cModel >= 0) { if (firstModel === null) firstModel = t[cModel]; else if (t[cModel] !== firstModel) break; }
        const resn = t[cComp];
        if (!(resn in AA3)) continue;
        const chain = (cAuthAsym >= 0 && t[cAuthAsym] !== '?' && t[cAuthAsym] !== '.') ? t[cAuthAsym] : t[cLabAsym];
        let num = cAuthSeq >= 0 ? parseInt(t[cAuthSeq], 10) : NaN;
        if (isNaN(num) && cLabSeq >= 0) num = parseInt(t[cLabSeq], 10);
        atoms.push({ atom, name: resn, chain, num, x: parseFloat(t[cX]), y: parseFloat(t[cY]), z: parseFloat(t[cZ]) });
      }
      i = j - 1;
    }
    if (meta.depositors && meta.depositors.length) meta.authors = meta.depositors; // depositors get the credit; citation authors are the fallback
    if (meta.journal === '?') meta.journal = ''; if (meta.year === '?') meta.year = '';
    return { atoms, title: title || 'Untitled', meta };
  }

  // Returns {title, chain, seq, names, num[], ca (flat Å), sc (per residue: flat side-chain heavy atoms relative to Cα, Å; [] if none)}
  function parseStructure(text, opts) {
    opts = opts || {};
    const isCif = /_atom_site\./.test(text);
    const { atoms, title, meta } = isCif ? parseCIF(text) : parsePDB(text);
    const chains = collect(atoms);
    if (!chains.size) throw new Error('No Cα atoms found');
    let best = null, arr;
    if (opts.chain === '*') { best = '*'; arr = []; for (const [, a] of chains) arr.push(...a); }
    else {
      if (opts.chain && chains.has(opts.chain)) best = opts.chain;
      else for (const [id, a] of chains) if (!best || a.length > chains.get(best).length) best = id;
      arr = chains.get(best);
    }
    const ca = new Array(arr.length * 3);
    let seq = '';
    const names = [], num = [], sc = [];
    let anySc = false;
    arr.forEach((r, i) => {
      ca[3 * i] = r.ca[0]; ca[3 * i + 1] = r.ca[1]; ca[3 * i + 2] = r.ca[2];
      seq += AA3[r.name]; names.push(r.name); num.push(r.num);
      const rel = [];
      for (const q of r.sc) rel.push(q.x - r.ca[0], q.y - r.ca[1], q.z - r.ca[2]);
      if (rel.length) anySc = true;
      sc.push(rel);
    });
    return { title, chain: best, seq, names, num, ca, sc: anySc ? sc : null, meta };
  }

  const api = { parseStructure, AA3, AA1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
