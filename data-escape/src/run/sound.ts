// Sound made in the browser (Web Audio): a light electronic loop that grows with the run and calms down while the
// player reads, plus short effects. No audio files. Unlocked by the first tap, as browsers require.
export type MusicMood = 'off' | 'menu' | 'run' | 'read' | 'win';
export type Sfx = 'click' | 'collect' | 'power' | 'jump' | 'slide' | 'land' | 'hit' | 'shield' | 'gate' | 'safe' | 'unsafe' | 'recovered'
	| 'tick' | 'go' | 'stage' | 'win' | 'lens' | 'edge';

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// A minor, F, C, G: one bar each. Root notes (bass) and the chord tones the arpeggio walks through.
const BARS = [
	{ root: 45, tones: [57, 60, 64, 69] },
	{ root: 41, tones: [57, 60, 65, 69] },
	{ root: 48, tones: [55, 60, 64, 67] },
	{ root: 43, tones: [55, 59, 62, 67] }
];
const ARP = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 3, 1, 2, 3, 1, 2];

export class Sound {
	private ctx: AudioContext | null = null;
	private master!: GainNode; private musicBus!: GainNode; private musicFilter!: BiquadFilterNode; private sfxBus!: GainNode;
	private noise!: AudioBuffer;
	private timer: number | null = null;
	private step = 0; private nextAt = 0;
	private mood: MusicMood = 'off'; private intensity = 0;
	private musicOn = true; private sfxOn = true;

	unlock() {
		if (this.ctx) { void this.ctx.resume(); return; }
		const AC = window.AudioContext || (window as any).webkitAudioContext;
		if (!AC) return;
		const ctx: AudioContext = new AC();
		this.ctx = ctx;
		this.master = ctx.createGain(); this.master.gain.value = 0.9;
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = -10; limiter.ratio.value = 8;
		this.master.connect(limiter).connect(ctx.destination);
		this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 900;
		this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0;
		this.musicFilter.connect(this.musicBus).connect(this.master);
		this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxOn ? 0.9 : 0;
		this.sfxBus.connect(this.master);
		this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
		const d = this.noise.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
		this.nextAt = ctx.currentTime + 0.1;
		this.timer = window.setInterval(() => this.schedule(), 60);
		this.applyMood(0.4);
	}

	setMusic(on: boolean) { this.musicOn = on; this.applyMood(0.3); }
	setSfx(on: boolean) { this.sfxOn = on; if (this.ctx) this.sfxBus.gain.value = on ? 0.9 : 0; }
	/** Page hidden or game paused: stop making sound without losing the place in the loop. */
	suspend(yes: boolean) { if (this.ctx) void (yes ? this.ctx.suspend() : this.ctx.resume()); }

	/** intensity 0..1 follows the running speed: more layers, faster, brighter. */
	music(mood: MusicMood, intensity = this.intensity) {
		this.intensity = Math.max(0, Math.min(1, intensity));
		if (mood !== this.mood) { this.mood = mood; this.applyMood(mood === 'read' ? 0.5 : 0.9); }
	}

	private applyMood(seconds: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const level = !this.musicOn || this.mood === 'off' ? 0 : this.mood === 'read' ? 0.16 : this.mood === 'menu' ? 0.26 : 0.4;
		const cutoff = this.mood === 'read' ? 520 : this.mood === 'menu' ? 1500 : 2600;
		const t = ctx.currentTime;
		for (const [p, v] of [[this.musicBus.gain, level], [this.musicFilter.frequency, cutoff]] as const) {
			p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + seconds);
		}
	}

	private schedule() {
		const ctx = this.ctx;
		if (!ctx || ctx.state !== 'running') return;
		if (this.nextAt < ctx.currentTime - 0.3) this.nextAt = ctx.currentTime + 0.05;      // the tab was asleep
		const running = this.mood === 'run' || this.mood === 'win';
		const bpm = running ? 104 + 22 * this.intensity : 92;
		const sixteenth = 60 / bpm / 4;
		while (this.nextAt < ctx.currentTime + 0.18) {
			if (this.mood !== 'off' && this.musicOn) this.playStep(this.step, this.nextAt, sixteenth, running);
			this.step = (this.step + 1) % 64;
			this.nextAt += sixteenth;
		}
	}

	private playStep(step: number, t: number, sixteenth: number, running: boolean) {
		const bar = BARS[Math.floor(step / 16) % BARS.length];
		const i = step % 16;
		const hot = running ? this.intensity : 0;
		if (i === 0) this.pad(bar.tones, t, sixteenth * 16);
		if (i % 4 === 0 || (running && i % 8 === 6)) this.tone('triangle', midi(bar.root), t, sixteenth * 3.2, 0.34, this.musicFilter);
		if (this.mood !== 'read' && (running || i % 2 === 0)) {
			const note = bar.tones[ARP[i]] + (hot > 0.6 && i % 8 >= 4 ? 12 : 0);
			this.tone('square', midi(note), t, sixteenth * 0.9, 0.07 + 0.05 * hot, this.musicFilter);
		}
		if (running) {
			if (i % 4 === 0) this.kick(t, 0.5 + 0.25 * hot);
			if (i % 4 === 2 || (hot > 0.5 && i % 2 === 1)) this.hat(t, 0.05 + 0.05 * hot);
		}
	}

	private tone(type: OscillatorType, freq: number, t: number, len: number, gain: number, out: AudioNode, glideTo?: number) {
		const ctx = this.ctx!;
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type; o.frequency.setValueAtTime(freq, t);
		if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + len);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
		g.gain.exponentialRampToValueAtTime(0.0001, t + len);
		o.connect(g).connect(out);
		o.start(t); o.stop(t + len + 0.03);
	}
	private pad(tones: number[], t: number, len: number) {
		const ctx = this.ctx!;
		for (const n of tones.slice(0, 3)) {
			const o = ctx.createOscillator(), g = ctx.createGain();
			o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = (n % 2 ? 7 : -7);
			g.gain.setValueAtTime(0.0001, t);
			g.gain.linearRampToValueAtTime(0.045, t + len * 0.3);
			g.gain.linearRampToValueAtTime(0.0001, t + len * 1.05);
			o.connect(g).connect(this.musicFilter);
			o.start(t); o.stop(t + len * 1.1);
		}
	}
	private kick(t: number, gain: number) { this.tone('sine', 130, t, 0.16, gain, this.musicBus, 42); }
	private hat(t: number, gain: number) { this.burst(t, 0.035, gain, 7000, 'highpass', this.musicBus); }
	private burst(t: number, len: number, gain: number, freq: number, type: BiquadFilterType, out: AudioNode, sweepTo?: number) {
		const ctx = this.ctx!;
		const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
		src.buffer = this.noise; src.loop = true;
		f.type = type; f.frequency.setValueAtTime(freq, t);
		if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + len);
		g.gain.setValueAtTime(gain, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + len);
		src.connect(f).connect(g).connect(out);
		src.start(t, Math.random() * 0.5); src.stop(t + len + 0.02);
	}

	/** `pitch` raises collect blips along a streak. */
	sfx(name: Sfx, pitch = 0) {
		const ctx = this.ctx;
		if (!ctx || !this.sfxOn || ctx.state !== 'running') return;
		const t = ctx.currentTime + 0.005, out = this.sfxBus;
		const notes = (list: number[], gap: number, type: OscillatorType, gain: number, len = 0.16) =>
			list.forEach((n, i) => this.tone(type, midi(n), t + i * gap, len, gain, out));
		switch (name) {
			case 'click': this.tone('sine', 660, t, 0.06, 0.2, out); break;
			case 'collect': this.tone('sine', midi(84 + Math.min(12, pitch)), t, 0.09, 0.2, out, midi(88 + Math.min(12, pitch))); break;
			case 'power': notes([72, 76, 79, 84], 0.05, 'triangle', 0.24); break;
			case 'lens': notes([79, 86], 0.07, 'sine', 0.2); break;
			case 'jump': this.tone('sine', 300, t, 0.18, 0.2, out, 620); break;
			case 'slide': this.burst(t, 0.3, 0.2, 2400, 'bandpass', out, 500); break;
			case 'land': this.tone('sine', 150, t, 0.09, 0.22, out, 70); break;
			case 'edge': this.tone('square', 180, t, 0.05, 0.08, out); break;
			case 'hit': this.burst(t, 0.28, 0.5, 900, 'lowpass', out, 120); this.tone('sawtooth', 110, t, 0.25, 0.3, out, 50); break;
			case 'shield': notes([88, 95], 0.04, 'sine', 0.22, 0.25); this.burst(t, 0.15, 0.15, 5000, 'highpass', out); break;
			case 'gate': notes([64, 71], 0.12, 'sine', 0.2, 0.4); break;
			case 'safe': notes([72, 76, 79, 84], 0.085, 'triangle', 0.26, 0.3); break;
			case 'recovered': notes([67, 72, 76], 0.1, 'triangle', 0.24, 0.3); break;
			case 'unsafe': this.tone('sawtooth', 185, t, 0.45, 0.22, out, 92); this.tone('sawtooth', 196, t, 0.45, 0.16, out, 98); break;
			case 'tick': this.tone('sine', 880, t, 0.08, 0.22, out); break;
			case 'go': this.tone('sine', 1320, t, 0.3, 0.26, out); break;
			case 'stage': notes([67, 72, 76, 79, 84], 0.09, 'triangle', 0.26, 0.35); break;
			case 'win': notes([60, 64, 67, 72, 76, 79, 84, 88], 0.1, 'triangle', 0.28, 0.5); break;
		}
	}

	dispose() { if (this.timer !== null) clearInterval(this.timer); void this.ctx?.close(); this.ctx = null; }
}
