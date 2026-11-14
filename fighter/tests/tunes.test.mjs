// Every stage has its own tune (owner, 2026-11-13). The tunes are data; this checks that there is one for every stage
// and the last challenge, that each is well formed, that no note falls outside its bar's chord, and that no two are alike.
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

test('there is a tune for every stage and one for the last challenge', () => {
	assert.equal(TUNES.length, economy.stages.length + 1);
});

test('every tune is well formed', () => {
	for (const [n, t] of TUNES.entries()) {
		assert.equal(t.bars.length, 4, `tune ${n + 1}: four bars`);
		assert.equal(t.arp.length, 16, `tune ${n + 1}: sixteen steps of arpeggio`);
		for (const k of ['bass', 'kick', 'snare', 'hat']) assert.equal(t[k].length, 16, `tune ${n + 1}: ${k} has sixteen steps`);
		assert.match(t.bass, /^[xo.]+$/); assert.match(t.kick, /^[x.]+$/); assert.match(t.snare, /^[x.]+$/); assert.match(t.hat, /^[xh.]+$/);
		assert.ok(t.arp.every(k => k >= -1 && k <= 3), `tune ${n + 1}: the arpeggio stays inside the chord`);
		assert.ok(t.bpm >= 80 && t.bpm < t.boss && t.boss <= 150, `tune ${n + 1}: the boss is faster than the fight`);
		for (const b of t.bars) {
			assert.equal(b.tones.length, 4);
			assert.ok(b.root >= 36 && b.root <= 52, `tune ${n + 1}: the bass can be heard on a phone and stays a bass`);
			assert.ok(b.tones.every(x => x >= 52 && x <= 76), `tune ${n + 1}: the chord is in the middle of the keyboard`);
			// the chord belongs to its bass note: the bass is one of the chord's own notes
			assert.ok(b.tones.some(x => (x - b.root) % 12 === 0), `tune ${n + 1}: the bass note is in its chord`);
		}
	}
});

test('no two tunes are alike: key, pace, voice, walk and drums all differ', () => {
	const sig = t => ({ chords: t.bars.map(b => b.root % 12 + ':' + b.tones.map(x => x % 12).sort().join(',')).join(' '), arp: t.arp.join(), drums: t.kick + t.snare + t.hat, bass: t.bass });
	for (let a = 0; a < TUNES.length; a++) for (let b = a + 1; b < TUNES.length; b++) {
		const x = sig(TUNES[a]), y = sig(TUNES[b]);
		assert.notEqual(x.chords, y.chords, `tunes ${a + 1} and ${b + 1}: other chords`);
		assert.notEqual(x.arp, y.arp, `tunes ${a + 1} and ${b + 1}: another walk`);
		assert.notEqual(x.drums, y.drums, `tunes ${a + 1} and ${b + 1}: other drums`);
		assert.notEqual(TUNES[a].bpm, TUNES[b].bpm, `tunes ${a + 1} and ${b + 1}: another pace`);
		assert.notEqual(TUNES[a].bars[0].root % 12, TUNES[b].bars[0].root % 12, `tunes ${a + 1} and ${b + 1}: another home note`);
	}
	// neighbours in the order of play never share a voice
	for (let a = 0; a + 1 < TUNES.length; a++) assert.notEqual(TUNES[a].wave, TUNES[a + 1].wave, `stages ${a + 1} and ${a + 2}: another voice`);
});
