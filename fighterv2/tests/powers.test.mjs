// Cyber boxes and the special skills of part 2, run without rendering: a box pays nothing and hurts no one, opening it
// is reported once, each skill does what its text says for as long as it says, what it does is counted for whoever
// used it, and the numbers shown for damage never exceed the health that was there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const build = async (path, name) => {
	const out = join(here, '.build', 'p-' + name + '.mjs');
	buildSync({ entryPoints: [join(here, path)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
	return import(pathToFileURL(out).href);
};
const bundle = name => build(`../src/sim/${name}.ts`, name);
const W = await bundle('world');
W.CLOSE.bonus = 0;                       // rated figures are those of a shot from far away; the bonus for standing near is tested in coop.test.mjs
const E = await bundle('economy');
const P = await bundle('powers');
const DT = 1 / 60, still = { dx: 0, dz: 0, target: null };
const quiet = (stage = 0) => { const w = new W.World(E.stages[stage], stage, 'pulse', 1, { waves: false, seed: 'p' }); w.firing = false; return w; };
function dummy(world, x, z, hp, kind = 'normal') {
	const e = world.director.spawn({ kind, index: -1, at: 0, sx: x, sz: z, hx: x, hz: z, pattern: 0, shooter: false });
	e.hp = e.maxHp = hp; e.mode = 'hold'; e.x = x; e.z = z; e.stay = 1e9; e.cycle = 1e9;
	return e;
}
const bossOf = (w, x, z, hp, guard = 1) => { const b = dummy(w, x, z, hp); b.kind = 'boss'; b.r = 1.4; b.guard = guard; w.boss = b; return b; };
const hold = world => { world.director.update = () => {}; return world; };
const take = (world, type) => world.events.filter(e => e.type === type);
const run = (w, seconds) => { for (let n = 0; n < Math.round(60 * seconds); n++) w.step(DT, still); };
const pair = (stage = 0) => { const w = quiet(stage); w.addAlly('pulse', 1); return w; };
const OLD = ['bomb', 'mega', 'laser', 'freeze', 'guard', 'wall', 'scan', 'backup', 'update'];

test('Cyber boxes appear in a real stage, once in early stages and twice later, and only when asked for', () => {
	for (const [stage, expected] of [[0, 1], [1, 1], [2, 2], [4, 2]]) {
		const w = new W.World(E.stages[stage], stage, 'plasma', 5, { waves: true, seed: 'box' + stage, crates: true });
		w.godMode = true;
		let seen = 0;
		for (let n = 0; n < 60 * 150 && !w.director.cleared; n++) {
			const list = w.targets().filter(e => e.kind !== 'crate');
			w.step(DT, list.length ? { dx: 0, dz: 0, target: { x: 2.4, z: Math.max(-3.6, Math.min(3.6, list.reduce((a, b) => (a.x < b.x ? a : b)).z)) } } : still);
			seen += take(w, 'crateIn').length; w.events.length = 0;
		}
		assert.ok(w.director.cleared, `stage ${stage + 1} waves were cleared`);
		assert.equal(seen, expected, `stage ${stage + 1} boxes`);
	}
	const plain = new W.World(E.stages[0], 0, 'plasma', 5, { waves: true, seed: 'menu' });
	plain.godMode = true;
	for (let n = 0; n < 60 * 40; n++) plain.step(DT, still);
	assert.equal(plain.enemies.filter(e => e.kind === 'crate').length + take(plain, 'crateIn').length, 0, 'no boxes behind the menu');
});

test('a box pays nothing, cannot hurt, and reports its opening once; left alone it flies away', () => {
	const w = quiet();
	const box = w.director.spawnCrate();
	assert.equal(box.index, -1, 'no reward id: it never pays');
	for (let n = 0; n < 90; n++) w.step(DT, still);
	w.player.x = box.x; w.player.z = box.z;                                    // standing inside it
	w.step(DT, still);
	assert.equal(w.player.hp, w.player.maxHp, 'touching a box does not hurt');
	w.damage(box, 1e6, 'pulse', box.x, box.z);
	assert.equal(take(w, 'crate').length, 1);
	assert.equal(take(w, 'kill').length, 0, 'a box is not a kill and credits no money');
	const w2 = quiet();
	w2.director.spawnCrate();
	for (let n = 0; n < 60 * 14; n++) w2.step(DT, still);
	assert.equal(w2.enemies.length, 0, 'the unopened box has left');
	assert.equal(take(w2, 'crate').length, 0);
});

test('the ten skills of part 2: nine in ordinary boxes, none of part 1\'s, at least five from the first stage, the strong ones later', () => {
	assert.deepEqual([...W.POWERS].sort(), ['armor', 'bolt', 'falcon', 'guards', 'mirror', 'mute', 'private', 'rain', 'report']);
	assert.ok(!W.POWERS.includes('aware'), 'an ordinary box never holds Total Awareness');
	assert.deepEqual([...P.POWER_IDS].sort(), [...W.POWERS, 'aware'].sort());
	for (const id of OLD) assert.ok(!P.POWER_IDS.includes(id), `${id} is gone`);
	const from = stage => W.POWERS.filter(p => stage >= (W.POWER_FROM[p] ?? 0));
	assert.ok(from(0).length >= 5, `stage 1 offers ${from(0).length}`);
	for (const id of ['falcon', 'guards', 'bolt']) assert.ok(!from(0).includes(id), `${id} is kept for later stages`);
	assert.equal(from(2).length, 9, 'from the third stage every one of them can come');
	// no ordinary skill takes more of a boss than a quarter of its health; Total Awareness takes two fifths
	const T = P.TUNE;
	const share = { rain: T.rain.boss * T.rain.time / T.rain.tick, falcon: T.falcon.boss * 2, mirror: T.mirror.boss, bolt: T.bolt.boss, guards: T.guards.boss * 2 * T.guards.time / T.guards.every };
	for (const [id, k] of Object.entries(share)) assert.ok(k <= 0.25, `${id} takes ${(k * 100).toFixed(0)} % of a boss at most`);
	assert.equal(T.aware.boss, 0.4);
});

test('a power that is not known is never used, and the fallen and the finished use none', () => {
	const w = hold(quiet());
	const e = dummy(w, 12, 0, 50);
	for (const id of OLD) w.usePower(id);                                      // an id out of an old save: nothing happens and nothing breaks
	run(w, 1);
	assert.equal(e.hp, 50); assert.equal(w.player.hp, w.player.maxHp);
	assert.equal(take(w, 'power').length, 0, 'and nothing is shown');
	w.over = true; w.usePower('bolt'); w.over = false;
	assert.equal(take(w, 'power').filter(p => p.power === 'bolt').length, 0);
});

test('Khareef Rain: five seconds in which every enemy is hurt a little several times a second, and moves more slowly', () => {
	const w = hold(quiet(1));
	const small = dummy(w, 9, 0, 100), plated = dummy(w, 14, -3, 300, 'armored'), boss = bossOf(w, 16, 0, 1000, 0.1);
	const box = w.director.spawnCrate(); box.mode = 'hold'; box.x = 10;
	w.usePower('rain');
	assert.equal(small.hp, 100, 'nothing at once: it is not a blast');
	run(w, 1.02);
	assert.equal(small.hp, 84, 'four drops of damage in the first second, four hundredths each');
	assert.equal(plated.hp, 300 - 4 * 12, 'a plate does not keep the rain out');
	assert.equal(boss.hp, 980);
	run(w, 4.2);
	assert.equal(w.pw.rain, 0, 'it stops after five seconds');
	assert.ok(small.hp >= 20 && small.hp <= 24, `a small enemy lost about four fifths (${small.hp} left)`);
	assert.ok(boss.hp >= 900 && boss.hp <= 905, `a boss lost a tenth (${boss.hp} left)`);
	const after = small.hp; run(w, 2);
	assert.equal(small.hp, after, 'and then nothing more');
	assert.ok(!box.dead && box.hp === box.maxHp, 'a box is left alone');
	assert.equal(take(w, 'kill').length, 0);
	// slower: the same enemy in the same fight has lived through less of its own time when it rains
	const age = wet => { const v = quiet(1); const e = dummy(v, 14, 0, 1e6); if (wet) v.usePower('rain'); run(v, 2); return e.age; };
	assert.ok(Math.abs(age(false) - 2) < 0.02);
	assert.ok(Math.abs(age(true) - 2 * P.TUNE.rain.slow) < 0.02, 'enemies move and fire at little more than half speed');
});

test('Falcon Dive: up the lane where the enemies are thickest and back down it, striking twice what stands in the lane and nothing beside it', () => {
	const w = hold(quiet(1));
	const lane = [dummy(w, 9, 2.2, 100), dummy(w, 13, 2.6, 100), dummy(w, 16, 1.8, 100)], aside = dummy(w, 12, -2.5, 100), near = dummy(w, 11, -0.4, 100);
	w.usePower('falcon');
	const f = w.pw.falcon;
	assert.ok(f.on && lane.every(e => Math.abs(e.z - f.z) < P.TUNE.falcon.half), `the lane (${f.z}) is where three stand, not where one does`);
	run(w, 1.2);
	assert.deepEqual(lane.map(e => e.hp), [25, 25, 25], 'on the way up each loses three quarters, once');
	assert.equal(f.dir, -1, 'then it turns');
	run(w, 1.4);
	assert.ok(!f.on, 'and is gone when it has flown back down');
	assert.ok(lane.every(e => e.dead), 'the second pass finishes them');
	assert.equal(take(w, 'kill').length, 3);
	assert.deepEqual([aside.hp, near.hp], [100, 100], 'what stands outside the lane is untouched');
	// with a boss on the field the lane is the boss's, wherever the crowd is; it loses seven hundredths on each pass
	const v = hold(quiet(2));
	for (const z of [-3, -2.6, -2.2]) dummy(v, 10, z, 100);
	const boss = bossOf(v, 16, 2.4, 1000, 0.1);
	v.usePower('falcon');
	assert.equal(v.pw.falcon.z, 2.4);
	run(v, 2.6);
	assert.equal(boss.hp, 860, 'through its shield');
	assert.equal(boss.guard, 0.1, 'which is as it was afterwards');
});

test('Rumour Mirror: for five seconds enemy shots turn round near the fighter and fly back at the enemies; then they hurt again', () => {
	const w = hold(quiet());
	const e = dummy(w, 12, 0, 50);
	w.usePower('mirror');
	for (let i = 0; i < 5; i++) w.shoot(8, (i - 2) * 0.3, 0, 6);
	w.zone(0, -4, 1, -3.5);                                                   // marked ground is not a shot: the mirror leaves it
	run(w, 0.75);
	assert.ok(w.bullets.length === 5 && w.bullets.every(b => b.back === 1 && b.vx > 0), 'all five were turned before they reached the player');
	assert.ok(take(w, 'turned').length > 0, 'and the screen is told where');
	run(w, 1.5);
	assert.equal(w.player.hp, w.player.maxHp);
	assert.equal(w.bullets.length, 0);
	assert.equal(e.hp, 50 - 5 * 2, 'each returned shot is worth one small enemy of the stage');
	assert.equal(w.zones.length + take(w, 'zone').length, 1, 'the marked ground went off as usual');
	run(w, 3);
	assert.equal(w.pw.mirror, 0);
	w.shoot(8, 0, 0, 6); run(w, 1.5);
	assert.equal(w.player.hp, w.player.maxHp - 1, 'after five seconds a shot hurts again');
	// a storm of shots returned to a boss never takes more than its capped share
	const v = hold(quiet(3));
	const boss = bossOf(v, 15, 0, 1000, 0.1);
	v.usePower('mirror');
	for (let n = 0; n < 60 * 4; n++) { if (n % 3 === 0) v.shoot(9, (n % 7 - 3) * 0.4, 0, 7); v.step(DT, still); }
	run(v, 2);
	assert.equal(v.player.hp, v.player.maxHp);
	assert.ok(Math.abs(boss.hp - (1000 - 1000 * P.TUNE.mirror.boss)) < 1e-6, `the boss lost its capped share and no more (hp ${boss.hp})`);
});

test('Mute: for six seconds no enemy fires (shots in the air fly on, enemies still move); then they fire again', () => {
	const w = new W.World(E.stages[1], 1, 'pulse', 1, { waves: true, seed: 'mute' });   // the second stage: none of its shots bursts into new ones
	w.godMode = true; w.firing = false;
	let n = 0;
	while (w.bullets.length < 3 && n++ < 60 * 40) w.step(DT, still);
	assert.ok(w.bullets.length >= 3, 'the enemies of a real stage were firing');
	const known = new Set(w.bullets.map(b => b.id)), flying = w.bullets[w.bullets.length - 1], x0 = flying.x;
	const mover = w.enemies.find(e => e.kind === 'normal' && e.mode === 'hold'), z0 = mover.z;
	w.usePower('mute'); w.events.length = 0;
	for (let i = 0; i < 60 * 5.9; i++) { w.step(DT, still); for (const b of w.bullets) assert.ok(known.has(b.id), 'no new shot while muted'); }
	assert.equal(take(w, 'enemyFire').length, 0, 'and no flash of a shot that was never fired');
	assert.ok(flying.x < x0, 'a shot that was already in the air kept flying');
	assert.notEqual(mover.z, z0, 'the enemies still move');
	w.shoot(10, 0, 0, 1); w.zone(0, 0, 1, 1); w.lob(10, 0, 3, 0, 1);
	assert.equal(w.bullets.filter(b => !known.has(b.id)).length + w.zones.length, 0, 'neither shot, nor marked ground, nor lobbed shot');
	n = 0;
	while (!w.bullets.some(b => !known.has(b.id)) && n++ < 60 * 20) w.step(DT, still);
	assert.ok(w.bullets.some(b => !known.has(b.id)), 'after six seconds they fire again');
	assert.equal(w.pw.mute, 0);
});

test('Report: every enemy on screen is marked for eight seconds and takes double from weapons (a boss half as much again)', () => {
	const w = hold(quiet());
	const a = dummy(w, 12, 0, 1000), boss = bossOf(w, 16, 0, 1000);
	const box = w.director.spawnCrate(); box.mode = 'hold'; box.x = 10;
	w.usePower('report');
	const late = dummy(w, 10, 2, 1000);                                        // it came after the report was sent
	assert.ok(w.pw.marked.has(a.id) && w.pw.marked.has(boss.id) && !w.pw.marked.has(late.id) && !w.pw.marked.has(box.id));
	w.damage(a, 10, 'pulse', a.x, a.z); w.damage(boss, 10, 'pulse', boss.x, boss.z); w.damage(late, 10, 'pulse', late.x, late.z);
	assert.deepEqual([a.hp, boss.hp, late.hp], [980, 985, 990]);
	w.usePower('falcon'); run(w, 0.68);                                        // a skill that takes a share of health takes the same share of a marked enemy
	assert.equal(a.hp, 980 - 750);
	run(w, 7.6);
	assert.equal(w.pw.report, 0);
	const before = late.hp; w.damage(late, 10, 'pulse', late.x, late.z);
	w.damage(boss, 10, 'pulse', boss.x, boss.z);
	assert.equal(before - late.hp, 10);
	assert.ok(Math.abs(boss.hp - (985 - 140 - 10)) < 1e-6, 'after eight seconds a hit is a plain hit again');
});

test('Identity Guards: two lights beside the fighter fire by themselves at the nearest enemy for ten seconds', () => {
	const w = hold(quiet());                                                  // the player's own weapon is silent here: whatever is struck, the guards struck
	const nearOne = dummy(w, 9, -1, 1000), far = dummy(w, 17, 3, 1000);
	w.usePower('guards');
	run(w, 0.5);
	assert.ok(w.pw.darts.length > 0, 'they have begun to fire');
	const from = P.guardSpot(w.player, 0), to = P.guardSpot(w.player, 1);
	assert.ok(from.z < w.player.z && to.z > w.player.z, 'one on each side of the fighter');
	run(w, 10.5);
	assert.deepEqual([w.pw.guards[0], w.pw.darts.length], [0, 0], 'after ten seconds they are gone, and so are their shots');
	const dealt = 1000 - nearOne.hp;
	assert.ok(dealt >= 36 && dealt <= 42, `about forty shots, each worth half a small enemy (${dealt})`);
	assert.equal(far.hp, 1000, 'they fire at whoever is nearest');
	assert.equal(w.stats[0].damage, dealt, 'and what they do is counted for their fighter');
	// against a boss alone the whole ten seconds stay under a quarter of its health
	const v = hold(quiet(4));
	const boss = bossOf(v, 15, 0, 100, 0.1);
	v.usePower('guards'); run(v, 11);
	assert.ok(boss.hp > 80 && boss.hp < 90, `a boss loses about a sixth (hp ${boss.hp})`);
	// they wait while their fighter answers a box
	const q = hold(pair());
	const t = dummy(q, 9, 0, 1000);
	q.usePower('guards', 1); q.setBusy(1, true); run(q, 2);
	assert.equal(t.hp, 1000);
	q.setBusy(1, false); run(q, 2);
	assert.ok(t.hp < 1000 && Math.abs(q.stats[1].damage - (1000 - t.hp)) < 1e-6 && q.stats[0].damage === 0, 'the supporter\'s guards count for the supporter');
});

test('Identity Shield: one heart back and three plates, each of which takes one hit; a count of hits, not of seconds', () => {
	const w = quiet();
	w.player.hp = 2;
	w.usePower('armor');
	assert.equal(w.player.hp, 3);
	assert.equal(w.pw.armor[0], 3);
	run(w, 30);
	assert.equal(w.pw.armor[0], 3, 'the plates do not run out with time');
	for (let i = 0; i < 3; i++) { w.player.invuln = 0; w.hurtPlayer(); assert.equal(w.player.hp, 3, `plate ${i + 1} took the hit`); }
	assert.deepEqual(take(w, 'plate').map(e => e.left), [2, 1, 0]);
	assert.equal(take(w, 'playerHit').length, 0);
	w.hurtPlayer();
	assert.equal(w.player.hp, 3, 'a breath after a plate breaks: one cluster of shots does not take two');
	w.player.invuln = 0; w.hurtPlayer();
	assert.equal(w.player.hp, 2, 'the fourth hit reaches a heart');
	const full = quiet();
	full.usePower('armor'); full.usePower('armor');
	assert.equal(full.player.hp, full.player.maxHp, 'never more hearts than the maximum');
	assert.equal(full.pw.armor[0], 3, 'and never more than three plates');
});

test('Private Account: for six seconds the enemies cannot see the fighter: aimed shots go straight down and seeking shots stop seeking', () => {
	const w = hold(quiet(2));
	w.player.x = 3; w.player.z = 3;
	assert.ok(w.aim(15, -2) > 0.3, 'seen: the shot is aimed at the player');
	w.shoot(14, -3, 0, 4, 'glitch', { how: 'seek', turn: 2, until: 9 });
	run(w, 0.5);
	const seeker = w.bullets[0];
	assert.ok(seeker.vz > 0.2 && seeker.fly, 'a seeking shot bends toward the player');
	w.usePower('private');
	assert.equal(w.aim(15, -2), 0, 'unseen: straight down the field');
	const vz = seeker.vz;
	w.player.z = -3;                                                          // the player crosses to the other side, unseen
	run(w, 0.5);
	assert.ok(!seeker.fly && seeker.vz === vz, 'the seeking shot lost its prey and flies on as it was going');
	w.shoot(14, -3, w.aim(14, -3), 5); const aimed = w.bullets[w.bullets.length - 1];
	assert.ok(Math.abs(aimed.vz) < 1e-9 && aimed.vx < 0, 'a new aimed shot goes straight down');
	assert.deepEqual([w.prey().x, w.prey().z], [3, 3], 'lobbed shots land where the fighter was last seen');
	assert.ok(w.pw.hidden[0] > 0 && w.player.hp === w.player.maxHp);
	w.bullets = []; run(w, 5.6);
	assert.equal(w.pw.hidden[0], 0, 'six seconds');
	assert.ok(w.aim(15, 2) < -0.3 && w.prey() === w.player, 'then the enemies see the player again');
	// two fighters: it hides only whoever used it, and the enemies turn to the other
	const v = hold(pair());
	v.usePower('private');
	for (let i = 0; i < 6; i++) { run(v, 0.9); assert.equal(v.prey(), v.ally.body, 'they aim at the one they can see'); }
	assert.ok(v.aim(15, 0) !== 0);
	const both = hold(pair());
	both.usePower('private'); both.usePower('private', 1);
	assert.equal(both.aim(15, 3), 0, 'with both unseen nobody is aimed at');
});

test('Mountain Lightning: a mark, then lightning on the five strongest enemies at once; a boss is always one of them', () => {
	const w = hold(quiet(2));
	const hp = [10, 80, 30, 60, 20, 70, 40], small = hp.map((h, i) => dummy(w, 8 + i, i - 3, h)), boss = bossOf(w, 17, 0, 1000, 0.1);
	const box = w.director.spawnCrate(); box.mode = 'hold'; box.x = 10;
	for (let i = 0; i < 6; i++) w.shoot(10, i - 2.5, 0, 0);
	w.usePower('bolt');
	assert.equal(w.pw.bolts.length, 5);
	assert.ok(small.every(e => !e.dead) && boss.hp === 1000 && take(w, 'thunder').length === 0, 'first the marks: nothing is struck yet');
	small[1].x = 5; run(w, 0.25);
	assert.equal(w.pw.bolts.find(b => b.id === small[1].id).x, 5, 'a mark follows its target');
	run(w, 0.3);
	assert.deepEqual(small.map(e => e.dead), [false, true, false, true, false, true, true], 'the four strongest small ones are destroyed, the rest untouched');
	assert.deepEqual(small.filter(e => !e.dead).map(e => e.hp), [10, 30, 20]);
	assert.equal(boss.hp, 850, 'and the boss loses fifteen hundredths, through its shield');
	assert.deepEqual(take(w, 'thunder').map(e => e.big).sort(), [false, false, false, false, true]);
	assert.equal(take(w, 'kill').length, 4);
	assert.equal(w.bullets.length, 6, 'targeted hits: enemy fire is not cleared, as a blast would clear it');
	assert.ok(!box.dead && w.pw.bolts.length === 0);
});

test('the damage shown never exceeds the health that was there', () => {
	const w = hold(quiet());
	const e = dummy(w, 9, 0, 3);
	w.damage(e, 2, 'pulse', 9, 0);
	assert.equal(e.took, 2);
	w.damage(e, 1e9, 'pulse', 9, 0);
	assert.equal(e.took, 3, 'an overkill shows only what was left');
});

test('enemy fire grows with every wave of a stage', () => {
	const w = new W.World(E.stages[0], 0, 'pulse', 1, { waves: true, seed: 'ramp' });
	const d = w.director;
	d.wave = 0; const first = d.pressure;
	d.wave = d.waveCount - 1; const last = d.pressure;
	assert.equal(first, 1);
	assert.ok(last > 1.25 && last < 1.6, `the last wave fires ${(last * 100 - 100).toFixed(0)} % faster`);
});

test('the last challenge: the storm of the war of ideas guards itself, throws lightning, and falls to a strong weapon in a fair time', t => {
	const B = E.bonusStage;
	assert.equal(B.boss.id, 'warstorm');
	assert.ok(B.boss.hp > Math.max(...E.stages.map(s => s.boss.hp)), 'it has more health than every other boss');
	assert.deepEqual(B.enemies, { normal: 0, armored: 0, rare: 0 }, 'no small enemies: it pays nothing but its own reward');
	// the weapon everybody starts with (at its highest level and half-way), and the two dearest ones
	const ids = E.weapons.map(x => x.id), top = [...E.weapons].sort((a, b) => b.price - a.price).slice(0, 2).map(x => x.id);
	for (const [id, level] of [[ids[0], 5], [top[1], 5], [top[0], 5], [ids[0], 3]]) {
		const w = new W.World(B, E.stages.length, id, level, { waves: false, seed: 'code' });
		w.godMode = true;
		const boss = w.director.startBoss();
		let n = 0, shut = 0, sawZap = false, blocked = 0; const phases = new Set();
		while (w.boss && n < 60 * 600) {
			w.step(DT, { dx: 0, dz: 0, target: { x: 2.4, z: Math.max(-3.6, Math.min(3.6, boss.z)) } });
			n++; if (boss.shielded) shut++;
			if (w.bullets.some(b => b.kind === 'zap')) sawZap = true;
			for (const e of w.events) { if (e.type === 'bossPhase') phases.add(e.phase); if (e.type === 'hit' && e.blocked) blocked++; }
			w.events.length = 0;
		}
		const seconds = n / 60;
		t.diagnostic(`warstorm with ${id} L${level}: ${seconds.toFixed(0)} s, guarded ${Math.round(shut / n * 100)} % of the time`);
		assert.ok(!w.boss, `${id} L${level} defeats it`);
		assert.ok(sawZap, 'its fire is shaped like lightning');
		assert.ok(shut / n > 0.2 && shut / n < 0.5, 'it is guarded part of the time, never most of it');
		assert.deepEqual([...phases], [1, 2], 'three phases');
		if (level === 5) assert.ok(seconds > 60 && seconds < 190, `a level 5 weapon needs between one and three minutes (${seconds.toFixed(0)} s)`);
	}
});

test('the rare black box: never in the first stage, at most one in a fight, about one box in five elsewhere', () => {
	let rare = 0, all = 0;
	for (let seed = 0; seed < 400; seed++) {
		const w = new W.World(E.stages[2], 2, 'pulse', 1, { waves: false, seed: 'rare' + seed });
		const a = w.director.spawnCrate();
		all++; if (a.pattern === 1) { rare++; assert.ok(a.hp > 12 * E.stages[2].enemyHp, 'it is tougher'); }
		assert.deepEqual(take(w, 'crateIn').map(e => e.rare), [a.pattern === 1]);
		const more = [w.director.spawnCrate(), w.director.spawnCrate(), w.director.spawnCrate()];
		assert.ok((a.pattern === 1) + more.filter(e => e.pattern === 1).length <= 1, 'never two in one fight');
	}
	assert.ok(rare / all > 0.12 && rare / all < 0.3, `rare boxes are ${(rare / all * 100).toFixed(0)} % of boxes`);
	for (let seed = 0; seed < 60; seed++) {
		const w = new W.World(E.stages[0], 0, 'pulse', 1, { waves: false, seed: 'first' + seed });
		assert.equal(w.director.spawnCrate().pattern, 0, 'no rare box in the first stage');
	}
	const w = quiet(1), box = w.director.spawnCrate(true);
	w.damage(box, 1e9, 'pulse', box.x, box.z);
	assert.deepEqual(take(w, 'crate').map(e => e.rare), [true], 'opening it says it was the rare one');
});

test('Total Awareness, the sunrise: the fight stands still while the sun rises, then its light crosses the field from the bottom to the top', () => {
	const w = hold(quiet(3));
	const low = dummy(w, 6, 0, 50), mid = dummy(w, 12, 2, 50), plated = dummy(w, 14, -3, 300, 'armored'), high = dummy(w, 19, 3.5, 80), small = [low, mid, plated, high];
	const boss = bossOf(w, 16, 0, 1000, 0.1);
	const box = w.director.spawnCrate(false); box.mode = 'hold'; box.x = 10;
	for (let i = 0; i < 12; i++) w.shoot(4 + i * 1.3, i / 3 - 2, 0, 3);
	w.zone(0, -4, 8, 4);
	w.usePower('aware');
	assert.equal(take(w, 'nova').length + take(w, 'dawn').length, 0, 'not yet: the sun rises first');
	const at = w.bullets.map(b => b.x);
	run(w, W.World.NOVA_DELAY - 0.1);
	assert.deepEqual(w.bullets.map(b => b.x), at, 'while it rises nothing moves');
	assert.ok(small.every(e => !e.dead) && boss.hp === 1000 && w.player.hp === w.player.maxHp, 'and nothing is hurt');
	run(w, 0.2);
	assert.equal(take(w, 'dawn').length, 1, 'the light sets off');
	assert.equal(w.zones.length, 0);
	// it takes what it passes, lowest first
	let order = [], n = 0, bossAt = -1, lastBullets = w.bullets.length;
	while (!take(w, 'nova').length && n++ < 60 * 4) {
		w.step(DT, still);
		for (const e of small) if (e.dead && !order.includes(e)) order.push(e);
		if (bossAt < 0 && boss.hp < 1000) bossAt = order.length;
		assert.ok(w.bullets.length <= lastBullets, 'no new shot while it crosses'); lastBullets = w.bullets.length;
		assert.ok(w.bullets.every(b => b.x > w.pw.dawn.x - 0.5), 'no shot is left behind the light');
	}
	assert.deepEqual(order, [low, mid, plated, high], 'bottom to top');
	assert.equal(bossAt, 3, 'the boss is struck when the light reaches it, between the third and the fourth');
	assert.ok(Math.abs(n / 60 - P.DAWN_TIME) < 0.25, `the crossing takes about ${P.DAWN_TIME.toFixed(1)} s`);
	assert.equal(take(w, 'nova').length, 1, 'one last flash');
	assert.equal(take(w, 'kill').length, 4, 'every small enemy is reported, so each pays once');
	assert.equal(w.bullets.length + w.zones.length, 0);
	assert.equal(boss.hp, 600, 'two fifths of a shielded boss');
	assert.ok(!box.dead, 'a box is left for the player to open');
	assert.ok(w.player.invuln > 1);
	run(w, 3);
	assert.equal(take(w, 'nova').length, 1, 'it never happens twice');
	assert.equal(w.freeze, 0, 'and the fight moves again');
});

test('the heart box comes only when hearts are missing: once in the early stages, twice later, and says what it is', () => {
	const go = (stage, hurtAt, seconds) => {
		const w = new W.World(E.stages[stage], stage, 'pulse', 1, { waves: true, seed: 'heart' + stage, crates: true });
		w.godMode = true; w.firing = false;
		let hearts = 0;
		for (let n = 0; n < 60 * seconds; n++) {
			if (n === 60 * hurtAt) w.player.hp = 2;
			w.step(DT, still);
			hearts += take(w, 'crateIn').filter(e => e.heart).length; w.events.length = 0;
			for (const e of w.enemies) if (e.kind === 'crate' && e.pattern === 2 && e.mode === 'hold' && e.age > 1) { assert.equal(e.index, -1); e.mode = 'leave'; }
		}
		return hearts;
	};
	assert.equal(go(0, 1e9, 70), 0, 'none while health is full');
	assert.equal(go(0, 5, 120), 1, 'one in the first stage');
	assert.equal(go(4, 5, 150), 2, 'two in the last stage');
	const w = quiet(1), box = w.director.spawnCrate(false, true);
	w.damage(box, 1e9, 'pulse', box.x, box.z);
	assert.deepEqual(take(w, 'crate').map(e => [e.rare, e.heart]), [[false, true]]);
	const p = quiet(0);
	p.player.hp = 4;
	assert.equal(p.heal(2), 1, 'hearts never pass the maximum');
	assert.equal(p.player.hp, p.player.maxHp);
});

test('two fighters: what a skill does is counted for whoever used it, and what is their own stays theirs', () => {
	const w = hold(pair(2));
	const a = dummy(w, 10, -3, 60), b = dummy(w, 12, 3, 60), boss = bossOf(w, 16, 0, 1000);   // the two small ones stand outside the falcon's lane
	w.usePower('rain', 1); run(w, 1.02);
	assert.ok(w.stats[0].damage === 0 && Math.abs(w.stats[1].damage - (2 * 4 * 2.4 + 20)) < 1e-6, 'the supporter\'s rain is the supporter\'s damage');
	w.usePower('falcon', 0); run(w, 2.6);
	assert.ok(Math.abs(w.stats[0].boss - 140) < 1e-6 && Math.abs(w.stats[0].damage - 140) < 1e-6, 'the main player\'s falcon is the main player\'s');
	assert.ok(!a.dead && !b.dead && boss.hp < 1000);
	w.events.length = 0;
	w.usePower('bolt', 1); run(w, 0.6);
	assert.ok(take(w, 'kill').length === 2 && take(w, 'kill').every(k => k.by === 1), 'the supporter\'s lightning: the supporter\'s kills');
	assert.equal(w.stats[1].kills, 2);
	// a returned shot is counted for whoever raised the mirror, whichever fighter it was flying at
	const v = hold(pair());
	const e = dummy(v, 12, v.player.z, 50);
	v.usePower('mirror', 1);
	v.shoot(8, v.player.z, 0, 6); run(v, 2);
	assert.ok(v.stats[0].damage === 0 && Math.abs(v.stats[1].damage - (50 - e.hp)) < 1e-6);
	assert.ok(e.hp < 50 && v.player.hp === v.player.maxHp, 'and the mirror covers both fighters');
	// the shield and the private account belong to whoever used them
	v.usePower('armor', 0); v.usePower('private', 1);
	v.ally.body.invuln = 0; v.hurt(1);
	assert.equal(v.ally.body.hp, v.ally.body.maxHp - 1, 'the main player\'s plates do not take the supporter\'s hit');
	assert.deepEqual([v.pw.armor[0], v.pw.armor[1], v.pw.hidden[0] > 0, v.pw.hidden[1] > 0], [3, 0, false, true]);
	// Total Awareness by the supporter: its kills and its two fifths are the supporter's
	const z = hold(pair(1));
	dummy(z, 9, 0, 40); const zb = bossOf(z, 16, 0, 500);
	z.usePower('aware', 1); run(z, 4);
	assert.equal(take(z, 'kill')[0].by, 1);
	assert.deepEqual([z.stats[0].boss, z.stats[1].boss], [0, 200]);
	// a supporter who leaves takes their own skills with them
	const q = hold(pair());
	q.usePower('guards', 1); q.usePower('armor', 1); q.usePower('private', 1); q.usePower('guards', 0);
	q.dropAlly();
	assert.deepEqual([q.pw.guards[1], q.pw.armor[1], q.pw.hidden[1]], [0, 0, 0]);
	assert.ok(q.pw.guards[0] > 0);
	run(q, 1);
});

test('the picture sent to the supporter carries every skill that is running, and their device keeps it moving', async () => {
	const C = await build('../src/core/coop.ts', 'coop');
	const w = hold(pair(2));
	const a = dummy(w, 11, 0, 1e6), b = dummy(w, 13, 2, 1e6), boss = bossOf(w, 16, -1, 1e6);
	w.usePower('report');
	for (const [id, by] of [['rain', 0], ['mirror', 1], ['mute', 0], ['guards', 1], ['armor', 0], ['private', 1], ['falcon', 0], ['bolt', 1]]) w.usePower(id, by);
	w.pw.mute = 0; w.shoot(6, w.player.z, 0, 6); w.pw.mute = P.TUNE.mute.time;  // one shot on its way to the mirror
	run(w, 0.3);
	assert.ok(w.bullets.some(q => q.back) && w.pw.darts.length > 0 && w.pw.bolts.length === 3 && w.pw.falcon.on, 'the fight is full of skills');
	const m = new C.Mirror(E.stages[2], 2, { id: 'pulse', level: 1 });
	m.apply(JSON.parse(JSON.stringify(C.snapshot(w))));                       // as it arrives: plain data
	const s = w.pw, g = m.pw, near = (x, y) => Math.abs(x - y) < 0.011;
	for (const k of ['rain', 'mirror', 'mute', 'report']) assert.ok(near(g[k], s[k]) && g[k] > 0, k);
	assert.ok(g.falcon.on && near(g.falcon.x, s.falcon.x) && near(g.falcon.z, s.falcon.z) && g.falcon.dir === s.falcon.dir, 'the falcon, where it is and which way it flies');
	assert.ok(g.guards[0] === 0 && near(g.guards[1], s.guards[1]), 'whose guards');
	assert.deepEqual(g.armor, [3, 0], 'whose plates');
	assert.ok(g.hidden[0] === 0 && near(g.hidden[1], s.hidden[1]), 'whose account is private');
	assert.deepEqual([...g.marked].sort(), [a.id, b.id, boss.id].sort(), 'who is marked');
	assert.equal(g.darts.length, s.darts.length);
	assert.deepEqual(g.bolts.map(q => q.id).sort(), s.bolts.map(q => q.id).sort());
	assert.deepEqual(m.bullets.filter(q => q.back).map(q => q.id), w.bullets.filter(q => q.back).map(q => q.id), 'which shots were turned round');
	// between two pictures things keep going
	const fx = g.falcon.x, dx = g.darts[0].x, rain = g.rain;
	m.advance(0.05);
	assert.ok(g.falcon.x > fx && g.darts[0].x !== dx && g.rain < rain);
	// Total Awareness: the rising sun and the wall of light
	const z = hold(pair());
	z.usePower('aware', 1);
	run(z, 0.5);
	m.apply(JSON.parse(JSON.stringify(C.snapshot(z))));
	assert.ok(m.novaIn > 0 && m.freeze > 0 && !m.pw.dawn.on);
	run(z, W.World.NOVA_DELAY);
	m.apply(JSON.parse(JSON.stringify(C.snapshot(z))));
	assert.ok(m.pw.dawn.on && near(m.pw.dawn.x, z.pw.dawn.x) && m.pw.dawn.by === 1);
	const x0 = m.pw.dawn.x; m.advance(0.05);
	assert.ok(m.pw.dawn.x > x0);
	// events travel as plain data
	const plain = JSON.parse(JSON.stringify(C.plainEvent({ type: 'plate', who: 1, left: 2, x: 3, z: 1 })));
	assert.deepEqual(plain, { type: 'plate', who: 1, left: 2, x: 3, z: 1 });
});

test('a save from before the powers were replaced loses the ids that no longer exist, and nothing else', async () => {
	const store = new Map();
	globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
	const S = await build('../src/core/storage.ts', 'storage');
	const save = S.defaults();
	save.bank.wallet = 123;
	save.powers = ['bomb', 'rain', 'backup', 'aware', 'mega', 'bolt', 'falcon'];
	S.storeSave(save);
	const back = S.loadSave();
	assert.deepEqual(back.powers, ['rain', 'aware', 'bolt'], 'unknown ids dropped, and three at most');
	assert.equal(back.bank.wallet, 123);
	save.powers = 'nonsense'; S.storeSave(save);
	assert.deepEqual(S.loadSave().powers, []);
	delete globalThis.localStorage;
});
