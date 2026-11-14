// Who appears and how they behave (pure). The waves of a stage are built from its approved enemy counts, so the money a
// stage can pay is exactly the budget in economy.json; enemies a boss calls in come out of the same counts.
// Every attack leaves a way through: rows have a gap, rings have an opening, struck areas are announced first.
import eco from '../data/economy.json';
import { EnemyClass } from './economy';
import type { Enemy, World } from './world';

// read straight from the data file: world.ts imports this module, so nothing of world.ts may be used while loading
const ARENA = eco.arena;
const E = eco.enemy;
const HW = ARENA.halfWidth;
export interface Spawn { kind: EnemyClass; index: number; at: number; sx: number; sz: number; hx: number; hz: number; pattern: number; shooter: boolean }
export interface Plan { waves: Spawn[][]; reserve: number[]; total: Record<EnemyClass, number> }

/** The waves of a stage. Each small enemy gets an index (its reward id); `reserve` are the ones the boss may call in. */
export function buildPlan(counts: Record<EnemyClass, number>, summons: number, fire: number, rnd: () => number): Plan {
	let index = 0;
	const inWaves = counts.normal - summons;
	const groups = Math.max(1, Math.round(inWaves / 5));
	const sizes = Array.from({ length: groups }, (_, i) => Math.floor(inWaves / groups) + (i < inWaves % groups ? 1 : 0));
	const waves: Spawn[][] = sizes.map(n => {
		const form = Math.floor(rnd() * 4), row = 13.2 + rnd() * 4, pattern = Math.floor(rnd() * 3);
		const list: Spawn[] = [];
		for (let i = 0; i < n; i++) {
			const u = n === 1 ? 0 : i / (n - 1) - 0.5;                                   // -0.5 .. 0.5 across the group
			let hx = row, hz = u * 6.2, sx = ARENA.length + 2, sz = hz;
			if (form === 1) hx = row + 1.2 - Math.abs(u) * 2.6;                           // a V
			else if (form === 2) { sx = row + 2; sz = (i % 2 ? 1 : -1) * (HW + 2.5); }    // in from both sides
			else if (form === 3) { hz = (i % 2 ? 1 : -1) * 1.7; hx = row - 1 + Math.floor(i / 2) * 1.5; sz = hz; }   // two columns
			list.push({ kind: 'normal', index: index++, at: i * 0.22, sx, sz, hx: Math.min(17.8, hx), hz, pattern, shooter: rnd() < 0.28 + fire * 0.22 });
		}
		return list;
	});
	const first = Math.min(2, groups - 1);
	for (let k = 0; k < counts.armored; k++) {
		const w = Math.min(groups - 1, first + Math.floor(k * (groups - first) / Math.max(1, counts.armored)));
		waves[w].push({ kind: 'armored', index: index++, at: 0.8 + rnd() * 0.6, sx: ARENA.length + 2, sz: 0, hx: 11.4 + rnd() * 2, hz: (rnd() - 0.5) * 5, pattern: 0, shooter: true });
	}
	for (let k = 0; k < counts.rare; k++) {
		const w = Math.min(groups - 1, Math.round(groups * [0.5, 0.75, 0.92][k % 3]));
		waves[w].push({ kind: 'rare', index: index++, at: 1.6, sx: 16, sz: (k % 2 ? 1 : -1) * (HW + 2), hx: 15.5, hz: 0, pattern: 9, shooter: false });
	}
	const reserve = Array.from({ length: summons }, () => index++);
	return { waves, reserve, total: { ...counts } };
}

interface BossState { id: string; phase: number; calm: number; a: number; b: number; c: number; spin: number; gap: number; turrets: Enemy[]; summonAt: number[]; thresholds: number[] }

export class Director {
	readonly plan: Plan;
	wave = -1; waveT = 0; spawned = 0; cleared = false;
	bossState: BossState | null = null;
	private later: { at: number; run: () => void }[] = [];

	/** The waves during which a Cyber box drifts through: one in the early stages, two later. */
	private crateWaves: number[];
	private rareDone = false;
	/** Heart boxes still to come in this fight (one in the early stages, two later), and the wait before the next check. */
	private heartsLeft: number; private heartIn = 14;
	constructor(private w: World, private wavesOn: boolean, private cratesOn = false) {
		const s = w.stage;
		this.plan = buildPlan(s.enemies, s.boss.summons, s.enemyFire, w.rnd);
		const n = this.plan.waves.length;
		this.crateWaves = cratesOn ? (w.stageIndex < 2 ? [2] : [2, 5]).map(i => Math.min(n - 1, i)) : [];
		this.heartsLeft = cratesOn ? (w.stageIndex < 3 ? 1 : 2) : 0;
	}
	/** Enemies fire a little faster with every wave of a stage, so the end of a stage is its hardest part. */
	get pressure() { return (1 + 0.045 * Math.max(0, this.wave)) * this.w.hard.fire; }
	get waveCount() { return this.plan.waves.length; }
	private small() { return this.w.enemies.filter(e => !e.dead && e.kind !== 'boss' && e.kind !== 'turret' && e.kind !== 'crate' && e.mode !== 'leave').length; }

	update(dt: number) {
		const w = this.w;
		for (let i = this.later.length - 1; i >= 0; i--) if (this.later[i].at <= w.t) this.later.splice(i, 1)[0].run();
		if (this.wavesOn && !this.cleared) this.runWaves(dt);
		this.heartIn -= dt;
		if (this.heartsLeft > 0 && this.heartIn <= 0) {                           // a heart box comes only when hearts are missing, and never beside another box
			this.heartIn = 4;
			const p = w.player, fighting = w.boss ? w.boss.mode !== 'enter' : this.wavesOn && !this.cleared && this.wave >= 1;
			if (fighting && ((p.hp > 0 && p.hp < p.maxHp) || (w.ally && w.ally.body.hp < w.ally.body.maxHp)) && !w.enemies.some(e => e.kind === 'crate' && !e.dead)) { this.heartsLeft--; this.heartIn = 26; this.spawnCrate(false, true); }
		}
		for (const e of w.enemies) if (!e.dead) this.act(e, dt);
		if (w.boss && this.bossState) this.runBoss(w.boss, this.bossState, dt);
	}

	// ------------------------------------------------------------------ waves
	private runWaves(dt: number) {
		const w = this.w, waves = this.plan.waves;
		this.waveT += dt;
		const cur = waves[this.wave];
		if (cur) while (this.spawned < cur.length && cur[this.spawned].at <= this.waveT) this.spawn(cur[this.spawned++]);
		const done = !cur || this.spawned >= cur.length;
		if (!done) return;
		const alive = this.small();
		if (this.wave < waves.length - 1) {
			if (this.wave < 0 ? this.waveT > 1.2 : (alive <= 1 && this.waveT > 4) || this.waveT > 10.5) {
				this.wave++; this.waveT = 0; this.spawned = 0;
				waves[this.wave].sort((a, b) => a.at - b.at);
				w.events.push({ type: 'wave', index: this.wave, total: waves.length });
				if (this.crateWaves.includes(this.wave)) this.later.push({ at: w.t + 2.5, run: () => this.spawnCrate() });
			}
		} else if (alive === 0) { this.cleared = true; w.events.push({ type: 'wavesDone' }); }
	}

	spawn(s: Spawn): Enemy {
		const w = this.w, c = E[s.kind];
		const hp = c.hp * w.stage.enemyHp * w.hard.hp;
		const e: Enemy = { id: w.id(), kind: s.kind, x: s.sx, z: s.sz, hp, maxHp: hp, r: c.radius, index: s.index, age: 0, mode: 'enter',
			sx: s.sx, sz: s.sz, hx: s.hx, hz: s.hz, pattern: s.pattern, seed: w.rnd() * 6.28, stay: s.kind === 'armored' ? 15 : s.kind === 'rare' ? E.rare.stay : 8.5 + w.rnd() * 3.5,
			fireIn: 1 + w.rnd() * 2.5, shooter: s.shooter, flash: 0, shielded: s.kind === 'armored', cycle: E.armored.closed * (0.5 + w.rnd() * 0.5),
			guard: s.kind === 'armored' ? E.armored.shieldFactor : 1, dead: false };
		w.enemies.push(e);
		return e;
	}

	/** A Cyber box: it pays no money and hurts no one. It drifts down the screen and leaves if it is not opened in time. */
	/** One box in five is the rare black one (never in the first stage, and at most one in a fight). */
	private rollRare() { if (this.rareDone || this.w.stageIndex < 1 || this.w.rnd() >= 0.2) return false; this.rareDone = true; return true; }
	spawnCrate(rare = this.rollRare(), heart = false): Enemy {
		if (heart) rare = false;
		const w = this.w, side = w.rnd() < 0.5 ? -1 : 1, hp = 12 * w.stage.enemyHp * (rare ? 1.6 : heart ? 0.8 : 1);
		const e: Enemy = { id: w.id(), kind: 'crate', x: ARENA.length + 2, z: side * 2.2, hp, maxHp: hp, r: 0.62, index: -1, age: 0, mode: 'enter',
			sx: ARENA.length + 2, sz: side * 2.2, hx: 16, hz: side * 2.2, pattern: rare ? 1 : heart ? 2 : 0, seed: w.rnd() * 6.28, stay: rare ? 7.5 : 8.5, fireIn: 0, shooter: false, flash: 0, shielded: false, cycle: 0, guard: 1, dead: false };
		w.enemies.push(e);
		w.events.push({ type: 'crateIn', rare, heart });
		return e;
	}

	// ------------------------------------------------------------------ small enemies
	private act(e: Enemy, dt: number) {
		const w = this.w, p = w.player;
		if (e.kind === 'crate') {
			if (e.mode === 'enter') { this.enter(e, dt, 1.1); return; }
			e.age += dt;
			if (e.mode === 'leave') { e.x += 10 * dt; return; }
			e.x = e.hx - e.age * (e.pattern === 1 ? 1.55 : 1.35); e.z = Math.max(-HW + 0.7, Math.min(HW - 0.7, e.hz + Math.sin(e.age * 1.3 + e.seed) * 1.7));
			if (e.age > e.stay || e.x < 4.2) e.mode = 'leave';
			return;
		}
		if (e.kind === 'boss' || e.kind === 'turret') { if (e.mode === 'enter') this.enter(e, dt, 2); return; }
		e.age += dt;
		if (e.mode === 'enter') { e.age -= dt; this.enter(e, dt, e.kind === 'armored' ? 2.1 : 1.25); return; }
		if (e.mode === 'leave') { e.x += 10 * dt; return; }
		if (e.mode === 'dive') {
			e.x -= (e.kind === 'armored' ? 3.6 : 6.4) * dt;
			e.z += (e.hz - e.z) * Math.min(1, dt * 1.4);
			if (e.x < -1.6) e.mode = 'leave', e.x = -9;
			return;
		}
		const t = e.age;
		if (e.kind === 'rare') {
			e.z = Math.sin(t * 1.5 + e.seed) * (HW - 0.7); e.x = e.hx + Math.sin(t * 3.1 + e.seed) * 1.5;
			if (t > e.stay) e.mode = 'leave';
			return;
		}
		if (e.kind === 'armored') {
			e.x = e.hx - t * 0.12; e.z = e.hz + Math.sin(t * 0.7 + e.seed) * 1.2;
			e.cycle -= dt;
			if (e.cycle <= 0) {
				e.shielded = !e.shielded;
				e.cycle = e.shielded ? E.armored.closed : E.armored.open;
				e.guard = e.shielded ? E.armored.shieldFactor : 1;
				if (!e.shielded && e.x > p.x + 2) w.fan(e.x - 0.5, e.z, 3, 0.5, 4.6 + w.stageIndex * 0.25, w.aim(e.x, e.z));   // it fires as the plate opens
			}
		} else {
			if (e.pattern === 0) { e.z = e.hz + Math.sin(t * 1.6 + e.seed) * 0.9; e.x = e.hx - t * 0.22; }
			else if (e.pattern === 1) { e.z = e.hz + Math.sin(t * 2.5 + e.seed) * 1.5; e.x = e.hx + Math.sin(t * 1.3 + e.seed) * 0.5 - t * 0.25; }
			else { e.z = e.hz + Math.cos(t * 1.9 + e.seed) * 0.85; e.x = e.hx + Math.sin(t * 1.9 + e.seed) * 0.85 - t * 0.2; }
			if (e.shooter) {
				e.fireIn -= dt;
				if (e.fireIn <= 0) {
					e.fireIn = (2.8 + w.rnd() * 2) / Math.max(0.4, w.stage.enemyFire * this.pressure);
					if (e.x > p.x + 2.5) { w.shoot(e.x - 0.4, e.z, w.aim(e.x, e.z), 4.8 + w.stageIndex * 0.3 + Math.max(0, this.wave) * 0.05); w.events.push({ type: 'enemyFire', x: e.x, z: e.z }); }
				}
			}
		}
		e.z = Math.max(-HW + 0.4, Math.min(HW - 0.4, e.z));
		if (t > e.stay) { e.mode = 'dive'; e.hz = p.z; }
	}
	private enter(e: Enemy, dt: number, seconds: number) {
		e.age += dt;
		const k = Math.min(1, e.age / seconds), s = 1 - (1 - k) * (1 - k);
		e.x = e.sx + (e.hx - e.sx) * s; e.z = e.sz + (e.hz - e.sz) * s;
		if (k >= 1) { e.mode = 'hold'; e.age = 0; }
	}

	// ------------------------------------------------------------------ bosses
	startBoss() {
		const w = this.w, def = w.stage.boss;
		const radius: Record<string, number> = { angler: 1.3, warden: 1.5, factory: 1.35, core: 1.5, heart: 1.7, omcode: 1.9 };
		const thresholds: Record<string, number[]> = { angler: [0.5], warden: [0.6, 0.3], factory: [0.5], core: [0.66, 0.33], heart: [0.66, 0.33], omcode: [0.7, 0.38] };
		const bossHp = def.hp * w.hard.boss;
		const boss: Enemy = { id: w.id(), kind: 'boss', x: ARENA.length + 4, z: 0, hp: bossHp, maxHp: bossHp, r: radius[def.id] ?? 1.4, index: -1, age: 0, mode: 'enter',
			sx: ARENA.length + 4, sz: 0, hx: 15.3, hz: 0, pattern: 0, seed: 0, stay: 1e9, fireIn: 0, shooter: false, flash: 0, shielded: false, cycle: 2.5, guard: 1, dead: false };
		w.enemies.push(boss);
		w.boss = boss;
		w.firing = true;
		for (const b of [w.player, w.ally?.body]) if (b && !b.down) b.hp = Math.min(b.maxHp, b.hp + eco.player.bossHeal);
		this.bossState = { id: def.id, phase: 0, calm: 2.2, a: 1, b: 2.5, c: 4, spin: 0, gap: 0, turrets: [], summonAt: [], thresholds: thresholds[def.id] ?? [0.5] };
		if (def.id === 'factory') for (const side of [-1, 1]) {
			const hp = bossHp * 0.13;
			const t: Enemy = { ...boss, id: w.id(), kind: 'turret', hp, maxHp: hp, r: 0.6, sx: ARENA.length + 4, sz: side * 2.6, hx: 14.5, hz: side * 2.6, x: ARENA.length + 4, z: side * 2.6, fireIn: side > 0 ? 1.2 : 0.6 };
			w.enemies.push(t); this.bossState.turrets.push(t);
		}
		if (def.summons) this.bossState.summonAt = def.id === 'factory' ? [5, 999] : [999, 999];
		return boss;
	}

	private summon(n: number) {
		for (let i = 0; i < n && this.plan.reserve.length; i++) {
			const side = i % 2 ? 1 : -1;
			this.spawn({ kind: 'normal', index: this.plan.reserve.shift()!, at: 0, sx: 13 + i, sz: side * (HW + 2.5), hx: 10.8 + (i % 3) * 1.1, hz: side * (0.9 + Math.floor(i / 2) * 1.5), pattern: i % 3, shooter: i % 2 === 0 });
		}
	}

	private runBoss(b: Enemy, s: BossState, dt: number) {
		const w = this.w, p = w.player;
		if (b.mode === 'enter') return;
		b.age += dt;
		const t = b.age, hpK = b.hp / b.maxHp;
		// next phase: a short calm with the screen cleared of danger, so the change is fair
		if (s.phase < s.thresholds.length && hpK <= s.thresholds[s.phase]) {
			s.phase++; s.calm = 1.5; s.a = 0.6; s.b = 2; s.c = 3;
			w.clearFire();
			w.events.push({ type: 'bossPhase', phase: s.phase });
			if (this.cratesOn && s.phase === 1) this.later.push({ at: w.t + 2.2, run: () => { if (w.boss) this.spawnCrate(); } });   // help arrives when the boss turns fierce
			if (s.id === 'factory') this.summon(4);
			if (s.id === 'heart' && s.phase === 1) { this.summon(4); this.later.push({ at: w.t + 7, run: () => { if (w.boss) this.summon(4); } }); }
		}
		const ph = s.phase;
		b.z = Math.sin(t * (0.5 + ph * 0.12)) * (s.id === 'warden' ? 1.6 : s.id === 'omcode' ? 1.15 : 2.4);
		b.x = b.hx + Math.sin(t * 0.9) * 0.4;
		if (s.calm > 0) { s.calm -= dt; return; }
		s.a -= dt; s.b -= dt; s.c -= dt; s.spin += dt;
		const down = 0, aim = w.aim(b.x, b.z), bx = b.x - b.r * 0.7;
		const burst = (n: number, speed: number, kind: 'orb' | 'code' = 'orb') => { for (let i = 0; i < n; i++) this.later.push({ at: w.t + i * 0.13, run: () => { if (w.boss) w.fan(w.boss.x - 1, w.boss.z, 1, 0, speed, w.aim(w.boss.x, w.boss.z), kind); } }); };
		const shield = (closed: number, open: number, factor: number) => {
			b.cycle -= dt;
			if (b.cycle <= 0) { b.shielded = !b.shielded; b.cycle = b.shielded ? closed : open; }
			b.guard = b.shielded ? factor : 1;
		};
		const rows = (every: number, width: number, speed: number, kind: 'shard' | 'code' = 'shard') => {
			if (s.a > 0) return;
			s.a = every;
			s.gap = Math.max(-2.7, Math.min(2.7, s.gap + (w.rnd() < 0.5 ? -1.4 : 1.4)));
			if (Math.abs(s.gap) > 2.6) s.gap *= 0.5;
			w.row(bx, s.gap, width, speed, kind);
		};
		const rings = (every: number, count: number, gap: number, speed: number, kind: 'orb' | 'code' = 'orb') => {
			if (s.a > 0) return;
			s.a = every;
			const offset = s.spin * 0.7, stepA = Math.PI * 2 / count;
			const toward = aim + (w.rnd() < 0.5 ? -0.45 : 0.45);                          // the opening is near the player, not on them
			const open = ((Math.round((toward - offset) / stepA) - Math.floor(gap / 2)) % count + count) % count;
			w.ring(b.x, b.z, count, speed, offset, open, gap, kind);
		};
		const lanes = (every: number) => {
			if (s.c > 0) return;
			s.c = every;
			const safe = Math.floor(w.rnd() * 3), third = HW * 2 / 3;
			for (let i = 0; i < 3; i++) if (i !== safe) w.zone(0, -HW + i * third + 0.08, ARENA.playerMaxX + 1.5, -HW + (i + 1) * third - 0.08, 1.15, 0.4);
		};
		const spiral = (every: number, speed: number, kind: 'orb' | 'code' = 'orb') => { if (s.b > 0) return; s.b = every; w.shoot(bx, b.z, Math.sin(s.spin * 1.7) * 1.15, speed, kind); };

		switch (s.id) {
			case 'angler':                                                           // fans
				if (s.a <= 0) {
					s.a = ph ? 1.3 : 1.75;
					w.fan(bx, b.z, ph ? 7 : 5, ph ? 1.5 : 1.1, ph ? 5.5 : 5, aim * 0.5 + (ph && Math.floor(t) % 2 ? 0.11 : 0));
				}
				if (ph && s.b <= 0) { s.b = 3.6; burst(3, 7.2); }
				break;
			case 'warden':                                                           // a plate that opens and closes, and rows with a gap
				shield(3 - ph * 0.3, 2.6, 0.12);
				rows(1.55 - ph * 0.2, 2.1 - ph * 0.15, 4.6 + ph * 0.3);
				if (ph >= 1 && s.b <= 0) { s.b = 2.4 - ph * 0.3; w.fan(bx, b.z, ph >= 2 ? 3 : 1, 0.35, 6.4, aim); }
				break;
			case 'factory': {                                                        // a core guarded by two turrets, and helpers
				const alive = s.turrets.filter(x => !x.dead);
				b.guard = alive.length ? 0.5 : 1;
				for (const tr of alive) {
					if (tr.mode === 'enter') continue;
					tr.z = tr.hz + Math.sin(t * 0.8 + tr.hz) * 0.7; tr.x = tr.hx;
					tr.fireIn -= dt;
					if (tr.fireIn <= 0) { tr.fireIn = 1.5 - ph * 0.25; w.fan(tr.x - 0.5, tr.z, 1, 0, 6, w.aim(tr.x, tr.z)); }
				}
				if (s.summonAt[0] < t) { s.summonAt[0] = 999; this.summon(4); }
				if (!ph) { if (s.a <= 0) { s.a = 2.5; w.fan(bx, b.z, 3, 0.7, 5, down); } }
				else spiral(0.2, 5.2);
				break;
			}
			case 'core':                                                             // rings with an opening, then struck lanes
				rings(2.4 - ph * 0.3, 24, ph >= 2 ? 4 : 5, 4.4 + ph * 0.3);
				if (s.b <= 0) { s.b = 3.1 - ph * 0.4; w.fan(bx, b.z, ph >= 1 ? 5 : 3, ph >= 1 ? 0.9 : 0.5, 5.6 + ph * 0.3, aim); }   // aimed, so the bottom of the screen is not a safe place
				if (ph >= 1) lanes(5 - ph * 0.6);
				break;
			case 'omcode': {                                                         // the code boss: its brackets close in front of it, and it throws code
				const was = b.shielded;
				shield(2 + ph * 0.15, 4 - ph * 0.3, 0.1);
				if (!was && b.shielded) burst(2 + ph, 7, 'code');                     // a volley as the brackets shut
				if (ph === 0) { if (s.a <= 0) { s.a = 1.5; w.fan(bx, b.z, 5, 1.2, 5.4, aim * 0.5, 'code'); } if (s.b <= 0) { s.b = 3.2; w.row(bx, (s.gap = (w.rnd() - 0.5) * 5), 2.2, 4.7, 'code'); } }
				else if (ph === 1) { rings(2.2, 16, 4, 4.8, 'code'); lanes(4.4); }
				else { spiral(0.2, 5.5, 'code'); rows(1.8, 2.1, 4.9, 'code'); lanes(4.2); }
				break;
			}
			case 'heart':                                                            // everything learned so far, in three phases
				if (ph === 0) { if (s.a <= 0) { s.a = 1.55; w.fan(bx, b.z, 5, 1.2, 5.3, aim * 0.5); } if (s.b <= 0) { s.b = 3.3; w.row(bx, (s.gap = (w.rnd() - 0.5) * 5), 2.1, 4.6); } }
				else if (ph === 1) { rings(2.3, 18, 4, 4.6); lanes(4.6); }
				else { shield(2.2, 3, 0.15); spiral(0.19, 5.4); if (s.c <= 0) { s.c = 2.8; burst(3, 7.4); } }
				break;
		}
	}
}
