// Who appears and how they behave (pure). The waves of a stage are built from its approved enemy counts, so the money a
// stage can pay is exactly the budget in economy.json; enemies a boss calls in come out of the same counts.
// Every attack leaves a way through: sweeps come one shot at a time, rows and fronts have a gap, funnels lead to their
// opening, rings are combs with holes, and struck lanes are announced first and always leave one lane alone. Nothing
// is sudden: a shot that will dart or burst hangs or wears a closing ring first, and a lobbed one marks where it lands.
// Every kind of small enemy, every rare one and every boss attacks in a way of its own (see `attack`, `rareAttack`
// and `runBoss`); how often they fire, and so how much fire is on screen, is the same for all kinds of a stage.
import eco from '../data/economy.json';
import roster from '../data/malware-ar.json';
import { EnemyClass } from './economy';
import type { Bullet, Enemy, World } from './world';

// read straight from the data file: world.ts imports this module, so nothing of world.ts may be used while loading
const ARENA = eco.arena;
const E = eco.enemy;
const HW = ARENA.halfWidth;
const KINDS = roster.stages as { small: string[]; rare: string }[];
const stageKinds = (stage: number) => KINDS[Math.max(0, Math.min(KINDS.length - 1, stage))];
/** Which of its stage's four kinds a small enemy is: decided by its id alone, so a wave is always mixed, the same
 *  enemy is the same kind on every device, and the picture (arena.ts) and the behaviour (here) always agree. */
export const smallKind = (stage: number, id: number) => { const k = stageKinds(stage).small; return k[id % k.length]; };
export const rareKind = (stage: number) => stageKinds(stage).rare;
/** How much longer than usual each kind rests between attacks: those that throw more at once wait longer. */
const REST: Record<string, number> = { rumor: 1.2, clickbait: 1.1, fakepic: 1.2, chain: 1.4, vortex: 1.3, mocker: 1.1, noise: 1.2, tracker: 1.2, quizbot: 1.3, footprint: 1.5,
	bully: 1.5, lure: 1.3, troll: 1.5, echo: 1.1, inciter: 1.6, swarm: 1.4 };
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

/** What the small enemies of each stage throw (the armoured one throws the other shape, so it is told apart). */
const STAGE_SHOT: Bullet['kind'][] = ['talk', 'bang', 'glitch', 'bang', 'zap'];
export interface BossState {
	id: string; phase: number; calm: number;
	/** Countdowns of its attacks (each boss has up to four that run side by side), a count of the blows it has dealt
	 *  for those that take turns, and the seconds it has been attacking. */
	a: number; b: number; c: number; d: number; k: number; spin: number;
	/** Where the way through the last row was. */
	gap: number;
	/** Shots left in the volley being thrown (the towers' first release, for the hive), and the side the next one starts from. */
	n: number; dir: number;
	/** Moving: the stand it walks to and the wait before the next one, the side of the last stand, how far along its round it is. */
	tz: number; hop: number; side: number; path: number;
	/** The angle its spiral has turned to. */
	turn: number;
	turrets: Enemy[]; helpers: Enemy[]; summonAt: number[]; thresholds: number[];
}

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
			e.fireIn -= dt;
			if (e.fireIn <= 0) { e.fireIn = 2.3 / Math.max(0.7, w.stage.enemyFire); if (e.x > p.x + 2.5) this.rareAttack(e, rareKind(w.stageIndex)); }
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
				if (!e.shielded && e.x > p.x + 2) w.fan(e.x - 0.5, e.z, 3, 0.5, 4.6 + w.stageIndex * 0.25, w.aim(e.x, e.z), STAGE_SHOT[w.stageIndex] === 'bang' ? 'talk' : 'bang');   // it fires as the plate lifts
			}
		} else {
			const kind = smallKind(w.stageIndex, e.id), s = e.seed;
			if (e.pattern === 0) { e.z = e.hz + Math.sin(t * 1.6 + s) * 0.9; e.x = e.hx - t * 0.22; }
			else if (e.pattern === 1) { e.z = e.hz + Math.sin(t * 2.5 + s) * 1.5; e.x = e.hx + Math.sin(t * 1.3 + s) * 0.5 - t * 0.25; }
			else { e.z = e.hz + Math.cos(t * 1.9 + s) * 0.85; e.x = e.hx + Math.sin(t * 1.9 + s) * 0.85 - t * 0.2; }
			// on top of the way its wave moves, each kind has a habit of its own
			switch (kind) {
				case 'clickbait': e.x -= (1 + Math.sin(t * 1.1 + s)) * 0.6; break;                        // it is let down on its line and pulled up again
				case 'trend': e.x += Math.abs(Math.sin(t * 2.6 + s)) * 0.55; break;                         // it hops
				case 'vortex': e.x += Math.cos(t * 2.4 + s) * 0.5; e.z += Math.sin(t * 2.4 + s) * 0.5; break;   // it goes round in small circles
				case 'mocker': e.z += Math.sin(t * 3.3 + s) * 0.45; break;                                  // it dances from side to side
				case 'noise': e.z += Math.sign(Math.sin(t * 9 + s)) * 0.12; break;                          // it jitters
				case 'tracker': e.hz += Math.max(-0.7 * dt, Math.min(0.7 * dt, p.z - e.hz)); break;          // it drifts to stand above whoever it follows
				case 'snapper': e.hz += Math.max(-1.5 * dt, Math.min(1.5 * dt, p.z - e.hz)); break;          // it flies over its subject, quickly
				case 'stranger': e.x -= Math.min(3, t * 0.3); break;                                        // it comes closer than the others dare
				case 'bully': e.x -= Math.max(0, Math.sin(t * 1.3 + s)) ** 4 * 1.6; break;                   // it lunges and steps back
				case 'troll': e.z += Math.sin(t * 6 + s) * 0.5; break;                                      // it buzzes about
			}
			if (e.shooter) {
				e.fireIn -= dt;
				if (e.fireIn <= 0) {
					e.fireIn = (2.8 + w.rnd() * 2) * (REST[kind] ?? 1) / Math.max(0.4, w.stage.enemyFire * this.pressure);
					if (e.x > p.x + 2.5) { this.attack(e, kind); w.events.push({ type: 'enemyFire', x: e.x, z: e.z }); }
				}
			}
		}
		e.z = Math.max(-HW + 0.4, Math.min(HW - 0.4, e.z));
		if (t > e.stay) { e.mode = 'dive'; e.hz = p.z; }
	}
	/** The attack of each kind of small enemy. None is the plain aimed shot of another kind in a new coat: they differ in
	 *  what flies, how it flies and how it must be dodged. `v` is the speed of an ordinary shot at this point of the game. */
	private attack(e: Enemy, kind: string) {
		const w = this.w, x = e.x - 0.4, z = e.z, aim = w.aim(e.x, e.z), prey = w.prey();
		const v = 4.8 + w.stageIndex * 0.3 + Math.max(0, this.wave) * 0.05, shot = STAGE_SHOT[w.stageIndex] ?? 'talk';
		/** The rest of a burst, a moment later, if the enemy is still there to throw it. */
		const soon = (delay: number, run: () => void) => this.later.push({ at: w.t + delay, run: () => { if (!e.dead && e.mode === 'hold') run(); } });
		switch (kind) {
			// stage 1: rumours
			case 'rumor': w.shoot(x, z, aim, v * 0.62, 'talk', { how: 'split', at: 1, into: 2, spread: 0.6 }, 0.26); break;                           // one large, slow rumour that becomes two: they pass on both sides of whoever keeps still
			case 'clickbait': w.shoot(x, z, aim, v * 1.1, 'bang', { how: 'stop', at: 0.5, wait: 0.8, speed: v * 1.45, aim: true }); break;             // it hangs in the air like a headline, then darts at whoever is looking
			case 'fakepic': for (const k of [-0.8, 0.8]) w.shoot(x, z + k, aim, v, 'talk'); break;                                                   // two side by side, and the safe place is between them
			case 'chain': for (let i = 0; i < 3; i++) soon(i * 0.15, () => w.shoot(e.x - 0.4, e.z, aim, v, 'talk')); break;                           // three on one line, link after link, then a long rest
			// stage 2: trends
			case 'trend': w.shoot(x, z, aim, v * 0.4, 'bang', { how: 'rush', gain: 5.5, top: v * 1.7 }); break;                                       // it starts slowly and gathers speed, as a trend does
			case 'vortex': for (const k of [-1, 1]) w.shoot(x, z, aim + k * 0.75, v * 0.9, 'bang', { how: 'curve', turn: -k * 0.75, until: 1.3 }); break;   // two that swing out wide and curl back in
			case 'mocker': w.shoot(x, z, aim, v * 0.85, 'bang', { how: 'weave', wide: 0.7, rate: 5, phase: w.rnd() * 6 }); break;                     // one that sways from side to side all the way down
			case 'noise': for (let i = 0; i < 3; i++) w.shoot(x, z, (w.rnd() - 0.5) * 1.1, v * (0.55 + 0.3 * w.rnd()), 'glitch', undefined, 0.12); break;   // a handful of small slow specks thrown anywhere, aimed at no one
			// stage 3: data collectors
			case 'tracker': w.shoot(x, z, aim, v * 0.75, 'glitch', { how: 'seek', turn: 0.9, until: 1.7 }); break;                                    // it bends after its prey for a while, then loses the trail
			case 'quizbot': w.lob(e.x, e.z, prey.x, prey.z, 0.85, 1.15, 0.3, true); break;                                                           // lobbed: a circle on the ground shows where its question will land
			case 'snapper': for (let i = 0; i < 2; i++) soon(i * 0.16, () => w.shoot(e.x - 0.4, e.z, 0, v * 1.5, 'glitch', undefined, 0.12)); break;   // snap, snap: two small quick ones straight down from wherever it hovers
			case 'footprint': for (let i = 0; i < 4; i++) soon(i * 0.32, () => w.shoot(e.x - 0.4, e.z + (i % 2 ? 0.4 : -0.4), 0, v * 0.62, 'glitch')); break;   // slow steps straight down: left, right, left, right
			// stage 4: strangers
			case 'stranger': w.shoot(x, z, aim, v * 0.5, 'bang', undefined, 0.3); break;                                                             // one very large, very slow one that comes straight for you
			case 'bully': for (let i = 0; i < 3; i++) soon(i * 0.2, () => w.shoot(e.x - 0.4, e.z, w.aim(e.x, e.z), v * 1.25, 'bang', undefined, 0.13)); break;   // three small quick ones, each aimed afresh, then a long silence
			case 'impostor': { const k = w.rnd() < 0.5 ? -1 : 1; w.shoot(x, z, aim + k * 0.7, v, 'bang', { how: 'curve', turn: -k * 0.7, until: 1.4 }); break; }   // it sets off as if it would miss, then bends in
			case 'lure': w.shoot(x, z, 0, v * 0.6, 'bang', { how: 'split', at: 1.3, into: 3, spread: 0.9 }, 0.24); break;                             // a gift dropped straight down that opens into three
			// stage 5: the swarm
			case 'troll': for (let i = 0; i < 4; i++) soon(i * 0.12, () => w.shoot(e.x - 0.4, e.z, 0, v * 1.3, 'zap', undefined, 0.12)); break;       // a stream of small quick ones straight down while it buzzes about: a slanting line
			case 'echo': { const k = z + prey.z + (w.rnd() - 0.5) * 3 < 0 ? -1 : 1; w.shoot(x, z, Math.atan2(2 * k * HW - prey.z - z, e.x - prey.x), v * 0.95, 'zap', { how: 'bounce', left: 1 }); break; }   // thrown at the side of the field, it comes back off it toward its prey
			case 'inciter': w.lob(e.x, e.z, prey.x, prey.z, 0.8, 1.2, 1.2, true); break;                                                             // lobbed fire: where it lands goes on burning for a moment
			case 'swarm': for (const dx of [0, 0.55]) for (const dz of [-0.28, 0.28]) w.shoot(x + dx, z + dz, aim, v * 0.9, 'zap', undefined, 0.13); break;   // four small ones flying as a square
			default: w.shoot(x, z, aim, v, shot);
		}
	}
	/** The rare one of each stage never stops crossing the field, and attacks in its own way as it goes. */
	private rareAttack(e: Enemy, kind: string) {
		const w = this.w, x = e.x - 0.4, z = e.z, v = 4.6 + w.stageIndex * 0.3;
		switch (kind) {
			case 'deepfake': w.shoot(x, z, 0, v, 'talk'); w.shoot(x, -z, 0, v, 'talk'); w.events.push({ type: 'enemyFire', x: e.x, z: -z }); break;                                                       // one straight down from itself and a copy from the mirrored place: which is the real one?
			case 'fakestar': for (let i = 0; i < 5; i++) w.shoot(e.x, z, e.age * 0.9 + i * Math.PI * 2 / 5, v * 0.8, 'bang'); break;                  // five points of a star, turned a little further each time
			case 'broker': for (const k of [-1, 0, 1]) w.shoot(x, z, k * 0.35, v * 0.6, 'glitch', { how: 'weave', wide: 0.45, rate: 4, phase: k * 2 }); break;   // three cards that flutter down
			case 'puppeteer': for (const k of [0, Math.PI]) w.shoot(x, z, 0, v * 0.75, 'bang', { how: 'weave', wide: 0.6, rate: 4.5, phase: k }); break;   // two on strings that cross and cross again
			default: w.zone(0, z - 0.55, ARENA.playerMaxX + 1.5, z + 0.55, 0.9, 0.3);                                                                 // the storm seed marks the strip below it, and lightning strikes there
		}
		w.events.push({ type: 'enemyFire', x: e.x, z: e.z });
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
		const radius: Record<string, number> = { rumorking: 1.3, whirl: 1.5, octodata: 1.45, maskmaster: 1.4, hivequeen: 1.7, warstorm: 1.9 };
		const thresholds: Record<string, number[]> = { rumorking: [0.5], whirl: [0.6, 0.3], octodata: [0.5], maskmaster: [0.66, 0.33], hivequeen: [0.66, 0.33], warstorm: [0.7, 0.38] };
		const bossHp = def.hp * w.hard.boss;
		const boss: Enemy = { id: w.id(), kind: 'boss', x: ARENA.length + 4, z: 0, hp: bossHp, maxHp: bossHp, r: radius[def.id] ?? 1.4, index: -1, age: 0, mode: 'enter',
			sx: ARENA.length + 4, sz: 0, hx: 15.3, hz: 0, pattern: 0, seed: 0, stay: 1e9, fireIn: 0, shooter: false, flash: 0, shielded: false, cycle: 2.5, guard: 1, dead: false };
		w.enemies.push(boss);
		w.boss = boss;
		w.firing = true;
		for (const b of [w.player, w.ally?.body]) if (b && !b.down) b.hp = Math.min(b.maxHp, b.hp + eco.player.bossHeal);
		this.bossState = { id: def.id, phase: 0, calm: 2.2, a: 1, b: 2.5, c: 4, d: 5.5, k: 0, spin: 0, gap: 0, n: 0, dir: 1, tz: 0, hop: 2.6, side: 1, path: 0, turn: 0,
			turrets: [], helpers: [], summonAt: def.id === 'octodata' ? [4] : [], thresholds: thresholds[def.id] ?? [0.5] };
		return boss;
	}

	/** Small enemies out of the stage's own counts (they pay like the rest). They come in from the sides, or down from the top. */
	private summon(n: number, fromTop = false): Enemy[] {
		const list: Enemy[] = [];
		for (let i = 0; i < n && this.plan.reserve.length; i++) {
			const side = i % 2 ? 1 : -1, hz = side * (0.9 + Math.floor(i / 2) * 1.5);
			list.push(this.spawn({ kind: 'normal', index: this.plan.reserve.shift()!, at: 0, sx: fromTop ? ARENA.length + 2 + i * 0.5 : 13 + i, sz: fromTop ? hz * 1.5 : side * (HW + 2.5),
				hx: 10.8 + (i % 3) * 1.1, hz, pattern: i % 3, shooter: i % 2 === 0 }));
		}
		return list;
	}
	/** Helpers outside the stage's counts: they pay nothing (index -1) and never fire; they only get in the way. */
	private decoys(n: number) {
		for (let i = 0; i < n; i++) {
			const side = i % 2 ? 1 : -1;
			this.spawn({ kind: 'normal', index: -1, at: 0, sx: 15 + i * 0.6, sz: side * (HW + 2.5), hx: 11.2 + (i % 2) * 1.2, hz: side * (1.2 + Math.floor(i / 2) * 1.3), pattern: (i + 1) % 3, shooter: false });
		}
	}
	/** The hive lets relay towers out of its mouth, one to each side, never more than two at a time. */
	private hatch(b: Enemy, s: BossState) {
		const w = this.w, alive = s.turrets.filter(x => !x.dead);
		for (const side of [-1, 1]) {
			if (alive.length >= 2 || alive.some(x => Math.sign(x.hz) === side)) continue;
			const hp = b.maxHp * 0.04;
			const t: Enemy = { ...b, id: w.id(), kind: 'turret', hp, maxHp: hp, r: 0.6, age: 0, mode: 'enter', sx: b.x - 0.9, sz: b.z, x: b.x - 0.9, z: b.z, hx: 13.6, hz: side * 2.7,
				fireIn: side > 0 ? 1.5 : 0.8, flash: 0, shielded: false, guard: 1, took: 0 };
			w.enemies.push(t); s.turrets.push(t); alive.push(t);
		}
	}

	/** Every boss moves in its own way. */
	private moveBoss(b: Enemy, s: BossState, t: number, dt: number) {
		const ph = s.phase;
		switch (s.id) {
			case 'rumorking':                                                        // it strides between three stands and shouts from each
				s.hop -= dt;
				if (s.hop <= 0) { s.hop = 3.1 - ph * 0.5; if (s.tz) s.tz = 0; else { s.side = -s.side; s.tz = s.side * 2.3; } }
				b.z += (s.tz - b.z) * Math.min(1, dt * 3.5); b.x = b.hx + Math.abs(Math.sin(t * 2.4)) * 0.25;
				break;
			case 'whirl':                                                            // round and round like the water it is, faster while its eye is shut
				s.path += dt * (0.5 + ph * 0.1 + (b.shielded ? 0.5 : 0));
				b.z = Math.sin(s.path) * 2.3; b.x = b.hx + (Math.cos(s.path) - 1) * 0.8;
				break;
			case 'octodata': b.z = Math.sin(t * 0.33) * 1.3; b.x = b.hx + Math.sin(t * 1.3) * 0.3; break;   // heavy: it hardly leaves the middle
			case 'maskmaster': b.z = Math.sin(t * (0.62 + ph * 0.08)) * 2.5; b.x = b.hx + Math.sin(t * (1.24 + ph * 0.16)) * 0.6; break;   // a figure of eight, like a juggler's hands
			case 'hivequeen': b.z = Math.sin(t * 0.3) * 0.9; b.x = b.hx + Math.sin(t * 0.8) * 0.25; break;   // a hive stays where it hangs
			default: b.z = Math.sin(t * 0.42) * 1.3 + Math.sin(t * 1.3) * 0.35; b.x = b.hx + Math.sin(t * 0.7) * 0.45;   // the storm drifts and shudders
		}
	}

	private runBoss(b: Enemy, s: BossState, dt: number) {
		const w = this.w;
		if (b.mode === 'enter') return;
		b.age += dt;
		const t = b.age, hpK = b.hp / b.maxHp;
		// next phase: a short calm with the screen cleared of danger, so the change is fair
		if (s.phase < s.thresholds.length && hpK <= s.thresholds[s.phase]) {
			s.phase++; s.calm = 1.5; s.a = 0.6; s.b = 2; s.c = 3; s.d = 4; s.n = 0;
			w.clearFire();
			w.events.push({ type: 'bossPhase', phase: s.phase });
			if (this.cratesOn && s.phase === 1) this.later.push({ at: w.t + 2.2, run: () => { if (w.boss) this.spawnCrate(); } });   // help arrives when the boss turns fierce
			if (s.id === 'octodata') s.helpers.push(...this.summon(4, true));
			if (s.id === 'maskmaster') this.decoys(s.phase + 1);
			if (s.id === 'hivequeen') this.summon(4);
		}
		const ph = s.phase;
		this.moveBoss(b, s, t, dt);
		if (s.calm > 0) { s.calm -= dt; return; }
		s.a -= dt; s.b -= dt; s.c -= dt; s.d -= dt; s.spin += dt;
		const aim = w.aim(b.x, b.z), bx = b.x - b.r * 0.7, prey = w.prey();
		/** Lobbed shots: each lands on a circle marked on the ground first. `spots` are places beside whoever is aimed at ([forward, sideways]). */
		const lobs = (spots: number[][], r: number, warn: number, fromZ = b.z) => { for (const [dx, dz] of spots) w.lob(b.x, fromZ, prey.x + dx, prey.z + dz, r, warn, 0.35); w.events.push({ type: 'enemyFire', x: b.x, z: b.z }); };
		const side = () => (w.rnd() < 0.5 ? -1 : 1);
		/** Something that happens a moment later, unless the boss has fallen or changed phase meanwhile (the screen was cleared). */
		const soon = (delay: number, run: () => void) => this.later.push({ at: w.t + delay, run: () => { if (w.boss === b && s.phase === ph) run(); } });
		const shield = (closed: number, open: number, factor: number) => {
			b.cycle -= dt;
			if (b.cycle <= 0) { b.shielded = !b.shielded; b.cycle = b.shielded ? closed : open; }
			b.guard = b.shielded ? factor : 1;
		};
		/** One stroke: shots one behind another on the same line. */
		const streak = (x: number, z: number, angle: number, n: number, speed: number, kind: Bullet['kind']) => {
			for (let i = 0; i < n; i++) soon(i * 0.07, () => w.shoot(x, z, angle, speed, kind));
			w.events.push({ type: 'enemyFire', x, z });
		};

		switch (s.id) {
			case 'rumorking': {                                                      // sweeping waves: the megaphone turns and lays its bubbles down one after another
				const total = ph ? 11 : 9;
				if (s.n > 0) {
					if (s.a <= 0) {
						const i = total - s.n, u = i / (total - 1) - 0.5;
						s.a = ph ? 0.1 : 0.12; s.n--;
						w.shoot(bx, b.z, Math.atan2(-b.z, b.x - 3) + s.dir * u * (ph ? 1.15 : 0.95), ph ? 5.2 : 4.7);
						if (i % 3 === 0) w.events.push({ type: 'enemyFire', x: bx, z: b.z });
					}
				} else if (s.b <= 0) { s.b = ph ? 2.2 : 2.7; s.n = total; s.dir = -s.dir; s.a = 0; }   // the next sweep runs the other way
				if (ph && s.c <= 0) {                                                 // a forked shout: it passes on both sides of whoever keeps still
					s.c = 3.8;
					for (const k of [-0.3, -0.1, 0.1, 0.3]) w.shoot(bx, b.z, aim + k, 6.4, 'bang');
					w.events.push({ type: 'enemyFire', x: bx, z: b.z });
				}
				if (s.d <= 0) {                                                       // lobbed rumours: circles on the ground show where they will land, one of them on whoever it aims at
					s.d = ph ? 3.9 : 4.7;
					lobs(ph ? [[0, 0], [0.6, -2.3], [0.6, 2.3]] : [[0, 0], [1.2, side() * 2.4]], 0.95, 1.2);
				}
				break;
			}
			case 'whirl': {                                                          // open, its arms turn one way and throw outward; shut, they turn back and wind tight
				shield(2.6, 3.2 - ph * 0.2, 0.2);
				// each arm is a curved wall that sweeps across the field, with holes in it at regular steps: stand where a hole will pass
				const shut = b.shielded, arms = shut || !ph ? 2 : 3, solid = shut ? 4 : 5;
				s.turn += dt * (shut ? -0.7 : 0.6 + ph * 0.05);
				if (s.a <= 0) {
					s.a = 0.1; s.n = (s.n + 1) % (solid + 3);
					for (let i = 0; i < arms; i++) {
						const a = s.turn + i * Math.PI * 2 / arms, down = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 1.35;   // toward the player's half it is a wall; elsewhere only a few, for the look of it
						if (down ? s.n < solid : s.n % 3 === 0) w.shoot(b.x, b.z, a, shut ? 3.8 : 4.5 + ph * 0.2, shut ? 'bang' : 'glitch');
					}
					if (!s.n) w.events.push({ type: 'enemyFire', x: b.x, z: b.z });
				}
				if (ph >= 1 && s.b <= 0) { s.b = 3.4 - ph * 0.4; w.fan(bx, b.z, 2, 0.3, 6, aim, 'talk'); }   // a pair that passes on both sides
				if (s.c <= 0) {                                                       // two large slow bubbles that drift down swaying, among the small quick ones
					s.c = 4.3 - ph * 0.5;
					for (const k of [-1, 1]) w.shoot(b.x, b.z, aim + k * 0.5, 2.3, 'talk', { how: 'weave', wide: 0.5, rate: 2.2, phase: k }, 0.3);
				}
				break;
			}
			case 'octodata': {                                                       // its arms beat rows down, and the way through slides from side to side
				const fed = s.helpers.some(e => !e.dead && e.mode !== 'leave');     // while its helpers feed it, it is harder to hurt
				b.shielded = fed; b.guard = fed ? 0.6 : 1;
				if (s.summonAt[0] < t) { s.summonAt[0] = 1e9; s.helpers.push(...this.summon(4, true)); }
				if (s.a <= 0) {
					s.a = ph ? 1.1 : 1.3;
					s.gap = Math.sin(s.spin * (ph ? 0.62 : 0.5)) * 2.5;
					w.row(bx, s.gap, ph ? 2 : 2.2, ph ? 4.8 : 4.5, 'glitch');
				}
				if (ph && s.b <= 0) { s.b = 2.6; s.dir = -s.dir; const hz = b.z + s.dir * 1.9; w.fan(b.x - 0.5, hz, 1, 0, 6.2, w.aim(b.x - 0.5, hz), 'bang'); }   // the tip of an arm snaps at whoever is below
				if (s.c <= 0) { s.c = ph ? 3.7 : 4.5; const k = side(); lobs([[0, 0], [0.4, k * 2.4]], 1, 1.1, b.z + k * 1.9); }   // two arms come down from above: one on whoever it aims at, one beside them
				if (ph && s.d <= 0) {                                                 // a fan of cards that stop in a bow, hang there, then fall along the lines they were on
					s.d = 5.2;
					for (let i = -3; i <= 3; i++) w.shoot(bx, b.z, i * 0.22, 5, 'talk', { how: 'stop', at: 0.7, wait: 0.9, speed: 5.4, aim: false });
					w.events.push({ type: 'enemyFire', x: bx, z: b.z });
				}
				break;
			}
			case 'maskmaster': {                                                     // two hands throw in turn; behind its great mask it can hardly be hurt
				shield(1.4 + ph * 0.1, 4.4 - ph * 0.3, 0.2);
				if (s.a <= 0) {
					s.a = 0.86 - ph * 0.08; s.dir = -s.dir; s.k++;
					const hz = b.z + s.dir * 1.6, at = w.aim(b.x - 0.5, hz);
					if (ph >= 2 && s.k % 3 === 0) { w.shoot(b.x - 0.5, hz, at, 3.6, 'bang', { how: 'split', at: 1, into: 3, spread: 0.8, speed: 5.6 }, 0.26); w.events.push({ type: 'enemyFire', x: b.x - 0.5, z: hz }); }   // now and then a large mask that breaks into three
					else w.fan(b.x - 0.5, hz, 1, 0, 5.4 + ph * 0.3, at, 'bang');
				}
				if (s.c <= 0) {                                                       // two masks thrown wide, one from each hand, that curl in and cross where their prey was standing
					s.c = 3.5 - ph * 0.3;
					for (const k of [-1, 1]) w.shoot(b.x - 0.5, b.z + k * 1.6, aim + k * 0.75, 4.8, 'talk', { how: 'curve', turn: -k * 0.75, until: 1.3 }, 0.22);
					w.events.push({ type: 'enemyFire', x: bx, z: b.z });
				}
				if (ph >= 1 && s.b <= 0) {                                            // a funnel: its walls arrive first and lead to the way through, which is near the player
					s.b = 3.6 - (ph - 1) * 0.5;
					s.gap = Math.max(-2.6, Math.min(2.6, w.prey().z + (w.rnd() < 0.5 ? -1.6 : 1.6)));
					for (let z = -HW + 0.3; z <= HW - 0.3; z += 0.74) { const d = Math.abs(z - s.gap); if (d > 1.05) w.shoot(bx + Math.max(0, 3 - d) * 0.5, z, 0, 4.6, 'talk'); }
					w.events.push({ type: 'enemyFire', x: bx, z: s.gap });
				}
				break;
			}
			case 'hivequeen': {                                                      // relay towers on both sides, rings like honeycomb, and a sting
				if (!s.n) { s.n = 1; this.hatch(b, s); }                             // towers come out at the start and again with every phase
				for (const tr of s.turrets) {
					if (tr.dead || tr.mode === 'enter') continue;
					tr.age += dt;
					tr.z = tr.hz + Math.sin(tr.age * 0.9) * 0.6 * Math.sign(tr.hz); tr.x = tr.hx + (1 - Math.cos(tr.age * 0.9)) * 0.3;
					tr.fireIn -= dt;
					if (tr.fireIn <= 0) { tr.fireIn = 2.1 - ph * 0.2; w.fan(tr.x - 0.5, tr.z, 2, 0.26, 5.6, w.aim(tr.x, tr.z), 'bang'); }   // a pincer: it passes on both sides
				}
				if (s.a <= 0) {                                                       // two combs one after the other, the teeth of the second behind the holes of the first
					s.a = 3.2 - ph * 0.35;
					const count = 30, turn = s.spin * 0.4, speed = 4.2 + ph * 0.2;
					const comb = (offset: number) => { for (let i = 0; i < count; i++) if (i % 3 !== 2) w.shoot(b.x, b.z, offset + i / count * Math.PI * 2, speed, 'talk'); w.events.push({ type: 'enemyFire', x: b.x, z: b.z }); };
					comb(turn); soon(0.5, () => comb(turn + Math.PI * 3 / count));
				}
				if (s.b <= 0) {                                                       // the sting: a short bar flying straight at whoever is below
					s.b = 3.6 - (ph - 1) * 0.5;
					for (const k of [-0.55, 0, 0.55]) w.shoot(bx + k * Math.sin(aim), b.z + k * Math.cos(aim), aim, 6.4, 'zap');
					w.events.push({ type: 'enemyFire', x: bx, z: b.z });
				}
				if (ph >= 1 && s.c <= 0) {                                            // drones fly out to four places, hang there for a second, then dive at their prey
					s.c = 5.4 - ph * 0.6;
					for (const k of [-1.05, -0.45, 0.45, 1.05]) w.shoot(bx, b.z, k, 5.2, 'zap', { how: 'stop', at: 0.6, wait: 1, speed: 7, aim: true }, 0.15);
					w.events.push({ type: 'enemyFire', x: bx, z: b.z });
				}
				break;
			}
			default: {                                                               // the storm of the last stand: its arms of lightning shut in front of it
				const was = b.shielded;
				shield(1.7 + ph * 0.2, 3.4 - ph * 0.2, 0.1);
				if (!was && b.shielded) { const n = 2 + ph; for (let i = 0; i < n; i++) streak(bx, b.z, aim + (i / (n - 1) - 0.5) * 0.56, 3, 6.6, 'zap'); }   // a fork as the arms shut
				/** A storm front: a slanting row that slides sideways as it comes down. Its gap is aimed at where it will be among the player's rows. */
				const front = (every: number) => {
					if (s.a > 0) return;
					s.a = every; s.dir = -s.dir;
					const slant = s.dir * 0.3, drift = Math.tan(slant) * (bx - 3);
					s.gap = Math.max(-2.5, Math.min(2.5, s.gap + (w.rnd() < 0.5 ? -1.5 : 1.5)));
					if (Math.abs(s.gap) > 2.4) s.gap *= 0.5;
					for (let z = -HW + 0.3 - Math.max(0, drift); z <= HW - 0.3 - Math.min(0, drift); z += 0.74) if (Math.abs(z + drift - s.gap) > 1.2) w.shoot(bx, z, slant, 4.7, 'zap');
					w.events.push({ type: 'enemyFire', x: bx, z: s.gap });
				};
				/** Lightning walks across the lanes: from one side to the last lane, which is spared, or (later) from both sides to the middle one. */
				const walk = (every: number) => {
					if (s.c > 0) return;
					s.c = every;
					const from = w.rnd() < 0.5, lane = HW * 2 / 5, steps = ph >= 2 && w.rnd() < 0.5 ? [[0, 4], [1, 3]] : [[0], [1], [2], [3]];
					steps.forEach((step, k) => soon(k * 0.42, () => { for (const i of step) { const n = from ? i : 4 - i; w.zone(0, -HW + n * lane + 0.06, ARENA.playerMaxX + 1.5, -HW + (n + 1) * lane - 0.06, 1.1, 0.38); } }));
				};
				/** Thunder: three circles marked around whoever it aims at; the ground between and beyond them is safe. */
				const thunder = (every: number, timer: 'c' | 'd') => { if (s[timer] > 0) return; s[timer] = every; const k = side(); lobs([[0, 0], [1.9, k * 2.1], [-0.4, -k * 2.3]], 1, 1.15); };
				/** Ball lightning: a large slow ball that bursts into a cross just short of where its prey stood, so the arms of the cross pass on both sides of that place. */
				const ball = (every: number) => {
					if (s.d > 0) return;
					s.d = every;
					w.shoot(bx, b.z, aim, 3.4, 'zap', { how: 'split', at: Math.max(1, (Math.hypot(bx - prey.x, b.z - prey.z) - 2.6) / 3.4), into: 4, spread: Math.PI * 1.5, speed: 5.2 }, 0.3);
					w.events.push({ type: 'enemyFire', x: bx, z: b.z });
				};
				/** A gust: a column of sparks hangs at one side of the field for a second, then sweeps right across it. A stretch of it is missing: be in those rows as it passes. */
				const gust = () => {
					const from = side(), gx = Math.max(2.3, Math.min(6.7, prey.x + (w.rnd() - 0.5) * 3));
					for (let x = 1; x <= ARENA.playerMaxX + 0.9; x += 0.74) if (Math.abs(x - gx) > 1.2) w.shoot(x, from * (HW + 0.2), -from * Math.PI / 2, 3.4, 'zap', { how: 'stop', at: 0, wait: 1, speed: 3.4, aim: false });
					w.events.push({ type: 'enemyFire', x: gx, z: from * HW });
				};
				if (ph === 0) { front(2.6); thunder(5, 'c'); if (s.b <= 0) { s.b = 1.6; streak(bx, b.z, aim, 3, 6.4, 'zap'); } }
				else if (ph === 1) {
					walk(4.6); ball(3.6);
					if (s.b <= 0) {                                                   // scissors: two strokes that close a little more each time around whoever keeps their place
						s.b = 2.8;
						[0.5, 0.32, 0.15].forEach((wide, k) => soon(k * 0.45, () => { const a = w.aim(b.x, b.z); for (const side of [-1, 1]) streak(b.x - b.r * 0.7, b.z, a + side * wide, 2, 6, 'zap'); }));
					}
				} else {                                                              // everything it has: two fronts, then a gust, and so on, while lightning walks the lanes and thunder falls
					if (s.a <= 0) { if (++s.k % 3 === 0) { s.a = 3.4; gust(); } else front(2.3); }
					walk(4.8); thunder(5.6, 'd');
					if (s.b <= 0) { s.b = 1.7; streak(bx, b.z, aim, 3, 6.6, 'zap'); }
				}
			}
		}
	}
}
