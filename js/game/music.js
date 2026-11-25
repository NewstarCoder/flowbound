(function () {
  // Procedural chiptune loops. Each step is an eighth note; 0 = rest.
  const chord = (root, third, fifth) => [root, third, fifth, third + 12, fifth, third];
  const TRACKS = {
    title: {
      bpm: 72, wave: 'triangle', drums: false,
      bass: [45, 0, 0, 0, 0, 0, 0, 0, 41, 0, 0, 0, 0, 0, 0, 0, 48, 0, 0, 0, 0, 0, 0, 0, 43, 0, 0, 0, 0, 0, 0, 0],
      chords: [chord(57, 60, 64), chord(53, 57, 60), chord(55, 60, 64), chord(55, 59, 62)],
      arpEvery: 2,
    },
    gatekeeper: {
      bpm: 104, wave: 'triangle', drums: true,
      bass: [45, 0, 45, 0, 45, 0, 52, 0, 41, 0, 41, 0, 41, 0, 48, 0, 48, 0, 48, 0, 48, 0, 55, 0, 43, 0, 43, 0, 47, 0, 50, 0],
      chords: [chord(57, 60, 64), chord(53, 57, 60), chord(55, 60, 64), chord(55, 59, 62)],
      arpEvery: 1,
    },
    hydra: {
      bpm: 112, wave: 'triangle', drums: true,
      bass: [40, 0, 40, 47, 0, 40, 47, 0, 36, 0, 36, 43, 0, 36, 43, 0, 38, 0, 38, 45, 0, 38, 45, 0, 35, 0, 35, 42, 0, 35, 47, 0],
      chords: [chord(64, 67, 71), chord(60, 64, 67), chord(62, 66, 69), chord(59, 62, 66)],
      arpEvery: 1,
    },
    loop: {
      bpm: 124, wave: 'square', drums: true,
      bass: [38, 38, 50, 38, 38, 50, 38, 50, 34, 34, 46, 34, 34, 46, 34, 46, 43, 43, 55, 43, 43, 55, 43, 55, 45, 45, 57, 45, 45, 57, 44, 56],
      chords: [chord(62, 65, 69), chord(58, 62, 65), chord(55, 58, 62), chord(57, 61, 64)],
      arpEvery: 1,
    },
  };
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const M = {
    ac: null, out: null, track: null, step: 0, nextTime: 0, timer: null, intensity: 0,
    enabled: true,
    init(ac) {
      if (this.out || !ac) return;
      this.ac = ac;
      this.out = ac.createGain();
      this.out.gain.value = 0.22;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      this.out.connect(lp).connect(ac.destination);
      try { this.enabled = localStorage.getItem('flowbound.music') !== 'off'; } catch (e) { /* default on */ }
      this.out.gain.value = this.enabled ? 0.22 : 0;
      if (this.pending) { const p = this.pending; this.pending = null; this.play(p); }
    },
    play(name) {
      if (!this.ac) { this.pending = name; return; }
      if (this.track === TRACKS[name]) return;
      this.track = TRACKS[name];
      this.step = 0;
      this.intensity = 0;
      this.nextTime = this.ac.currentTime + 0.1;
      if (!this.timer) this.timer = setInterval(() => this.schedule(), 40);
    },
    setIntensity(v) { this.intensity = v; },
    toggle() {
      this.enabled = !this.enabled;
      try { localStorage.setItem('flowbound.music', this.enabled ? 'on' : 'off'); } catch (e) { /* not persisted */ }
      if (this.out) this.out.gain.setTargetAtTime(this.enabled ? 0.22 : 0, this.ac.currentTime, 0.05);
      return this.enabled;
    },
    note(m, t, dur, type, vol) {
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = type;
      o.frequency.value = freq(m);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    drum(kind, t) {
      const ac = this.ac;
      if (kind === 'k') {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        g.gain.setValueAtTime(0.7, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(this.out);
        o.start(t); o.stop(t + 0.2);
      } else {
        const n = Math.floor(ac.sampleRate * 0.04), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
        f.type = 'highpass'; f.frequency.value = 6000; g.gain.value = 0.12;
        s.buffer = buf; s.connect(f).connect(g).connect(this.out); s.start(t);
      }
    },
    schedule() {
      const tr = this.track;
      if (!tr) return;
      const stepDur = 60 / tr.bpm / 2;
      while (this.nextTime < this.ac.currentTime + 0.15) {
        const i = this.step % tr.bass.length, t = this.nextTime;
        if (tr.bass[i]) this.note(tr.bass[i] - 12, t, stepDur * 1.8, 'sawtooth', 0.09);
        if (i % tr.arpEvery === 0) {
          const ch = tr.chords[Math.floor(i / 8) % tr.chords.length];
          this.note(ch[(i / tr.arpEvery) % ch.length] + (this.intensity && i % 4 === 2 ? 12 : 0), t, stepDur * 0.9, tr.wave, 0.05);
        }
        if (tr.drums) {
          if (i % 8 === 0 || i % 8 === 5 || (this.intensity && i % 8 === 3)) this.drum('k', t);
          if (i % 2 === 1 || (this.intensity && i % 2 === 0 && i % 8 !== 0)) this.drum('h', t);
        }
        this.step++;
        this.nextTime += stepDur;
      }
    },
  };
  CB.Music = M;
})();
