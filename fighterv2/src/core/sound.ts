// Sound made in the browser (Web Audio). Part 2 has its own music: tunes in the modes of the region over a hand-drum
// rhythm (dum and tek), with a lead instrument and a low drone; a tune thickens in a fight, darkens for a boss and
// thins out while the player reads. Every stage has its own tune, mode, rhythm and lead instrument (tunes.ts). The effects are new too: every hit is a dry knock with a ring, not the beeps of part 1.
// Nothing here is a recording except the voices (public/assets/voice): the bosses, played deepened, and the callers
// of the box questions that arrive as a phone call, played as heard through a phone.
// Unlocked by the first tap, as browsers require. Repeated effects (shots, coins) are rate-limited so a crowd of them
// never turns into noise.
export type MusicMood = 'off' | 'menu' | 'run' | 'boss' | 'read' | 'win';
export type Sfx = 'click' | 'pulse' | 'scatter' | 'arc' | 'disc' | 'beam' | 'wave' | 'missile' | 'plasma' | 'shield' | 'hit' | 'block' | 'boom' | 'bigBoom' | 'coin' | 'hurt' | 'lost'
	| 'alarm' | 'phase' | 'bossDown' | 'zone' | 'buy' | 'upgrade' | 'equip' | 'deny' | 'right' | 'wrong' | 'package' | 'bonus' | 'tick' | 'go' | 'stage' | 'win' | 'power' | 'crate' | 'beat' | 'fall' | 'growl' | 'ring' | 'pickup';

import { TUNES, type Tune, type Lead } from './tunes';

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Sound {
	private ctx: AudioContext | null = null;
	private master!: GainNode; private musicBus!: GainNode; private musicFilter!: BiquadFilterNode; private sfxBus!: GainNode; private voiceBus!: GainNode; private phoneBus!: GainNode;
	private noise!: AudioBuffer;
	private timer: number | null = null;
	private step = 0; private nextAt = 0;
	private mood: MusicMood = 'off'; private intensity = 0;
	private chosen = 0; private playing = 0;                                   // the stage's tune, and the one sounding now
	private musicOn = true; private sfxOn = true;
	private lastAt = new Map<string, number>();
	private voices = new Map<string, AudioBuffer | null>();
	private speaking: AudioBufferSourceNode | null = null;

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
		// a boss's voice: made darker and a little rough, so every boss sounds like a monster whatever voice spoke the line
		const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 260; low.gain.value = 8;
		const rough = ctx.createWaveShaper(); const curve = new Float32Array(257);
		for (let i = 0; i < 257; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
		rough.curve = curve;
		this.voiceBus = ctx.createGain(); this.voiceBus.gain.value = 1.15;
		this.voiceBus.connect(low).connect(rough).connect(this.sfxBus);
		// a caller's voice: heard through a phone, so thinner than a voice in the room (but every word stays clear)
		const thin = ctx.createBiquadFilter(); thin.type = 'highpass'; thin.frequency.value = 280;
		const top = ctx.createBiquadFilter(); top.type = 'lowpass'; top.frequency.value = 4200;
		this.phoneBus = ctx.createGain(); this.phoneBus.gain.value = 1.5;
		this.phoneBus.connect(thin).connect(top).connect(this.sfxBus);
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
	/** intensity 0..1 follows the fight: more layers, faster, brighter. */
	music(mood: MusicMood, intensity = this.intensity) {
		this.intensity = Math.max(0, Math.min(1, intensity));
		if (mood !== this.mood) { this.mood = mood; this.applyMood(mood === 'read' ? 0.5 : 0.9); }
	}

	/** A boss speaks: the recorded line at `url`, played slower and darker. The music steps back while it talks.
	 *  A missing or broken file is silent, never an error. */
	say(url: string) {
		const ctx = this.ctx;
		if (!ctx || !this.sfxOn) return;
		const play = (buf: AudioBuffer | null) => {
			if (!buf || !this.ctx || this.ctx.state !== 'running') return;
			try { this.speaking?.stop(); } catch { /* already ended */ }
			const src = ctx.createBufferSource();
			src.buffer = buf; src.playbackRate.value = 0.86;
			src.connect(this.voiceBus);
			src.start();
			this.speaking = src;
			const len = buf.duration / 0.86, t = ctx.currentTime, g = this.musicBus.gain, back = g.value;
			g.cancelScheduledValues(t); g.setValueAtTime(back, t); g.linearRampToValueAtTime(back * 0.3, t + 0.15); g.setValueAtTime(back * 0.3, t + len); g.linearRampToValueAtTime(back, t + len + 0.5);
		};
		if (this.voices.has(url)) { play(this.voices.get(url) ?? null); return; }
		this.voices.set(url, null);
		void fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('no voice')))).then(b => ctx.decodeAudioData(b)).then(buf => { this.voices.set(url, buf); play(buf); }).catch(() => { /* no voice for this boss: the written line is enough */ });
	}

	/** Fetches a recording ahead of time (a caller's line while the phone still rings), so it starts at once. */
	load(url: string) {
		const ctx = this.ctx;
		if (!ctx || this.voices.has(url)) return;
		this.voices.set(url, null);
		void fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('no voice')))).then(b => ctx.decodeAudioData(b)).then(buf => { this.voices.set(url, buf); }).catch(() => { /* the written words are enough */ });
	}
	/** A caller speaks on the phone: the recording at `url` in its own voice. Returns its length in seconds, or 0 when
	 *  nothing can be played (sound off, the file missing or not loaded yet): the words are then only written. */
	speak(url: string): number {
		const ctx = this.ctx, buf = this.voices.get(url);
		if (!ctx || !this.sfxOn || !buf || ctx.state !== 'running') return 0;
		this.hush();
		const src = ctx.createBufferSource();
		src.buffer = buf; src.connect(this.phoneBus); src.start();
		this.speaking = src;
		const t = ctx.currentTime, g = this.musicBus.gain, back = g.value;
		g.cancelScheduledValues(t); g.setValueAtTime(back, t); g.linearRampToValueAtTime(back * 0.25, t + 0.15); g.setValueAtTime(back * 0.25, t + buf.duration); g.linearRampToValueAtTime(back, t + buf.duration + 0.5);
		return buf.duration;
	}
	/** Whoever is speaking stops (the call was ended, or the question is over). */
	hush() { try { this.speaking?.stop(); } catch { /* already ended */ } this.speaking = null; }

	private applyMood(seconds: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const level = !this.musicOn || this.mood === 'off' ? 0 : this.mood === 'read' ? 0.13 : this.mood === 'menu' ? 0.24 : this.mood === 'boss' ? 0.36 : 0.32;
		const cutoff = this.mood === 'read' ? 480 : this.mood === 'menu' ? 1400 : this.mood === 'boss' ? 2000 : 2800;
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
		const bpm = this.mood === 'boss' ? tune.boss : running ? tune.bpm + 18 * this.intensity : tune.bpm - 14;
		const sixteenth = 60 / bpm / 4;
		while (this.nextAt < ctx.currentTime + 0.18) {
			if (this.mood !== 'off' && this.musicOn) this.playStep(tune, this.step, this.nextAt, sixteenth, running);
			this.step = (this.step + 1) % 64;
			this.nextAt += sixteenth;
		}
	}

	private playStep(tune: Tune, step: number, t: number, sixteenth: number, running: boolean) {
		const bar = tune.bars[Math.floor(step / 16) % tune.bars.length], i = step % 16, boss = this.mood === 'boss';
		const hot = running ? this.intensity : 0;
		// the drone: the home note and its fifth, held under everything
		if (i === 0) this.drone(bar.root, t, sixteenth * 16, boss ? 0.075 : 0.055);
		// the bass walks on the strong strokes
		if (i === 0 || i === 8 || (running && i === 6)) this.tone('triangle', midi(bar.root + (i === 6 ? 7 : 0)), t, sixteenth * 3, 0.3, this.musicFilter);
		// the lead: the tune's instrument playing the bar's phrase in eighths; in a boss fight an octave lower and doubled
		if (this.mood !== 'read' && i % 2 === 0 && (running || i % 4 === 0)) {
			const note = tune.scale[bar.phrase[i / 2]] + (boss ? -12 : hot > 0.6 && i >= 8 ? 12 : 0);
			this.lead(tune.lead, midi(note), t, sixteenth, running, 0.1 + 0.05 * hot);
			if (boss && i % 4 === 0) this.pluck(midi(note + tune.echo), t + sixteenth * 0.5, sixteenth * 1.4, 0.05);
		}
		// the hand drum
		if (this.mood !== 'read') {
			const stroke = (boss ? tune.drum.boss : running ? tune.drum.run : tune.drum.calm)[i];
			if (stroke === 'D') this.dum(t, running ? 0.5 + 0.2 * hot : 0.26);
			else if (stroke === 'B') { this.tone('sine', 104, t, 0.26, running ? 0.4 + 0.12 * hot : 0.24, this.musicBus, 44); this.burst(t, 0.05, 0.1, 500, 'lowpass', this.musicBus); }   // the great drum
			else if (stroke === 't') this.tek(t, running ? 0.2 + 0.08 * hot : 0.1, 2100);
			else if (stroke === 'k' && hot > 0.25) this.tek(t, 0.07 + 0.06 * hot, 3400);
		}
		// a shaker joins when the fight is at its height
		if (running && hot > 0.55 && i % 2 === 1) this.burst(t, 0.03, 0.035 + 0.03 * hot, 8200, 'highpass', this.musicBus);
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
	/** One note of the lead, on the tune's instrument. */
	private lead(kind: Lead, freq: number, t: number, sixteenth: number, running: boolean, gain: number) {
		const long = sixteenth * (running ? 1.8 : 3.4);
		switch (kind) {
			case 'oud': this.pluck(freq, t, long, gain); break;
			// a qanun: thin bright strings, each note struck and then touched again more softly
			case 'qanun':
				this.tone('triangle', freq, t, long * 0.8, gain * 1.5, this.musicFilter); this.tone('square', freq * 2, t, sixteenth * 0.7, gain * 0.3, this.musicFilter);
				if (running) this.tone('triangle', freq, t + sixteenth, sixteenth * 0.8, gain * 0.7, this.musicFilter);
				break;
			// a ney: a held breath of a note that comes in softly and wavers
			case 'ney': this.blown(freq, t, sixteenth * (running ? 2.2 : 3.8), gain * 0.66, 'sine', 0); this.burst(t, 0.07, gain * 0.16, freq * 2.5, 'bandpass', this.musicFilter); break;
			// a buzuq: a wiry double string, every note picked twice
			case 'buzuq': this.pluck(freq, t, sixteenth * 1.1, gain * 0.9, 13); if (running) this.pluck(freq, t + sixteenth, sixteenth * 0.9, gain * 0.6, 13); break;
			// a reed pipe: nasal and loud, held to the next note
			case 'reed': this.blown(freq, t, sixteenth * (running ? 1.9 : 3.4), gain * 1.0, 'square', 1500); break;
			// the last battle: the pipe above, the oud an octave below
			case 'storm': this.blown(freq, t, sixteenth * (running ? 1.9 : 3.4), gain * 0.5, 'square', 1500); this.pluck(freq / 2, t, long, gain * 0.7); break;
		}
	}
	/** A blown note: a soft start, held, with a slow waver; `nasal` (a frequency) squeezes it like a reed. */
	private blown(freq: number, t: number, len: number, gain: number, type: OscillatorType, nasal: number) {
		const ctx = this.ctx!;
		const o = ctx.createOscillator(), g = ctx.createGain(), wob = ctx.createOscillator(), depth = ctx.createGain();
		o.type = type; o.frequency.value = freq;
		wob.frequency.value = 5.5; depth.gain.value = freq * 0.006;
		wob.connect(depth).connect(o.frequency);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.linearRampToValueAtTime(gain, t + Math.min(0.05, len * 0.3));
		g.gain.setValueAtTime(gain, t + len * 0.75);
		g.gain.linearRampToValueAtTime(0.0001, t + len);
		if (nasal) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = nasal; f.Q.value = 1.4; o.connect(f).connect(g); } else o.connect(g);
		g.connect(this.musicFilter);
		o.start(t); o.stop(t + len + 0.03); wob.start(t); wob.stop(t + len + 0.03);
	}
	/** A plucked string: two close notes with a hard start and a quick fall. */
	private pluck(freq: number, t: number, len: number, gain: number, spread = 6.5) {
		const ctx = this.ctx!;
		for (const cents of [-spread + 0.5, spread + 0.5]) {
			const o = ctx.createOscillator(), g = ctx.createGain();
			o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = cents;
			g.gain.setValueAtTime(gain, t);
			g.gain.exponentialRampToValueAtTime(gain * 0.3, t + len * 0.25);
			g.gain.exponentialRampToValueAtTime(0.0001, t + len);
			o.connect(g).connect(this.musicFilter);
			o.start(t); o.stop(t + len + 0.03);
		}
	}
	private drone(root: number, t: number, len: number, gain: number) {
		const ctx = this.ctx!;
		for (const n of [root + 12, root + 19]) {
			const o = ctx.createOscillator(), g = ctx.createGain();
			o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = n % 2 ? 5 : -5;
			g.gain.setValueAtTime(0.0001, t);
			g.gain.linearRampToValueAtTime(gain, t + len * 0.25);
			g.gain.linearRampToValueAtTime(0.0001, t + len * 1.05);
			o.connect(g).connect(this.musicFilter);
			o.start(t); o.stop(t + len * 1.1);
		}
	}
	/** The deep stroke of the hand drum. */
	private dum(t: number, gain: number) { this.tone('sine', 150, t, 0.2, gain, this.musicBus, 58); this.burst(t, 0.03, gain * 0.25, 900, 'lowpass', this.musicBus); }
	/** The sharp stroke on the rim. */
	private tek(t: number, gain: number, freq: number) { this.burst(t, 0.05, gain, freq, 'bandpass', this.musicBus); this.tone('triangle', freq * 0.42, t, 0.04, gain * 0.5, this.musicBus); }
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
	/** A struck bell: the note and two overtones that are not in tune with it, ringing out. */
	private bell(freq: number, t: number, len: number, gain: number, out: AudioNode) {
		for (const [k, a] of [[1, 1], [2.76, 0.45], [5.4, 0.22]]) this.tone('sine', freq * k, t, len * (k === 1 ? 1 : 0.6), gain * a, out);
	}

	/** One effect. `pitch` raises the coin note as a batch of coins arrives. Each effect has a minimum gap between plays. */
	sfx(name: Sfx | string, pitch = 0) {
		const ctx = this.ctx;
		if (!ctx || !this.sfxOn || ctx.state !== 'running') return;
		const gaps: Record<string, number> = { pulse: 0.09, scatter: 0.16, arc: 0.14, 'arc.shot': 0.07, disc: 0.18, beam: 0.3, wave: 0.2, missile: 0.2, plasma: 0.3, shield: 0.3, 'burst.scatter': 0.1, 'burst.arc': 0.1, 'burst.wave': 0.1, 'burst.missile': 0.08, 'burst.plasma': 0.07, 'burst.shield': 0.08, clack: 0.05, hit: 0.055, block: 0.12, boom: 0.07, coin: 0.045 };
		const last = this.lastAt.get(name) ?? -1;
		if (ctx.currentTime - last < (gaps[name] ?? 0)) return;
		this.lastAt.set(name, ctx.currentTime);
		const t = ctx.currentTime + 0.005, out = this.sfxBus;
		const notes = (list: number[], gap: number, type: OscillatorType, gain: number, len = 0.16) =>
			list.forEach((n, i) => this.tone(type, midi(n), t + i * gap, len, gain, out));
		const bells = (list: number[], gap: number, gain: number, len = 0.5) => list.forEach((n, i) => this.bell(midi(n), t + i * gap, len, gain, out));
		switch (name) {
			case 'click': this.burst(t, 0.03, 0.14, 2600, 'bandpass', out); this.tone('sine', 880, t, 0.05, 0.1, out, 1320); break;
			// weapons: each its own voice
			case 'pulse': this.tone('sine', 880, t, 0.05, 0.08, out, 1500); this.tone('sine', 1320, t + 0.03, 0.04, 0.04, out, 1900); break;                                              // a drop of water: plip
			case 'scatter': this.burst(t, 0.18, 0.12, 600, 'bandpass', out, 1900); this.bell(1100, t + 0.03, 0.14, 0.05, out); break;                                                    // the burner is thrown: a swish and the clink of its lid
			case 'arc': this.tone('sine', 150, t, 0.16, 0.22, out, 70); this.burst(t, 0.09, 0.16, 700, 'lowpass', out, 200); this.tone('triangle', 660, t + 0.08, 0.1, 0.05, out, 880); break;   // a tower is set down: stone on sand
			case 'arc.shot': this.tone('triangle', 1250, t, 0.05, 0.045, out, 640); this.burst(t, 0.025, 0.04, 4200, 'bandpass', out); break;                                             // a tower lets a dart go: a bowstring
			case 'beam': this.tone('sine', 220, t, 0.3, 0.07, out, 440); this.tone('triangle', 440, t, 0.3, 0.03, out, 660); break;                                                    // the lighthouse turns back: a hum that rises
			case 'missile': this.tone('sawtooth', 2600, t, 0.12, 0.05, out, 1700); this.tone('sawtooth', 2300, t + 0.11, 0.14, 0.04, out, 1400); this.burst(t, 0.16, 0.05, 2400, 'bandpass', out, 900); break;   // a falcon's cry as it dives
			case 'plasma': this.tone('sine', 110, t, 0.28, 0.3, out, 40); this.burst(t, 0.12, 0.2, 900, 'lowpass', out, 200); this.tone('sine', 1500, t + 0.15, 0.7, 0.035, out, 700); break;   // the gun thumps, and the shell whistles on its way
			case 'disc': this.tone('square', 300, t, 0.12, 0.04, out, 900); this.burst(t, 0.1, 0.08, 6000, 'highpass', out, 2500); break;                                              // a blade leaves the hand: a whirr
			case 'wave': this.burst(t, 0.45, 0.16, 200, 'lowpass', out, 1300); this.tone('sine', 130, t, 0.4, 0.1, out, 80); break;                                                    // water rushing in a circle
			case 'shield': bells([93, 90, 86], 0.06, 0.07, 0.35); this.tone('sine', 2000, t, 0.4, 0.04, out, 700); break;                                                               // a star falls: three small bells, going down
			// what the weapons leave behind: smoke opening, a tower or a whirlpool ending, a falcon's blow, a shell, a star landing; and a blade on the side wall
			case 'burst.scatter': this.burst(t, 0.3, 0.16, 1200, 'lowpass', out, 300); break;
			case 'burst.arc': this.tone('sine', 170, t, 0.2, 0.22, out, 50); this.burst(t, 0.2, 0.16, 1800, 'bandpass', out, 400); break;
			case 'burst.wave': this.burst(t, 0.26, 0.16, 5000, 'highpass', out, 1500); this.burst(t, 0.3, 0.14, 700, 'lowpass', out, 200); break;
			case 'burst.missile': this.tone('sine', 220, t, 0.12, 0.16, out, 80); this.burst(t, 0.08, 0.12, 2200, 'bandpass', out, 700); break;
			case 'burst.plasma': this.tone('sine', 160, t, 0.3, 0.34, out, 40); this.burst(t, 0.28, 0.26, 2400, 'lowpass', out, 200); break;
			case 'burst.shield': this.bell(midi(74), t, 0.5, 0.14, out); this.bell(midi(81), t + 0.04, 0.4, 0.08, out); this.tone('sine', 150, t, 0.16, 0.2, out, 60); break;
			case 'clack': this.burst(t, 0.03, 0.14, 3200, 'bandpass', out); this.tone('triangle', 1400, t, 0.05, 0.08, out, 900); break;
			// hits: a dry knock with a short ring; a blocked hit clanks
			case 'hit': this.burst(t, 0.025, 0.16, 2400, 'bandpass', out); this.tone('sine', 300, t, 0.05, 0.1, out, 140); break;
			case 'block': this.bell(620, t, 0.12, 0.07, out); this.burst(t, 0.02, 0.1, 5200, 'highpass', out); break;
			case 'boom': this.tone('sine', 190, t, 0.2, 0.26, out, 48); this.burst(t, 0.16, 0.2, 2600, 'lowpass', out, 300); break;
			case 'bigBoom': this.tone('sine', 120, t, 0.9, 0.5, out, 30); this.burst(t, 0.8, 0.45, 3000, 'lowpass', out, 80); this.burst(t + 0.05, 0.3, 0.16, 6000, 'highpass', out); break;
			case 'coin': this.bell(midi(79 + Math.min(14, pitch)), t, 0.16, 0.11, out); break;
			case 'hurt': this.tone('square', 220, t, 0.24, 0.2, out, 70); this.burst(t, 0.22, 0.34, 1400, 'lowpass', out, 160); break;
			case 'lost': notes([62, 58, 55, 51, 50], 0.17, 'triangle', 0.22, 0.45); break;
			case 'alarm': for (let i = 0; i < 3; i++) { this.tone('square', 392, t + i * 0.32, 0.14, 0.1, out, 370); this.tone('square', 277, t + i * 0.32 + 0.15, 0.14, 0.1, out, 262); } break;
			case 'phase': this.tone('sawtooth', 70, t, 0.7, 0.24, out, 300); this.burst(t, 0.6, 0.14, 300, 'bandpass', out, 4000); break;
			case 'bossDown': bells([50, 57, 62, 66, 69, 74], 0.08, 0.16, 0.8); break;
			case 'zone': this.tone('square', 147, t, 0.14, 0.1, out, 196); break;
			case 'buy': bells([74, 78, 81], 0.07, 0.16, 0.4); break;
			case 'upgrade': notes([62, 66, 69, 74, 78, 81], 0.055, 'triangle', 0.2, 0.3); this.bell(midi(86), t + 0.33, 0.5, 0.12, out); break;
			case 'equip': this.burst(t, 0.04, 0.14, 1800, 'bandpass', out); this.bell(midi(81), t + 0.03, 0.25, 0.12, out); break;
			case 'deny': this.tone('square', 131, t, 0.1, 0.12, out); this.tone('square', 117, t + 0.11, 0.14, 0.12, out); break;
			case 'right': bells([74, 78, 81, 86], 0.08, 0.17, 0.45); break;
			case 'wrong': this.tone('triangle', 196, t, 0.18, 0.16, out, 185); this.tone('triangle', 156, t + 0.16, 0.26, 0.16, out, 139); break;
			case 'package': this.burst(t, 0.22, 0.16, 600, 'bandpass', out, 5000); bells([81, 86, 90], 0.06, 0.13, 0.4); break;
			case 'bonus': bells([62, 66, 69, 74, 78, 81, 86, 90, 93], 0.07, 0.15, 0.6); break;
			case 'tick': this.burst(t, 0.02, 0.18, 3200, 'bandpass', out); this.tone('sine', 740, t, 0.06, 0.14, out); break;
			case 'power': this.tone('sawtooth', 73, t, 0.55, 0.2, out, 587); this.burst(t, 0.5, 0.2, 300, 'bandpass', out, 6000); bells([74, 81, 86, 93], 0.07, 0.14, 0.5); break;
			case 'fall': this.tone('sine', 1760, t, 0.55, 0.18, out, 140); this.tone('triangle', 1320, t, 0.55, 0.09, out, 100); break;
			// the special skills of part 2: each has a voice of its own, and none is the old charge-up of 'power'
			case 'pw.rain': this.burst(t, 1.6, 0.16, 5200, 'highpass', out, 2600); this.burst(t, 1.2, 0.1, 500, 'lowpass', out, 240); bells([98, 93, 96, 91, 95], 0.11, 0.05, 0.25); break;                     // a shower begins: hiss, far thunder, drops
			case 'pw.falcon': for (const [at, a, b] of [[0, 2500, 1650], [0.24, 2900, 1500]]) { this.tone('sawtooth', a, t + at, 0.22, 0.09, out, b); this.tone('triangle', a * 1.5, t + at, 0.2, 0.05, out, b * 1.5); } this.burst(t, 0.7, 0.2, 400, 'bandpass', out, 3200); break;   // two cries and the rush of wings
			case 'pw.mirror': for (const [n, at] of [[96, 0], [103, 0.05], [91, 0.1], [108, 0.16]]) this.bell(midi(n), t + at, 0.5, 0.08, out); this.burst(t, 0.3, 0.07, 9000, 'highpass', out, 4000); break;   // glass ringing
			case 'pw.mute': this.tone('square', 660, t, 0.26, 0.11, out, 110); this.burst(t, 0.26, 0.12, 3000, 'lowpass', out, 200); this.tone('sine', 70, t + 0.27, 0.2, 0.3, out, 50); break;                 // a voice running down, then a thud: silence
			case 'pw.report': for (const at of [0, 0.13]) { this.tone('square', 988, t + at, 0.09, 0.09, out); this.tone('square', 1319, t + at + 0.04, 0.07, 0.07, out); } this.tone('sine', 150, t + 0.3, 0.14, 0.26, out, 70); this.burst(t + 0.3, 0.05, 0.16, 1400, 'bandpass', out); break;   // sent, sent, and the stamp comes down
			case 'pw.guards': for (const [n, at] of [[74, 0], [81, 0.09], [78, 0.2], [86, 0.29]]) this.bell(midi(n), t + at, 0.45, 0.11, out); this.tone('sine', 587, t, 0.5, 0.05, out, 1175); break;         // two lights wake, one after the other
			case 'pw.armor': for (let i = 0; i < 3; i++) { this.bell(196 * (1 + i * 0.26), t + i * 0.11, 0.3, 0.16, out); this.burst(t + i * 0.11, 0.03, 0.14, 4200, 'highpass', out); } break;              // three plates lock into place
			case 'pw.private': this.tone('sine', 1050, t, 0.24, 0.12, out, 260); this.burst(t, 0.24, 0.07, 2400, 'bandpass', out, 500); this.burst(t + 0.27, 0.025, 0.2, 3000, 'bandpass', out); this.tone('triangle', 330, t + 0.28, 0.1, 0.14, out, 220); break;   // a curtain drawn, and the lock clicks
			case 'pw.bolt': this.burst(t, 0.45, 0.12, 1800, 'bandpass', out, 9000); this.tone('sawtooth', 220, t, 0.45, 0.05, out, 1760); break;                                                           // the air charges
			case 'pw.thunder': this.burst(t, 0.07, 0.4, 7000, 'highpass', out); this.tone('sine', 150, t, 0.5, 0.42, out, 38); this.burst(t + 0.04, 0.55, 0.28, 1800, 'lowpass', out, 120); break;             // the crack, then the roll
			case 'pw.plate': this.bell(1240, t, 0.2, 0.12, out); this.burst(t, 0.12, 0.2, 6000, 'highpass', out, 2200); this.tone('square', 180, t, 0.08, 0.1, out, 90); break;                                // a plate breaks
			case 'pw.turned': this.tone('triangle', 640, t, 0.08, 0.09, out, 1500); break;                                                                                                               // a shot is sent back
			// Total Awareness: the sun rises on a slow climbing chord, and its light sets off with a bright sweep
			case 'pw.aware': this.tone('sawtooth', 62, t, 1.5, 0.16, out, 248); this.burst(t, 1.5, 0.12, 200, 'bandpass', out, 3000); [50, 57, 62, 66, 69, 74].forEach((n, i) => this.bell(midi(n), t + i * 0.22, 1.2, 0.1, out)); break;
			case 'pw.dawn': this.burst(t, 1.3, 0.22, 500, 'bandpass', out, 7000); this.tone('sine', 294, t, 1.3, 0.12, out, 1175); [74, 78, 81, 86, 90, 93].forEach((n, i) => this.bell(midi(n), t + i * 0.18, 0.9, 0.09, out)); break;
			case 'beat': this.tone('sine', 66, t, 0.16, 0.34, out, 46); this.tone('sine', 60, t + 0.2, 0.14, 0.26, out, 42); break;
			// a boss arrives: a low growl that wavers, with breath in it (heard under its spoken or written line)
			case 'growl': {
				const o = ctx.createOscillator(), wob = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
				o.type = 'sawtooth'; o.frequency.setValueAtTime(74, t); o.frequency.exponentialRampToValueAtTime(48, t + 1.3);
				wob.frequency.value = 23; depth.gain.value = 16; wob.connect(depth).connect(o.frequency);
				f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + 1.3);
				g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
				o.connect(f).connect(g).connect(out); o.start(t); wob.start(t); o.stop(t + 1.5); wob.stop(t + 1.5);
				this.burst(t, 1.1, 0.12, 500, 'bandpass', out, 180);
				break;
			}
			// a phone rings: two short trills of two notes together; and the small click of a call being picked up
			case 'ring': for (const at of [0, 0.42]) for (let k = 0; k < 4; k++) { this.tone('sine', 1245, t + at + k * 0.075, 0.06, 0.13, out); this.tone('sine', 1568, t + at + k * 0.075, 0.06, 0.1, out); } break;
			case 'pickup': this.burst(t, 0.03, 0.16, 2400, 'bandpass', out); this.tone('sine', 880, t + 0.02, 0.09, 0.12, out, 1175); break;
			case 'crate': bells([86, 90, 93, 98], 0.07, 0.13, 0.4); break;
			case 'go': this.bell(midi(86), t, 0.5, 0.2, out); this.dum(t, 0.4); break;
			case 'stage': bells([62, 69, 74, 78, 81], 0.09, 0.17, 0.5); break;
			case 'win': bells([62, 66, 69, 74, 78, 81, 86, 90], 0.1, 0.17, 0.7); break;
			default: this.tone('triangle', 520, t, 0.06, 0.08, out, 1040);            // a weapon without a voice of its own yet
		}
	}

	dispose() { if (this.timer !== null) clearInterval(this.timer); void this.ctx?.close(); this.ctx = null; }
}
