// Small Web Audio piano-like synth (no samples needed).

export class Synth {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.volume = 0.5;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  noteOn(midi, velocity = 90, when = 0, duration = null) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.noteOff(midi, when);
    const t = ctx.currentTime + when;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const amp = 0.18 * (velocity / 127) ** 1.2;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(amp, t + 0.006);
    // Piano-like decay: faster for high notes.
    const decay = Math.max(0.8, 3.2 - (midi - 48) * 0.035);
    out.gain.setTargetAtTime(amp * 0.25, t + 0.02, decay * 0.25);
    out.gain.setTargetAtTime(0.0001, t + 0.3, decay);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(12000, freq * 8), t);
    filter.frequency.setTargetAtTime(Math.min(6000, freq * 3), t + 0.01, 0.4);
    filter.connect(out).connect(this.master);

    const partials = [
      { type: 'triangle', mult: 1, gain: 1 },
      { type: 'sine', mult: 2, gain: 0.35 },
      { type: 'sine', mult: 3, gain: 0.12 },
    ];
    const oscs = partials.map((p) => {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.value = freq * p.mult;
      o.detune.value = (Math.random() - 0.5) * 4;
      const g = ctx.createGain();
      g.gain.value = p.gain;
      o.connect(g).connect(filter);
      o.start(t);
      return o;
    });
    const voice = { out, oscs };
    this.voices.set(midi, voice);
    if (duration != null) {
      setTimeout(() => {
        if (this.voices.get(midi) === voice) this.noteOff(midi);
      }, (when + duration) * 1000);
    }
  }

  noteOff(midi, when = 0) {
    const voice = this.voices.get(midi);
    if (!voice || !this.ctx) return;
    this.voices.delete(midi);
    const t = this.ctx.currentTime + when;
    voice.out.gain.cancelScheduledValues(t);
    voice.out.gain.setValueAtTime(voice.out.gain.value, t);
    voice.out.gain.setTargetAtTime(0.0001, t, 0.08);
    for (const o of voice.oscs) o.stop(t + 0.6);
  }

  /** Play a chord (block or arpeggiated). */
  playChord(midis, { arpeggio = false, duration = 1.6 } = {}) {
    midis.forEach((m, i) => this.noteOn(m, 85, arpeggio ? i * 0.22 : i * 0.012, duration + (arpeggio ? (midis.length - i) * 0.22 : 0)));
  }

  /** Short feedback blips. */
  feedback(ok) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = ok ? [1318.5, 1760] : [220, 196];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = ok ? 'sine' : 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(ok ? 0.08 : 0.04, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.15);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.2);
    });
  }
}
