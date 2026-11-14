// Fairness of the generated tracks: for many seeds, every stage must be passable without a single collision by a
// player who follows the guaranteed route, rows must leave enough time to react, and gates must be clear of obstacles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(join(here, '.build'), { recursive: true });
const bundle = name => {
	const out = join(here, '.build', name + '.mjs');
	buildSync({ entryPoints: [join(here, `../src/run/${name}.ts`)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
	return import(pathToFileURL(out).href);
};
const T = await bundle('track');
const S = await bundle('sim');
const balance = JSON.parse(readFileSync(join(here, '../src/data/balance.json'), 'utf8'));
const missions = JSON.parse(readFileSync(join(here, '../src/data/missions.json'), 'utf8')).missions;
const SEEDS = 150;
const DT = 1 / 60;

/** Runs one stage with the autopilot; returns the sim. Fails the test if the run never finishes. */
function play(S, track, skill = 1, rnd = Math.random, dt = DT) {
	const sim = new S.RunnerSim(track);
	let gate = 0, guard = 0;
	while (!(sim.stopped && sim.s >= track.end)) {
		S.autopilot(sim, skill, rnd);
		sim.step(dt);
		for (const e of sim.events.splice(0)) {
			if (e.type === 'energyOut') sim.respawn(track.segmentStarts.filter(x => x <= sim.s).pop());
		}
		if (sim.stopped && sim.s < track.end) { gate++; sim.resume(track.gates[gate]?.stopS ?? track.end); }
		assert.ok(++guard < 60 * 60 * 20, 'stage did not finish');
	}
	return sim;
}

test(`a careful player passes every stage of ${SEEDS} runs without a collision`, () => {
	let rowsTotal = 0;
	for (let i = 0; i < SEEDS; i++) {
		for (const track of T.buildRun('seed-' + i, missions)) {
			const sim = play(S, track);
			assert.equal(sim.hits, 0, `seed-${i} ${track.missionId}: ${sim.hits} collisions`);
			assert.ok(sim.bits / Math.max(1, sim.bitsSeen) >= 0.85, `seed-${i} ${track.missionId}: only ${sim.bits}/${sim.bitsSeen} bits on the route`);
			rowsTotal += track.rows.length;
		}
	}
	assert.ok(rowsTotal > SEEDS * 30);
});

test('the same route works at 30 frames per second', () => {
	for (let i = 0; i < 40; i++) for (const track of T.buildRun('slow-' + i, missions)) assert.equal(play(S, track, 1, Math.random, 1 / 30).hits, 0);
});

test('rows leave time to react, the route moves one lane at most, gates are clear', () => {
	for (let i = 0; i < SEEDS; i++) {
		for (const track of T.buildRun('seed-' + i, missions)) {
			const spec = balance.stages[track.missionId];
			for (let r = 0; r < track.rows.length; r++) {
				const row = track.rows[r];
				const cell = row.cells[row.pathLane];
				assert.notEqual(cell, 'block', 'the route lane is never a wall');
				assert.equal(row.need, cell === 'low' ? 'jump' : cell === 'high' ? 'slide' : 'none');
				if (r === 0) continue;
				const prev = track.rows[r - 1];
				assert.ok(Math.abs(row.pathLane - prev.pathLane) <= 1, 'route jumps two lanes');
				const seconds = (row.s - prev.s) / spec.speed[1];
				assert.ok(seconds >= 0.6, `rows ${seconds.toFixed(2)} s apart at top speed`);
			}
			for (const g of track.gates) {
				for (const o of track.obstacles) assert.ok(o.s < g.s - balance.gateClearBefore + 0.01 || o.s > g.s + balance.gateClearAfter - 0.01, 'obstacle inside a gate zone');
				assert.equal(g.stopS, g.s - balance.gateStandoff);
			}
			assert.equal(track.gates.length, missions.find(m => m.id === track.missionId).checkpoints.length);
		}
	}
});

test('the same seed gives the same track, different seeds differ', () => {
	const a = JSON.stringify(T.buildRun('same', missions)), b = JSON.stringify(T.buildRun('same', missions)), c = JSON.stringify(T.buildRun('other', missions));
	assert.equal(a, b);
	assert.notEqual(a, c);
});

test('collisions cost energy, a shield absorbs one, and running out of energy is reported', () => {
	const track = T.buildRun('hits', missions)[1];
	const sim = new S.RunnerSim(track);
	sim.shields = 1;
	const seen = [];
	for (let n = 0; n < 60 * 120 && !seen.includes('energyOut'); n++) {
		if (Math.abs(sim.z) < 0.01 && sim.lane !== 1) sim.setLane(1);
		sim.step(DT);                                                   // no input at all: runs into whatever is in the middle lane
		for (const e of sim.events.splice(0)) seen.push(e.type);
		if (sim.stopped) sim.resume(track.end);
	}
	assert.ok(seen.includes('shieldBlock'), 'the shield took the first collision');
	assert.equal(seen.filter(t => t === 'hit').length, balance.energyMax);
	assert.equal(sim.energy, 0);
	sim.respawn(track.segmentStarts[0]);
	assert.equal(sim.energy, balance.energyMax);
	assert.ok(track.obstacles.every(o => !o.hit), 'obstacles are whole again after a respawn');
});

test('a jump pressed just before landing is buffered; down in the air becomes a slide on landing', () => {
	const track = T.buildRun('buffer', missions, false)[0];
	const sim = new S.RunnerSim(track);
	const types = [];
	const run = seconds => { for (let n = 0; n < seconds * 60; n++) { sim.step(DT); for (const e of sim.events.splice(0)) types.push(e.type); } };
	run(0.5);
	sim.input('jump'); run(balance.jump.airtime - 0.1); sim.input('jump'); run(0.3);
	assert.equal(types.filter(t => t === 'jump').length, 2, 'second jump fired on landing');
	run(1);
	sim.input('jump'); run(0.1); sim.input('slide'); run(0.5);
	assert.ok(types.includes('slide'), 'slide started on landing');
});
