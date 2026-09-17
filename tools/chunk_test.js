// Exercise the production chunk-cache lifecycle with a tiny, deterministic mesh.
// No browser or GPU needed. Actual ball-and-stick appearance is covered by visual_test.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../src/game/runtime.js'), 'utf8');
const start = source.indexOf('  const newGeom =');
const end = source.indexOf('  // faint ghosts', start);
assert(start >= 0 && end > start);
const context = vm.createContext({ assert, console, Float32Array, Uint32Array });
vm.runInContext(`
let scheme = 'clustal', full = 0, colours = 0, poses = 0, disposed = 0;
const P = { t: 0, s: 0 }, A = x => x;
const blocks = [{ s: 1, f: 0, type: 'H', judged: false }, { s: 2, f: 1, type: 'E', judged: true }];
const renderer = {
  upload(g, m) { full++; return { pos: g.pos.slice(), col: g.col.slice() }; },
  updateColours(m, c) { colours++; m.col.set(c); },
  updatePose(m, p, n, first) { poses++; m.pos.set(p, first*3); },
  updateBounds() {},
  dispose() { disposed++; }
};
const blockDir = b => b.f, visLen = b => 1;
const blockColour = b => [b.f, scheme === 'clustal' ? 0 : 1, b.f === 0 ? P.t : 1];
function pushSideChain(g, b, dir, len, col) {
  for (let i=0;i<3;i++) { g.pos.push(dir,i,len); g.nrm.push(0,1,0); g.col.push(...col); }
  g.idx.push(0,1,2);
}
${source.slice(start, end)}
buildChunks(); updateChunks();
assert.equal(full, 1); assert.equal(colours, 0);
updateChunks(); assert.equal(full, 1); assert.equal(colours, 0);
P.t++; updateChunks();
assert.equal(full, 1); assert.equal(colours, 1); assert.equal(chunks[0].mesh.col[2], 1);
blocks[0].judged = true; blocks[0].anim = true; blocks[0].f = .5;
P.t++; updateChunks(); assert.equal(full, 1); assert.equal(poses, 1); assert.equal(chunks[0].mesh.pos[0], .5);
blocks[0].f = 1; P.t++; updateChunks();
assert.equal(full, 1); assert.equal(poses, 2); assert.equal(chunks[0].mesh.pos[0], 1);
P.t++; updateChunks(); assert.equal(full, 1); assert.equal(colours, 3);
scheme = 'class'; updateChunks();
assert.equal(full, 1); assert.equal(colours, 4);
assert.equal(chunks[0].mesh.col[1], 1); assert.equal(chunks[0].mesh.col[10], 1);
blocks[0].f = 0; blocks[0].anim = false; blocks[0].judged = false;
rebuildBlockMesh(); updateChunks(); assert.equal(full, 2); assert.equal(chunks[0].mesh.pos[0], 0);
buildChunks(); updateChunks(); assert.equal(disposed, 1); assert.equal(full, 3);
console.log('PASS chunk cache: frozen frames, colour-only pulses, swing, final pose, scheme, restart, disposal');
`, context);
