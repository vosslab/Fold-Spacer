#!/usr/bin/env node
// UI and renderer checks against the shipped page. No real-time physics: step the actual game at 60 Hz.
// Usage: node tools/visual_test.js [screenshot-directory] [standalone-page]
// FLYER_CONTROLS=1: deterministic keyboard regression suite (desktop and coarse-pointer PC).
// FLYER_BENCH=1 FLYER_VIEWPORT=1920,1080,2: frozen-draw timings, width/height/DPR.
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
async function navigate(width, height, phone, deviceScaleFactor = 1) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: phone });
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
    if (process.env.FLYER_CONTROLS) {
      for (const phone of [false, true]) {
        await navigate(1280, 800, phone);
        const results = await evaluate(`(function(){
          document.getElementById('beginbtn').click();
          function event(type,key,code,repeat){window.dispatchEvent(new KeyboardEvent(type,{key,code:code||'',repeat:!!repeat}));}
          function step(seconds,hz=60){for(var i=0;i<Math.round(seconds*hz);i++)window.frame(1/hz,true);var s=window.flyerStatus();return {x:s.x,y:s.y,rolls:s.rolls,boost:s.boost,autopilot:s.autopilot,err:s.err};}
          function reset(){window.dispatchEvent(new Event('blur'));window.loadFoldIndex(0);window.setAutopilot(false);step(3.4);}
          function down(k,code){event('keydown',k,code);}function up(k,code){event('keyup',k,code);}
          var r={};reset();down('ArrowRight');r.cardinal=step(.3);up('ArrowRight');
          reset();down('ArrowRight');down('ArrowUp');r.diagonal=step(.3);up('ArrowRight');up('ArrowUp');
          reset();down('ArrowRight');step(.45);down('ArrowUp');r.addAxis=step(.15);up('ArrowRight');r.releaseAxis=step(.3);up('ArrowUp');r.releaseAll=step(.6);
          reset();down('w','KeyW');down('a','KeyA');r.wasd=step(.3);up('w','KeyW');up('a','KeyA');
          reset();down('ArrowRight');down('d','KeyD');step(.1);up('d','KeyD');r.alias=step(.2);up('ArrowRight');
          reset();down('ArrowRight');step(.3);up('ArrowRight');down('ArrowLeft');r.reverse=step(.3);r.reverseCross=step(.1);up('ArrowLeft');
          reset();down('ArrowRight');step(.3);window.dispatchEvent(new Event('blur'));r.blur=step(.6);
          reset();down('ArrowRight');step(.3);window.flyerAction('pause');window.flyerAction('resume');r.pause=step(.6);
          reset();down('ArrowRight');step(.3);window.loadFoldIndex(0);r.restart=step(3.6);
          reset();down('ArrowRight');r.tap=step(.1);up('ArrowRight');r.tapReturn=step(.6);
          reset();down('ArrowRight');step(.1);for(var i=0;i<12;i++)event('keydown','ArrowRight','',true);r.repeat=step(.2);up('ArrowRight');
          reset();down('ArrowRight');down('ArrowLeft');r.opposed=step(.3);up('ArrowRight');up('ArrowLeft');
          reset();down('ArrowLeft');down('ArrowDown');r.downLeft=step(.3);up('ArrowLeft');up('ArrowDown');
          reset();down('ArrowRight');down('ArrowDown');r.downRight=step(.3);up('ArrowRight');up('ArrowDown');
          reset();down('ArrowRight');step(.3);Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;r.hidden=step(.6);
          reset();down('Shift','ShiftLeft');down(' ','Space');step(.1);up(' ','Space');r.boostHeld=step(.1);up('Shift','ShiftLeft');r.boostReleased=step(.1);
          reset();down('p','KeyP');up('p','KeyP');r.autopilotOn=step(.1);down('p','KeyP');up('p','KeyP');r.autopilotOff=step(.1);
          reset();down('ArrowRight');step(.3);up('ArrowRight');
          var stage=document.getElementById('stage');
          stage.dispatchEvent(new PointerEvent('pointerdown',{pointerId:17,pointerType:'touch',clientX:300,clientY:400,bubbles:true}));
          stage.dispatchEvent(new PointerEvent('pointermove',{pointerId:17,pointerType:'touch',clientX:300,clientY:330,bubbles:true}));
          r.touchTakeover=step(.2);window.dispatchEvent(new Event('blur'));
          for(var hz of [30,60,120]){reset();down('ArrowRight');down('ArrowUp');r['hz'+hz]=step(.3,hz);up('ArrowRight');up('ArrowUp');}
          return r;
        })()`);
        const r = results, tag = phone ? 'touch-PC: ' : 'desktop: ';
        check(tag + 'both diagonal axes move equally', r.diagonal.x > .25 && r.diagonal.y > .25 && Math.abs(r.diagonal.x-r.diagonal.y)<.12, r.diagonal);
        check(tag + 'diagonal speed matches cardinal', Math.abs(Math.hypot(r.diagonal.x,r.diagonal.y)-Math.abs(r.cardinal.x))<.2);
        check(tag + 'added axis responds within 150 ms', r.addAxis.y > .3);
        check(tag + 'released axis returns while the other stays held', Math.abs(r.releaseAxis.x)<.3 && r.releaseAxis.y>.5);
        check(tag + 'release returns to centre', Math.hypot(r.releaseAll.x,r.releaseAll.y)<.15);
        check(tag + 'W+A steers up-left without autopilot', r.wasd.x<-.25 && r.wasd.y>.25 && !r.wasd.autopilot);
        check(tag + 'both downward diagonals work', r.downLeft.x<-.25 && r.downLeft.y<-.25 && r.downRight.x>.25 && r.downRight.y<-.25);
        check(tag + 'releasing a WASD alias preserves held arrow', Math.abs(r.alias.x-r.cardinal.x)<.05);
        check(tag + 'holding arrow and its alias is not a double-tap', r.alias.rolls===0);
        check(tag + 'reversal turns back within 300 ms and crosses by 400 ms', r.reverse.x < r.cardinal.x-.5 && r.reverseCross.x < -.1);
        for (const name of ['blur','pause','restart','tapReturn','opposed','hidden']) check(tag + name + ' clears steering', Math.hypot(r[name].x,r[name].y)<.15);
        check(tag + 'boost aliases release independently', r.boostHeld.boost && !r.boostReleased.boost);
        check(tag + 'P toggles autopilot', r.autopilotOn.autopilot && !r.autopilotOff.autopilot);
        check(tag + 'touch takes over during keyboard return', r.touchTakeover.y>.5);
        check(tag + 'tap is smaller than hold', r.tap.x>0 && r.tap.x<r.cardinal.x*.6);
        check(tag + 'key repeat does not alter steering', Math.abs(r.repeat.x-r.cardinal.x)<.05);
        check(tag + '30/60/120 Hz steering agrees', Math.abs(r.hz30.x-r.hz120.x)<.1 && Math.abs(r.hz30.y-r.hz120.y)<.1);
        check(tag + 'no runtime errors', Object.values(r).every(s=>!s.err));
        console.log(tag + JSON.stringify(Object.fromEntries(Object.entries(r).map(([k,s])=>[k,{x:s.x,y:s.y}]))));
      }
      return;
    }
    if (process.env.FLYER_BENCH) {
      const [width, height, dpr] = (process.env.FLYER_VIEWPORT || '390,760,1').split(',').map(Number);
      await navigate(width, height, width < 640, dpr);
      const bench = await evaluate(`(function(){
        document.getElementById('intro').hidden=true;window.flyerAction('start');var rows=[];
        for(var fold of [0,6,9]){
          window.loadFoldIndex(fold);window.setAutopilot(true);
          for(var i=0;i<600;i++)window.frame(1/60,true);
          var gl=document.getElementById('gl').getContext('webgl'), times=[], pixel=new Uint8Array(4);
          for(var i=0;i<55;i++){var t=performance.now();window.frame(0);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(i>=5)times.push(performance.now()-t);}
          times.sort((a,b)=>a-b);rows.push({fold:window.flyerStatus().fold,medianMs:times[25],p95Ms:times[47],width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,gl:gl.getError()});
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
    // Resize the SAME running game, including a DPR change and returning to a small window.
    for (const [width,height,dpr] of [[1920,1080,2],[3840,2160,1],[3440,1440,1],[800,600,1]]) {
      await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:dpr,mobile:false});
      const size = await evaluate(`(function(){window.frame(0);var g=document.getElementById('gl'),h=document.getElementById('hud');return {w:g.width,h:g.height,hudW:h.width,hudH:h.height,error:window.flyerStatus().err,gl:g.getContext('webgl').getError()};})()`);
      check('bounded scene / sharp HUD at '+[width,height,dpr].join('×'), size.w*size.h<=1920*1080 && Math.abs(size.w/size.h-width/height)<.003 && size.hudW===width*dpr && size.hudH===height*dpr && !size.error && size.gl===0, size);
      if (width===1920) await shot('flight-retina');
    }
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
  finally { if (ws) ws.close(); proc.kill(); process.exitCode = failures ? 1 : 0; }
})();
