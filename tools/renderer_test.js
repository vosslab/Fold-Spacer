// Buffer lifecycle and conservative culling checks, without browser timing noise.
const assert = require('assert');
const { createRenderer, meshRanges, outsideFrustum } = require('../gl.js');
const planes = [1,0,0,1, -1,0,0,1, 0,1,0,1, 0,-1,0,1, 0,0,1,1, 0,0,-1,1];
const ranges = meshRanges(new Float32Array([-2,0,0, 2,0,0, 0,2,0, 5,0,0, 6,0,0, 5,1,0]), new Uint16Array([0,1,2,3,4,5]), 3);
assert.equal(ranges.length, 2);
assert(!outsideFrustum(ranges[0], planes)); // crosses the view: never reject by centre alone
assert(outsideFrustum(ranges[1], planes));

for (const uint of [true, false]) {
  const bound = new Map(), calls = [], allocations = [];
  const gl = new Proxy({ UNSIGNED_INT: 5125, UNSIGNED_SHORT: 5123,
    createBuffer: () => ({}), getExtension: () => uint ? {} : null,
    getShaderParameter: () => true, getProgramParameter: () => true,
    bindBuffer(target, b) { bound.set(target, b); },
    bufferData(target, data) {
      const b = bound.get(target);
      b.bytes = typeof data === 'number' ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
      allocations.push(target);
    },
    bufferSubData(target, offset, data) {
      const b = bound.get(target); assert(offset + data.byteLength <= b.bytes.length);
      b.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
    },
    drawElements(mode, count, type, offset) {
      assert(offset + count * (type === 5125 ? 4 : 2) <= bound.get('ELEMENT_ARRAY_BUFFER').bytes.length);
      calls.push({count, type, offset});
    }
  }, { get(o, k) { return k in o ? o[k] : /^[A-Z_]+$/.test(k) ? k : () => ({}); } });
  const renderer = createRenderer({getContext: () => gl});
  const data = new Float32Array([0,0,0, .5,0,0, 0,.5,0]);
  const g = {pos:data,nrm:data,col:data,idx:new Uint32Array([0,1,2]),stream:true,indexCount:3,capacityBytes:96};
  const m = renderer.upload(g);
  assert.equal(m.type, uint ? 5125 : 5123);
  const firstAllocations = allocations.length;
  renderer.upload(g, m); assert.equal(allocations.length, firstAllocations);
  renderer.upload({...g,indexCount:0},m); assert.equal(m.count, 0);
  renderer.updateColours(m, new Float32Array([.1,.2,.3]), 1);
  renderer.updatePose(m, new Float32Array([.4,.5,.6]), new Float32Array([0,1,0]), 1);
  assert(Math.abs(new Float32Array(m.vPos.bytes.buffer)[3] - .4) < 1e-6);
  renderer.upload({...g,idx:new Uint32Array([0,1,2,0,2,1]),indexCount:6},m);
  assert.equal(allocations.length, firstAllocations + 1); // only the new topology
  const identity = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  renderer.begin(100,100,identity,identity,[0,1,0],[0,0,0],1,10);
  renderer.updateBounds(m,new Float32Array([5,0,0,6,1,0]));
  renderer.draw(m); assert.equal(calls.length,0);
  global.NO_FRUSTUM = true; renderer.draw(m); delete global.NO_FRUSTUM;
  assert.equal(calls.length,1);
  assert.equal(calls[0].count,6);
  const spatial = renderer.upload({pos:new Float32Array([-2,0,0,2,0,0,0,2,0]),nrm:data,col:data,idx:new Uint32Array([0,1,2]),spatial:true});
  renderer.draw(spatial); assert.equal(calls.length,2);
  renderer.dispose(m); assert.equal(m.count,0);
}
console.log('PASS renderer: conservative bounds, resident indices, stream capacity, partial uploads, zero counts, 16/32-bit indices');
