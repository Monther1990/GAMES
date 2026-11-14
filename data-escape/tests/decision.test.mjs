// Decisions at a gate: every answer the player can give maps to one of the checkpoint's action ids (the ids the platform
// re-scores), the right answer is not always in the same lane, and replays prefer situations the player has not met.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const out = join(here, '.build', 'decision.mjs');
buildSync({ entryPoints: [join(here, '../src/run/decision.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const D = await import(pathToFileURL(out).href);
const missions = JSON.parse(readFileSync(join(here, '../src/data/missions.json'), 'utf8')).missions;
const content = JSON.parse(readFileSync(join(here, '../src/data/content-ar.json'), 'utf8'));
const cps = missions.flatMap(m => m.checkpoints);

test('every situation offers exactly the checkpoint\'s actions, one per lane', () => {
	for (const cp of cps) {
		const all = content.decisions[cp.id].variants;
		for (const v of all) {
			const seen = all.filter(x => x.id !== v.id).map(x => x.id);                 // force this variant
			const d = D.buildDecision(cp, 'run-1', seen);
			assert.equal(d.variant.id, v.id);
			if (v.type === 'order') { assert.equal(d.steps.length, 3); assert.notDeepEqual(d.steps.map(s => s.id), v.steps.map(s => s.id), 'steps start out of order'); continue; }
			assert.deepEqual(d.choices.map(c => c.actionId).sort(), [cp.safeActionId, ...cp.unsafeActionIds].sort());
			assert.deepEqual(d.choices.map(c => c.lane), [0, 1, 2]);
		}
	}
});

test('the safe answer moves between lanes from run to run', () => {
	const cp = cps.find(c => content.decisions[c.id].variants[0].type === 'choice');
	const lanes = new Set();
	for (let i = 0; i < 40; i++) lanes.add(D.buildDecision(cp, 'run-' + i, []).choices.find(c => c.actionId === cp.safeActionId).lane);
	assert.equal(lanes.size, 3);
});

test('a replay shows a situation the player has not met when one is left', () => {
	for (const cp of cps) {
		const all = content.decisions[cp.id].variants.map(v => v.id);
		for (let i = 0; i < 10; i++) {
			const first = D.pickVariant(cp.id, 'run-' + i, []);
			assert.equal(first.fresh, true);
			const second = D.pickVariant(cp.id, 'other-' + i, [first.variant.id]);
			assert.notEqual(second.variant.id, first.variant.id);
			assert.equal(D.pickVariant(cp.id, 'x' + i, all).fresh, false);
		}
	}
});

test('an ordering maps to the safe action only when it is fully right', () => {
	for (const cp of cps) for (const v of content.decisions[cp.id].variants.filter(x => x.type === 'order')) {
		const [a, b, c] = v.steps.map(s => s.id);
		assert.equal(D.orderAction(cp, v, [a, b, c]), cp.safeActionId);
		assert.equal(D.orderAction(cp, v, [b, a, c]), cp.unsafeActionIds[0], 'wrong first step');
		assert.equal(D.orderAction(cp, v, [c, b, a]), cp.unsafeActionIds[0]);
		assert.equal(D.orderAction(cp, v, [a, c, b]), cp.unsafeActionIds[1], 'right first step, wrong later');
	}
});
