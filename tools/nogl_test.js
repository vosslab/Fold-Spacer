#!/usr/bin/env node
// Does the game SAY something when the browser refuses WebGL, instead of showing a black page?
// Builds the shipped bundle, stubs getContext('webgl') to return null before the game's script runs,
// and checks that the message lands in the card the player is already looking at.
//
// Kept separate from phone_test because it needs the stub injected ahead of the bundle's own <script>,
// which means a purpose-built page rather than the real one.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.dirname(__dirname);

const b = spawnSync('python3', [path.join(ROOT, 'tools', 'bundle.py')], { cwd: ROOT, encoding: 'utf8' });
if (b.status !== 0) { console.error('bundle failed:', b.stderr); process.exit(1); }

const src = fs.readFileSync(path.join(ROOT, 'dist', 'foldflyer.html'), 'utf8');
const stub = "<script>(function(){var g=HTMLCanvasElement.prototype.getContext;"
  + "HTMLCanvasElement.prototype.getContext=function(t){if(String(t).indexOf('webgl')>=0)return null;"
  + "return g.apply(this,arguments);};})();</script>";
const i = src.indexOf('<script>');
const page = path.join(os.tmpdir(), 'flyer_nogl_' + process.pid + '.html');
fs.writeFileSync(page, src.slice(0, i) + stub + src.slice(i));

const glob = require('fs').readdirSync(path.join(os.homedir(), '.cache', 'ms-playwright'))
  .filter((d) => d.startsWith('chromium_headless_shell-'));
if (!glob.length) { console.error('no headless_shell found'); process.exit(1); }
const CH = path.join(os.homedir(), '.cache', 'ms-playwright', glob[0], 'chrome-linux', 'headless_shell');
const PORT = 9400 + (process.pid % 90);
const proc = spawn(CH, ['--headless=new', '--remote-debugging-port=' + PORT, '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, note) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? ' · ' + note : ''}`); };

(async () => {
  await sleep(2000);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((x) => x.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } });
  const send = (method, params) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

  await send('Page.enable', {});
  await send('Page.navigate', { url: 'file://' + page });
  await sleep(3000);

  const msg = await evaluate("(function(){var o=document.getElementById('nogl');return o?o.textContent:'';})()");
  check('a browser without WebGL is told why', /WebGL/.test(String(msg)), String(msg).slice(0, 60) + '…');
  const introShown = await evaluate("(function(){var i=document.getElementById('intro');return !!i && !i.hidden;})()");
  check('the message is shown, not hidden behind a dismissed card', introShown === true);
  const err = await evaluate("(function(){try{return String(window.flyerStatus().err);}catch(e){return 'no status';}})()");
  check('the failure is recorded rather than thrown', /WebGL/.test(String(err)), String(err).slice(0, 40));

  proc.kill();
  try { fs.unlinkSync(page); } catch (e) { /* fine */ }
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
