// Sound made in the browser (Web Audio): an electronic loop that grows with the waves and the boss and calms down while
// the player reads, plus short effects. Every stage has its own tune (tunes.ts). Each weapon has its own voice. No audio files. Unlocked by the first tap, as
// browsers require. Repeated effects (shots, coins) are rate-limited so a crowd of them never turns into noise.
export type MusicMood = 'off' | 'menu' | 'run' | 'boss' | 'read' | 'win';
export type Sfx = 'click' | 'pulse' | 'scatter' | 'arc' | 'disc' | 'beam' | 'wave' | 'missile' | 'plasma' | 'shield' | 'hit' | 'block' | 'boom' | 'bigBoom' | 'coin' | 'hurt' | 'lost'
	| 'wave' | 'alarm' | 'phase' | 'bossDown' | 'zone' | 'buy' | 'upgrade' | 'equip' | 'deny' | 'right' | 'wrong' | 'package' | 'bonus' | 'tick' | 'go' | 'stage' | 'win' | 'power' | 'crate' | 'beat' | 'fall';

import { TUNES, type Tune } from './tunes';

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Sound {
	private ctx: AudioContext | null = null;
	private master!: GainNode; private musicBus!: GainNode; private musicFilter!: BiquadFilterNode; private sfxBus!: GainNode;
	private noise!: AudioBuffer;
	private timer: number | null = null;
	private step = 0; private nextAt = 0;
	private mood: MusicMood = 'off'; private intensity = 0;
	private chosen = 0; private playing = 0;                                   // the stage's tune, and the one sounding now
	private musicOn = true; private sfxOn = true;
	private lastAt = new Map<string, number>();

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

	/** Which stage's tune a fight plays (the menu always plays the first, calmly). */
	song(n: number) { this.chosen = ((Math.floor(n) % TUNES.length) + TUNES.length) % TUNES.length; }
	/** intensity 0..1 follows the running speed: more layers, faster, brighter. */
	music(mood: MusicMood, intensity = this.intensity) {
		this.intensity = Math.max(0, Math.min(1, intensity));
		if (mood !== this.mood) { this.mood = mood; this.applyMood(mood === 'read' ? 0.5 : 0.9); }
	}

	private applyMood(seconds: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const level = !this.musicOn || this.mood === 'off' ? 0 : this.mood === 'read' ? 0.14 : this.mood === 'menu' ? 0.24 : this.mood === 'boss' ? 0.36 : 0.32;
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
		const running = this.mood === 'run' || this.mood === 'win' || this.mood === 'boss';
		const now = this.mood === 'menu' || this.mood === 'off' ? 0 : this.chosen;
		if (now !== this.playing) { this.playing = now; this.step = 0; }           // another tune begins at its first bar
		const tune = TUNES[now];
		const bpm = this.mood === 'boss' ? tune.boss : running ? tune.bpm + 20 * this.intensity : tune.bpm - 14;
		const sixteenth = 60 / bpm / 4;
		while (this.nextAt < ctx.currentTime + 0.18) {
			if (this.mood !== 'off' && this.musicOn) this.playStep(tune, this.step, this.nextAt, sixteenth, running);
			this.step = (this.step + 1) % 64;
			this.nextAt += sixteenth;
		}
	}

	private playStep(tune: Tune, step: number, t: number, sixteenth: number, running: boolean) {
		const bar = tune.bars[Math.floor(step / 16) % tune.bars.length];
		const i = step % 16;
		const hot = running ? this.intensity : 0;
		if (i === 0) this.pad(bar.tones, t, sixteenth * 16);
		// the bass: the tune's own walk in a fight, one note a beat when it is calm
		const low = running ? tune.bass[i] : i % 4 === 0 ? 'x' : '.';
		if (low !== '.') this.tone('triangle', midi(bar.root + (low === 'o' ? 12 : 0)), t, sixteenth * (low === 'o' ? 1.8 : 3.2), 0.34, this.musicFilter);
		// the arpeggio, in the tune's voice
		const k = tune.arp[i];
		if (this.mood !== 'read' && (running || i % 2 === 0) && k >= 0) {
			const note = bar.tones[k] + (hot > 0.6 && i % 8 >= 4 ? 12 : 0), g = tune.gain * (1 + 0.7 * hot);
			this.tone(tune.wave, midi(note), t, sixteenth * tune.short, g, this.musicFilter);
			if (tune.twin) this.tone(tune.twin > 0 ? 'triangle' : tune.wave, midi(note + tune.twin), t, sixteenth * tune.short * 0.8, g * 0.4, this.musicFilter);
		}
		if (running) {
			if (tune.kick[i] === 'x') this.kick(t, 0.5 + 0.25 * hot);
			if (tune.snare[i] === 'x') this.burst(t, 0.09, 0.15 + 0.07 * hot, tune.snareHz, 'bandpass', this.musicBus);
			const h = tune.hat[i];
			if (h === 'x' || (h === 'h' && hot > 0.5)) this.hat(t, 0.05 + 0.05 * hot);
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

	/** One effect. `pitch` raises the coin note as a batch of coins arrives. Each effect has a minimum gap between plays. */
	sfx(name: Sfx, pitch = 0) {
		const ctx = this.ctx;
		if (!ctx || !this.sfxOn || ctx.state !== 'running') return;
		const gaps: Partial<Record<Sfx, number>> = { pulse: 0.09, scatter: 0.16, arc: 0.14, disc: 0.18, beam: 0.3, wave: 0.2, missile: 0.2, plasma: 0.3, shield: 0.3, hit: 0.06, block: 0.12, boom: 0.07, coin: 0.045 };
		const last = this.lastAt.get(name) ?? -1;
		if (ctx.currentTime - last < (gaps[name] ?? 0)) return;
		this.lastAt.set(name, ctx.currentTime);
		const t = ctx.currentTime + 0.005, out = this.sfxBus;
		const notes = (list: number[], gap: number, type: OscillatorType, gain: number, len = 0.16) =>
			list.forEach((n, i) => this.tone(type, midi(n), t + i * gap, len, gain, out));
		switch (name) {
			case 'click': this.tone('sine', 660, t, 0.06, 0.2, out); break;
			// weapons: six different voices
			case 'pulse': this.tone('square', 880, t, 0.07, 0.05, out, 440); break;
			case 'scatter': this.burst(t, 0.12, 0.16, 3200, 'bandpass', out, 900); break;
			case 'arc': this.tone('sawtooth', 1500, t, 0.09, 0.07, out, 300); this.burst(t, 0.05, 0.08, 6000, 'highpass', out); break;
			case 'beam': this.tone('sawtooth', 220, t, 0.32, 0.05, out, 233); this.tone('sine', 1320, t, 0.32, 0.03, out, 1340); break;
			case 'missile': this.burst(t, 0.3, 0.12, 700, 'bandpass', out, 2400); break;
			case 'plasma': this.tone('sine', 140, t, 0.3, 0.2, out, 70); this.tone('triangle', 420, t, 0.22, 0.08, out, 210); break;
			case 'disc': this.tone('triangle', 700, t, 0.14, 0.09, out, 1500); break;
			case 'wave': this.burst(t, 0.28, 0.16, 500, 'bandpass', out, 3200); this.tone('sine', 260, t, 0.24, 0.1, out, 520); break;
			case 'shield': this.tone('sine', 98, t, 0.5, 0.28, out, 196); this.burst(t, 0.4, 0.14, 2600, 'bandpass', out, 700); notes([76, 83, 88], 0.05, 'triangle', 0.12, 0.3); break;
			case 'hit': this.tone('triangle', 520, t, 0.04, 0.06, out, 260); break;
			case 'block': this.tone('square', 240, t, 0.05, 0.05, out); break;
			case 'boom': this.burst(t, 0.2, 0.2, 1400, 'lowpass', out, 200); break;
			case 'bigBoom': this.burst(t, 0.7, 0.5, 1600, 'lowpass', out, 90); this.tone('sine', 110, t, 0.6, 0.4, out, 40); break;
			case 'coin': this.tone('sine', midi(84 + Math.min(14, pitch)), t, 0.07, 0.12, out, midi(91 + Math.min(14, pitch))); break;
			case 'hurt': this.burst(t, 0.28, 0.45, 900, 'lowpass', out, 120); this.tone('sawtooth', 130, t, 0.25, 0.28, out, 55); break;
			case 'lost': notes([64, 60, 57, 52], 0.16, 'triangle', 0.24, 0.4); break;
			case 'wave': notes([67, 74], 0.08, 'sine', 0.14, 0.2); break;
			case 'alarm': for (let i = 0; i < 3; i++) this.tone('sawtooth', 311, t + i * 0.34, 0.24, 0.16, out, 415); break;
			case 'phase': this.tone('sawtooth', 90, t, 0.6, 0.25, out, 260); break;
			case 'bossDown': notes([48, 55, 60, 67, 72], 0.07, 'sawtooth', 0.16, 0.5); break;
			case 'zone': this.tone('square', 196, t, 0.12, 0.1, out); break;
			case 'buy': notes([72, 79, 84], 0.07, 'triangle', 0.24, 0.25); break;
			case 'upgrade': notes([60, 64, 67, 72, 76, 79], 0.055, 'triangle', 0.22, 0.3); break;
			case 'equip': notes([76, 83], 0.06, 'sine', 0.2, 0.2); break;
			case 'deny': this.tone('square', 150, t, 0.16, 0.12, out, 110); break;
			case 'right': notes([72, 76, 79, 84], 0.08, 'triangle', 0.26, 0.3); break;
			case 'wrong': this.tone('triangle', 220, t, 0.3, 0.16, out, 165); break;
			case 'package': this.burst(t, 0.25, 0.18, 800, 'bandpass', out, 4000); notes([79, 84, 88], 0.06, 'sine', 0.2, 0.3); break;
			case 'bonus': notes([60, 64, 67, 72, 76, 79, 84, 88, 91], 0.07, 'triangle', 0.26, 0.5); break;
			case 'tick': this.tone('sine', 880, t, 0.08, 0.22, out); break;
			case 'power': this.tone('sawtooth', 110, t, 0.5, 0.2, out, 880); this.burst(t, 0.5, 0.2, 400, 'bandpass', out, 5000); notes([72, 79, 84, 91], 0.07, 'triangle', 0.22, 0.4); break;
			case 'fall': this.tone('sine', 1500, t, 0.55, 0.2, out, 180); this.tone('triangle', 1100, t, 0.55, 0.1, out, 120); break;
			case 'beat': this.tone('sine', 62, t, 0.16, 0.34, out, 48); this.tone('sine', 58, t + 0.2, 0.14, 0.26, out, 44); break;
			case 'crate': notes([84, 88, 91, 96], 0.07, 'sine', 0.2, 0.3); break;
			case 'go': this.tone('sine', 1320, t, 0.3, 0.26, out); break;
			case 'stage': notes([67, 72, 76, 79, 84], 0.09, 'triangle', 0.26, 0.35); break;
			case 'win': notes([60, 64, 67, 72, 76, 79, 84, 88], 0.1, 'triangle', 0.28, 0.5); break;
		}
	}

	dispose() { if (this.timer !== null) clearInterval(this.timer); void this.ctx?.close(); this.ctx = null; }
}
