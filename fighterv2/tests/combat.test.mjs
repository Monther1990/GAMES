// The combat simulation, run without any rendering: wave plans match the approved enemy counts, every weapon fires and
// hurts at every level and changes shape at levels 3 and 5, enemies pay once, and boss fights last about as long as
// the brief asks at a fitting weapon level. (How each of the nine weapons works is tested in weapons.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const bundle = async name => {
	const out = join(here, '.build', name + '.mjs');
	buildSync({ entryPoints: [join(here, `../src/sim/${name}.ts`)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
	return import(pathToFileURL(out).href);
};
const W = await bundle('world');
W.CLOSE.bonus = 0;                       // rated figures are those of a shot from far away; the bonus for standing near is tested in coop.test.mjs
const D = await bundle('director');
const G = await bundle('weapons');
const E = await bundle('economy');
const DT = 1 / 60;
const WEAPONS = E.weapons.map(w => w.id);
const still = { dx: 0, dz: 0, target: null };

/** A player that lines up under the lowest enemy (or the boss) and cannot be hurt: measures what the weapons do. */
function aimBot(world) {
	const list = world.targets();
	if (!list.length) return still;
	const turret = list.find(e => e.kind === 'turret');                          // a sensible player breaks the guards first
	const t = turret ?? (world.boss && world.boss.mode !== 'enter' ? world.boss : list.reduce((a, b) => (a.x < b.x ? a : b)));
	return { dx: 0, dz: 0, target: { x: 2.4, z: Math.max(-3.6, Math.min(3.6, t.z)) } };
}
function dummy(world, x, z, hp = 1e6, kind = 'normal') {
	const e = world.director.spawn({ kind, index: -1, at: 0, sx: x, sz: z, hx: x, hz: z, pattern: 0, shooter: false });
	e.hp = e.maxHp = hp; e.mode = 'hold'; e.x = x; e.z = z; e.stay = 1e9; e.guard = 1; e.shielded = false; e.cycle = 1e9;
	return e;
}
const frozen = world => { world.director.update = () => {}; return world; };   // targets stay where the test puts them

test('wave plans contain exactly the approved enemy counts, each with its own reward id', () => {
	for (let seed = 0; seed < 40; seed++) E.stages.forEach((s, i) => {
		const plan = D.buildPlan(s.enemies, s.boss.summons, s.enemyFire, W.seeded('plan-' + seed + i));
		const all = plan.waves.flat();
		const count = k => all.filter(x => x.kind === k).length;
		assert.equal(count('normal') + plan.reserve.length, s.enemies.normal, `${s.id} normal`);
		assert.equal(count('armored'), s.enemies.armored, `${s.id} armoured`);
		assert.equal(count('rare'), s.enemies.rare, `${s.id} rare`);
		assert.equal(plan.reserve.length, s.boss.summons);
		const ids = [...all.map(x => x.index), ...plan.reserve];
		assert.equal(new Set(ids).size, ids.length, 'reward ids are unique');
		const money = all.reduce((n, x) => n + E.enemyReward[x.kind], 0) + plan.reserve.length * E.enemyReward.normal;
		assert.equal(money, E.enemyBudget(s), `${s.id} budget`);
		for (const x of all) assert.ok(Math.abs(x.hz) <= 4 && x.hx >= 9 && x.hx <= 18, 'enemies hold inside the arena, above the player');
	});
});

test('every weapon fires and deals damage at every level, close to its rated damage per second', () => {
	for (const id of WEAPONS) for (let level = 1; level <= 5; level++) {
		const world = frozen(new W.World(E.stages[0], 0, id, level, { waves: false, seed: 't' }));
		world.godMode = true;
		const boss = dummy(world, 9, 0, 1e6);
		boss.r = 3.2;                                                            // a target wide enough that nothing misses
		for (let n = 0; n < 60 * 12; n++) world.step(DT, still);
		const dealt = 1e6 - boss.hp, rated = G.ratedDps(id, level) * 12;
		assert.ok(dealt > 0, `${id} L${level} did no damage`);
		assert.ok(dealt > rated * 0.72 && dealt < rated * 1.2, `${id} L${level}: dealt ${dealt.toFixed(0)} vs rated ${rated.toFixed(0)}`);
		assert.ok(world.events.some(e => e.type === 'fire' && e.weapon === id), `${id} L${level} reported no shot`);
	}
});

test('weapons grow with level, and levels 3 and 5 change the way they fire', () => {
	for (const id of WEAPONS) for (let level = 2; level <= 5; level++)
		assert.ok(G.ratedPower(id, level) > G.ratedPower(id, level - 1) * 1.1, `${id} L${level} is not clearly stronger than L${level - 1}`);
	for (const id of WEAPONS) for (let level = 2; level <= 5; level++)
		assert.ok(G.ratedDps(id, level) > G.ratedDps(id, level - 1), `${id} L${level} does not hit one target harder than L${level - 1}`);
	// what each weapon gains at levels 3 and 5 (what these numbers do in a fight is tested in weapons.test.mjs)
	const L = (id, n) => G.levelStats(id, n), at = (id, key) => [1, 3, 5].map(n => L(id, n)[key] ?? 0);
	assert.deepEqual(at('pulse', 'streams'), [1, 2, 2]);                       // two streams, then three droplets that pass through an enemy
	assert.deepEqual([at('pulse', 'split'), at('pulse', 'pierce')], [[2, 2, 3], [0, 0, 1]]);
	assert.deepEqual(at('scatter', 'clouds'), [1, 2, 2]);                      // two clouds, then clouds that slow
	assert.ok(!L('scatter', 3).slow && L('scatter', 5).slow > 0 && L('scatter', 5).radius > L('scatter', 3).radius);
	assert.deepEqual(at('arc', 'towers'), [1, 2, 3]);                          // more towers, and at the top they burst
	assert.ok(!L('arc', 3).burst && L('arc', 5).burst > 0);
	assert.deepEqual(at('disc', 'count'), [1, 2, 3]);                          // a pair, then three with more bounces
	assert.ok(L('disc', 5).bounces > L('disc', 3).bounces);
	assert.deepEqual(at('beam', 'beams'), [1, 1, 2]);                          // a wider beam that leaves a burn, then two beams
	assert.ok(!L('beam', 1).burn && L('beam', 3).burn > 0 && L('beam', 3).width > L('beam', 1).width);
	assert.deepEqual(at('wave', 'count'), [1, 1, 2]);                          // a larger whirlpool, then two that burst
	assert.ok(L('wave', 3).radius > L('wave', 1).radius && L('wave', 5).burst > 0);
	assert.deepEqual(at('missile', 'count'), [1, 2, 3]);                       // more falcons, and at the top each strike splashes
	assert.ok(!L('missile', 3).splash && L('missile', 5).splash > 0);
	assert.ok(!L('plasma', 1).frags && L('plasma', 3).frags === 4 && !L('plasma', 3).second && L('plasma', 5).second > 0);   // fragments, then a second shell
	assert.deepEqual(at('shield', 'count'), [1, 2, 3]);                        // more stars, and at the top a great ring from the fighter
	assert.ok(!L('shield', 3).nova && L('shield', 5).nova > 0);
	for (const id of WEAPONS) if (id !== 'shield') assert.ok(G.ratedPower('shield', 5) > G.ratedPower(id, 5), `the Star of Suhail is stronger than ${id}`);
	// the approved prices stand, and a dearer weapon is not a weaker one overall: by level 5 the four dearest out-power the four cheapest
	const byPrice = [...E.weapons].sort((a, b) => a.price - b.price).map(w => G.ratedPower(w.id, 5));
	assert.ok(Math.min(...byPrice.slice(5)) > Math.max(...byPrice.slice(0, 4)) * 0.95, `power by price at level 5: ${byPrice.map(n => n.toFixed(0)).join(', ')}`);
});

test('an armoured enemy blocks most damage while its plate is closed', () => {
	const w = frozen(new W.World(E.stages[0], 0, 'pulse', 1, { waves: false, seed: 'a' }));
	w.godMode = true;
	const closed = dummy(w, 9, 0, 1000, 'armored'); closed.guard = 0.25; closed.shielded = true;
	for (let n = 0; n < 60 * 4; n++) w.step(DT, still);
	const blocked = 1000 - closed.hp;
	closed.guard = 1; closed.shielded = false; closed.hp = 1000;
	for (let n = 0; n < 60 * 4; n++) w.step(DT, still);
	assert.ok(1000 - closed.hp > blocked * 3, 'open takes at least three times as much');
});

test('stage one waves: an aiming player destroys most enemies, each kill is reported once, then the waves end', () => {
	const world = new W.World(E.stages[0], 0, 'pulse', 1, { waves: true, seed: 'waves-1' });
	world.godMode = true;
	const kills = new Set();
	let done = false, steps = 0, money = 0;
	while (!done && steps++ < 60 * 240) {
		world.step(DT, aimBot(world));
		for (const e of world.events.splice(0)) {
			if (e.type === 'kill') { assert.ok(!kills.has(e.enemy.index), 'a kill is reported once'); kills.add(e.enemy.index); money += E.enemyReward[e.enemy.kind]; }
			if (e.type === 'wavesDone') done = true;
		}
	}
	assert.ok(done, 'the waves finished');
	const seconds = steps * DT;
	console.log(`    stage 1 waves with a perfect aim: ${seconds.toFixed(0)} s, ${kills.size}/45 destroyed, ${money} rials`);
	assert.ok(seconds > 35 && seconds < 170, `waves took ${seconds.toFixed(0)} s`);   // (the lower bound was 45: the starter's drops now burst into droplets, which reach the enemies beside the one struck and also take numbers, and the mix of enemy kinds in a wave shifts with those; measured 39 to 47 s)
	assert.ok(kills.size >= 36, `only ${kills.size} of 45 destroyed`);
	assert.ok(money <= E.enemyBudget(E.stages[0]));
});

test('boss fights last about 45 to 75 seconds at a fitting weapon level, and end with the boss destroyed', () => {
	const fitting = [1, 3, 4, 5, 5];                                           // the pulse level a saving player can afford by each stage
	E.stages.forEach((s, i) => {
		const world = new W.World(s, i, 'pulse', fitting[i], { waves: false, seed: 'boss-' + i });
		world.godMode = true;
		world.director.startBoss();
		let dead = false, steps = 0, phases = 0;
		while (!dead && steps++ < 60 * 200) {
			world.step(DT, aimBot(world));
			for (const e of world.events.splice(0)) { if (e.type === 'bossDead') dead = true; if (e.type === 'bossPhase') phases++; }
		}
		const seconds = steps * DT;
		console.log(`    ${s.boss.id}: ${seconds.toFixed(0)} s with pulse L${fitting[i]}, ${phases + 1} phases`);
		assert.ok(dead, `${s.boss.id} was not destroyed`);
		assert.ok(phases >= 1 && phases <= 2, `${s.boss.id} has two or three phases`);
		assert.ok(seconds >= 40 && seconds <= 85, `${s.boss.id}: ${seconds.toFixed(0)} s with pulse L${fitting[i]}`);
		assert.equal(world.bullets.length, 0, 'danger is cleared when the boss falls');
	});
});

test('the player is hurt once per hit, protected for a moment after it, and the stage is lost at zero health', () => {
	const world = frozen(new W.World(E.stages[0], 0, 'pulse', 1, { waves: false, seed: 'h' }));
	const events = [];
	const flood = () => { for (let z = -0.4; z <= 0.4; z += 0.2) world.shoot(world.player.x + 0.3, world.player.z + z, 0, 6); };
	for (let n = 0; n < 60 * 12 && !world.over; n++) {
		flood();
		world.step(DT, still);
		for (const e of world.events.splice(0)) if (e.type === 'playerHit' || e.type === 'playerDead') events.push([e.type, +world.t.toFixed(2)]);
	}
	const hits = events.filter(e => e[0] === 'playerHit');
	assert.equal(hits.length, 5);
	for (let i = 1; i < hits.length; i++) assert.ok(hits[i][1] - hits[i - 1][1] >= 1.55, 'overlapping bullets take one life, not several');
	assert.equal(events[events.length - 1][0], 'playerDead');
	assert.equal(world.over, true);
});

test('movement stops at once when the keys are released and stays inside the lower area', () => {
	const world = frozen(new W.World(E.stages[0], 0, 'pulse', 1, { waves: false, seed: 'm' }));
	for (let n = 0; n < 30; n++) world.step(DT, { dx: 0, dz: 1, target: null });
	const z = world.player.z;
	for (let n = 0; n < 12; n++) world.step(DT, still);
	assert.ok(world.player.z - z < 0.35, 'no long slide after release');
	for (let n = 0; n < 600; n++) world.step(DT, { dx: 1, dz: 1, target: null });
	assert.ok(world.player.x <= 8 && world.player.z <= 3.6);
	for (let n = 0; n < 600; n++) world.step(DT, { dx: -1, dz: -1, target: null });
	assert.ok(world.player.x >= 0.9 && world.player.z >= -3.6);
});
