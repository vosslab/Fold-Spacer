// Fold Spacer — a small, original generative score. Web Audio only; no files, timers or network.
(function (root) {
  'use strict';
  const EIGHTH = 60 / 78 / 2;
  const CHORDS = [[0, 4, 7, 14], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, 2, 7, 9]];
  const MELODY = [0, 2, 1, 3, 2, 1, 3, 1];
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
  const hz = semis => 110 * Math.pow(2, semis / 12);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function createFlightAudio(context) {
    let ac = context || null, master = null, bed = null, playing = false, finished = false;
    let flow = 0, groove = 0, beat = 0, next = 0, melodyNote = 0, scheduled = 0, peakVoices = 0;
    let approaches = 0, claims = 0;
    const voices = new Set();
    function graph() {
      master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
      bed = ac.createGain(); bed.gain.value = 1; bed.connect(master);
    }
    if (ac) graph(); // OfflineAudioContext in the audio-render test; no browser gesture needed there.
    function unlock() {
      try {
        if (!ac) {
          const Audio = root.AudioContext || root.webkitAudioContext;
          if (!Audio) return;
          ac = new Audio(); graph();
          if (playing) master.gain.setTargetAtTime(0.45, ac.currentTime, 0.08);
        }
        if (ac.state === 'suspended' && ac.resume) {
          const p = ac.resume(); if (p && p.catch) p.catch(() => {});
        }
      } catch (e) { /* Sound is optional, including a rejected autoplay request. */ }
    }
    function clearVoices() {
      if (!ac) return;
      const now = ac.currentTime;
      for (const v of voices) {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setTargetAtTime(0.0001, now, 0.008);
        v.o.stop(now + 0.04);
      }
      // onended disconnects each node, including voices whose scheduled start was cancelled.
    }
    function play(on) {
      on = !!on;
      if (on === playing) return;
      playing = on;
      if (!ac) return;
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setTargetAtTime(on ? 0.45 : 0, ac.currentTime, on ? 0.08 : 0.012);
      if (on) { beat -= beat % 8; next = ac.currentTime + 0.04; }
      else clearVoices();
    }
    function voice(freq, dur, type, gain, when, music, attack, slide) {
      if (!ac || !playing || voices.size >= 32) return;
      const t = Math.max(ac.currentTime, when), a = Math.min(dur * 0.4, attack || 0.008);
      const o = ac.createOscillator(), g = ac.createGain();
      g.gain.value = 0.0001;
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(clamp(gain, 0.0001, 0.06), t + a);
      if (music && a > 0.1) g.gain.linearRampToValueAtTime(clamp(gain * 0.8, 0.0001, 0.06), t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(music ? bed : master);
      const v = { o, g }; voices.add(v);
      o.onended = () => { o.disconnect(); g.disconnect(); voices.delete(v); };
      o.start(t); o.stop(t + dur + 0.02);
      scheduled++; peakVoices = Math.max(peakVoices, voices.size);
    }
    function tone(freq, dur, type, gain, slide, delay) {
      if (ac) voice(freq, dur, type, gain || 0.04, ac.currentTime + (delay || 0), false, 0.008, slide);
    }
    function level() { return clamp(flow + groove * 0.16, 0, 1); }
    function pump(now) {
      if (!ac || !playing || finished) return;
      now = now === undefined ? ac.currentTime : now;
      // Audio-clock lookahead, not frame-count timing. Skip missed beats after a stall; never burst
      // a backlog of notes on return. At most one eighth-note is due in the 120 ms lookahead.
      if (next < now - 0.15) {
        const missed = Math.ceil((now - next) / EIGHTH);
        beat += missed; next += missed * EIGHTH;
      }
      while (next < now + 0.12) {
        const chord = CHORDS[Math.floor(beat / 16) % CHORDS.length], k = beat % 16, energy = level();
        if (k === 0 || k === 8) {
          for (const n of [chord[0], chord[2], chord[3]]) voice(hz(n + 12), EIGHTH * 9, 'sine', 0.022, next, true, 0.3);
        }
        if (energy > 0.2 && k % 4 === 0) voice(hz(chord[0] - 12), 0.65, 'triangle', 0.032 * energy, next, true, 0.018);
        if (energy > 0.45 && k % 2 === 0) {
          const n = chord[MELODY[(k / 2) % MELODY.length]];
          voice(hz(n + 24), 0.48, 'triangle', 0.027 * energy, next, true, 0.015);
        }
        if (energy > 0.75 && k % 4 === 3) voice(hz(chord[3] + 24), 0.6, 'sine', 0.012 * energy, next, true, 0.02);
        beat++; next += EIGHTH;
      }
    }
    function advance(dt, slipstream) {
      flow = Math.max(0, flow - Math.max(0, dt) * 0.018);
      groove = clamp(slipstream || 0, 0, 1);
    }
    function hit(perfect) {
      flow = Math.min(1, flow + (perfect ? 0.14 : 0.075));
      const n = PENTA[melodyNote++ % PENTA.length];
      tone(hz(n + 12), 0.38, 'triangle', 0.035);
      if (perfect) tone(hz(n + 24), 0.5, 'sine', 0.018, null, 0.07);
    }
    function miss() { flow *= 0.4; melodyNote = 0; }
    function landmark(kind, collected) {
      if (collected) claims++; else approaches++;
      if (collected) flow = Math.min(1, flow + 0.18);
      if (!ac || !playing) return;
      const heme = /^HE/.test(kind), nucleotide = /^(NA|FA|FM)/.test(kind);
      const notes = heme ? [0, 7, 12, 16] : nucleotide ? [7, 14, 16, 24] : [12, 19, 24, 28];
      const count = collected ? 4 : 2, step = collected ? 0.13 : EIGHTH;
      // Leave room for the landmark phrase. This is a dip in the music, not a louder master bus.
      bed.gain.cancelScheduledValues(ac.currentTime);
      bed.gain.setTargetAtTime(collected ? 0.45 : 0.7, ac.currentTime, 0.1);
      bed.gain.setTargetAtTime(1, ac.currentTime + (collected ? 1.4 : 0.8), 0.6);
      for (let i = 0; i < count; i++) tone(hz(notes[i] + 12), collected ? 1.05 : 0.65,
        heme ? 'triangle' : 'sine', collected ? 0.035 : 0.022, null, i * step);
    }
    function finish() {
      finished = true;
      for (const [i, n] of [0, 7, 12, 16].entries()) tone(hz(n + 12), 1.3, 'sine', 0.025, null, i * 0.16);
    }
    function reset() {
      clearVoices(); flow = groove = beat = melodyNote = 0; finished = false;
      approaches = claims = 0;
      if (ac) {
        next = ac.currentTime + 0.04;
        bed.gain.cancelScheduledValues(ac.currentTime); bed.gain.setValueAtTime(1, ac.currentTime);
      }
    }
    function state() { return { available: !!ac, playing, finished, flow: +level().toFixed(3),
      layers: 1 + (level() > 0.2 ? 1 : 0) + (level() > 0.45 ? 1 : 0) + (level() > 0.75 ? 1 : 0),
      voices: voices.size, peakVoices, scheduled, beat, approaches, claims }; }
    return { unlock, play, pump, advance, tone, hit, miss, landmark, finish, reset, state };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createFlightAudio };
  else root.createFlightAudio = createFlightAudio;
})(typeof window !== 'undefined' ? window : globalThis);
