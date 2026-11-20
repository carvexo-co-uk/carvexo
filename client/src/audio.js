// Original oscillators and noise. No recorded or downloaded audio is required.
class StudioAudio {
  context = null;
  enabled = false;
  last = new Map();

  async enable() {
    if (!this.context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      this.context = new Audio();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      const compressor = this.context.createDynamicsCompressor();
      this.master.connect(compressor).connect(this.context.destination);
      this.engine = this.context.createOscillator();
      this.engine.type = 'sawtooth';
      this.sub = this.context.createOscillator();
      this.sub.type = 'sine';
      this.filter = this.context.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.Q.value = 2;
      this.driveGain = this.context.createGain();
      this.driveGain.gain.value = 0;
      this.engine.connect(this.filter);
      this.sub.connect(this.filter);
      this.filter.connect(this.driveGain).connect(this.master);
      this.engine.start();
      this.sub.start();
    }
    await this.context.resume();
    if (this.context.state !== 'running') return;
    this.enabled = true;
    this.master.gain.setTargetAtTime(.46, this.context.currentTime, .07);
  }

  disable() {
    this.enabled = false;
    if (!this.context) return;
    this.master.gain.setTargetAtTime(0, this.context.currentTime, .035);
    this.update(0, false);
  }

  tone(from, to, duration, volume, type = 'sine', delay = 0) {
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + .04);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  noise(duration, frequency, volume) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const player = ctx.createBufferSource();
    player.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
    player.connect(filter).connect(gain).connect(this.master);
    player.start();
    player.onended = () => { player.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  cue(name) {
    if (!this.enabled || document.hidden || !this.context) return;
    const now = this.context.currentTime;
    if (now - (this.last.get(name) ?? -5) < 1.4) return;
    this.last.set(name, now);
    if (name === 'ignition') {
      this.noise(.40, 240, .14);
      this.tone(86, 42, .58, .20, 'triangle', .055);
    } else if (name === 'headlights') {
      this.tone(255, 126, .20, .049, 'sine');
    } else if (name === 'shift') {
      this.noise(.24, 730, .11);
      this.tone(143, 48, .23, .10);
    } else {
      this.tone(name === 'drive' ? 92 : 70, 29, .73, .17);
      this.noise(.28, 172, .06);
    }
  }

  update(rev, visible) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const active = this.enabled && visible && !document.hidden;
    this.master.gain.setTargetAtTime(active ? .46 : 0, now, .05);
    this.engine.frequency.setTargetAtTime(40 + 74 * rev, now, .09);
    this.sub.frequency.setTargetAtTime(25 + 48 * rev, now, .11);
    this.filter.frequency.setTargetAtTime(100 + 520 * rev, now, .11);
    this.driveGain.gain.setTargetAtTime(active ? .115 * rev : 0, now, .16);
  }
}

export const audio = new StudioAudio();
