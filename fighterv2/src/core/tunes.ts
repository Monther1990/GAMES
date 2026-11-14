// The tunes of part 2: every stage has its own (owner, 2026-11-13: "each stage a different music"). They are data
// only - sound.ts plays them - so they can be checked without a browser (tests/tunes.test.mjs).
// A tune is four bars. Each bar has a bass note and a phrase of eight notes, given as places in the tune's scale.
// The tunes differ in mode (maqam), home note, pace, the rhythm of the hand drum and the instrument that leads.
// Only modes that need no quarter tones are used, so every note is one a keyboard has.
export type Lead = 'oud' | 'qanun' | 'ney' | 'buzuq' | 'reed' | 'storm';
export interface Tune {
	/** beats a minute while fighting (it rises a little with the fight) and against the boss */
	bpm: number; boss: number;
	/** eight notes going up, from the home note to the one an octave above */
	scale: number[];
	bars: { root: number; phrase: number[] }[];
	lead: Lead;
	/** against the boss the lead is doubled this many semitones above its lowered note */
	echo: number;
	/** the hand drum, sixteen steps: 'D' the deep stroke, 'B' the great drum, 't' the sharp one, 'k' a light one */
	drum: { calm: string; run: string; boss: string };
}

export const TUNES: Tune[] = [
	// 1 the flood of rumours - D Hijaz on a plucked oud: the tune part 2 began with (the menu plays it calmly as well)
	{ bpm: 98, boss: 124, scale: [62, 63, 66, 67, 69, 70, 72, 74], lead: 'oud', echo: 7,
		bars: [{ root: 38, phrase: [0, 2, 3, 2, 4, 3, 2, 1] }, { root: 43, phrase: [3, 4, 5, 4, 3, 2, 3, 4] }, { root: 39, phrase: [1, 2, 1, 0, 1, 2, 4, 2] }, { root: 45, phrase: [4, 5, 4, 2, 3, 2, 1, 0] }],
		drum: { calm: 'D...t...D...t...', run: 'D.t.t.k.D.k.t.k.', boss: 'D.tkD.t.DktkD.tk' } },
	// 2 our identity on the screen - F Ajam (bright, proud) on a qanun, over the stick-dance rhythm
	{ bpm: 106, boss: 128, scale: [65, 67, 69, 70, 72, 74, 76, 77], lead: 'qanun', echo: 12,
		bars: [{ root: 41, phrase: [0, 2, 4, 2, 3, 4, 5, 4] }, { root: 46, phrase: [5, 4, 3, 5, 4, 3, 2, 3] }, { root: 48, phrase: [4, 6, 7, 6, 4, 3, 1, 3] }, { root: 41, phrase: [4, 3, 2, 1, 2, 1, 0, 0] }],
		drum: { calm: 'D.......D...t...', run: 'D.t.k.D.D.k.t.k.', boss: 'D.tkk.D.D.tkt.tk' } },
	// 3 your digital trace - E Nahawand (quiet, watchful) on a breathy ney, the drum sparse: someone is following
	{ bpm: 90, boss: 118, scale: [64, 66, 67, 69, 71, 72, 75, 76], lead: 'ney', echo: 12,
		bars: [{ root: 40, phrase: [0, 1, 2, 1, 0, 2, 4, 2] }, { root: 45, phrase: [3, 2, 3, 5, 4, 3, 2, 3] }, { root: 47, phrase: [4, 6, 7, 6, 4, 2, 1, 2] }, { root: 40, phrase: [4, 3, 2, 1, 2, 1, 0, 0] }],
		drum: { calm: 'D.......t.......', run: 'D.....t.k.t.D.k.', boss: 'D..t..t.D.k.t.tk' } },
	// 4 strangers behind masks - B Kurd (dark, creeping) on a buzuq that repeats every note, over a turning rhythm
	{ bpm: 110, boss: 130, scale: [59, 60, 62, 64, 66, 67, 69, 71], lead: 'buzuq', echo: 12,
		bars: [{ root: 47, phrase: [0, 1, 0, 2, 1, 0, 3, 2] }, { root: 48, phrase: [1, 2, 3, 2, 1, 3, 4, 3] }, { root: 45, phrase: [6, 5, 4, 3, 4, 5, 6, 4] }, { root: 47, phrase: [4, 3, 2, 1, 2, 1, 0, 0] }],
		drum: { calm: 'D.....t.D.....t.', run: 'D..kD.t.D..kD.t.', boss: 'D.kkD.t.D.kkD.tk' } },
	// 5 the front of awareness - A Hijazkar (grand, tense) on a reed pipe, a marching rhythm of three and three and two
	{ bpm: 114, boss: 134, scale: [57, 58, 61, 62, 64, 65, 68, 69], lead: 'reed', echo: 12,
		bars: [{ root: 45, phrase: [0, 2, 3, 4, 3, 2, 1, 0] }, { root: 38, phrase: [3, 4, 5, 4, 3, 5, 6, 7] }, { root: 46, phrase: [7, 6, 5, 4, 5, 4, 3, 2] }, { root: 45, phrase: [4, 6, 7, 6, 4, 3, 1, 0] }],
		drum: { calm: 'D..t....D..t....', run: 'D..t..t.D..t..t.', boss: 'D.kt.kt.D.kt.ktk' } },
	// 6 the last battle, the sky of Oman - D Nawa Athar (stormy) on pipe and oud together, over great war drums
	{ bpm: 118, boss: 138, scale: [62, 64, 65, 68, 69, 70, 73, 74], lead: 'storm', echo: 12,
		bars: [{ root: 38, phrase: [0, 2, 3, 4, 3, 2, 1, 0] }, { root: 45, phrase: [4, 5, 4, 3, 4, 6, 7, 6] }, { root: 46, phrase: [5, 4, 3, 2, 3, 4, 5, 7] }, { root: 45, phrase: [4, 3, 2, 1, 2, 1, 0, 0] }],
		drum: { calm: 'B.......B...t...', run: 'B.D.t.k.B.DktkD.', boss: 'B.DkB.t.BkDkBtkt' } }
];
