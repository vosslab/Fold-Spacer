#!/usr/bin/env node
// UI and renderer checks against the shipped page. No real-time physics: step the actual game at 60 Hz.
// Usage: node tools/visual_test.js [screenshot-directory] [standalone-page]
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const root = path.dirname(__dirname);
const output = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'flyer-visual-'));
fs.mkdirSync(output, { recursive: true });
const page = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'dist/FoldFlyer.html');
if (!process.argv[3]) {
  const build = spawnSync('python3', [path.join(__dirname, 'bundle.py')], { encoding: 'utf8' });
  if (build.status) throw new Error(build.stderr);
}
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const chrome = path.join(cache, fs.readdirSync(cache).find(x => x.startsWith('chromium_headless_shell')), 'chrome-linux/headless_shell');
const proc = spawn(chrome, ['--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws, id = 0, failures = 0;
const pending = new Map(), pause = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, value) { console.log((ok ? 'ok   ' : 'FAIL ') + name + (value === undefined ? '' : ' · ' + JSON.stringify(value))); if (!ok) failures++; }
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const seq = ++id; pending.set(seq, { resolve, reject }); ws.send(JSON.stringify({ id: seq, method, params })); });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + (r.exceptionDetails.exception || {}).description);
  return r.result.value;
}
async function shot(name) {
  await evaluate('window.frame(0)');
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(r.data, 'base64'));
}
async function key(key, code, type = 'keyDown') { await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: key === ' ' ? 32 : key === 'Escape' ? 27 : key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0) }); }
async function navigate(width, height, phone) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
  await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
  await send('Page.navigate', { url: 'file://' + page });
  for (let n = 0; n < 100; n++) { if (await evaluate('typeof window.flyerStatus === "function"')) break; await pause(100); }
  await evaluate('window.frame(0)');
}
(async () => {
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let log = '';
      const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 10000);
      proc.stderr.on('data', b => { log += b; const m = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
      proc.on('error', reject);
    });
    const origin = new URL(endpoint); const tabs = await (await fetch('http://' + origin.host + '/json')).json();
    ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => { ws.onopen = resolve; });
    ws.onmessage = e => { const d = JSON.parse(e.data), p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } };
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame=function(){return 0;};window.MARATHON=false;' });
    if (process.env.FLYER_BENCH) {
      await navigate(390, 760, true);
      const bench = await evaluate(`(function(){
        document.getElementById('intro').hidden=true;window.flyerAction('start');var rows=[];
        for(var fold of [0,6,9]){
          window.loadFoldIndex(fold);window.setAutopilot(true);
          for(var i=0;i<600;i++)window.frame(1/60,true);
          var gl=document.getElementById('gl').getContext('webgl'), times=[], pixel=new Uint8Array(4);
          for(var i=0;i<55;i++){var t=performance.now();window.frame(0);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(i>=5)times.push(performance.now()-t);}
          times.sort((a,b)=>a-b);rows.push({fold:window.flyerStatus().fold,medianMs:times[25],p95Ms:times[47],gl:gl.getError()});
        }return rows;
      })()`);
      console.log(JSON.stringify(bench));
      return;
    }
    await navigate(390, 760, true);
    check('phone layout has no horizontal overflow', await evaluate('document.documentElement.scrollWidth === innerWidth'));
    await shot('intro-phone');
    await evaluate('document.getElementById("learnbtn").click()');
    check('help opens before starting', await evaluate('document.getElementById("help").open && !document.getElementById("intro").hidden'));
    await shot('help-phone');
    await key('Escape', 'Escape'); await key('Escape', 'Escape', 'keyUp');
    check('Escape closes help and preserves welcome', await evaluate('!document.getElementById("help").open && !document.getElementById("intro").hidden'));
    await evaluate('document.getElementById("beginbtn").focus()');
    await key(' ', 'Space'); await key(' ', 'Space', 'keyUp');
    check('Space activates the focused Begin button', await evaluate('document.getElementById("intro").hidden'));
    await evaluate('for(var i=0;i<240;i++)window.frame(1/60,true);window.frame(0)');
    check('flight advances without errors', await evaluate('window.flyerStatus().t > 0 && !window.flyerStatus().err'), await evaluate('window.flyerStatus().err'));
    await evaluate('document.getElementById("menubtn").click(); document.getElementById("helpbtn").click()');
    const t0 = await evaluate('window.flyerStatus().t');
    await evaluate('for(var i=0;i<120;i++)window.frame(1/60,true)');
    check('help pauses a running flight', await evaluate('window.flyerStatus().t') === t0);
    await key('n', 'KeyN'); await key('n', 'KeyN', 'keyUp');
    check('help blocks gameplay shortcuts', await evaluate('window.flyerStatus().fold === "BUNDLE"'));
    await evaluate('document.getElementById("helpclose").click()');
    await pause(30);
    await evaluate('for(var i=0;i<60;i++)window.frame(1/60,true)');
    check('closing help resumes the same flight', await evaluate('window.flyerStatus().t > ' + t0));
    const cases = [[0,34,'bundle-phone'],[6,34,'ldg34'],[6,72,'ldg72'],[9,120,'m56120'],[8,70,'qj870'],[5,65,'mbn65']];
    for (const [fold, res, name] of cases) {
      // The rounded preview diagnostic reaches zero a frame before the old residue is refreshed.
      // Always step through the entire 3.2-second preview before reading residue-based capture state.
      const metrics = await evaluate(`(function(){window.loadFoldIndex(${fold});window.setAutopilot(true);for(var i=0;i<9000 && (i<200 || window.flyerStatus().res < ${res} || window.flyerStatus().preview !== 0);i++)window.frame(1/60,true);window.frame(0);var gl=document.getElementById('gl').getContext('webgl');return {error:window.flyerStatus().err,res:window.flyerStatus().res,glError:gl.getError()};})()`);
      check(name + ' renders cleanly at the requested residue', !metrics.error && metrics.glError === 0 && metrics.res >= res && metrics.res <= res + 1, metrics);
      await shot(name);
    }
    await navigate(1280, 800, false); await shot('intro-desktop');
    await evaluate('document.getElementById("beginbtn").click();window.setAutopilot(true);for(var i=0;i<450;i++)window.frame(1/60,true)');
    await shot('flight-desktop');
    check('desktop help menu is reachable', await evaluate('getComputedStyle(document.getElementById("touchbar")).display !== "none"'));
    await evaluate('document.getElementById("menubtn").focus(); document.getElementById("menubtn").click()');
    await key('Escape', 'Escape'); await key('Escape', 'Escape', 'keyUp');
    check('Escape closes a keyboard-focused menu', await evaluate('document.getElementById("menurow").hidden && document.getElementById("menubtn").getAttribute("aria-expanded") === "false"'));
    for (const [width, height, name] of [[320,568,'small-phone'], [844,390,'landscape']]) {
      await navigate(width,height,true);
      const layout = await evaluate('(function(){var b=document.getElementById("beginbtn").getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};})()');
      check(name + ' keeps Begin reachable', !layout.overflow && layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom <= height, layout);
      await shot('intro-' + name);
    }
    // No index extension: the largest campaign mesh must still fit and draw using WebGL1 indices.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'var getExt=WebGLRenderingContext.prototype.getExtension;WebGLRenderingContext.prototype.getExtension=function(n){return n==="OES_element_index_uint"?null:getExt.call(this,n);};' });
    await navigate(390,760,true);
    const fallback = await evaluate('(function(){document.getElementById("beginbtn").click();window.loadFoldIndex(9);for(var i=0;i<240;i++)window.frame(1/60,true);window.frame(0);return {err:window.flyerStatus().err,gl:document.getElementById("gl").getContext("webgl").getError()};})()');
    check('largest fold renders without the index extension', !fallback.err && fallback.gl === 0, fallback);
    console.log('Screenshots: ' + output);
  } catch (e) { failures++; console.error(e.stack); }
  finally { if (ws) ws.close(); proc.kill(); }
  process.exitCode = failures ? 1 : 0;
})();
