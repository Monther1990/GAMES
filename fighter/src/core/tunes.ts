// The tunes of part 1: every stage has its own (owner, 2026-11-13: "each stage a different music"). They are data
// only - sound.ts plays them - so they can be checked without a browser (tests/tunes.test.mjs).
// A tune is four bars of sixteen steps. Each bar has a bass note and a chord of four tones the arpeggio walks through.
// The tunes differ in key, chords, pace, the walk of the arpeggio, the voice that plays it, the bass and the drums.
export interface Tune {
	/** steps a minute while fighting (it rises a little with the fight) and against the boss */
	bpm: number; boss: number;
	/** the voice of the arpeggio, how loud it is, how long each note lasts (in steps) */
	wave: OscillatorType; gain: number; short: number;
	/** a second, quieter voice this many semitones away (12 a sparkle above, -12 a body below, 0 none) */
	twin: number;
	bars: { root: number; tones: number[] }[];
	/** sixteen steps: which of the bar's four tones sounds, -1 a rest */
	arp: number[];
	/** sixteen steps each: bass ('x' the bass note, 'o' an octave above, '.' none), kick, snare, hat ('x' always, 'h'
	 *  only when the fight is at its height) */
	bass: string; kick: string; snare: string; hat: string;
	/** the colour of the snare: low a clap, high a clank of metal */
	snareHz: number;
}

export const TUNES: Tune[] = [
	// 1 the message network - A minor, F, C, G: the tune the game began with (the menu plays it calmly as well)
	{ bpm: 106, boss: 132, wave: 'square', gain: 0.07, short: 0.9, twin: 0,
		bars: [{ root: 45, tones: [57, 60, 64, 69] }, { root: 41, tones: [57, 60, 65, 69] }, { root: 48, tones: [55, 60, 64, 67] }, { root: 43, tones: [55, 59, 62, 67] }],
		arp: [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 3, 1, 2, 3, 1, 2],
		bass: 'x...x.x.x...x.x.', kick: 'x...x...x...x...', snare: '................', hat: '.hxh.hxh.hxh.hxh', snareHz: 1800 },
	// 2 the vault of accounts - D minor, B flat, G minor, A: slow and heavy, a lock turning; soft notes with gaps
	{ bpm: 94, boss: 118, wave: 'triangle', gain: 0.15, short: 1.7, twin: 0,
		bars: [{ root: 38, tones: [57, 62, 65, 69] }, { root: 46, tones: [58, 62, 65, 70] }, { root: 43, tones: [55, 58, 62, 67] }, { root: 45, tones: [57, 61, 64, 69] }],
		arp: [0, -1, 2, 1, -1, 3, -1, 2, 0, -1, 2, 1, -1, 3, 2, -1],
		bass: 'x..x..x.x..x..x.', kick: 'x.....x...x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.xh', snareHz: 1300 },
	// 3 the app factory - E minor, G, C, D: machines at work; short dry notes, a bass that never stops, a clank of metal
	{ bpm: 118, boss: 138, wave: 'sawtooth', gain: 0.055, short: 0.45, twin: 0,
		bars: [{ root: 40, tones: [59, 64, 67, 71] }, { root: 43, tones: [59, 62, 67, 71] }, { root: 48, tones: [60, 64, 67, 72] }, { root: 50, tones: [57, 62, 66, 69] }],
		arp: [0, 0, 2, 0, 1, 0, 3, 0, 0, 0, 2, 0, 1, 3, 2, 1],
		bass: 'x.x.x.x.x.x.x.x.', kick: 'x...x...x...x...', snare: '....x..x....x.x.', hat: 'x.xhx.xhx.xhx.xh', snareHz: 2700 },
	// 4 the update core - B, F sharp, G sharp minor, E: bright and rising, a clear bell-like voice with a sparkle an octave above
	{ bpm: 112, boss: 134, wave: 'sine', gain: 0.13, short: 1.2, twin: 12,
		bars: [{ root: 47, tones: [59, 63, 66, 71] }, { root: 42, tones: [58, 61, 66, 70] }, { root: 44, tones: [59, 63, 68, 71] }, { root: 40, tones: [56, 59, 64, 68] }],
		arp: [0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3, 1, 2, 3, 3],
		bass: 'x...o...x.o.x...', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...xh', snareHz: 1500 },
	// 5 the heart of the system - F sharp minor, D, E, C sharp: fast and tight over a beat like a heart (two strokes, a rest)
	{ bpm: 122, boss: 140, wave: 'square', gain: 0.06, short: 0.6, twin: -12,
		bars: [{ root: 42, tones: [57, 61, 66, 69] }, { root: 50, tones: [57, 62, 66, 69] }, { root: 52, tones: [56, 59, 64, 68] }, { root: 49, tones: [56, 61, 65, 68] }],
		arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3],
		bass: 'x..x....x..x..x.', kick: 'x..x....x..x....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx', snareHz: 2000 },
	// 6 the last challenge, code space - C minor, A flat, F minor, G: wide and grim, one high note held over a broken beat
	{ bpm: 126, boss: 144, wave: 'sawtooth', gain: 0.05, short: 0.8, twin: 12,
		bars: [{ root: 48, tones: [60, 63, 67, 72] }, { root: 44, tones: [60, 63, 68, 72] }, { root: 41, tones: [60, 65, 68, 72] }, { root: 43, tones: [59, 62, 67, 71] }],
		arp: [0, 3, 2, 3, 1, 3, 2, 3, 0, 3, 2, 3, 1, 2, 3, 2],
		bass: 'x.xx..x.x.xx..x.', kick: 'x.....x...x.....', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', snareHz: 1700 }
];
