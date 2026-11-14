// The runner simulation (pure: no rendering, no DOM). It owns the player's movement along one stage, collisions and
// pickups, and reports what happened as events; the game layer turns those into pictures, sound and score.
// Time is whatever the caller passes to step(), so the game can slow it down, pause it or run it in fixed steps.
import balance from '../data/balance.json';
import { laneZ, LANES, Obstacle, Pickup, PickupKind, StageTrack } from './track';

export type Action = 'left' | 'right' | 'jump' | 'slide';
export type SimEvent =
	| { type: 'jump' | 'land' | 'slide' | 'lane' | 'edge' }
	| { type: 'collect'; kind: PickupKind; pickup: Pickup; streak: number }
	| { type: 'hit' | 'shieldBlock' | 'bump'; obstacle: Obstacle }
	| { type: 'cleared'; obstacle: Obstacle }
	| { type: 'energyOut' }
	| { type: 'stop' };

const GRAVITY = 8 * balance.jump.height / (balance.jump.airtime * balance.jump.airtime);
const JUMP_V = GRAVITY * balance.jump.airtime / 2;
const LANE_SPEED = balance.laneWidth / balance.laneTime;
const HALF_LANE = balance.laneWidth * 0.45;          // a little narrower than the lane: collisions forgive near misses

export class RunnerSim {
	s: number; speed = 0; lane = 1; z = 0; y = 0; vy = 0;
	airborne = false; sliding = 0; fastFall = false;
	energy = balance.energyMax; shields = 0; invulnerable = 0; slow = 0;
	bits = 0; bitsSeen = 0; cleared = 0; hits = 0; falls = 0; streak = 0;
	hints = 0; lenses = 0;
	t = 0;
	/** Where the runner must come to a halt (a gate's stop line or the stage end). */
	stopS: number;
	stopped = false;
	/** Practice: collisions cost nothing. */
	harmless = false;
	readonly events: SimEvent[] = [];
	/** Autopilot only: which rows this attempt's bot decided to miss. */
	readonly botMemo = new Map<number, boolean>();
	private jumpAt = -9; private slideAt = -9;
	private obstacleFrom = 0; private pickupFrom = 0;

	constructor(readonly track: StageTrack) {
		this.s = track.start;
		this.stopS = track.gates[0]?.stopS ?? track.end;
	}

	get progress() { return (this.s - this.track.start) / (this.track.end - this.track.start); }
	get cruise() { return this.track.speed[0] + (this.track.speed[1] - this.track.speed[0]) * Math.min(1, Math.max(0, this.progress)); }

	input(a: Action) {
		if (this.stopped) return;
		if (a === 'left' || a === 'right') {
			const next = this.lane + (a === 'left' ? -1 : 1);
			if (next < 0 || next >= LANES) { this.events.push({ type: 'edge' }); return; }
			this.lane = next;
			this.events.push({ type: 'lane' });
		} else if (a === 'jump') {
			if (this.airborne) this.jumpAt = this.t; else this.startJump();
		} else if (this.airborne) { this.fastFall = true; this.slideAt = this.t; } else this.startSlide();
	}
	/** Used at a gate: stand in the lane of the selected answer. */
	setLane(lane: number) { this.lane = Math.max(0, Math.min(LANES - 1, lane)); }

	private startJump() { this.vy = JUMP_V; this.airborne = true; this.sliding = 0; this.fastFall = false; this.events.push({ type: 'jump' }); }
	private startSlide() { this.sliding = balance.slideTime; this.events.push({ type: 'slide' }); }

	/** While standing at a gate: only the sideways move to the selected lane. */
	idle(dt: number) {
		const dz = laneZ(this.lane) - this.z;
		this.z += Math.sign(dz) * Math.min(Math.abs(dz), LANE_SPEED * 0.6 * dt);
	}

	/** Continue after a stop, toward the next stop line. */
	resume(stopS: number) { this.stopS = stopS; this.stopped = false; }

	/** Back to a checkpoint with full energy; obstacles ahead are whole again. */
	respawn(at: number) {
		this.s = at; this.speed = 0; this.lane = 1; this.z = 0; this.y = 0; this.vy = 0;
		this.airborne = false; this.sliding = 0; this.fastFall = false; this.stopped = false;
		this.energy = balance.energyMax; this.invulnerable = 2; this.slow = 0; this.streak = 0;
		this.shields = Math.max(this.shields, 1);                       // Cyber lends a shield for the next try
		this.botMemo.clear();
		for (const o of this.track.obstacles) if (o.s > at) { o.hit = false; o.passed = false; }
		this.obstacleFrom = this.track.obstacles.findIndex(o => o.s > at - 2);
		if (this.obstacleFrom < 0) this.obstacleFrom = this.track.obstacles.length;
		this.pickupFrom = this.track.pickups.findIndex(p => p.s > at - 2);
		if (this.pickupFrom < 0) this.pickupFrom = this.track.pickups.length;
	}

	step(dt: number) {
		if (dt <= 0) return;
		this.t += dt;
		this.invulnerable = Math.max(0, this.invulnerable - dt);
		this.slow = Math.max(0, this.slow - dt / balance.hitRecover);

		// forward: cruise speed, slower after a hit, easing to a halt at the stop line
		const prevS = this.s;
		if (!this.stopped) {
			const dist = this.stopS - this.s;
			let target = this.cruise * (1 - balance.hitSlow * this.slow);
			target = Math.min(target, 1.2 + 2.6 * Math.sqrt(Math.max(0, dist)));
			this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 2.2 : 7));
			this.s += this.speed * dt;
			if (this.s >= this.stopS) { this.s = this.stopS; this.speed = 0; this.stopped = true; this.events.push({ type: 'stop' }); }
		}

		// sideways
		const targetZ = laneZ(this.lane);
		const dz = targetZ - this.z;
		this.z += Math.sign(dz) * Math.min(Math.abs(dz), LANE_SPEED * dt);

		// up and down
		if (this.airborne) {
			this.vy -= GRAVITY * (this.fastFall ? 3 : 1) * dt;
			this.y += this.vy * dt;
			if (this.y <= 0) {
				this.y = 0; this.vy = 0; this.airborne = false; this.fastFall = false;
				this.events.push({ type: 'land' });
				if (this.t - this.slideAt <= balance.bufferWindow + 0.3) { this.slideAt = -9; this.startSlide(); }
				else if (this.t - this.jumpAt <= balance.bufferWindow) { this.jumpAt = -9; this.startJump(); }
			}
		} else if (this.sliding > 0) this.sliding = Math.max(0, this.sliding - dt);

		this.touchObstacles(prevS);
		this.touchPickups(prevS);
	}

	private touchObstacles(prevS: number) {
		const list = this.track.obstacles;
		while (this.obstacleFrom < list.length && list[this.obstacleFrom].s < prevS - 1.2) this.obstacleFrom++;
		for (let i = this.obstacleFrom; i < list.length; i++) {
			const o = list[i];
			if (o.s > this.s + 0.6) break;
			if (o.hit || o.passed) continue;
			const sameLane = Math.abs(this.z - laneZ(o.lane)) < HALF_LANE;
			if (o.s < prevS - 0.5) {                                   // behind the runner now
				o.passed = true;
				if (sameLane && o.kind !== 'block') { this.cleared++; this.events.push({ type: 'cleared', obstacle: o }); }
				continue;
			}
			if (!sameLane) continue;
			const blocked = o.kind === 'block' ? true : o.kind === 'low' ? this.y < 0.5 : !(this.sliding > 0 && this.y < 0.3);
			if (!blocked) continue;
			o.hit = true;
			if (o.soft || this.harmless) { this.events.push({ type: 'bump', obstacle: o }); continue; }    // lessons and practice cost nothing
			if (this.invulnerable > 0) continue;
			if (this.shields > 0) {
				this.shields--; this.invulnerable = 0.7;
				this.events.push({ type: 'shieldBlock', obstacle: o });
				continue;
			}
			this.energy--; this.hits++; this.streak = 0;
			this.invulnerable = balance.invulnerable; this.slow = 1;
			this.events.push({ type: 'hit', obstacle: o });
			if (this.energy <= 0) { this.falls++; this.events.push({ type: 'energyOut' }); }
		}
	}

	private touchPickups(prevS: number) {
		const list = this.track.pickups;
		while (this.pickupFrom < list.length && list[this.pickupFrom].s < prevS - 1.5) {
			const p = list[this.pickupFrom++];
			if (!p.taken && !p.missed) { p.missed = true; if (p.kind === 'bit') { this.bitsSeen++; this.streak = 0; } }
		}
		for (let i = this.pickupFrom; i < list.length; i++) {
			const p = list[i];
			if (p.s > this.s + 0.75) break;
			if (p.taken || p.missed || p.s < prevS - 0.75) continue;
			if (Math.abs(this.z - laneZ(p.lane)) > HALF_LANE + 0.1) continue;
			const reach = this.sliding > 0 ? 0.35 : 0.75;                 // the middle of the body
			if (Math.abs(p.y - (this.y + reach)) > 0.8) continue;
			p.taken = true;
			if (p.kind === 'bit') { this.bits++; this.bitsSeen++; this.streak++; }
			else if (p.kind === 'shield') this.shields = Math.min(2, this.shields + 1);
			else if (p.kind === 'hint') this.hints = Math.min(3, this.hints + 1);
			else this.lenses = Math.min(3, this.lenses + 1);
			this.events.push({ type: 'collect', kind: p.kind, pickup: p, streak: this.streak });
		}
	}
}

/** Plays the route the generator guarantees: follow the data bits, commit to the row's safe lane, jump or slide in time.
 *  `skill` below 1 makes it miss moves now and then (for demos of weaker players). */
export function autopilot(sim: RunnerSim, skill = 1, rnd: () => number = Math.random): void {
	if (sim.stopped) return;
	const row = sim.track.rows.find(r => r.s > sim.s - 0.4);
	let lane = row ? row.pathLane : sim.lane;
	const committed = row ? row.s - sim.s < Math.max(7, sim.speed * 0.8) : false;
	if (!committed) {
		const bit = sim.track.pickups.find(p => !p.taken && !p.missed && p.s > sim.s + 0.5 && p.s < sim.s + 8);
		if (bit) lane = bit.lane;
	}
	if (lane !== sim.lane && Math.abs(sim.z - laneZ(sim.lane)) < 0.05) sim.input(lane < sim.lane ? 'left' : 'right');
	if (!row || row.need === 'none' || sim.airborne || sim.sliding > 0.25) return;
	const dist = row.s - sim.s;
	const lead = row.need === 'jump' ? balance.jump.airtime / 2 : balance.slideTime * 0.42;
	if (dist > 0 && dist <= sim.speed * lead + 0.15) {
		if (!sim.botMemo.has(row.s)) sim.botMemo.set(row.s, skill < 1 && rnd() > skill);
		if (sim.botMemo.get(row.s)) return;                              // this bot forgets the move
		sim.input(row.need);
	}
}
