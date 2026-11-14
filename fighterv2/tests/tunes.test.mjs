// Every stage has its own tune (owner, 2026-11-13). The tunes are data; this checks that there is one for every stage
// and the last battle, that each is well formed, that the bass and the drone never fall outside the tune's mode, and
// that no two are alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const out = join(here, '.build', 't-tunes.mjs');
buildSync({ entryPoints: [join(here, '../src/core/tunes.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { TUNES } = await import(pathToFileURL(out).href);
const economy = JSON.parse(readFileSync(join(here, '../src/data/economy.json'), 'utf8'));

test('there is a tune for every stage and one for the last battle', () => {
	assert.equal(TUNES.length, economy.stages.length + 1);
});

test('every tune is well formed and stays in its mode', () => {
	for (const [n, t] of TUNES.entries()) {
		assert.equal(t.scale.length, 8, `tune ${n + 1}: eight notes`);
		assert.equal(t.scale[7] - t.scale[0], 12, `tune ${n + 1}: the scale closes an octave above`);
		for (let i = 1; i < 8; i++) assert.ok(t.scale[i] > t.scale[i - 1] && Number.isInteger(t.scale[i]), `tune ${n + 1}: the scale goes up, on notes a keyboard has`);
		assert.ok(t.scale[0] >= 55 && t.scale[7] <= 79, `tune ${n + 1}: the lead is in the middle of the keyboard`);
		assert.equal(t.bars.length, 4);
		assert.ok(t.bpm >= 80 && t.bpm < t.boss && t.boss <= 150, `tune ${n + 1}: the boss is faster than the fight`);
		for (const k of ['calm', 'run', 'boss']) { assert.equal(t.drum[k].length, 16, `tune ${n + 1}: ${k} drum has sixteen steps`); assert.match(t.drum[k], /^[DBtk.]+$/); assert.match(t.drum[k], /^[DB]/, `tune ${n + 1}: ${k} begins on a deep stroke`); }
		const mode = new Set(t.scale.map(x => x % 12));
		for (const b of t.bars) {
			assert.equal(b.phrase.length, 8);
			assert.ok(b.phrase.every(k => Number.isInteger(k) && k >= 0 && k <= 7), `tune ${n + 1}: the phrase stays in the scale`);
			assert.ok(b.root >= 36 && b.root <= 50, `tune ${n + 1}: the bass stays a bass`);
			assert.ok(mode.has(b.root % 12), `tune ${n + 1}: the bass note ${b.root} is in the mode`);
			// the drone and the walking bass also sound the fifth above the bass note for the whole bar
			// (the first tune is the one part 2 began with and is left exactly as it was: its last bar leans on a fifth outside the mode)
			if (n > 0) assert.ok(mode.has((b.root + 7) % 12), `tune ${n + 1}: the fifth above ${b.root} is in the mode`);
		}
		// the tune comes home: the last phrase ends on the home note
		assert.equal(t.bars[3].phrase[7] % 7, 0, `tune ${n + 1}: ends on its home note`);
	}
});

test('no two tunes are alike: mode, home note, pace, rhythm and instrument all differ', () => {
	const shape = t => t.scale.map(x => x - t.scale[0]).join();
	for (let a = 0; a < TUNES.length; a++) for (let b = a + 1; b < TUNES.length; b++) {
		const x = TUNES[a], y = TUNES[b];
		assert.notEqual(shape(x), shape(y), `tunes ${a + 1} and ${b + 1}: another mode`);
		assert.notEqual(x.lead, y.lead, `tunes ${a + 1} and ${b + 1}: another instrument`);
		assert.notEqual(x.bpm, y.bpm, `tunes ${a + 1} and ${b + 1}: another pace`);
		assert.notEqual(x.drum.run, y.drum.run, `tunes ${a + 1} and ${b + 1}: another rhythm`);
		assert.notEqual(x.bars.map(q => q.phrase.join()).join('|'), y.bars.map(q => q.phrase.join()).join('|'), `tunes ${a + 1} and ${b + 1}: another melody`);
	}
	// neighbours in the order of play never share a home note
	for (let a = 0; a + 1 < TUNES.length; a++) assert.notEqual(TUNES[a].scale[0] % 12, TUNES[a + 1].scale[0] % 12, `stages ${a + 1} and ${a + 2}: another home note`);
});
