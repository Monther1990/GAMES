// The approved economy of the brief, checked by arithmetic: stage totals, question cases, upgrade costs, shop rules,
// and that a reward can never be credited twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const out = join(here, '.build', 'economy.mjs');
buildSync({ entryPoints: [join(here, '../src/sim/economy.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const E = await import(pathToFileURL(out).href);

test('stage totals at mastery are 300, 360, 420, 480, 540 and the campaign pays 2100', () => {
	assert.deepEqual(E.stages.map(E.stageTotal), [300, 360, 420, 480, 540]);
	assert.equal(E.stages.reduce((n, s) => n + E.stageTotal(s), 0), 2100);
});

test('small-enemy budgets are 70, 84, 98, 112, 126 from the approved counts at 1, 5 and 10 rials', () => {
	assert.deepEqual(E.enemyReward, { normal: 1, armored: 5, rare: 10 });
	assert.deepEqual(E.stages.map(E.enemyBudget), [70, 84, 98, 112, 126]);
	assert.deepEqual(E.stages.map(s => [s.enemies.normal, s.enemies.armored, s.enemies.rare]), [[40, 4, 1], [44, 4, 2], [48, 6, 2], [52, 6, 3], [56, 8, 3]]);
});

test('each stage grows by 20 % of stage one', () => {
	const first = E.stages[0];
	E.stages.forEach((s, i) => {
		const k = 1 + 0.2 * i;
		assert.equal(s.bossReward, Math.round(first.bossReward * k));
		assert.deepEqual(s.questionRewards, first.questionRewards.map(x => Math.round(x * k)));
		assert.equal(s.bonus, Math.round(first.bonus * k));
	});
});

test('stage one: fighting alone pays 120, three right answers make 230, the bonus makes 300', () => {
	const s = E.stages[0];
	const fight = E.enemyBudget(s) + s.bossReward;
	assert.equal(fight, 120);
	const all = E.quizPayout(s, [true, true, true]);
	assert.equal(fight + all.total - all.bonus, 230);
	assert.equal(fight + all.total, 300);
});

test('zero, one, two and three right answers: the bonus needs all three', () => {
	const s = E.stages[0];
	assert.deepEqual(E.quizPayout(s, [false, false, false]), { packages: [0, 0, 0], bonus: 0, total: 0 });
	assert.deepEqual(E.quizPayout(s, [true, false, false]), { packages: [25, 0, 0], bonus: 0, total: 25 });
	assert.deepEqual(E.quizPayout(s, [false, true, true]), { packages: [0, 35, 50], bonus: 0, total: 85 });
	assert.deepEqual(E.quizPayout(s, [true, true, true]), { packages: [25, 35, 50], bonus: 70, total: 180 });
	assert.equal(E.quizPayout(s, [true, true]).bonus, 0, 'an unfinished session earns no bonus');
});

test('weapon prices and upgrade costs: 60 + 140 + 260 + 440 = 900 for every weapon', () => {
	const price = Object.fromEntries(E.weapons.map(w => [w.id, w.price]));
	for (const [id, p] of [['pulse', 0], ['scatter', 350], ['arc', 550], ['beam', 800], ['missile', 1100], ['plasma', 1450]]) assert.equal(price[id], p, `${id} keeps its approved price`);
	assert.deepEqual([price.disc, price.wave, price.shield], [650, 950, 1900], 'the three added weapons');
	assert.equal(Math.max(...E.weapons.map(w => w.price)), price.shield, 'the Cyber Shield is the most expensive weapon');
	assert.equal(E.weapons.length, 9);
	assert.deepEqual(E.upgradeCosts, [60, 140, 260, 440]);
	assert.equal(E.fullUpgradeCost(), 900);
	for (const w of E.weapons) {
		assert.equal(w.levels.length, 5, w.id);
		const bank = { wallet: 10000, weapons: { [w.id]: 1 }, equipped: w.id };
		let spent = 0;
		for (let level = 2; level <= 5; level++) { const r = E.upgradeWeapon(bank, w.id); assert.equal(r.ok, true); spent += r.spent; assert.equal(bank.weapons[w.id], level, 'no level is skipped'); }
		assert.equal(spent, 900);
		assert.deepEqual(E.upgradeWeapon(bank, w.id), { ok: false, reason: 'max_level' });
	}
});

test('shop: buying takes the price once, needs the money, and a weapon cannot be owned twice', () => {
	const bank = E.newBank();
	assert.deepEqual(bank.weapons, { pulse: 1 });
	assert.deepEqual(E.buyWeapon(bank, 'scatter'), { ok: false, reason: 'funds', missing: 350 });
	bank.wallet = 349;
	assert.deepEqual(E.buyWeapon(bank, 'scatter'), { ok: false, reason: 'funds', missing: 1 });
	bank.wallet = 400;
	assert.deepEqual(E.buyWeapon(bank, 'scatter'), { ok: true, spent: 350 });
	assert.equal(bank.wallet, 50);
	assert.deepEqual(E.buyWeapon(bank, 'scatter'), { ok: false, reason: 'owned' });
	assert.equal(bank.wallet, 50, 'a refused purchase costs nothing');
	assert.deepEqual(E.upgradeWeapon(bank, 'scatter'), { ok: false, reason: 'funds', missing: 10 });
	assert.deepEqual(E.upgradeWeapon(bank, 'beam'), { ok: false, reason: 'not_owned' });
	assert.equal(E.equipWeapon(bank, 'beam'), false);
	assert.equal(E.equipWeapon(bank, 'scatter'), true);
	assert.equal(bank.equipped, 'scatter');
	assert.equal(E.nextUpgradeCost(bank, 'scatter'), 60);
	assert.equal(E.nextUpgradeCost(bank, 'beam'), null);
});

test('a reward is credited once per attempt, survives a save and reload, and a new attempt earns again', () => {
	const bank = E.newBank();
	const a = new E.Attempt('a1', 0);
	assert.equal(a.credit(bank, 'kill:3', 1), true);
	assert.equal(a.credit(bank, 'kill:3', 1), false, 'the same kill does not pay twice');
	assert.equal(a.credit(bank, 'boss', 50), true);
	for (let i = 0; i < 5; i++) a.credit(bank, 'q1', 25);                    // rapid repeated clicks
	assert.equal(bank.wallet, 76);
	const restored = new E.Attempt('a1', 0, JSON.parse(JSON.stringify(a)));
	assert.equal(restored.credit(bank, 'boss', 50), false, 'reloading in the middle does not pay the boss again');
	assert.equal(restored.credit(bank, 'q2', 35), true);
	assert.equal(bank.wallet, 111);
	assert.equal(restored.sum('kill'), 1);
	assert.equal(restored.total, 111);
	const again = new E.Attempt('a2', 0);
	assert.equal(again.credit(bank, 'boss', 50), true, 'replaying the stage on purpose is a new attempt');
	assert.equal(bank.wallet, 161);
});

test('a full first pass through the campaign: fight, answer all, and the wallet matches the table', () => {
	const bank = E.newBank();
	E.stages.forEach((s, i) => {
		const a = new E.Attempt('run-' + i, i);
		let k = 0;
		for (const cls of ['normal', 'armored', 'rare']) for (let n = 0; n < s.enemies[cls]; n++) a.credit(bank, 'kill:' + k++, E.enemyReward[cls]);
		a.credit(bank, 'boss', s.bossReward);
		const pay = E.quizPayout(s, [true, true, true]);
		pay.packages.forEach((amount, q) => a.credit(bank, 'q' + (q + 1), amount));
		a.credit(bank, 'bonus', pay.bonus);
		assert.equal(a.total, E.stageTotal(s));
	});
	assert.equal(bank.wallet, 2100);
});
