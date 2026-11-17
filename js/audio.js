(function () {
  const APP = window.APP;
  const TRACK_URL = 'data/ambient.wav';
  let audioEl = null, ctx = null, enabled = false, fadeTimer = null;

  function ensureTrack() {
    if (audioEl) return audioEl;
    audioEl = new Audio(TRACK_URL);
    audioEl.loop = true;
    audioEl.preload = 'auto';
    audioEl.volume = 0;
    return audioEl;
  }

  function fadeVolume(target) {
    if (!audioEl) return;
    if (fadeTimer) clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      const diff = target - audioEl.volume;
      if (Math.abs(diff) < 0.02) {
        audioEl.volume = target;
        if (target === 0) audioEl.pause();
        clearInterval(fadeTimer);
        fadeTimer = null;
      } else {
        audioEl.volume = Math.max(0, Math.min(1, audioEl.volume + diff * 0.18));
      }
    }, 45);
  }

  function ensureSwooshCtx() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }

  APP.audio = {
    toggle() {
      const tr = ensureTrack();
      ensureSwooshCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      enabled = !enabled;
      if (enabled) {
        tr.play().then(() => fadeVolume(0.45)).catch(() => {});
        this.playSwoosh();
      } else {
        fadeVolume(0);
      }
      const b = document.getElementById('btn-sound');
      if (b) { b.textContent = enabled ? 'Sound: On' : 'Sound: Off'; b.classList.toggle('active', enabled); }
    },
    playSwoosh() {
      if (!enabled || !ctx) return;
      const now = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * 0.26);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
      bp.frequency.setValueAtTime(220, now);
      bp.frequency.exponentialRampToValueAtTime(720, now + 0.22);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.09, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      src.connect(bp); bp.connect(g); g.connect(ctx.destination);
      src.start(now);
    }
  };
})();