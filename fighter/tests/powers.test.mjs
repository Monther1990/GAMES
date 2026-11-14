// Cyber boxes and emergency powers, run without rendering: a box pays nothing and hurts no one, opening it is reported
// once, each power does what its text says, and the numbers shown for damage never exceed the health that was there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const bundle = async name => {
	const out = join(here, '.build', 'p-' + name + '.mjs');
	buildSync({ entryPoints: [join(here, `../src/sim/${name}.ts`)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
	return import(pathToFileURL(out).href);
};
const W = await bundle('world');
W.CLOSE.bonus = 0;                       // rated figures are those of a shot from far away; the bonus for standing near is tested in coop.test.mjs
const E = await bundle('economy');
const DT = 1 / 60, still = { dx: 0, dz: 0, target: null };
const quiet = (stage = 0) => { const w = new W.World(E.stages[stage], stage, 'pulse', 1, { waves: false, seed: 'p' }); w.firing = false; return w; };
function dummy(world, x, z, hp, kind = 'normal') {
	const e = world.director.spawn({ kind, index: -1, at: 0, sx: x, sz: z, hx: x, hz: z, pattern: 0, shooter: false });
	e.hp = e.maxHp = hp; e.mode = 'hold'; e.x = x; e.z = z; e.stay = 1e9; e.cycle = 1e9;
	return e;
}
const hold = world => { world.director.update = () => {}; return world; };
const take = (world, type) => world.events.filter(e => e.type === type);

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

test('the bomb clears small malware and enemy fire, wounds the boss by a tenth, and leaves a box alone', () => {
	const w = hold(quiet(1));
	const small = [dummy(w, 9, 0, 50), dummy(w, 12, 2, 50), dummy(w, 14, -3, 300, 'armored')];
	const boss = dummy(w, 16, 0, 1000); boss.kind = 'boss'; w.boss = boss;
	const box = w.director.spawnCrate(); box.mode = 'hold'; box.x = 10;
	for (let i = 0; i < 12; i++) w.shoot(10, i / 3 - 2, 0, 0.1);
	w.zone(0, -4, 8, 4);
	w.usePower('bomb');
	assert.ok(small.every(e => e.dead), 'every small enemy is gone, armoured ones too');
	assert.equal(take(w, 'kill').length, 3);
	assert.equal(w.bullets.length + w.zones.length, 0);
	assert.equal(boss.hp, 900);
	assert.ok(!box.dead && box.hp === box.maxHp);
	assert.deepEqual(take(w, 'power').map(e => e.power), ['bomb']);
});

test('the mega pulse takes a quarter of the boss even through its shield, and protects for a moment', () => {
	const w = hold(quiet(3));
	const boss = dummy(w, 16, 0, 1000); boss.kind = 'boss'; boss.guard = 0.1; w.boss = boss;
	w.usePower('mega');
	assert.equal(boss.hp, 750);
	assert.equal(boss.guard, 0.1, 'the shield is as it was afterwards');
	assert.ok(w.player.invuln >= 2.5 && w.player.bubble >= 2.5);
});

test('the freeze stops enemies and their fire for five seconds, then everything moves again', () => {
	const w = quiet();
	w.shoot(10, 0, 0, 5);
	const x0 = w.bullets[0].x;
	w.usePower('freeze');
	w.player.x = 9.9; w.player.z = 0;                                           // right next to the frozen bullet
	for (let n = 0; n < 60 * 4; n++) w.step(DT, still);
	assert.equal(w.bullets[0].x, x0, 'the bullet has not moved');
	assert.equal(w.player.hp, w.player.maxHp);
	w.player.x = 2.4; w.player.z = 3;
	for (let n = 0; n < 60 * 2; n++) w.step(DT, still);
	assert.ok(!w.bullets.length || w.bullets[0].x < x0, 'after the thaw it flies on');
});

test('the emergency shield gives one heart back (never above the maximum) and six seconds without harm', () => {
	const w = quiet();
	w.player.hp = 2;
	w.usePower('guard');
	assert.equal(w.player.hp, 3);
	for (let n = 0; n < 60 * 5; n++) { w.hurtPlayer(); w.step(DT, still); }
	assert.equal(w.player.hp, 3, 'nothing hurts during the shield');
	for (let n = 0; n < 60 * 2; n++) w.step(DT, still);
	w.hurtPlayer();
	assert.equal(w.player.hp, 2, 'then the player can be hurt again');
	const full = quiet();
	full.usePower('guard');
	assert.equal(full.player.hp, full.player.maxHp);
});

test('the laser wave burns what stands ahead of the player and erases the fire in its column only', () => {
	const w = hold(quiet(2));
	const ahead = dummy(w, 12, 0.5, 40), aside = dummy(w, 12, 3.6, 40);
	const boss = dummy(w, 17, 0, 1000); boss.kind = 'boss'; boss.r = 1.4; w.boss = boss;
	w.shoot(8, 0.4, 0, 0); w.shoot(8, 3.8, 0, 0);
	w.usePower('laser');
	for (let n = 0; n < 60 * 3.2; n++) w.step(DT, still);
	assert.ok(ahead.dead, 'the enemy in the column is destroyed');
	assert.ok(!aside.dead && aside.hp === 40, 'the one beside it is untouched');
	assert.equal(w.bullets.length, 1, 'only the bullet outside the column remains');
	assert.ok(Math.abs(boss.hp - 790) < 8, `the boss lost about a fifth (hp ${boss.hp.toFixed(0)})`);
	assert.equal(w.laser, 0);
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

test('the last challenge: the code boss shuts its brackets, throws code, and falls to a strong weapon in a fair time', t => {
	const B = E.bonusStage;
	assert.equal(B.boss.id, 'omcode');
	assert.ok(B.boss.hp > Math.max(...E.stages.map(s => s.boss.hp)), 'it has more health than every other boss');
	assert.deepEqual(B.enemies, { normal: 0, armored: 0, rare: 0 }, 'no small enemies: it pays nothing but its own reward');
	for (const [id, level] of [['pulse', 5], ['plasma', 5], ['shield', 5], ['pulse', 3]]) {
		const w = new W.World(B, E.stages.length, id, level, { waves: false, seed: 'code' });
		w.godMode = true;
		const boss = w.director.startBoss();
		let n = 0, shut = 0, sawCode = false, blocked = 0; const phases = new Set();
		while (w.boss && n < 60 * 600) {
			w.step(DT, { dx: 0, dz: 0, target: { x: 2.4, z: Math.max(-3.6, Math.min(3.6, boss.z)) } });
			n++; if (boss.shielded) shut++;
			if (w.bullets.some(b => b.kind === 'code')) sawCode = true;
			for (const e of w.events) { if (e.type === 'bossPhase') phases.add(e.phase); if (e.type === 'hit' && e.blocked) blocked++; }
			w.events.length = 0;
		}
		const seconds = n / 60;
		t.diagnostic(`code boss with ${id} L${level}: ${seconds.toFixed(0)} s, brackets shut ${Math.round(shut / n * 100)} % of the time`);
		assert.ok(!w.boss, `${id} L${level} defeats it`);
		assert.ok(sawCode, 'its fire is shaped like code');
		assert.ok(shut / n > 0.2 && shut / n < 0.5, 'the brackets are shut part of the time, never most of it');
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

test('Total Awareness gathers, then destroys everything small, clears all fire, and takes two fifths of a shielded boss', () => {
	const w = hold(quiet(3));
	const small = [dummy(w, 9, 0, 50), dummy(w, 12, 2, 50), dummy(w, 14, -3, 300, 'armored'), dummy(w, 17, 3.5, 80)];
	const boss = dummy(w, 16, 0, 1000); boss.kind = 'boss'; boss.guard = 0.1; w.boss = boss;
	const box = w.director.spawnCrate(false); box.mode = 'hold'; box.x = 10;
	for (let i = 0; i < 12; i++) w.shoot(10, i / 3 - 2, 0, 0.1);
	w.zone(0, -4, 8, 4);
	assert.ok(!W.POWERS.includes('aware'), 'an ordinary box never holds it');
	w.usePower('aware');
	assert.equal(take(w, 'nova').length, 0, 'not yet: it gathers first');
	assert.ok(small.every(e => !e.dead) && boss.hp === 1000);
	for (let n = 0; n < 30; n++) w.step(DT, still);
	assert.ok(w.bullets.length > 0 && w.player.hp === w.player.maxHp, 'while it gathers nothing moves and nothing hurts');
	for (let n = 0; n < 60; n++) w.step(DT, still);
	assert.equal(take(w, 'nova').length, 1, 'one blast');
	assert.ok(small.every(e => e.dead), 'nothing small survives');
	assert.equal(take(w, 'kill').length, 4, 'and every one of them is reported, so each pays once');
	assert.equal(w.bullets.length + w.zones.length, 0);
	assert.equal(boss.hp, 600);
	assert.ok(!box.dead, 'a box is left for the player to open');
	assert.ok(w.player.invuln > 2);
	for (let n = 0; n < 120; n++) w.step(DT, still);
	assert.equal(take(w, 'nova').length, 1, 'it never goes off twice');
});

test('the heart box comes only when hearts are missing: once in the early stages, twice later, and says what it is', () => {
	const run = (stage, hurtAt, seconds) => {
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
	assert.equal(run(0, 1e9, 70), 0, 'none while health is full');
	assert.equal(run(0, 5, 120), 1, 'one in the first stage');
	assert.equal(run(4, 5, 150), 2, 'two in the last stage');
	const w = quiet(1), box = w.director.spawnCrate(false, true);
	w.damage(box, 1e9, 'pulse', box.x, box.z);
	assert.deepEqual(take(w, 'crate').map(e => [e.rare, e.heart]), [[false, true]]);
	const p = quiet(0);
	p.player.hp = 4;
	assert.equal(p.heal(2), 1, 'hearts never pass the maximum');
	assert.equal(p.player.hp, p.player.maxHp);
});

test('the firewall stops enemy fire at its line for six seconds, and no longer', () => {
	const w = hold(quiet());
	w.usePower('wall');
	const line = w.wall.x;
	assert.ok(line > w.player.x + 1, 'the wall stands ahead of the player');
	for (let i = 0; i < 8; i++) w.shoot(line + 3, i - 3.5, 0, 6);
	for (let n = 0; n < 60 * 2; n++) w.step(DT, still);
	assert.equal(w.bullets.length, 0, 'everything that reached the wall was stopped');
	assert.equal(w.player.hp, w.player.maxHp);
	assert.ok(take(w, 'fizz').length > 0, 'and the screen is told where, so it can show sparks');
	for (let n = 0; n < 60 * 4.2; n++) w.step(DT, still);
	assert.equal(w.wall.left, 0);
	w.shoot(line + 3, 9, 0, 6);
	for (let n = 0; n < 60 * 1; n++) w.step(DT, still);
	assert.equal(w.bullets.length, 1, 'after it ends, fire passes again');
});

test('the antivirus scan sweeps the whole field once: small malware is removed, a boss loses an eighth, fire is erased', () => {
	const w = hold(quiet(2));
	const small = [dummy(w, 6, -3, 60), dummy(w, 12, 2, 60), dummy(w, 17, 3.4, 400, 'armored')];
	const boss = dummy(w, 15, 0, 1000); boss.kind = 'boss'; boss.guard = 0.1; w.boss = boss;
	const box = w.director.spawnCrate(false); box.mode = 'hold'; box.x = 9;
	for (let i = 0; i < 6; i++) w.shoot(4 + i * 2.5, i - 2.5, 0, 0);
	w.usePower('scan');
	for (let n = 0; n < 60 * 3; n++) w.step(DT, still);
	assert.ok(small.every(e => e.dead), 'every small enemy on the field');
	assert.equal(boss.hp, 875, 'the boss is struck once, through its shield');
	assert.equal(w.bullets.length, 0);
	assert.ok(!box.dead);
	assert.ok(!w.scan.on, 'the scan ends when it has crossed the field');
});

test('a backup brings the player back once with two hearts; without one, zero health loses the stage', () => {
	const w = quiet();
	w.backups = 1; w.player.hp = 1;
	w.shoot(8, 0, 0, 1);
	w.hurtPlayer();
	assert.equal(w.player.hp, 2);
	assert.ok(!w.over);
	assert.equal(take(w, 'revived').length, 1);
	assert.equal(w.bullets.length, 0, 'and the screen is cleared for a fair return');
	assert.equal(w.backups, 0);
	w.player.invuln = 0; w.player.hp = 1;
	w.hurtPlayer();
	assert.ok(w.over && take(w, 'playerDead').length === 1, 'the second time there is nothing left to restore');
});

test('the security update: one level higher and harder-hitting for eight seconds, on top of any upgrade made meanwhile', () => {
	const w = hold(new W.World(E.stages[0], 0, 'pulse', 2, { waves: false, seed: 'u' }));
	w.firing = false;
	const e = dummy(w, 9, 0, 1000);
	w.damage(e, 10, 'pulse', 9, 0);
	assert.equal(e.hp, 990);
	w.usePower('update');
	assert.equal(w.weapon.level, 3);
	w.damage(e, 10, 'pulse', 9, 0);
	assert.equal(e.hp, 977, 'thirty per cent harder');
	w.setWeaponLevel(3);
	assert.equal(w.weapon.level, 4, 'an upgrade bought during the update keeps the extra level');
	for (let n = 0; n < 60 * 8.2; n++) w.step(DT, still);
	assert.equal(w.weapon.level, 3, 'afterwards the weapon is at the level that was paid for');
	assert.equal(w.boost, 0);
	const top = hold(new W.World(E.stages[0], 0, 'pulse', 5, { waves: false, seed: 'u5' }));
	top.usePower('update');
	assert.equal(top.weapon.level, 5, 'never above the highest level');
	for (const id of ['wall', 'scan', 'backup', 'update']) assert.ok(W.POWERS.includes(id), `${id} can come from an ordinary box`);
});
