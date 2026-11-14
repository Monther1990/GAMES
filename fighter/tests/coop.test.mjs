// Two players in one fight, run without rendering or network: the supporter fires and can be hurt, a fallen player is
// revived with one of the other's hearts, the stage is lost only when both are down, a fight for two is harder, and a
// supporter who leaves puts the fight back to the measure of one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const bundle = async name => {
	const out = join(here, '.build', 'c-' + name + '.mjs');
	buildSync({ entryPoints: [join(here, `../src/sim/${name}.ts`)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
	return import(pathToFileURL(out).href);
};
const W = await bundle('world');
const E = await bundle('economy');
const DT = 1 / 60, still = { dx: 0, dz: 0, target: null };
const pair = (stage = 0, weapon = 'pulse', level = 1, allyWeapon = 'pulse', allyLevel = 1) => {
	const w = new W.World(E.stages[stage], stage, weapon, level, { waves: false, seed: 'co' });
	w.addAlly(allyWeapon, allyLevel);
	return w;
};
const hold = w => { w.director.update = () => {}; return w; };
function dummy(world, x, z, hp, kind = 'normal') {
	const e = world.director.spawn({ kind, index: -1, at: 0, sx: x, sz: z, hx: x, hz: z, pattern: 0, shooter: false });
	e.hp = e.maxHp = hp; e.mode = 'hold'; e.x = x; e.z = z; e.stay = 1e9; e.cycle = 1e9;
	return e;
}
const take = (w, type) => w.events.filter(e => e.type === type);
const run = (w, seconds) => { for (let n = 0; n < 60 * seconds; n++) w.step(DT, still); };

test('two players: four hearts each, standing apart, and both weapons fire and hurt', () => {
	const w = hold(pair(0, 'pulse', 1, 'missile', 3));
	assert.equal(w.player.maxHp, 4); assert.equal(w.ally.body.maxHp, 4);
	assert.ok(w.player.z < 0 && w.ally.body.z > 0);
	const mine = dummy(w, 9, w.player.z, 1e6), theirs = dummy(w, 9, 3.6, 1e6);
	w.moveAlly(2.4, 3.6, DT);
	run(w, 4);
	assert.ok(mine.hp < 1e6, 'the main player hits what is in front of them');
	assert.ok(theirs.hp < 1e6, 'the supporter hits too');
	assert.ok(w.shots.some(s => s.owner === 1) && w.shots.some(s => !s.owner), 'each shot knows who fired it');
	assert.deepEqual([w.weapon.id, w.ally.weapon.id], ['pulse', 'missile'], 'and each keeps their own weapon');
	assert.ok(take(w, 'fire').some(e => e.weapon === 'missile') && take(w, 'fire').some(e => e.weapon === 'pulse'));
});

test('a fight for two is harder: tougher enemies and bosses, faster fire; leaving puts it back', () => {
	const w = pair(2);
	assert.deepEqual(w.hard, { hp: 1.7, boss: 1.8, fire: 1.3 });
	const solo = new W.World(E.stages[2], 2, 'pulse', 1, { waves: false, seed: 'co' });
	const e2 = dummy(w, 9, 0, 1), spawn = stage => stage.director.spawn({ kind: 'normal', index: -1, at: 0, sx: 9, sz: 0, hx: 9, hz: 0, pattern: 0, shooter: false });
	void e2;
	assert.ok(Math.abs(spawn(w).hp / spawn(solo).hp - 1.7) < 1e-9);
	const boss = w.director.startBoss(), soloBoss = solo.director.startBoss();
	assert.ok(Math.abs(boss.hp / soloBoss.hp - 1.8) < 1e-9);
	assert.ok(Math.abs(w.director.pressure / solo.director.pressure - 1.3) < 1e-9);
	boss.hp = boss.maxHp * 0.5;
	w.dropAlly();
	assert.equal(w.ally, null);
	assert.ok(Math.abs(boss.maxHp - soloBoss.maxHp) < 1e-6 && Math.abs(boss.hp - soloBoss.maxHp * 0.5) < 1e-6, 'the boss keeps its share of health at the measure of one player');
	assert.deepEqual(w.hard, { hp: 1, boss: 1, fire: 1 });
});

test('enemy fire hurts whichever player it reaches, and is aimed at each in turn', () => {
	const w = hold(pair());
	w.firing = false;
	w.moveAlly(2.4, 3, DT);
	w.shoot(4, 3, 0, 6);
	run(w, 0.6);
	assert.equal(w.ally.body.hp, 3);
	assert.equal(w.player.hp, 4);
	assert.equal(take(w, 'allyHit').length, 1);
	assert.equal(take(w, 'playerHit').length, 0);
	const aims = new Set();
	for (let n = 0; n < 60 * 6; n++) { w.step(DT, still); aims.add(w.prey() === w.player ? 'main' : 'ally'); }
	assert.deepEqual([...aims].sort(), ['ally', 'main']);
});

test('a fallen player waits; the other revives them by standing close and giving one heart', () => {
	const w = hold(pair());
	w.firing = false;
	w.moveAlly(6, 3, DT);
	const a = w.ally.body;
	a.hp = 1; a.invuln = 0;
	w.hurt(1);
	assert.ok(a.down && !w.over, 'the supporter is down, the fight goes on');
	assert.deepEqual(take(w, 'down').map(e => e.who), [1]);
	w.shoot(8, 3, 0, 6); run(w, 0.5);
	assert.equal(take(w, 'allyHit').length, 1, 'fire passes over the fallen');
	assert.equal(w.prey(), w.player, 'and enemies aim at the one still standing');
	run(w, 3);
	assert.ok(a.down, 'far away, nothing happens');
	for (let n = 0; n < 60 * 2; n++) w.step(DT, { dx: 0, dz: 0, target: { x: 6, z: 2.6 } });
	assert.ok(!a.down && a.hp === 1, 'the supporter rises with one heart');
	assert.equal(w.player.hp, 3, 'which the main player gave');
	assert.deepEqual(take(w, 'revive').map(e => e.by), [0]);
	assert.ok(a.invuln > 0, 'and is safe for a moment');
});

test('the last heart is never given away; when both are down the stage is lost', () => {
	const w = hold(pair());
	w.firing = false;
	const p = w.player, a = w.ally.body;
	p.hp = 1; p.invuln = 0; w.hurt(0);
	assert.ok(p.down && !w.over);
	a.hp = 1;
	w.moveAlly(p.x, p.z + 0.5, DT);
	run(w, 3);
	assert.ok(p.down, 'a supporter with one heart cannot revive');
	a.hp = 2;
	run(w, 2);
	assert.ok(!p.down && p.hp === 1 && a.hp === 1, 'with two hearts they can, and keep one');
	p.invuln = 0; w.hurt(0);
	assert.ok(p.down);
	a.invuln = 0; w.hurt(1);
	assert.ok(w.over && take(w, 'playerDead').length === 1, 'nobody is left standing');
});

test('answering a box in a fight for two: shielded and still while the other fights on', () => {
	const w = hold(pair());
	const target = dummy(w, 9, w.player.z, 1e6);
	w.setBusy(0, true);
	const x0 = w.player.x;
	for (let n = 0; n < 60 * 3; n++) { w.hurt(0); w.step(DT, { dx: 1, dz: 0, target: null }); }
	assert.equal(w.player.hp, 4, 'nothing hurts the one who is answering');
	assert.equal(w.player.x, x0, 'who does not move');
	assert.equal(target.hp, 1e6, 'and does not fire');
	w.setBusy(0, false);
	run(w, 2);
	assert.ok(target.hp < 1e6, 'afterwards they fight again');
	assert.ok(!w.player.busy);
});

test('powers and boxes belong to whoever uses or opens them', () => {
	const w = hold(pair(1));
	w.firing = false;
	w.moveAlly(5, 3, DT);
	w.ally.body.hp = 2;
	w.usePower('guard', 1);
	assert.equal(w.ally.body.hp, 3); assert.equal(w.player.hp, 4);
	assert.ok(w.ally.body.bubble > 0 && w.player.bubble === 0);
	w.usePower('update', 1);
	assert.deepEqual([w.ally.weapon.level, w.weapon.level], [2, 1], 'the supporter updates their own weapon');
	w.usePower('wall', 1);
	assert.ok(Math.abs(w.wall.x - 7.6) < 1e-9, 'the wall stands ahead of whoever raised it');
	const box = w.director.spawnCrate(false);
	w.acting = 1; w.damage(box, 1e9, 'pulse', box.x, box.z); w.acting = 0;
	assert.deepEqual(take(w, 'crate').map(e => e.by), [1], 'the box says who opened it');
	w.ally.backups = 1; w.ally.body.hp = 1; w.ally.body.invuln = 0;
	w.hurt(1);
	assert.deepEqual(take(w, 'revived').map(e => e.who), [1]);
	assert.equal(w.ally.body.hp, 2);
	assert.equal(w.heal(5, 1), 2, 'hearts given to the supporter stop at their maximum');
});

test('a main player who is down gets up alone if the supporter leaves', () => {
	const w = hold(pair());
	w.firing = false;
	w.player.hp = 1; w.player.invuln = 0; w.hurt(0);
	assert.ok(w.player.down);
	w.dropAlly();
	assert.ok(!w.player.down && w.player.hp === 1 && !w.over);
	assert.equal(w.player.maxHp, 5, 'alone again: the fifth heart can be won back');
});

// ---- what travels between the two devices: the picture of the fight, and the supporter's own steering
const buildFile = async (path, name) => {
	const out = join(here, '.build', 'c-' + name + '.mjs');
	buildSync({ entryPoints: [join(here, path)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
	return import(pathToFileURL(out).href);
};
const C = await buildFile('../src/core/coop.ts', 'coop');

test('the picture sent to the supporter rebuilds the fight; their own place stays theirs', () => {
	const w = hold(pair(1, 'pulse', 2, 'scatter', 3));
	dummy(w, 14, 0.5, 30); dummy(w, 16, -2, 30, 'armored');
	for (let i = 0; i < 40; i++) w.step(DT, still);
	const picture = JSON.parse(JSON.stringify(C.snapshot(w, 50)));           // as it arrives: plain data, stamped with the sender's clock
	const m = new C.Mirror(E.stages[1], 1, { id: 'scatter', level: 3 });
	m.ally.body.x = 7; m.ally.body.z = -3;                                    // the supporter has moved on their own device
	m.apply(picture, 50);
	m.advance(0, 50.1);                                                       // shots are drawn a moment behind the sender's clock: by now all that were flying are shown
	assert.equal(m.enemies.length, 2);
	assert.equal(m.shots.length, w.shots.length);
	assert.ok(m.shots.some(s => s.owner) && m.shots.some(s => !s.owner), 'shots of both players are told apart');
	assert.deepEqual([m.weapon.id, m.weapon.level, m.ally.weapon.id, m.ally.weapon.level], ['pulse', 2, 'scatter', 3]);
	assert.equal(m.player.hp, w.player.hp);
	assert.deepEqual([m.ally.body.x, m.ally.body.z], [7, -3], 'moving never waits for the network');
	// fallen or answering: the main player's device decides where the supporter is
	w.ally.body.invuln = 0; for (let i = 0; i < 4; i++) { w.ally.body.invuln = 0; w.hurt(1); }
	m.apply(JSON.parse(JSON.stringify(C.snapshot(w, 50.2))), 50.2);
	assert.equal(m.ally.body.down, true);
	assert.deepEqual([m.ally.body.x, m.ally.body.z], [w.ally.body.x, w.ally.body.z]);
	// between two pictures things glide on
	m.advance(0, 50.3);
	const x0 = m.shots[0]?.x ?? 0; m.advance(0.05, 50.35);
	if (m.shots[0]) assert.ok(m.shots[0].x > x0);
});

test('steering is one rule on both devices, and events travel as plain data', () => {
	const body = { x: 2.4, z: 0, vx: 0, vz: 0, hp: 4, maxHp: 4, invuln: 0, bubble: 0, down: false, busy: false };
	const bounds = { minX: W.ARENA.playerMinX, maxX: W.ARENA.playerMaxX, halfWidth: W.ARENA.playerHalfWidth };
	for (let i = 0; i < 600; i++) W.steer(body, { dx: 1, dz: 1, target: null }, DT, bounds);
	assert.equal(body.x, bounds.maxX); assert.equal(body.z, bounds.halfWidth);
	body.busy = true; W.steer(body, { dx: -1, dz: -1, target: null }, DT, bounds);
	assert.equal(body.x, bounds.maxX, 'answering a question: no moving');
	const w = hold(pair());
	const e = dummy(w, 12, 0, 1);
	w.damage(e, 5, 'pulse', e.x, e.z);
	const kill = w.events.find(x => x.type === 'kill');
	const plain = JSON.parse(JSON.stringify(C.plainEvent(kill)));
	assert.equal(plain.type, 'kill'); assert.equal(plain.enemy.id, e.id); assert.equal(plain.enemy.kind, 'normal');
});


test('standing near pays: the same shot hits up to half as hard again, and powers do not change', () => {
	assert.equal(W.closeBonus(20), 1); assert.equal(W.closeBonus(W.CLOSE.far), 1);
	assert.equal(W.closeBonus(W.CLOSE.near), 1.5); assert.equal(W.closeBonus(0), 1.5);
	assert.ok(W.closeBonus(6.75) > 1.2 && W.closeBonus(6.75) < 1.3);
	const hit = px => { const w = hold(pair()); w.player.x = px; const e = dummy(w, 14, w.player.z, 1000); w.damage(e, 10, 'pulse', e.x, e.z); return 1000 - e.hp; };
	const far = hit(0.9), near = hit(8);
	assert.equal(far, 10);
	assert.ok(near > 13 && near <= 15, 'at the front line: ' + near);
	// the supporter's shots are measured from where the supporter stands
	const w = hold(pair()); w.player.x = 0.9; w.ally.body.x = 8; w.ally.body.z = 0;
	const e = dummy(w, 14, 0, 1000); w.acting = 1; w.damage(e, 10, 'pulse', e.x, e.z); w.acting = 0;
	assert.ok(1000 - e.hp > 13);
	// a bomb takes the same share of a boss from anywhere
	const share = px => { const v = hold(pair()); v.player.x = px; const b = dummy(v, 15, 0, 500); b.kind = 'boss'; v.boss = b; v.usePower('bomb'); return 500 - b.hp; };
	assert.equal(share(0.9), share(8));
});

test('the supporter can change and upgrade their weapon in the middle of a fight', () => {
	const w = hold(pair(0, 'pulse', 1, 'pulse', 1));
	w.setAllyWeapon('pulse', 3);
	assert.equal(w.ally.weapon.level, 3);
	w.usePower('update', 1);
	assert.equal(w.ally.weapon.level, 4);
	w.setAllyWeapon('scatter', 2);
	assert.deepEqual([w.ally.weapon.id, w.ally.weapon.level, w.ally.baseLevel], ['scatter', 3, 2], 'a running security update stays on top');
	for (let i = 0; i < 9 * 60; i++) w.step(DT, still);
	assert.equal(w.ally.weapon.level, 2);
});

test('each fighter is counted for their own damage and kills, and powers count for whoever used them', () => {
	const w = hold(pair());
	const a = dummy(w, 15, 0, 4), b = dummy(w, 15, 2, 4), c = dummy(w, 15, -2, 4);
	w.player.x = 0.9; w.ally.body.x = 0.9;
	w.damage(a, 9, 'pulse', a.x, a.z);
	w.acting = 1; w.damage(b, 9, 'pulse', b.x, b.z); w.acting = 0;
	const kills = w.events.filter(e => e.type === 'kill');
	assert.deepEqual(kills.map(e => e.by), [0, 1]);
	assert.deepEqual([w.stats[0].kills, w.stats[1].kills], [1, 1]);
	assert.equal(w.stats[0].damage, 4, 'never more than the health that was there');
	w.events.length = 0;
	w.usePower('bomb', 1);
	assert.equal(w.events.find(e => e.type === 'kill').by, 1);
	assert.equal(w.stats[1].kills, 2);
	// the boss: what each did to it is kept apart, for dividing its reward
	const boss = dummy(w, 16, 0, 100); boss.kind = 'boss'; w.boss = boss;
	w.damage(boss, 30, 'pulse', boss.x, boss.z);
	w.acting = 1; w.damage(boss, 1e9, 'pulse', boss.x, boss.z); w.acting = 0;
	assert.deepEqual([w.stats[0].boss, w.stats[1].boss], [30, 70]);
	assert.equal(w.events.find(e => e.type === 'bossDead').by, 1);
	void c;
});

test('the picture carries real health, so the supporter sees what each hit took', () => {
	const w = hold(pair());
	const e = dummy(w, 14, 0, 40);
	const m = new C.Mirror(E.stages[0], 0, { id: 'pulse', level: 1 });
	m.apply(JSON.parse(JSON.stringify(C.snapshot(w))));
	w.player.x = 0.9; w.damage(e, 12, 'pulse', e.x, e.z);
	m.apply(JSON.parse(JSON.stringify(C.snapshot(w))));
	const seen = m.enemies.find(x => x.id === e.id);
	assert.equal(seen.hp, 28); assert.equal(seen.maxHp, 40); assert.equal(seen.took, 12);
});

// What the supporter sees when pictures come late and unevenly (through the server: one every fifth of a second,
// each delayed by a different amount). A shot must run smoothly from its fighter to its end: never thrown back,
// never leaping ahead. `uneven` plays a fight that way and counts what a watching eye would call a stutter.
function uneven(weapon, level, { every = 0.2, least = 0.12, spread = 0.35, seconds = 6, target = [16, 1.4] } = {}) {
	const w = hold(pair(0, 'pulse', 1, weapon, level));
	w.moveAlly(2.4, 1.4, DT);
	dummy(w, target[0], target[1], 1e9); dummy(w, 16, -1.4, 1e9);
	const m = new C.Mirror(E.stages[0], 0, { id: weapon, level });
	let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const post = []; let next = 0, back = 0, leap = 0, seen = 0, far = 0;
	const last = new Map();
	for (let f = 0; f < 60 * seconds; f++) {
		const now = 100 + f * DT;                                               // both devices on one clock here; only differences matter
		w.step(DT, still);
		if (now >= next) { next = now + every; post.push({ at: now + least + rnd() * spread, s: JSON.parse(JSON.stringify(C.snapshot(w, now))) }); }
		while (post.length && post[0].at <= now) m.apply(post.shift().s, now);
		m.advance(DT, now);
		const here = new Set();
		for (const s of m.shots) {
			here.add(s.id);
			const p = last.get(s.id), v = Math.hypot(s.vx, s.vz);
			if (p && v > 6) {                                                     // a flying shot: this frame it should have gone about v/60 along its way
				const along = ((s.x - p.x) * s.vx + (s.z - p.z) * s.vz) / v, step = v * DT;
				if (along < -0.02) back++; else if (along > step * 2.5 + 0.05) leap++;
				seen++;
			}
			if (s.x > 16.9 && Math.abs(s.z - target[1]) < 0.5) far++;              // drawn beyond the enemy that stopped it
			last.set(s.id, { x: s.x, z: s.z });
		}
		for (const id of last.keys()) if (!here.has(id)) last.delete(id);
	}
	return { back, leap, seen, far };
}
test('pictures that come late and unevenly: the supporter still sees every shot run smoothly', () => {
	for (const [weapon, level] of [['pulse', 1], ['pulse', 5], ['scatter', 3], ['plasma', 1], ['wave', 3]]) {
		const r = uneven(weapon, level);
		assert.ok(r.seen > 200, `${weapon}: shots are drawn (${r.seen} steps seen)`);
		assert.equal(r.back, 0, `${weapon}: no shot is thrown back (${r.back} of ${r.seen})`);
		assert.ok(r.leap <= r.seen * 0.01, `${weapon}: no shot leaps ahead (${r.leap} of ${r.seen})`);
	}
	// and over a quick, steady link (fifteen pictures a second, hardly any delay) nothing changes for the worse
	const quick = uneven('pulse', 3, { every: 0.066, least: 0.02, spread: 0.02 });
	assert.equal(quick.back + quick.leap, 0);
});
test('a shot that stops at an enemy is not drawn flying on through it', () => {
	const r = uneven('pulse', 1);
	assert.ok(r.far <= 2, `drawn beyond the enemy ${r.far} times`);
});

test('a supporter who comes into a fight already running: the field grows to the measure of two, and the main player is not moved', () => {
	const w = hold(new W.World(E.stages[0], 0, 'pulse', 1, { waves: false, seed: 'late' }));
	const small = dummy(w, 12, 0, 20);
	w.step(DT, { dx: 0, dz: 1, target: null });
	const z = w.player.z, hearts = w.player.maxHp;
	w.joinAlly('scatter', 2);
	assert.ok(w.ally && w.ally.weapon.id === 'scatter' && w.ally.weapon.level === 2);
	assert.equal(w.player.z, z, 'the main player stays where they stand');
	assert.equal(w.player.maxHp, hearts - 1); assert.equal(w.ally.body.maxHp, hearts - 1);
	assert.ok(Math.abs(small.maxHp - 20 * 1.7) < 1e-9 && Math.abs(small.hp - 20 * 1.7) < 1e-9, 'what is on the field is as tough as in a fight for two');
	assert.ok(w.ally.body.invuln > 2, 'a moment to look around');
	w.joinAlly('pulse', 1); assert.equal(w.ally.weapon.id, 'scatter', 'asked twice, nothing changes');
	w.dropAlly();
	assert.ok(Math.abs(small.maxHp - 20) < 1e-9, 'and leaving puts it back');
});
