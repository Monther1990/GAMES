// The nine weapons of part 2, run without any rendering. None works as its namesake did in part 1, so each is tested
// for what it now does: the drop that bursts into droplets, the cloud that stays, the tower that fires by itself, the
// blade that comes off the side walls, the beam that sweeps, the whirlpool that drags, the falcon that dives and comes
// home, the shell that lands on the thickest group, the star that falls on the strongest enemy. Then: whoever owns a
// shot is counted for what it does, and the picture sent to a supporter carries what each of these needs to be drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const bundle = async (path, name) => {
	const out = join(here, '.build', 'w-' + name + '.mjs');
	buildSync({ entryPoints: [join(here, path)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
	return import(pathToFileURL(out).href);
};
const W = await bundle('../src/sim/world.ts', 'world');
W.CLOSE.bonus = 0;                       // exact figures: the bonus for standing near is tested in coop.test.mjs
const G = await bundle('../src/sim/weapons.ts', 'weapons');
const E = await bundle('../src/sim/economy.ts', 'economy');
const C = await bundle('../src/core/coop.ts', 'coop');
const DT = 1 / 60, still = { dx: 0, dz: 0, target: null }, HP = 1e6;
const L = (id, level) => G.levelStats(id, level);

/** A fight with no waves in which nothing moves unless a weapon moves it, and the player cannot be hurt. */
function make(id, level, live = false) {
	const w = new W.World(E.stages[0], 0, id, level, { waves: false, seed: 'weapons' });
	if (!live) w.director.update = () => {};
	w.godMode = true;
	return w;
}
function dummy(world, x, z, hp = HP, kind = 'normal') {
	const e = world.director.spawn({ kind, index: -1, at: 0, sx: x, sz: z, hx: x, hz: z, pattern: 0, shooter: false });
	e.hp = e.maxHp = hp; e.mode = 'hold'; e.x = x; e.z = z; e.stay = 1e9; e.guard = 1; e.shielded = false; e.cycle = 1e9;
	return e;
}
const run = (w, seconds, each) => { for (let n = 0; n < Math.round(60 * seconds); n++) { w.step(DT, still); each?.(); } };
const lost = e => e.maxHp - e.hp;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const of = (w, kind) => w.shots.filter(s => s.kind === kind);
/** Runs until the weapon has fired `volleys` times and a moment more (so what it queued for that volley is out too), then holds fire. */
function fireOnce(w, volleys = 1, more = 0) {
	let fired = 0, guard = 0;
	while (fired < volleys && guard++ < 6000) { w.step(DT, still); fired += w.events.filter(e => e.type === 'fire').length; w.events.length = 0; }
	run(w, more);
	w.firing = false;
}

test('Falaj Spring: a drop bursts on the first enemy it meets into droplets that fly on diagonally and hurt others, never the one it struck', () => {
	// A stands in the stream, B and C on the diagonal beyond it, D straight behind it
	const place = w => [dummy(w, 8, 0), dummy(w, 9.43, 1.7), dummy(w, 11.26, 3.41), dummy(w, 10, 0)];
	const one = make('pulse', 1), [a, b, c, d] = place(one), dmg = L('pulse', 1).dmg;
	const seen = new Set();
	run(one, 3, () => { for (const s of one.shots) seen.add(s.kind); });
	assert.deepEqual([...seen].sort(), ['drop', 'droplet']);
	assert.ok(lost(a) > 0 && near(lost(a) / dmg, Math.round(lost(a) / dmg)), 'the one in the stream takes whole drops only: no droplet comes back at it');
	assert.ok(lost(b) > 0 && near(lost(b) / (dmg * G.DROPLET), Math.round(lost(b) / (dmg * G.DROPLET))), 'the one beside it takes droplets, each about a third of a drop');
	assert.ok(lost(b) < lost(a), 'and less than the one in the stream');
	assert.equal(lost(c), 0, 'a droplet stops at the first enemy it meets');
	assert.equal(lost(d), 0, 'and nothing reaches an enemy standing behind the one in the stream');
	// a drop alone in the field never turns: an enemy to the side is safe from a stream that hits nothing
	const lone = make('pulse', 1), side = dummy(lone, 9, 3.6);
	run(lone, 3);
	assert.equal(lost(side), 0);
	// level 3: two streams; level 5: three droplets (one flies straight on) and each passes through one enemy
	const three = make('pulse', 3); dummy(three, 8, 0); run(three, 0.6);
	assert.equal(new Set(of(three, 'drop').map(s => s.z)).size, 2, 'two streams side by side');
	const five = make('pulse', 5), [a5, b5, c5, d5] = place(five);
	run(five, 3);
	assert.ok(lost(a5) > 0 && lost(b5) > 0 && lost(c5) > 0 && lost(d5) > 0, 'at level 5 the droplets pass through one enemy and one goes straight on');
	assert.ok(near(lost(a5) / L('pulse', 5).dmg, Math.round(lost(a5) / L('pulse', 5).dmg), 1e-4), 'still no droplet hurts the one that burst it');
});

test('Frankincense: the burner lands on the nearest enemy, and the cloud it leaves stays and hurts everything inside it several times a second', () => {
	const s = L('scatter', 1), w = make('scatter', 1), inside = dummy(w, 9, 0), also = dummy(w, 9.9, 0.8), outside = dummy(w, 9, 3.5);
	fireOnce(w);
	assert.equal(of(w, 'burner').length, 1, 'one burner in the air');
	assert.deepEqual([of(w, 'burner')[0].tx, of(w, 'burner')[0].tz], [9, 0], 'thrown at the nearest enemy');
	assert.equal(lost(inside), 0, 'nothing is hurt while it flies');
	run(w, 0.7);
	assert.equal(of(w, 'cloud').length, 1, 'where it lands a cloud opens');
	const early = lost(inside);
	assert.ok(early > 0 && early < s.dmg * 4, 'it has only begun to hurt');
	run(w, 1);
	assert.ok(lost(inside) > early + s.dmg * 2, 'and goes on hurting, though the fighter has stopped firing');
	run(w, 4);
	assert.equal(of(w, 'cloud').length, 0, 'after a few seconds it is gone');
	const bites = s.last * s.ticks;
	assert.ok(near(lost(inside), bites * s.dmg) && near(lost(also), bites * s.dmg), `everything inside was hurt ${bites} times (${lost(inside)}, ${lost(also)})`);
	assert.equal(lost(outside), 0, 'and what stood outside was not touched');
	// with fire held on, the next burner goes to an enemy that is not already standing in smoke
	const more = make('scatter', 1), first = dummy(more, 9, 0), second = dummy(more, 9, 3.5);
	run(more, 4);
	assert.ok(lost(first) > 0 && lost(second) > 0, 'two enemies apart each get a cloud');
	// level 3: two clouds side by side
	const three = make('scatter', 3); dummy(three, 9, 0); fireOnce(three);
	assert.deepEqual(of(three, 'burner').map(b => b.tz).sort((a, b) => a - b), [-1.25, 1.25]);
	// level 5: what stands in the cloud lives more slowly (it moves, sways and decides to dive later)
	const five = make('scatter', 5, true), slowed = dummy(five, 9, 0), free = dummy(five, 15, -3.2);
	fireOnce(five);
	run(five, 0.6);                                                            // the clouds have landed
	const from = [slowed.age, free.age];
	run(five, 2);
	const aged = [slowed.age - from[0], free.age - from[1]];
	assert.ok(near(aged[1], 2, 0.05), 'an enemy outside moves at its usual pace');
	assert.ok(aged[0] > 0.8 && aged[0] < 1.3, `the one inside lived ${aged[0].toFixed(2)} s of those two seconds`);
});

test('Watchtower: planted beside the fighter, it fires by itself while the fighter is elsewhere; more towers with the levels, and at the top they burst', () => {
	const w = make('arc', 1), prey = dummy(w, 9, 0);
	fireOnce(w);
	const [tower] = of(w, 'tower');
	const from = Math.hypot(tower.x - w.player.x, tower.z - w.player.z), [tx, tz] = [tower.x, tower.z];
	assert.ok(near(from, G.TOWER_ASIDE), 'it stands beside the fighter, not on them (it would hide them)');
	// the fighter walks away and no longer fires: the tower goes on shooting
	for (let n = 0; n < 60; n++) w.step(DT, { dx: 0, dz: 0, target: { x: 7, z: 3.5 } });
	assert.ok(w.player.z > 3 && tower.x === tx && tower.z === tz, 'the tower stays where it was planted');
	const before = lost(prey);
	run(w, 1.5);
	assert.ok(lost(prey) > before + 3, 'and hurts the enemy in its range by itself');
	assert.ok(near(lost(prey) / L('arc', 1).dmg, Math.round(lost(prey) / L('arc', 1).dmg), 1e-4), 'with quick shots, each a full one');
	run(w, 5);
	assert.equal(of(w, 'tower').length, 0, 'it stands for a few seconds only');
	const after = lost(prey);
	run(w, 1);
	assert.equal(lost(prey), after);
	// an enemy out of a tower's reach is not left alone (the owner saw towers standing silent with enemies on the screen: the
	// field is longer than their reach): it takes long shots at it, each worth part of a full one
	const far = make('arc', 1), away = dummy(far, 17.9, 3.6);
	run(far, 6);
	const each = L('arc', 1).dmg * G.TOWER_FAR;
	assert.ok(lost(away) > 5 * each && near(lost(away) / each, Math.round(lost(away) / each), 1e-4), 'long shots, each part of a full one');
	// with one enemy in reach and one beyond it, the one in reach is shot, at full strength
	const both = make('arc', 1), close = dummy(both, 9, 0), beyond = dummy(both, 17.9, 3.6);
	run(both, 6);
	assert.ok(lost(close) > 0 && lost(beyond) === 0, 'an enemy in reach comes first');
	// one tower at a time at level 1, two at level 3, three at level 5; only at level 5 does a tower burst when its time ends
	for (const [level, most, bursts] of [[1, 1, false], [3, 2, false], [5, 3, true]]) {
		const t = make('arc', level); dummy(t, 9, 0);
		let top = 0, burst = 0;
		run(t, 16, () => { top = Math.max(top, of(t, 'tower').length); burst += t.events.filter(e => e.type === 'explode' && e.weapon === 'arc').length; t.events.length = 0; });
		assert.equal(top, most, `L${level}: ${most} towers at most`);
		assert.equal(burst > 0, bursts, `L${level}: towers ${bursts ? 'burst' : 'do not burst'} at the end`);
	}
});

test('Watchtower: towers never stand on one another or on the fighter, wherever the fighter stands; they share the enemies out; a dart whose target fell turns to the next', () => {
	// the owner saw three towers on one spot, on top of the fighter: it looked like one tower and a fighter who was stuck
	for (const [x, z] of [[2.4, 0], [0.9, 3.6], [0.9, -3.6], [8, 3.6], [8, 0], [4, -3.6]]) {
		const w = make('arc', 5); dummy(w, 12, 0);
		w.player.x = x; w.player.z = z;
		let closest = Infinity, onFighter = Infinity, most = 0;
		run(w, 20, () => {
			const ts = of(w, 'tower').filter(t => t.life > 0);
			most = Math.max(most, ts.length);
			for (const a of ts) { onFighter = Math.min(onFighter, Math.hypot(a.x - w.player.x, a.z - w.player.z)); assert.ok(Math.abs(a.z) <= 4 && a.x >= 0.5 && a.x <= 16.5, 'inside the field'); for (const b of ts) if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z)); }
		});
		assert.equal(most, 3);
		assert.ok(closest >= G.TOWER_APART - 1e-6, `fighter at ${x},${z}: towers stand apart (closest ${closest.toFixed(2)})`);
		assert.ok(onFighter >= G.TOWER_ASIDE - 1e-6, `fighter at ${x},${z}: no tower on the fighter (nearest ${onFighter.toFixed(2)})`);
	}
	// three towers and three enemies in reach: every enemy is shot at, not all towers at the nearest
	const w = make('arc', 5), foes = [dummy(w, 8, -3), dummy(w, 9, 0), dummy(w, 10, 3)];
	run(w, 6); for (const e of foes) e.hp = e.maxHp;
	run(w, 3);
	for (const e of foes) assert.ok(lost(e) > 0, 'each enemy in reach has a tower on it');
	const share = foes.map(lost), all = share.reduce((a, b) => a + b, 0);
	assert.ok(Math.max(...share) < all * 0.6, 'the fire is shared out');
	// one enemy only: every tower is on it
	const one = make('arc', 5), lone = dummy(one, 9, 0);
	run(one, 6); lone.hp = lone.maxHp;
	run(one, 2);
	assert.ok(lost(lone) > 2 * 3 * L('arc', 5).shots * L('arc', 5).dmg * 0.8, 'with one enemy all three towers shoot at it');
	// a dart on its way to an enemy that falls turns to the one beside it
	const d = make('arc', 1), first = dummy(d, 7, 0, 0.5), second = dummy(d, 10, 0);
	run(d, 4);
	assert.ok(first.dead && lost(second) > 0, 'the towers go on to the next enemy');
});

test('Watchtower: whoever is answering the question of a box opens no other meanwhile, though their tower goes on shooting', () => {
	const w = make('arc', 1), foe = dummy(w, 12, 1);
	w.director.spawnCrate();
	const box = w.enemies.find(e => e.kind === 'crate');
	box.x = 6; box.z = -1; box.mode = 'hold'; box.hx = 6; box.hz = -1; box.stay = 1e9;
	fireOnce(w);
	w.setBusy(0, true);                                                    // the tower is out; its owner now answers a question (and does not fire)
	const before = box.hp;
	run(w, 3);
	assert.equal(box.hp, before, 'the box is spared while its would-be opener answers');
	assert.ok(lost(foe) > 0, 'the tower goes on shooting at enemies');
	w.setBusy(0, false); w.firing = true;
	run(w, 6);
	assert.ok(box.dead, 'and is opened once they are back');
});

test('Palm Blades: thrown to the side, they come off the side walls and zig-zag up the field, cutting through every enemy they cross', () => {
	const s = L('disc', 1), w = make('disc', 1), high = dummy(w, 16, 0), beside = dummy(w, 16.3, 0.2);
	fireOnce(w);
	const [blade] = of(w, 'blade');
	assert.ok(Math.abs(blade.vz) > 5 && blade.vx > 5, 'it leaves on a slant, not straight ahead');
	let bounces = 0, widest = 0, turns = 0, side = Math.sign(blade.vz), firstHitAfter = -1;
	run(w, 3, () => {
		for (const e of w.events) if (e.type === 'bounce') { bounces++; assert.ok(near(Math.abs(e.z), W.ARENA.halfWidth), 'it turns at the side wall'); }
		w.events.length = 0;
		if (w.shots.includes(blade)) { widest = Math.max(widest, Math.abs(blade.z)); if (Math.sign(blade.vz) !== side) { side = Math.sign(blade.vz); turns++; } }
		if (firstHitAfter < 0 && lost(high) > 0) firstHitAfter = bounces;
	});
	assert.ok(bounces >= 2 && bounces <= s.bounces && turns === bounces, `it came off the walls ${bounces} times`);
	assert.ok(widest > W.ARENA.halfWidth - 0.4, 'and crossed the whole width of the field');
	assert.ok(firstHitAfter >= 1, 'the enemy high up was reached after a bounce, not by a straight throw');
	assert.ok(near(lost(high), s.dmg) && near(lost(beside), s.dmg), `one blade cut through both enemies in its way, each once (${lost(high)}, ${lost(beside)})`);
	// level 3: a mirrored pair; level 5: three, with more bounces
	const three = make('disc', 3); dummy(three, 12, 0); fireOnce(three);
	assert.deepEqual(of(three, 'blade').map(b => Math.sign(b.vz)).sort(), [-1, 1]);
	assert.ok(near(of(three, 'blade')[0].vz, -of(three, 'blade')[1].vz), 'the two leave as mirror images');
	const five = make('disc', 5); dummy(five, 12, 0); fireOnce(five, 1, 0.2);
	assert.equal(of(five, 'blade').length, 3);
	assert.ok(of(five, 'blade').every(b => b.n <= L('disc', 5).bounces) && L('disc', 5).bounces > s.bounces);
});

test('Muscat Lighthouse: the beam sweeps from side to side through a cone and strikes everything along its length as it passes, once each pass', () => {
	const s = L('beam', 1), w = make('beam', 1), cone = s.cone * Math.PI / 180;
	const right = dummy(w, 10, 2), left = dummy(w, 10, -2), behind = dummy(w, 13.3, 3), outside = dummy(w, 6, 3.5);
	let lo = 0, hi = 0, turns = 0, dir = 0;
	run(w, 6, () => { const [ray] = of(w, 'ray'); if (!ray) return; lo = Math.min(lo, ray.a); hi = Math.max(hi, ray.a); if (dir && Math.sign(ray.va) !== dir) turns++; dir = Math.sign(ray.va); });
	assert.equal(of(w, 'ray').length, 1);
	assert.ok(near(lo, -cone, 0.01) && near(hi, cone, 0.01), 'it swings to both edges of its cone');
	assert.ok(turns >= 8, `and turns back each time (${turns} turns in six seconds)`);
	for (const e of [right, left, behind]) {
		const strikes = lost(e) / s.dmg;
		assert.ok(near(strikes, Math.round(strikes), 1e-6) && strikes >= 8 && strikes <= 11, `struck once on each pass (${strikes})`);
	}
	assert.ok(lost(behind) > 0, 'an enemy behind another is struck too: the beam is not stopped');
	assert.equal(lost(outside), 0, 'what stands outside the cone is never touched');
	// level 3: a wider beam that leaves its target burning for a moment
	const s3 = L('beam', 3), three = make('beam', 3), prey = dummy(three, 10, 0);
	let guard = 0;
	while (lost(prey) === 0 && guard++ < 600) three.step(DT, still);
	three.firing = false;
	assert.equal(of(three, 'ember').length, 1, 'the one it struck is alight');
	const struck = lost(prey);
	run(three, 0.3);
	assert.ok(lost(prey) > struck, 'it goes on burning after the beam has passed');
	run(three, 1);
	assert.ok(near(lost(prey), s3.dmg + s3.burn, 1e-6), `the strike and the burn together: ${lost(prey)}`);
	assert.equal(of(three, 'ember').length, 0);
	// level 5: two beams sweeping in opposite directions
	const five = make('beam', 5); dummy(five, 10, 0); run(five, 0.2);
	assert.deepEqual(of(five, 'ray').map(r => Math.sign(r.va)).sort(), [-1, 1]);
});

test('Arabian Sea Whirlpool: it travels slowly up the field, drags small enemies to its middle and carries them, and grinds what is inside; armour is hurt but not moved', () => {
	const s = L('wave', 1), w = make('wave', 1), small = dummy(w, 9, 1.6), armoured = dummy(w, 12, -1.2, HP, 'armored');
	fireOnce(w);
	const [whirl] = of(w, 'whirl');
	assert.ok(whirl.vx > 0 && whirl.vx < 5 && whirl.vz === 0, 'slowly, straight up the field');
	run(w, 9);
	assert.equal(of(w, 'whirl').length, 0);
	assert.ok(Math.abs(small.z) < 0.3, `the small one was pulled to its middle (z ${small.z.toFixed(2)})`);
	assert.ok(small.x > 15, `and carried up the field (x ${small.x.toFixed(1)})`);
	assert.deepEqual([small.hx, small.hz], [small.x, small.z], 'and stays where it was left');
	assert.deepEqual([armoured.x, armoured.z], [12, -1.2], 'the armoured one did not move');
	assert.ok(near(lost(small), s.bites * s.dmg), `the small one was ground the full ${s.bites} times (${lost(small)})`);
	assert.ok(lost(armoured) > 0 && lost(armoured) <= s.bites * s.dmg + 1e-9, 'the armoured one was hurt while the whirlpool passed over it');
	// an enemy well to the side of its path is neither moved nor hurt
	const side = make('wave', 1), safe = dummy(side, 10, 3.6); fireOnce(side); run(side, 9);
	assert.deepEqual([safe.x, safe.z, lost(safe)], [10, 3.6, 0]);
	// level 3 is larger; level 5 sends two, and each bursts at the end of its way
	assert.ok(L('wave', 3).radius > s.radius);
	const five = make('wave', 5), top = dummy(five, 18, 0, HP, 'armored');
	fireOnce(five, 1, 0.35);
	assert.equal(of(five, 'whirl').length, 2);
	let bursts = 0;
	run(five, 9, () => { bursts += five.events.filter(e => e.type === 'explode' && e.weapon === 'wave').length; five.events.length = 0; });
	assert.equal(bursts, 2);
	assert.ok(lost(top) > 2 * L('wave', 5).burst - 1e-9, 'the bursts hurt what is near the end of the way');
});

test('Desert Falcons: they circle the fighter; each dives at the nearest enemy in reach, strikes it and flies home before it dives again', () => {
	const s = L('missile', 1), idle = make('missile', 1);
	run(idle, 1);
	const [bird] = of(idle, 'falcon');
	assert.ok(near(Math.hypot(bird.x - idle.player.x, bird.z - idle.player.z), G.ORBIT, 0.01), 'with no enemy it circles the fighter');
	const x0 = bird.x; run(idle, 0.3); assert.notEqual(bird.x, x0, 'and keeps moving');
	// with an enemy in reach: out, strike, home, again
	const w = make('missile', 1), prey = dummy(w, 9, 2), steps = [];
	let most = 0, farthest = 0;
	run(w, 6, () => { const f = of(w, 'falcon')[0]; most = Math.max(most, of(w, 'falcon').length); if (!f) return; if (steps[steps.length - 1] !== f.mode) steps.push(f.mode); farthest = Math.max(farthest, Math.hypot(f.x - w.player.x, f.z - w.player.z)); });
	assert.equal(most, 1, 'one falcon, however long the fight: it is not a shot that is fired again and again');
	assert.deepEqual(steps.slice(0, 7), [0, 1, 2, 0, 1, 2, 0], 'circle, dive, fly home, circle');
	assert.ok(farthest > 5, 'it really flies out to its prey');
	const strikes = lost(prey) / s.dmg;
	assert.ok(near(strikes, Math.round(strikes)) && strikes >= 5 && strikes <= 6, `about one strike a second (${strikes})`);
	// out of reach: left alone
	const far = make('missile', 1), away = dummy(far, 17.9, 3.6); run(far, 5);
	assert.equal(lost(away), 0);
	// two falcons at level 3, three at level 5: the same birds all through the fight, and that many times the strikes
	for (const [level, count] of [[3, 2], [5, 3]]) {
		const t = make('missile', level), list = [dummy(t, 8, -2), dummy(t, 8, 2), dummy(t, 9, 0)], sl = L('missile', level);
		let most = 0;
		run(t, 6, () => { most = Math.max(most, of(t, 'falcon').length); });
		assert.equal(most, count);
		const dealt = list.reduce((n, e) => n + lost(e), 0);
		assert.ok(dealt > sl.dmg * sl.rate * count * 6 * 0.75, `L${level}: ${count} falcons strike ${count} times as often (${dealt.toFixed(0)})`);
	}
	// level 5: a strike splashes on what stands beside the prey
	const five = make('missile', 5); dummy(five, 9, 0); dummy(five, 9.6, 0.6);
	let splashes = 0;
	run(five, 4, () => { splashes += five.events.filter(e => e.type === 'explode' && e.weapon === 'missile').length; five.events.length = 0; });
	assert.ok(splashes > 0, 'each strike is a small blast');
	const three = make('missile', 3); dummy(three, 9, 0); dummy(three, 9.6, 0.6);
	run(three, 4);
	assert.equal(three.events.filter(e => e.type === 'explode').length, 0, 'below level 5 a strike hurts its prey only');
});

test('Fort Cannon: a mortar. The shell is aimed at the thickest group, lands a moment later and hurts everything in a wide circle', () => {
	const s = L('plasma', 1), w = make('plasma', 1);
	const group = [dummy(w, 13, 2), dummy(w, 13.8, 2.5), dummy(w, 12.5, 2.9)], single = dummy(w, 8, -3);
	fireOnce(w);
	const [shell] = of(w, 'shell');
	assert.ok(group.includes(shell.target), 'aimed at the group, not at the nearer single enemy');
	run(w, s.fly - 0.2);
	assert.ok(group.every(e => lost(e) === 0), 'nothing is hurt while the shell is in the air');
	run(w, 0.4);
	assert.deepEqual(group.map(lost), [s.dmg, s.dmg, s.dmg], 'when it lands, the whole group takes the blast');
	assert.equal(lost(single), 0);
	assert.equal(of(w, 'shell').length, 0);
	// against a boss the shell goes for the boss
	const b = make('plasma', 1, true); dummy(b, 9, 3); dummy(b, 9.5, 3.2); dummy(b, 9.3, 2.6);
	const boss = b.director.startBoss();
	run(b, 4);                                                                 // the boss has come onto the field
	const aims = new Set();
	run(b, 3, () => { for (const q of of(b, 'shell')) if (q.age < 0.1) aims.add(q.target); });
	assert.deepEqual([...aims], [boss]);
	// level 3: the blast throws fragments that land and burst on what the blast did not reach
	const s3 = L('plasma', 3), three = make('plasma', 3), hit = dummy(three, 12, 0), beyond = dummy(three, 12, 3.2);
	fireOnce(three);
	run(three, s3.fly + 0.1);
	assert.equal(of(three, 'frag').length, s3.frags, 'fragments fly out from the blast');
	assert.deepEqual([lost(hit), lost(beyond)], [s3.dmg, 0]);
	run(three, 0.6);
	assert.deepEqual([lost(hit), lost(beyond)], [s3.dmg, s3.frag], 'a fragment reaches the enemy outside the blast; none strikes the one already hit');
	// level 5: a second shell follows, on the next group
	const s5 = L('plasma', 5), five = make('plasma', 5), nearOne = dummy(five, 9, -3.3), farOne = dummy(five, 12, 0);
	fireOnce(five, 1, 0.35);
	assert.equal(of(five, 'shell').length, 2);
	assert.deepEqual(of(five, 'shell').map(q => q.target).sort((p, q) => p.x - q.x), [nearOne, farOne], 'the two shells go to two different places');
	run(five, 2);
	assert.deepEqual([lost(nearOne), lost(farOne)], [s5.dmg + s5.frag, s5.second + s5.frag], 'each took its shell and a fragment of the other');
});

test('Star of Suhail: stars fall on the enemy with the most health anywhere on the field, and each sends out a ring of light that hurts what it passes', () => {
	const s = L('shield', 1), w = make('shield', 1);
	const close = dummy(w, 8, 0, 50), strong = dummy(w, 17, -3, 500), neighbour = dummy(w, 17.5, -1.5, 100), apart = dummy(w, 16, 3, 80);
	fireOnce(w);
	assert.equal(of(w, 'star')[0].target, strong, 'the strongest, though it is the farthest');
	run(w, s.fall - 0.1);
	assert.ok([close, strong, neighbour, apart].every(e => lost(e) === 0), 'nothing is hurt while the star falls');
	run(w, 0.2);
	assert.ok(near(lost(strong), s.dmg), 'the star lands on it');
	assert.equal(of(w, 'halo').length, 1, 'and a ring of light goes out');
	run(w, 1);
	assert.ok(near(lost(strong), s.dmg), 'the ring does not hurt the one the star fell on');
	assert.ok(near(lost(neighbour), s.ring), 'it hurts the enemy it passes');
	assert.deepEqual([lost(close), lost(apart)], [0, 0], 'and stops at its reach');
	assert.equal(of(w, 'halo').length, 0);
	// level 3: two stars in a volley (both on a boss-sized enemy; shared out when one star is enough)
	const s3 = L('shield', 3), three = make('shield', 3), big = dummy(three, 15, 0, 500), little = dummy(three, 9, 3, 5);
	fireOnce(three);
	assert.deepEqual(of(three, 'star').map(q => q.target), [big, big]);
	run(three, 1.5);
	assert.ok(near(lost(big), s3.dmg * 2));
	const split = make('shield', 3), one = dummy(split, 15, 0, 8), two = dummy(split, 9, 3, 5);
	fireOnce(split);
	assert.deepEqual(of(split, 'star').map(q => q.target), [one, two], 'a second star is not wasted on an enemy the first will finish');
	void little;
	// level 5: three stars, and every third volley a great ring from the fighter himself
	const s5 = L('shield', 5), five = make('shield', 5), boss = dummy(five, 17, 0, 5000), beside = dummy(five, 5, 2, 100);
	fireOnce(five);
	assert.equal(of(five, 'star').length, 3);
	five.firing = true;
	let great = 0;
	run(five, 3 / s5.rate + 1.6, () => { for (const q of of(five, 'halo')) if (q.mode === 1) great = Math.max(great, q.radius); });
	assert.equal(great, s5.novaReach, 'the great ring went out');
	assert.ok(near(lost(beside), s5.nova), 'and hurt the enemy near the fighter, which no star was aimed at');
	assert.ok(lost(boss) > s5.dmg * 6, 'while the stars kept falling on the strongest');
});

test('whoever owns a weapon is counted for everything it does: clouds, towers, falcons and rings included', () => {
	for (const id of E.weapons.map(x => x.id)) {
		// the supporter holds the weapon; the main player's drops fly up an empty lane
		const w = make('pulse', 1); w.addAlly(id, 5); w.moveAlly(2.4, 3.4, DT);
		dummy(w, 9, 3.4); const weak = dummy(w, 8, 3.4, 1);
		let killer = -1;
		run(w, 8, () => { for (const e of w.events) if (e.type === 'kill' && e.enemy === weak) killer = e.by; w.events.length = 0; });
		assert.ok(w.stats[1].damage > 0, `${id}: the supporter's weapon did damage`);
		assert.equal(w.stats[0].damage, 0, `${id}: none of it was counted for the main player`);
		assert.equal(killer, 1, `${id}: and the kill is the supporter's`);
		assert.ok(w.shots.filter(s => s.weapon === id && id !== 'pulse').every(s => s.owner === 1), `${id}: everything it put on the field is marked as the supporter's`);
		// the other way round
		const v = make(id, 5); v.addAlly('pulse', 1); v.moveAlly(2.4, 3.6, DT);
		dummy(v, 9, v.player.z);
		run(v, 8);
		assert.ok(v.stats[0].damage > 0, `${id}: the main player's weapon did damage`);
		assert.equal(v.stats[1].damage, 0, `${id}: none of it was counted for the supporter`);
		// a supporter who leaves takes everything of theirs off the field
		w.dropAlly();
		assert.equal(w.shots.filter(s => s.owner === 1).length, 0, `${id}: nothing of the supporter's is left behind`);
	}
});

test('falcons and the lighthouse beam belong to the weapon in hand: change the weapon and they are gone', () => {
	for (const [id, kind, count] of [['missile', 'falcon', 3], ['beam', 'ray', 2]]) {
		const w = make(id, 5); dummy(w, 9, 0);
		run(w, 1);
		assert.equal(of(w, kind).length, count);
		w.weapon.id = 'pulse'; w.weapon.queue = []; w.weapon.cool = 0.4;        // what the game does when the weapon is changed in a fight
		run(w, 0.5);
		assert.equal(of(w, kind).length, 0, `${kind}s do not outlive their weapon`);
		// one level down (a security update ends): the extra one goes, the rest stay
		const v = make(id, 5); dummy(v, 9, 0); run(v, 1);
		v.weapon.level = 3; run(v, 0.5);
		assert.equal(of(v, kind).length, L(id, 3)[id === 'beam' ? 'beams' : 'count']);
	}
});

test('the picture sent to a supporter carries what every new weapon needs to be drawn, after the figures it always carried', () => {
	const r2 = n => Math.round(n * 100) / 100 + 0, carried = new Set();       // (+ 0: a figure that rounds to minus nothing arrives as nothing)
	for (const [mine, theirs] of [['pulse', 'scatter'], ['arc', 'disc'], ['beam', 'wave'], ['missile', 'plasma'], ['shield', 'beam']]) {
		const w = make(mine, 5); w.addAlly(theirs, 5);
		dummy(w, 9, -1.4); dummy(w, 10, 1.6); dummy(w, 13, 0.5, HP, 'armored');
		const m = new C.Mirror(E.stages[0], 0, { id: theirs, level: 5 });
		for (let k = 0; k < 24; k++) {
			run(w, 0.25);
			const now = 500 + k * 0.25;                                          // one clock for both devices here; only differences matter
			const picture = JSON.parse(JSON.stringify(C.snapshot(w, now)));      // as it arrives: plain data, stamped with the sender's clock
			m.apply(picture, now);
			m.advance(0, now + m.behind);                                        // shots are drawn a moment behind that clock: this is the moment of the picture itself
			const drawn = new Map(m.shots.map(q => [q.id, q]));
			w.shots.forEach((s, i) => {
				const row = picture.sh[i], q = drawn.get(s.id);
				carried.add(s.kind);
				assert.deepEqual(row.slice(0, 10), [s.id, s.kind, s.weapon, s.owner ? 1 : 0, r2(s.x), r2(s.z), r2(s.vx), r2(s.vz), s.r, r2(s.radius)], 'the first ten figures are where they always were');
				assert.equal(row.length, 18);
				// a drop or a dart that has reached an enemy on the supporter's screen is already taken away there
				if (!q) { assert.ok(s.kind === 'drop' || s.kind === 'dart', `${s.kind} is drawn`); return; }
				assert.deepEqual([q.kind, q.weapon, !!q.owner, q.total, q.va, q.tx, q.tz, q.n, q.mode, q.radius],
					[s.kind, s.weapon, !!s.owner, r2(s.total), r2(s.va), r2(s.tx), r2(s.tz), s.n, s.mode, r2(s.radius)], `${s.kind}: length of life, the speed of its angle, landing point, number and step all arrive`);
				assert.ok(near(q.age, r2(s.age)) && near(q.a, r2(s.a)), `${s.kind}: its age and its angle at the moment of the picture`);
			});
			// between two pictures they keep moving, grow older, and the lighthouse keeps turning
			const was = new Map(m.shots.map(q => [q.id, [q.x, q.age, q.a]])), before = m.behind;
			m.advance(0.05, now + before + 0.05);
			const passed = 0.05 + before - m.behind;                             // the moment drawn moved on by this much
			assert.ok(passed > 0.02 && passed < 0.08);
			m.shots.forEach(q => {
				const p = was.get(q.id);
				if (!p) return;
				assert.ok(near(q.age, p[1] + passed) && near(q.a, p[2] + q.va * passed), `${q.kind}: older, and its angle turned`);
				if (Math.abs(q.vx) > 3 && (q.kind === 'drop' || q.kind === 'droplet')) assert.ok((q.x - p[0]) * q.vx > 0, `${q.kind}: it moved on along its way`);
			});
		}
		assert.ok(m.shots.some(q => q.owner) || w.shots.every(s => !s.owner));
	}
	for (const kind of ['drop', 'droplet', 'burner', 'cloud', 'tower', 'dart', 'blade', 'ray', 'ember', 'whirl', 'falcon', 'shell', 'frag', 'star', 'halo'])
		assert.ok(carried.has(kind), `a ${kind} was in a picture`);
});
