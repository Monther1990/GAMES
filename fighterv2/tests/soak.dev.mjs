// A dev tool, not a unit test: every weapon is taken through whole fights with nobody at the screen, to find what a
// short test does not - an error after a minute, a weapon that falls silent while enemies stand in front of it, things
// that pile up on the field without end, a place that is not a number, a fighter who can no longer move.
//   node tests/soak.dev.mjs            every weapon, levels 1, 3 and 5, first and last stage and the last battle
//   node tests/soak.dev.mjs arc        one weapon only
// Each fight is run twice alone (standing still, and moving about) and once with a supporter who carries the same
// weapon, whose device is fed the pictures a real supporter would get (so the mirror is soaked too).
// A line is printed for each fight; a line that begins with "!!" names something to look at.
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const bundle = async (path, name) => { const out = join(here, '.build', 's-' + name + '.mjs'); buildSync({ entryPoints: [join(here, path)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' }); return import(pathToFileURL(out).href); };
const W = await bundle('../src/sim/world.ts', 'world'), E = await bundle('../src/sim/economy.ts', 'economy'), C = await bundle('../src/core/coop.ts', 'coop');
const DT = 1 / 60, SECONDS = 150;
const only = process.argv[2];
const ids = E.weapons.map(x => x.id).filter(id => !only || id === only);
/** How long each weapon may land nothing although an enemy is on the field in front of it (its own slowest rhythm, and a little more). */
const PATIENCE = { pulse: 2.5, scatter: 4, arc: 3, disc: 4, beam: 4, wave: 5, missile: 4, plasma: 5, shield: 5 };
let bad = 0;
for (const id of ids) for (const level of [1, 3, 5]) for (const stage of [0, 4, 5]) for (const how of ['still', 'moving', 'two']) {
	const def = stage < E.stages.length ? E.stages[stage] : E.bonusStage;
	const w = new W.World(def, stage, id, level, { waves: stage < E.stages.length, crates: true, seed: id + level + stage + how });
	if (stage >= E.stages.length) w.director.startBoss();
	w.godMode = true;
	let mirror = null, clock = 0;
	if (how === 'two') { w.addAlly(id, level); mirror = new C.Mirror(def, stage, { id, level }); }
	let err = null, nan = 0, most = 0, hits = 0, lastHits = 0, quiet = 0, worst = 0, stuck = 0, n = 0, done = '', kinds = new Set();
	const dmg = w.damage.bind(w); w.damage = (e, a, weapon, ...r) => { if (weapon === id && e.kind !== 'crate') hits++; return dmg(e, a, weapon, ...r); };
	try {
		for (n = 0; n < 60 * SECONDS && !w.over; n++) {
			const a = n / 60, moving = how !== 'still', input = moving ? { dx: Math.sin(a * 1.3), dz: Math.cos(a * 0.9), target: null } : { dx: 0, dz: 0, target: null };
			const p = w.player, px = p.x, pz = p.z, free = p.x > 1 && p.x < 7.9 && Math.abs(p.z) < 3.5;
			if (w.ally) w.moveAlly(4 + 2 * Math.sin(a * 0.8), 2.5 * Math.cos(a * 1.1), DT);
			w.step(DT, input); clock += DT;
			if (moving && free && Math.hypot(input.dx, input.dz) > 0.6 && Math.hypot(p.x - px, p.z - pz) < 1e-6) stuck++;
			for (const s of w.shots) { kinds.add(s.kind); if (![s.x, s.z, s.vx, s.vz, s.age, s.life].every(Number.isFinite)) nan++; }
			if (![p.x, p.z].every(Number.isFinite) || w.enemies.some(e => !Number.isFinite(e.x) || !Number.isFinite(e.z) || !Number.isFinite(e.hp))) nan++;
			most = Math.max(most, w.shots.length);
			for (const e of w.events) { if (e.type === 'wavesDone') w.director.startBoss(); if (e.type === 'bossDead') done = 'boss down at ' + w.t.toFixed(0) + 's'; }
			if (mirror) {
				if (n % 4 === 0) mirror.apply(JSON.parse(JSON.stringify(C.snapshot(w, clock, 1))), clock + 0.08);
				mirror.advance(DT, clock + 0.08);
				for (const s of mirror.shots) if (![s.x, s.z, s.age].every(Number.isFinite)) nan++;
			}
			w.events.length = 0;
			// silent although an enemy has arrived on the field and the weapon is allowed to fire?
			const there = w.firing && w.freeze <= 0 && w.targets().some(e => e.kind !== 'crate' && e.x < 15.5 && e.mode !== 'enter');
			if (there && hits === lastHits) { quiet += DT; worst = Math.max(worst, quiet); } else quiet = 0;
			lastHits = hits;
			if (done) break;
		}
	} catch (e) { err = String(e.stack).split('\n').slice(0, 3).join(' | '); }
	const flags = [];
	if (err) flags.push('ERROR ' + err);
	if (nan) flags.push('not a number x' + nan);
	if (stuck) flags.push('fighter did not move x' + stuck);
	if (most > 160) flags.push('things pile up: ' + most);
	if (worst > PATIENCE[id]) flags.push('silent for ' + worst.toFixed(1) + 's');
	if (!hits) flags.push('never hit anything');
	if (flags.length) bad++;
	console.log((flags.length ? '!! ' : '   ') + [id, 'L' + level, 'stage ' + (stage + 1), how].join(' ').padEnd(30) + ' hits ' + String(hits).padStart(5) + '  most on field ' + String(most).padStart(3) + '  longest silence ' + worst.toFixed(1) + 's  ' + (done || 'ran ' + (n / 60).toFixed(0) + 's') + (flags.length ? '   <- ' + flags.join('; ') : ''));
}
console.log(bad ? bad + ' fight(s) to look at' : 'nothing to look at');
