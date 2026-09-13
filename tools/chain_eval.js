/* Plays the whole campaign in one headless run and reports every fold.
   Run it with tools/chain_eval.sh — that wrapper strips this comment and flattens the rest to one line.

   Three traps in writing this harness, each of which fooled me once:

   1. The eval is flattened to ONE line, so this file must never use a line comment — one would silently
      swallow the entire rest of the script.
   2. The branches must be exclusive (else if). Advancing off the ninth fold and logging the tenth
      otherwise happen in the SAME frame, and the tenth row comes out carrying the ninth fold's data.
   3. `done` does NOT go false the moment the next fold loads: the pre-race preview orbit leaves it true,
      with `t` frozen at the finished fold's time, for as long as the orbit lasts. Gating on the fold id
      changing does not help either, since the id changes on the very next frame. The harness must wait
      until the new fold is genuinely running - `done` observed false - before it may log again.
      Without that it walks all ten folds in ten frames and reports the bundle's time, score and rank
      under all ten names.
*/
window.__chain = 0; window.__log = []; window.__wait = 0;
var of = window.frame;
window.frame = function (dt, skip) {
  of(dt, skip);
  var st = window.flyerStatus();
  var ready = st.done && st.t > 2 && !st.preview;
  if (window.__wait) { if (!st.done) window.__wait = 0; }
  else if (ready && window.__chain < 9) {
    window.__log.push([st.fold, st.fixed + '/' + st.total, st.rank, +st.t.toFixed(1), st.score, st.runFolds]);
    window.__chain++; window.__wait = 1;
    window.flyerAction('next'); window.setAutopilot(true);
  }
  else if (ready && window.__chain === 9 && !window.__last) {
    window.__last = 1;
    window.__log.push([st.fold, st.fixed + '/' + st.total, st.rank, +st.t.toFixed(1), st.score, st.runFolds]);
  }
  if (window.__log.length) st.chain = window.__log;
};
