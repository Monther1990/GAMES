// How enemies attack, run without rendering: every kind of small enemy and every rare one attacks in a way of its own,
// shots that hang, burst, bend or are lobbed do what they say and warn first, no enemy fire vanishes in mid-air, every
// boss has several different attacks, and the picture sent to a supporter carries what the new shots need to be drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const bundle = async (path, name) => {
	const out = join(here, '.build', 'a-' + name + '.mjs');
	buildSync({ entryPoints: [join(here, path)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
	return import(pathToFileURL(out).href);
};
const W = await bundle('../src/sim/world.ts', 'world');
const D = await bundle('../src/sim/director.ts', 'director');
const E = await bundle('../src/sim/economy.ts', 'economy');
const C = await bundle('../src/core/coop.ts', 'coop');
const roster = JSON.parse(readFileSync(join(here, '../src/data/malware-ar.json'), 'utf8'));
const DT = 1 / 60, still = { dx: 0, dz: 0, target: null };
const quiet = (stage = 0) => { const w = new W.World(E.stages[stage], stage, 'pulse', 1, { waves: false, seed: 'atk' }); w.firing = false; w.director.update = () => {}; return w; };
const run = (w, seconds, each) => { for (let i = 0; i < seconds * 60; i++) { w.step(DT, still); each?.(w); } };

test('the picture and the behaviour agree on which kind an enemy is', () => {
	roster.stages.forEach((s, stage) => {
		for (let id = 0; id < 12; id++) assert.equal(D.smallKind(stage, id), s.small[id % 4]);
		assert.equal(D.rareKind(stage), s.rare);
	});
	assert.equal(D.smallKind(99, 1), roster.stages[4].small[1], 'beyond the last stage the last roster is used');
});

test('each of the twenty small kinds and five rare ones attacks in a way of its own', () => {
	const seen = new Map();
	roster.stages.forEach((s, stage) => {
		for (const [kind, rare] of [...s.small.map(k => [k, false]), [s.rare, true]]) {
			const w = quiet(stage);
			w.director.update = dt => { for (let i = w.director.later.length - 1; i >= 0; i--) if (w.director.later[i].at <= w.t) w.director.later.splice(i, 1)[0].run(); };   // only the rest of a burst
			w.godMode = true; w.player.x = 2.4; w.player.z = 1;
			const e = w.director.spawn({ kind: rare ? 'rare' : 'normal', index: -1, at: 0, sx: 14, sz: -1, hx: 14, hz: -1, pattern: 0, shooter: true });
			e.mode = 'hold'; e.x = 14; e.z = -1;
			if (rare) w.director.rareAttack(e, kind); else w.director.attack(e, kind);
			const shots = new Map(), zones = new Map();
			run(w, 1.6, () => { for (const b of w.bullets) if (!shots.has(b.id)) shots.set(b.id, [b.kind, b.fly?.how ?? 'straight', b.r, Math.round(Math.hypot(b.vx, b.vz) * 2)].join()); for (const z of w.zones) zones.set(z.id, [z.r ? 'round' : 'strip', z.live].join()); });
			assert.ok(shots.size + zones.size > 0, `${kind} attacks`);
			const signature = JSON.stringify([[...shots.values()].sort(), [...zones.values()].sort()]);
			assert.ok(!seen.has(signature), `${kind} attacks exactly as ${seen.get(signature)} does`);
			seen.set(signature, kind);
		}
	});
	assert.equal(seen.size, 25);
});

test('a shot that hangs, a shot that bursts, a shot that comes back off the side: each warns, then does what it says', () => {
	const w = quiet(); w.godMode = true; w.player.x = 2; w.player.z = 3;
	w.shoot(15, -2, 0, 5, 'bang', { how: 'stop', at: 0.5, wait: 0.8, speed: 8, aim: true });
	const b = w.bullets[0];
	run(w, 0.6); const x = b.x;
	assert.deepEqual([b.vx, b.vz], [0, 0], 'it hangs');
	run(w, 0.5); assert.equal(b.x, x); assert.ok(b.hot > 0.5 && b.hot < 1, 'a ring closes on it while it hangs');
	run(w, 0.4); assert.ok(Math.abs(Math.hypot(b.vx, b.vz) - 8) < 1e-6 && b.vz > 0 && !b.hot, 'then it darts at whoever is aimed at');

	const v = quiet(); v.godMode = true;
	v.shoot(15, 0, 0, 3, 'talk', { how: 'split', at: 1, into: 3, spread: 0.8 }, 0.26);
	run(v, 0.8); assert.equal(v.bullets.length, 1); assert.ok(v.bullets[0].hot > 0.5, 'it shows that it is about to burst');
	run(v, 0.3); assert.equal(v.bullets.length, 3, 'it became three'); assert.ok(v.bullets.every(q => q.r === 0.17 && !q.fly));
	assert.deepEqual(v.bullets.map(q => Math.sign(Math.round(q.vz * 100))), [-1, 0, 1], 'spread around the way it was going');

	const u = quiet(); u.godMode = true;
	u.shoot(15, 3, 0.8, 6, 'zap', { how: 'bounce', left: 1 });
	run(u, 2); assert.equal(u.bullets.length, 1); assert.ok(u.bullets[0].vz < 0 && Math.abs(u.bullets[0].z) < 4, 'it came back into the field');
	run(u, 4); assert.equal(u.bullets.length, 0, 'and left it at the bottom, not through the side');
});

test('a lobbed shot marks its circle first, hurts only inside it and only when it lands', () => {
	const w = quiet(); w.player.x = 3; w.player.z = 0;
	w.lob(15, 0, 3, 0, 0.9, 1, 0.3, true);
	run(w, 0.9); assert.equal(w.player.hp, 5, 'the mark alone does not hurt');
	run(w, 0.3); assert.equal(w.player.hp, 4, 'what lands on it does');
	const far = quiet(); far.player.x = 3; far.player.z = 1.2;
	far.lob(15, 0, 3, 0, 0.9, 1, 0.3, true);
	run(far, 1.6); assert.equal(far.player.hp, 5, 'a step outside the circle is safe, though inside the square around it');
	assert.equal(far.zones.length, 0);
	far.lob(15, 0, 99, 99, 0.9); const z = far.zones[0];
	assert.ok((z.x0 + z.x1) / 2 <= W.ARENA.playerMaxX + 0.5 && (z.z0 + z.z1) / 2 <= W.ARENA.playerHalfWidth, 'it always lands where players can be');
});

test('enemy fire never vanishes in mid-air: it leaves the field, strikes someone, bursts into more, or is cleared with sparks', () => {
	[...E.stages, E.bonusStage].forEach((s, i) => {
		const w = new W.World(s, i, 'pulse', 5, { waves: false, seed: 'gone-' + i });
		w.godMode = true; w.director.startBoss();
		let last = new Map(), lost = 0;
		for (let n = 0; n < 60 * 70 && w.boss; n++) {
			w.step(DT, { dx: 0, dz: 0, target: { x: 2.4, z: Math.sin(n / 90) * 3 } });
			const cleared = w.events.some(e => e.type === 'fizz'), now = new Map(w.bullets.map(b => [b.id, [b.x, b.z, b.r, b.hot ?? 0, b.fly?.how]]));
			w.events.length = 0;
			if (!cleared) for (const [id, [x, z, r, hot, how]] of last) {
				if (now.has(id)) continue;
				const out = x < -1.2 || x > W.ARENA.length + 2.5 || Math.abs(z) > W.World.SIDE - 0.5, struck = Math.hypot(x - w.player.x, z - w.player.z) < r + 0.26 + 0.5, burst = how === 'split' && hot > 0.9;
				if (!out && !struck && !burst) lost++;
			}
			last = now;
		}
		assert.equal(lost, 0, `${s.boss.id}: ${lost} shots vanished in mid-air`);
	});
});

test('every boss has at least three clearly different attacks, and the last one the most', () => {
	const count = [...E.stages, E.bonusStage].map((s, i) => {
		const w = new W.World(s, i, 'pulse', 5, { waves: false, seed: 'kinds-' + i });
		w.godMode = true; w.firing = false;
		const boss = w.director.startBoss(), seen = new Set();
		for (let n = 0; n < 60 * 150; n++) {
			if (n % 1800 === 1799) boss.hp -= boss.maxHp * 0.3;                // through its phases without a weapon
			w.step(DT, { dx: 0, dz: 0, target: { x: 2.4, z: Math.sin(n / 110) * 3 } });
			w.events.length = 0;
			for (const b of w.bullets) seen.add([b.kind, b.fly?.how ?? 'straight', b.r > 0.22 ? 'large' : 'usual'].join());
			for (const z of w.zones) seen.add(z.r ? 'lobbed' : 'strip');
			if (!w.boss) break;
		}
		assert.ok(seen.size >= 3, `${s.boss.id} has only ${[...seen].join(' | ')}`);
		return seen.size;
	});
	assert.ok(count[5] >= Math.max(...count.slice(0, 5)), `the last boss is the richest (${count.join(', ')})`);
});

test('the picture sent to a supporter carries hanging shots, their closing ring and the circles of lobbed ones', () => {
	const w = new W.World(E.stages[2], 2, 'pulse', 1, { waves: false, seed: 'pic' });
	w.addAlly('pulse', 1); w.firing = false; w.director.update = () => {}; w.godMode = true;
	w.shoot(15, -2, 0, 5, 'bang', { how: 'stop', at: 0.2, wait: 1, speed: 8, aim: true });
	w.shoot(15, 2, 0, 4, 'talk', { how: 'weave', wide: 0.7, rate: 5 }, 0.3);
	w.lob(15, 0, 4, 1, 0.9, 1.2);
	w.zone(0, -1, 9, 0, 1, 0.4);
	run(w, 0.7);
	const m = new C.Mirror(E.stages[2], 2, { id: 'pulse', level: 1 });
	m.apply(JSON.parse(JSON.stringify(C.snapshot(w))));
	const [hung, wove] = m.bullets;
	assert.deepEqual([hung.vx, hung.vz], [0, 0]); assert.ok(hung.hot > 0.3, 'the ring that closes on a hanging shot');
	assert.equal(wove.r, 0.3); assert.ok(Math.abs(wove.vz - w.bullets[1].vz) < 0.01 && wove.vz !== 0, 'a weaving shot is sent with the speed it has now');
	const [round, strip] = m.zones;
	assert.deepEqual([round.r, round.fx, round.fz, round.total], [0.9, 15, 0, 1.2]);
	assert.ok(round.warn > 0.4 && round.warn < 0.6);
	assert.equal(strip.r, undefined, 'a strip stays a strip');
	const x = hung.x; m.advance(0.05); assert.equal(hung.x, x, 'between two pictures a hanging shot stays where it hangs');
});
