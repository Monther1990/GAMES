// The combat simulation (pure: no rendering, no DOM, no storage). One World is one try at a stage: the player, the
// enemies, everyone's projectiles and warned danger zones. It reports what happened as events; the game layer turns
// them into pictures, sound and money. Time is whatever the caller passes to step(), so the game can pause it, slow it
// or run it in fixed steps for tests.
// Axes: x goes up the screen (0 at the bottom, 20 at the top), z goes across (-4 left, +4 right).
import eco from '../data/economy.json';
import { EnemyClass, StageDef, WeaponId } from './economy';
import { Director } from './director';
import { stepShots, updateWeapon, WeaponState } from './weapons';
import { blankPowers, hush, markOf, mirrored, muted, NOVA_DELAY, plateTakes, POWER_IDS, preyOf, runPowers, slowOf, startPower, unseen } from './powers';
import type { PowerId } from './powers';

export const ARENA = eco.arena;
const P = eco.player;

export type EnemyKind = EnemyClass | 'boss' | 'turret' | 'crate';
/** Special skills, won from Cyber boxes and used when the player chooses: what each does is in powers.ts. */
export { POWERS, POWER_FROM } from './powers';
export type { PowerId } from './powers';
export interface Enemy {
	id: number; kind: EnemyKind; x: number; z: number; hp: number; maxHp: number; r: number;
	/** Position in the stage's enemy list, used as the reward id so a kill is paid once. -1: pays nothing. */
	index: number; age: number; mode: 'enter' | 'hold' | 'dive' | 'leave';
	sx: number; sz: number; hx: number; hz: number; pattern: number; seed: number; stay: number;
	fireIn: number; shooter: boolean; flash: number;
	/** Armoured enemies and some bosses: true while the plate is closed (most damage is blocked). */
	shielded: boolean; cycle: number; guard: number; dead: boolean;
	/** Damage taken since the screen last showed a number for it. */
	took?: number;
}
/** What the weapons put on the field: a drop of water and the droplets it bursts into, a lobbed incense burner and the
 *  cloud it leaves, a watchtower and its darts, a palm blade, the lighthouse beam and the ember it leaves on a target, a
 *  whirlpool, a falcon, a mortar shell and its fragments, a falling star and the ring of light it sends out. */
export type ShotKind = 'drop' | 'droplet' | 'burner' | 'cloud' | 'tower' | 'dart' | 'blade' | 'ray' | 'ember' | 'whirl' | 'falcon' | 'shell' | 'frag' | 'star' | 'halo';
/** One of those things. Some fly and some stay for a while; what each kind does with these numbers is in weapons.ts. */
export interface Shot {
	id: number; kind: ShotKind; weapon: WeaponId; x: number; z: number; vx: number; vz: number; dmg: number; r: number;
	/** Seconds left, seconds lived, and the seconds it was given (the picture shows how far along it is). */
	life: number; age: number; total: number;
	/** Whom it is after, and the point it is going to. */
	target: Enemy | null; tx: number; tz: number;
	/** The area it covers (a cloud, a blast, a ring at its widest, the reach of a tower, the length of a beam). */
	radius: number;
	/** An angle and how fast it turns (the lighthouse beam). Other kinds keep a figure of their own here. */
	a: number; va: number;
	/** A count of its kind (bounces left, bites left, which of a set it is) and the step it is at (a falcon: 0 circling, 1 diving, 2 flying home). */
	n: number; mode: number;
	/** Seconds until it acts again, and a second amount of damage it carries (a burst at its end, the ring a star sends out). */
	tick: number; power: number;
	/** Enemies it has already struck, and how many times. */
	seen: Map<number, number> | null;
	/** 1 when the supporter fired it. */
	owner?: number;
}
/** Enemy fire comes in four shapes: a jagged speech bubble, a spinning exclamation mark, a glitch square and a lightning shard. */
export type BulletKind = 'talk' | 'bang' | 'glitch' | 'zap';
/** How a piece of enemy fire flies when it does not simply go straight. Whatever it will do, it shows first: one that
 *  hangs does so in plain sight, and one about to dart or burst wears a closing ring (`hot` on the bullet). */
export type Flight =
	| { how: 'weave'; wide: number; rate: number; phase?: number; bx?: number; bz?: number }   // sways across its line (bx, bz: the line it keeps to)
	| { how: 'curve'; turn: number; until: number }                                         // bends at a steady rate for a while, then flies straight
	| { how: 'seek'; turn: number; until: number }                                          // bends toward whoever is being aimed at, for a while
	| { how: 'rush'; gain: number; top: number }                                            // starts slowly and gathers speed
	| { how: 'stop'; at: number; wait: number; speed: number; aim: boolean; dx?: number; dz?: number }   // flies, hangs in the air, then goes: the way it was going, or at its prey
	| { how: 'split'; at: number; into: number; spread: number; speed?: number }            // bursts into several plain shots, spread around the way it was going
	| { how: 'bounce'; left: number };                                                      // comes back off the side of the field
export interface Bullet {
	id: number; kind: BulletKind; x: number; z: number; vx: number; vz: number; r: number;
	/** Seconds it has flown, its way of flying if not straight, and 0..1 as it nears a sudden change (the screen draws a closing ring). */
	age: number; fly?: Flight; hot?: number;
	/** Rumour Mirror: set when the shot was turned round (1 by the main player's mirror, 2 by the supporter's). It then
	 *  flies back, hurts no fighter and strikes the enemy it touches. */
	back?: number;
}
/** A rectangle that is announced first (warn) and then hurts for a moment (live). A lobbed shot lands on a round one:
 *  `r` is its radius around the middle of the rectangle, (fx, fz) is where it was thrown from, and a `quiet` one lands
 *  without shaking the screen. */
export interface Zone { id: number; x0: number; z0: number; x1: number; z1: number; warn: number; live: number; total: number; r?: number; fx?: number; fz?: number; quiet?: boolean }
export interface Blast { x: number; z: number; radius: number; dmg: number; weapon: WeaponId; at: number; owner?: number }
/** What one fighter did in a fight: damage dealt (to everything but boxes), how much of it to the boss, and kills. */
export interface Tally { damage: number; boss: number; kills: number }

export type SimEvent =
	| { type: 'fire'; weapon: WeaponId; x: number; z: number }
	| { type: 'hit'; x: number; z: number; weapon: WeaponId; blocked: boolean }
	| { type: 'bounce'; x: number; z: number }
	| { type: 'kill'; enemy: Enemy; by: number }
	| { type: 'crateIn'; rare: boolean; heart: boolean }
	| { type: 'crate'; x: number; z: number; rare: boolean; heart: boolean; by: number }
	| { type: 'allyHit'; hp: number }
	| { type: 'down'; who: number }
	| { type: 'revive'; by: number }
	| { type: 'nova'; x: number; z: number }
	| { type: 'power'; power: PowerId; x: number; z: number }
	| { type: 'plate'; who: number; left: number; x: number; z: number }      // Identity Shield: a plate took a hit and broke
	| { type: 'turned'; points: number[] }                                    // Rumour Mirror: enemy shots were turned round here
	| { type: 'dart'; x: number; z: number }                                  // a guard's shot, or a returned one, struck
	| { type: 'towerShot'; x: number; z: number }                             // a watchtower let a dart go
	| { type: 'thunder'; x: number; z: number; big: boolean }                 // Mountain Lightning fell
	| { type: 'dawn' }                                                        // Total Awareness: the sun is up and its light sets off
	| { type: 'explode'; x: number; z: number; radius: number; weapon: WeaponId }
	| { type: 'playerHit'; hp: number }
	| { type: 'playerDead' }
	| { type: 'wave'; index: number; total: number }
	| { type: 'wavesDone' }
	| { type: 'bossPhase'; phase: number }
	| { type: 'bossDead'; enemy: Enemy; by: number }
	| { type: 'zone' }
	| { type: 'fizz'; points: number[] }
	| { type: 'enemyFire'; x: number; z: number };

export interface MoveInput { dx: number; dz: number; target: { x: number; z: number } | null }
export interface Bounds { minX: number; maxX: number; halfWidth: number }
/** Courage pays: the nearer a fighter stands to what their weapon strikes, the harder it hits. Nothing is added from
 *  `far` away, the whole bonus from `near` (distances to the enemy's edge). */
export const CLOSE = { near: 4.5, far: 9, bonus: 0.5 };
export function closeBonus(distance: number) { return 1 + CLOSE.bonus * Math.max(0, Math.min(1, (CLOSE.far - distance) / (CLOSE.far - CLOSE.near))); }
/** Moves a fighter by the finger or the keys, inside the field. One who has fallen or is answering stands still. */
export function steer(p: Body, input: MoveInput, dt: number, bounds: Bounds) {
	if (p.down || p.busy) { p.vx = 0; p.vz = 0; return; }
	let wantX = 0, wantZ = 0;
	if (input.target) {
		const dx = input.target.x - p.x, dz = input.target.z - p.z, d = Math.hypot(dx, dz);
		const v = Math.min(P.dragSpeed, d / Math.max(dt, 0.001));
		if (d > 0.001) { wantX = dx / d * v; wantZ = dz / d * v; }
		p.vx = wantX; p.vz = wantZ;
	} else {
		const d = Math.hypot(input.dx, input.dz);
		if (d > 0.01) { wantX = input.dx / Math.max(1, d) * P.speed; wantZ = input.dz / Math.max(1, d) * P.speed; }
		const k = Math.min(1, dt * 22);                                    // quick to start and to stop: no sliding
		p.vx += (wantX - p.vx) * k; p.vz += (wantZ - p.vz) * k;
	}
	p.x = Math.max(bounds.minX, Math.min(bounds.maxX, p.x + p.vx * dt));
	p.z = Math.max(-bounds.halfWidth, Math.min(bounds.halfWidth, p.z + p.vz * dt));
}
export interface WorldOptions { waves: boolean; seed: string; crates?: boolean }
/** One of the two who fight: where they are, their health, and whether they are down (waiting to be revived) or busy
 *  (answering the question of a box: shielded, and neither moving nor firing). */
export interface Body { x: number; z: number; vx: number; vz: number; hp: number; maxHp: number; invuln: number; bubble: number; down: boolean; busy: boolean }
/** The supporter inside the main player's fight. */
export interface Ally { body: Body; weapon: WeaponState; beam: { on: boolean; z: number; x0: number; x1: number; width: number } }

export function seeded(seed: string): () => number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
	let a = h >>> 0;
	return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class World {
	t = 0;
	readonly rnd: () => number;
	player: Body = { x: 2.4, z: 0, vx: 0, vz: 0, hp: P.hp, maxHp: P.hp, invuln: 0, bubble: 0, down: false, busy: false };
	/** The supporter, when two play together. */
	ally: Ally | null = null;
	/** Who is acting right now (0 the main player, 1 the supporter): whose shot struck, who opened a box. */
	acting = 0;
	/** How much harder a fight for two is: health of small enemies and of bosses, and how often enemies fire. */
	hard = { hp: 1, boss: 1, fire: 1 };
	private reviveT = 0;
	/** The special skills that are running: rain, falcon, mirror, mute, marks, guards, plates, private accounts, lightning, sunrise. */
	pw = blankPowers();
	enemies: Enemy[] = []; shots: Shot[] = []; bullets: Bullet[] = []; zones: Zone[] = [];
	blasts: Blast[] = [];
	/** The focused beam, when that weapon is equipped: where it is this frame. */
	beam = { on: false, z: 0, x0: 0, x1: 0, width: 0 };
	readonly events: SimEvent[] = [];
	weapon: WeaponState;
	readonly director: Director;
	boss: Enemy | null = null;
	firing = true;
	/** Where the player may move. The shop preview moves this area up the screen. */
	readonly bounds = { minX: ARENA.playerMinX, maxX: ARENA.playerMaxX, halfWidth: ARENA.playerHalfWidth };
	/** Tests and the shop preview: the player cannot be hurt. */
	godMode = false;
	over = false;
	/** Seconds for which everything hostile stands still (only Total Awareness does this, while its sun rises and its light crosses the field). */
	freeze = 0;
	/** Total Awareness: seconds left until the sun is up and its light sets off (0: none). */
	novaIn = 0;
	/** The count of the fight for each fighter (0 the main player, 1 the supporter): each is paid for their own kills. */
	readonly stats: Tally[] = [{ damage: 0, boss: 0, kills: 0 }, { damage: 0, boss: 0, kills: 0 }];
	private ids = 1;

	constructor(readonly stage: StageDef, readonly stageIndex: number, weapon: WeaponId, level: number, options: WorldOptions) {
		this.rnd = seeded(options.seed);
		this.weapon = { id: weapon, level, cool: 0.4, queue: [], hitTick: 0 };
		this.director = new Director(this, options.waves, !!options.crates);
	}
	id() { return this.ids++; }

	step(dt: number, input: MoveInput) {
		if (dt <= 0 || this.over) return;
		this.t += dt;
		this.movePlayer(dt, input);
		const ally = this.ally;
		this.acting = 0;
		if (this.firing && !this.player.down && !this.player.busy) updateWeapon(this, dt); else this.beam.on = false;
		if (ally) {
			const b = ally.body;
			b.invuln = Math.max(0, b.invuln - dt); b.bubble = Math.max(0, b.bubble - dt);
			if (this.firing && !b.down && !b.busy) this.asAlly(() => updateWeapon(this, dt)); else ally.beam.on = false;
			this.runRevive(dt);
		}
		this.moveShots(dt);
		this.acting = 0;
		const frozen = this.freeze > 0;
		this.freeze = Math.max(0, this.freeze - dt);
		if (!frozen) {
			const said = this.events.length;
			this.director.update(dt * slowOf(this));                               // Khareef Rain: enemies move and act more slowly
			if (muted(this)) hush(this, said);                                     // Mute: nothing was fired, so nothing flashes
			this.moveBullets(dt);
		}
		runPowers(this, dt);
		this.acting = 0;
		for (let i = this.blasts.length - 1; i >= 0; i--) if (this.blasts[i].at <= this.t) { const b = this.blasts.splice(i, 1)[0]; this.acting = b.owner ?? 0; this.explode(b.x, b.z, b.radius, b.dmg, b.weapon, null); this.acting = 0; }
		for (const e of this.enemies) {
			e.flash = Math.max(0, e.flash - dt);
			if (frozen || e.dead || e.kind === 'boss' || e.kind === 'crate') continue;
			if (this.touches(e.x, e.z, e.r * 0.8)) this.hurt(0);
			if (ally && this.near(ally.body, e.x, e.z, e.r * 0.8)) this.hurt(1);
		}
		// the dead are removed, and so are those that left the screen (they pay nothing)
		this.enemies = this.enemies.filter(e => !e.dead && !(e.mode === 'leave' && (e.x > ARENA.length + 3 || e.x < -2)));
	}

	// ------------------------------------------------------------------ player
	private movePlayer(dt: number, input: MoveInput) {
		const p = this.player;
		p.invuln = Math.max(0, p.invuln - dt); p.bubble = Math.max(0, p.bubble - dt);
		steer(p, input, dt, this.bounds);
	}
	private near(b: Body, x: number, z: number, r: number) { return !b.down && Math.hypot(b.x - x, b.z - z) < r + P.radius; }
	touches(x: number, z: number, r: number) { return this.near(this.player, x, z, r); }
	hurtPlayer() { this.hurt(0); }
	/** One of the two is struck (0 the main player, 1 the supporter). A plate of the Identity Shield takes the hit if
	 *  one is left. At zero health they fall and wait for the other to revive them, and when nobody is left standing
	 *  the stage is lost. */
	hurt(who: number) {
		const a = this.ally, p = who === 1 ? a?.body : this.player;
		if (!p || p.down || p.invuln > 0 || this.godMode || this.over) return;
		if (plateTakes(this, who, p)) return;
		p.hp--; p.invuln = P.invulnerable;
		this.events.push(who === 1 ? { type: 'allyHit', hp: p.hp } : { type: 'playerHit', hp: p.hp });
		if (p.hp > 0) return;
		const other = who === 1 ? this.player : a?.body;
		if (other && !other.down) { p.hp = 0; p.down = true; p.busy = false; this.events.push({ type: 'down', who }); return; }
		this.over = true; this.events.push({ type: 'playerDead' });
	}

	// ------------------------------------------------------------------ two players
	/** The supporter joins before the fight begins: two fighters, four hearts each, and a harder fight. */
	addAlly(weapon: WeaponId, level: number) {
		const hearts = P.hp - 1;
		this.player.maxHp = hearts; this.player.hp = Math.min(this.player.hp, hearts); this.player.z = -1.4;
		this.ally = { body: { x: 2.4, z: 1.4, vx: 0, vz: 0, hp: hearts, maxHp: hearts, invuln: 0, bubble: 0, down: false, busy: false },
			weapon: { id: weapon, level, cool: 0.6, queue: [], hitTick: 0 }, beam: { on: false, z: 0, x0: 0, x1: 0, width: 0 } };
		this.hard = { hp: 1.7, boss: 1.8, fire: 1.3 };
	}
	/** The supporter left in the middle: what remains of the fight goes back to the measure of one player. */
	joinAlly(weapon: WeaponId, level: number) {
		if (this.ally) return;
		const z = this.player.z;
		this.addAlly(weapon, level);
		this.player.z = z;                                                       // the main player stays where they stand
		for (const e of this.enemies) { const k = e.kind === 'boss' || e.kind === 'turret' ? this.hard.boss : e.kind === 'crate' ? 1 : this.hard.hp; e.hp *= k; e.maxHp *= k; }
		const b = this.ally!.body; b.invuln = 2.5; b.bubble = 2.5;                // a moment to look around
	}
	/** The supporter left in the middle: what remains of the fight goes back to the measure of one player. (The line
	 *  above this one, joinAlly, is the other way round: a supporter who steps into a fight already running - what is
	 *  on the field grows to the measure of two, as it would have been had they been there from the start.) */
	dropAlly() {
		if (!this.ally) return;
		for (const e of this.enemies) { const k = e.kind === 'boss' || e.kind === 'turret' ? this.hard.boss : e.kind === 'crate' ? 1 : this.hard.hp; e.hp /= k; e.maxHp /= k; }
		this.shots = this.shots.filter(s => s.owner !== 1);
		this.ally = null; this.hard = { hp: 1, boss: 1, fire: 1 };
		const s = this.pw; s.guards[1] = 0; s.armor[1] = 0; s.hidden[1] = 0; s.ghost[1] = null; s.darts = s.darts.filter(d => d.by !== 1);   // what was the supporter's own goes with them
		const p = this.player;
		p.maxHp = P.hp;                                                           // alone again: the fifth heart can be won back
		if (p.down) { p.down = false; p.hp = 1; p.invuln = 2.5; p.bubble = 2.5; }      // nobody is left to revive them
		p.busy = false;
	}
	/** Where the supporter is now (their own device decides; it is only kept inside the field). */
	moveAlly(x: number, z: number, dt: number) {
		const b = this.ally?.body;
		if (!b || b.down || b.busy) return;
		const nx = Math.max(ARENA.playerMinX, Math.min(ARENA.playerMaxX, x)), nz = Math.max(-ARENA.playerHalfWidth, Math.min(ARENA.playerHalfWidth, z));
		if (dt > 0) { b.vx = (nx - b.x) / dt; b.vz = (nz - b.z) / dt; }
		b.x = nx; b.z = nz;
	}
	/** The supporter changed or upgraded their weapon on their own device. */
	setAllyWeapon(id: WeaponId, level: number) {
		const a = this.ally;
		if (!a) return;
		if (a.weapon.id !== id) { a.weapon.id = id; a.weapon.queue = []; a.weapon.cool = 0.4; a.beam.on = false; }
		a.weapon.level = level;
	}
	/** While one answers the question of a box the fight goes on: they stand shielded, and neither move nor fire. */
	setBusy(who: number, on: boolean) {
		const b = who === 1 ? this.ally?.body : this.player;
		if (!b || b.down) return;
		b.busy = on;
		if (on) { b.invuln = Math.max(b.invuln, 40); b.bubble = Math.max(b.bubble, 40); } else { b.invuln = 1.2; b.bubble = 1.2; }
	}
	/** Runs the weapon code for the supporter: for that moment the supporter stands where the code looks for "the player". */
	private asAlly(fn: () => void) {
		const a = this.ally!, keep = { player: this.player, weapon: this.weapon, beam: this.beam }, from = this.shots.length;
		this.player = a.body; this.weapon = a.weapon; this.beam = a.beam; this.acting = 1;
		try { fn(); } finally { a.beam = this.beam; this.player = keep.player; this.weapon = keep.weapon; this.beam = keep.beam; this.acting = 0; }
		for (let i = from; i < this.shots.length; i++) this.shots[i].owner = 1;
	}
	static readonly REVIVE_TIME = 1.2;
	/** How far the reviving has come, 0 .. 1 (for the ring drawn around the fallen one). */
	get reviving() { return Math.min(1, this.reviveT / World.REVIVE_TIME); }
	/** Whoever stands beside the fallen one for a moment gives them one of their own hearts, and they rise. */
	private runRevive(dt: number) {
		const p = this.player, b = this.ally!.body;
		const giver = p.down && !b.down ? b : b.down && !p.down ? p : null;
		if (!giver) { this.reviveT = 0; return; }
		const fallen = giver === p ? b : p;
		if (giver.hp >= 2 && !giver.busy && Math.hypot(giver.x - fallen.x, giver.z - fallen.z) < 1.45) {
			this.reviveT += dt;
			if (this.reviveT < World.REVIVE_TIME) return;
			giver.hp--; fallen.hp = 1; fallen.down = false; fallen.invuln = 2.5; fallen.bubble = 2.5; this.reviveT = 0;
			this.events.push({ type: 'revive', by: giver === p ? 0 : 1 });
		} else this.reviveT = Math.max(0, this.reviveT - dt * 2);
	}

	// ------------------------------------------------------------------ damage
	/** Enemies in front of the player that can be hit now. */
	targets() { return this.enemies.filter(e => !e.dead && e.mode !== 'leave' && e.x < ARENA.length + 0.5); }

	damage(e: Enemy, amount: number, weapon: WeaponId, x: number, z: number, quiet = false) {
		if (e.dead) return;
		// whoever is answering the question of a box opens no other meanwhile: what they left on the field (a tower, a cloud) spares the boxes until they are back
		if (e.kind === 'crate' && (this.acting === 1 && this.ally ? this.ally.body : this.player).busy) return;
		if (!this.flat) amount *= markOf(this, e);                                // Report: a marked enemy is struck harder by every weapon
		if (!this.flat) { const b = this.acting === 1 && this.ally ? this.ally.body : this.player; amount *= closeBonus(Math.max(0, Math.hypot(e.x - b.x, e.z - b.z) - e.r)); }   // weapons only: powers hit the same from anywhere
		const blocked = e.guard < 1;
		const dealt = Math.min(e.hp, amount * e.guard);                           // what is shown never exceeds the health that was there
		e.hp -= amount * e.guard; e.took = (e.took ?? 0) + dealt;
		if (e.kind !== 'crate') { const t = this.stats[this.acting === 1 && this.ally ? 1 : 0]; t.damage += dealt; if (e.kind === 'boss') t.boss += dealt; }
		e.flash = 0.09;
		if (!quiet) this.events.push({ type: 'hit', x, z, weapon, blocked });
		if (e.hp <= 0) this.kill(e);
	}
	private kill(e: Enemy) {
		const by = this.acting === 1 && this.ally ? 1 : 0;
		e.dead = true; e.hp = 0;
		if (e.kind !== 'crate') this.stats[by].kills++;
		if (e.kind === 'boss') {
			this.clearFire();
			for (const o of this.enemies) if (o !== e && !o.dead) { o.dead = true; if (o.index >= 0) { this.stats[by].kills++; this.events.push({ type: 'kill', enemy: o, by }); } }   // its helpers fall with it and still pay
			this.boss = null;
			this.firing = false;
			this.events.push({ type: 'bossDead', enemy: e, by });
		} else if (e.kind === 'crate') this.events.push({ type: 'crate', x: e.x, z: e.z, rare: e.pattern === 1, heart: e.pattern === 2, by: this.acting });
		else this.events.push({ type: 'kill', enemy: e, by });
	}

	// ------------------------------------------------------------------ special skills (what each does is in powers.ts)
	/** Damage that no plate or shield reduces, and that is the same from anywhere on the field. */
	strike(e: Enemy, amount: number) { const g = e.guard; e.guard = 1; this.flat = true; this.damage(e, amount, this.weapon.id, e.x, e.z, true); this.flat = false; e.guard = g; }
	private flat = false;
	/** Uses one power now. The game decides whether the player has one; this only says what it does. */
	usePower(id: PowerId, by = 0) {
		if (this.over || !POWER_IDS.includes(id)) return;                          // an id out of an old save, or from another device, does nothing
		const a = by === 1 ? this.ally : null, p = a ? a.body : this.player;
		if (p.down) return;
		this.events.push({ type: 'power', power: id, x: p.x, z: p.z });
		const before = this.acting;
		this.acting = a ? 1 : 0;
		try { startPower(this, id, a ? 1 : 0, p); } finally { this.acting = before; }
	}
	/** Sets the level of the weapon in hand (an upgrade in the middle of a fight). */
	setWeaponLevel(level: number) { this.weapon.level = level; }
	/** Gives hearts back, never above the maximum. Returns how many were really added. */
	heal(hearts: number, who = 0) { const p = who === 1 && this.ally ? this.ally.body : this.player, before = p.hp; if (p.down) return 0; p.hp = Math.min(p.maxHp, p.hp + hearts); return p.hp - before; }
	/** Total Awareness: how long its sun needs to rise before the light sets off across the field. */
	static readonly NOVA_DELAY = NOVA_DELAY;
	explode(x: number, z: number, radius: number, dmg: number, weapon: WeaponId, except: Enemy | null) {
		this.events.push({ type: 'explode', x, z, radius, weapon });
		for (const e of this.targets()) if (e !== except && Math.hypot(e.x - x, e.z - z) < radius + e.r) this.damage(e, dmg, weapon, e.x, e.z, true);
	}

	// ------------------------------------------------------------------ projectiles
	/** Everything the weapons have put on the field moves and does its work (weapons.ts). */
	private moveShots(dt: number) { stepShots(this, dt); }
	private moveBullets(dt: number) {
		const born: Bullet[] = [];
		for (const b of this.bullets) {
			b.age += dt;
			if ((b.back || this.pw.mirror > 0) && mirrored(this, b, dt)) continue;   // Rumour Mirror: turned shots fly back at the enemies
			if (b.fly) this.steer(b, b.fly, dt, born);
			b.x += b.vx * dt; b.z += b.vz * dt;
			if (this.touches(b.x, b.z, b.r)) { this.hurt(0); b.x = -99; }
			else if (this.ally && this.near(this.ally.body, b.x, b.z, b.r)) { this.hurt(1); b.x = -99; }
		}
		if (born.length) this.bullets.push(...born);
		this.bullets = this.bullets.filter(b => b.x > -1.6 && b.x < ARENA.length + 3 && Math.abs(b.z) < World.SIDE);
		const p = this.player, q = this.ally?.body;
		const inside = (who: Body, z: Zone) => !who.down && who.x > z.x0 && who.x < z.x1 && who.z > z.z0 && who.z < z.z1 && (!z.r || Math.hypot(who.x - (z.x0 + z.x1) / 2, who.z - (z.z0 + z.z1) / 2) < z.r);
		for (const z of this.zones) {
			if (z.warn > 0) { z.warn -= dt; if (z.warn <= 0) this.events.push(z.quiet ? { type: 'enemyFire', x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 } : { type: 'zone' }); continue; }
			z.live -= dt;
			if (inside(p, z)) this.hurt(0);
			if (q && inside(q, z)) this.hurt(1);
		}
		this.zones = this.zones.filter(z => z.warn > 0 || z.live > 0);
	}
	/** One step of a shot that does not fly straight (see Flight). Shots it bursts into are added to `born`. */
	private steer(b: Bullet, f: Flight, dt: number, born: Bullet[]) {
		const speed = Math.hypot(b.vx, b.vz), turnBy = (angle: number) => { const a = Math.atan2(b.vz, -b.vx) + angle; b.vx = -Math.cos(a) * speed; b.vz = Math.sin(a) * speed; };
		switch (f.how) {
			case 'weave': {
				const bx = f.bx ?? b.vx, bz = f.bz ?? b.vz, s = Math.hypot(bx, bz) || 1, side = f.wide * f.rate * Math.cos(f.rate * b.age + (f.phase ?? 0));
				b.vx = bx - bz / s * side; b.vz = bz + bx / s * side;
				break;
			}
			case 'curve': if (b.age < f.until) turnBy(f.turn * dt); else b.fly = undefined; break;
			case 'seek': {
				const p = this.prey();
				if (b.age >= f.until || b.x < p.x + 1.5 || unseen(this)) { b.fly = undefined; break; }   // a private account cannot be followed
				let d = Math.atan2(p.z - b.z, b.x - p.x) - Math.atan2(b.vz, -b.vx);
				d = Math.atan2(Math.sin(d), Math.cos(d));
				turnBy(Math.max(-f.turn * dt, Math.min(f.turn * dt, d)));
				break;
			}
			case 'rush': { const s = Math.min(f.top, speed + f.gain * dt), k = speed > 0 ? s / speed : 1; b.vx *= k; b.vz *= k; if (s >= f.top) b.fly = undefined; break; }
			case 'stop': {
				if (b.age < f.at) break;
				if (f.dx === undefined) { f.dx = speed > 0 ? b.vx / speed : -1; f.dz = speed > 0 ? b.vz / speed : 0; b.vx = 0; b.vz = 0; }
				b.hot = Math.min(1, (b.age - f.at) / f.wait);
				if (b.age < f.at + f.wait) break;
				if (f.aim) { const a = this.aim(b.x, b.z); b.vx = -Math.cos(a) * f.speed; b.vz = Math.sin(a) * f.speed; }
				else { b.vx = f.dx * f.speed; b.vz = (f.dz ?? 0) * f.speed; }
				b.fly = undefined; b.hot = 0;
				break;
			}
			case 'split': {
				b.hot = Math.max(0, Math.min(1, 1 - (f.at - b.age) / 0.6));
				if (b.age < f.at) break;
				const a = Math.atan2(b.vz, -b.vx), v = f.speed ?? speed;
				for (let i = 0; i < f.into; i++) { const k = a + (f.into === 1 ? 0 : (i / (f.into - 1) - 0.5) * f.spread); born.push({ id: this.id(), kind: b.kind, x: b.x, z: b.z, vx: -Math.cos(k) * v, vz: Math.sin(k) * v, r: b.kind === 'glitch' ? 0.14 : 0.17, age: 0 }); }
				this.events.push({ type: 'enemyFire', x: b.x, z: b.z });
				b.x = -99;
				break;
			}
			case 'bounce': if (f.left > 0 && Math.abs(b.z) > ARENA.halfWidth - 0.15 && b.z * b.vz > 0) { b.vz = -b.vz; if (--f.left <= 0) b.fly = undefined; } break;
		}
	}

	/** How far to the side anything may fly before it is dropped: beyond the edge of the widest screen (a tablet or a
	 *  desktop shows far more than the lanes of the fight), so nothing is seen to vanish in mid-air. */
	static readonly SIDE = 19;
	/** Removes all enemy fire at once (a boss changes phase or falls, a power goes off) and says where it was, so the
	 *  screen can turn it to sparks instead of letting it vanish. */
	clearFire() {
		if (this.bullets.length) this.events.push({ type: 'fizz', points: this.bullets.slice(0, 90).flatMap(b => [b.x, b.z]) });
		this.bullets = []; this.zones = [];
	}

	// ------------------------------------------------------------------ what enemies use to attack
	/** One enemy bullet. `angle` is measured from straight down the screen, positive toward +z. `fly` gives it a way of
	 *  flying other than straight, and `r` a size other than the usual (large ones are slow, small ones may be quick). */
	shoot(x: number, z: number, angle: number, speed: number, kind: Bullet['kind'] = 'talk', fly?: Flight, r = kind === 'glitch' ? 0.14 : 0.17) {
		if (this.bullets.length > 260 || muted(this)) return;                       // Mute: no enemy can fire
		const b: Bullet = { id: this.id(), kind, x, z, vx: -Math.cos(angle) * speed, vz: Math.sin(angle) * speed, r, age: 0 };
		if (fly) b.fly = fly.how === 'weave' ? { ...fly, bx: b.vx, bz: b.vz } : { ...fly };
		this.bullets.push(b);
	}
	/** Whom enemy fire is aimed at: the one still standing, or each in turn every few seconds when both are (a fighter
	 *  whose account is private is passed over: see preyOf). */
	prey(): Body { return preyOf(this); }
	/** The way from a point to whoever is aimed at; straight down the field when nobody can be seen (Private Account). */
	aim(x: number, z: number) { if (unseen(this)) return 0; const p = this.prey(); return Math.atan2(p.z - z, x - p.x); }
	fan(x: number, z: number, count: number, spread: number, speed: number, centre: number, kind: Bullet['kind'] = 'talk') {
		for (let i = 0; i < count; i++) this.shoot(x, z, centre + (count === 1 ? 0 : (i / (count - 1) - 0.5) * spread), speed, kind);
		this.events.push({ type: 'enemyFire', x, z });
	}
	/** A row across the arena moving down, with one gap wide enough to pass. */
	row(x: number, gapZ: number, gapWidth: number, speed: number, kind: Bullet['kind'] = 'glitch') {
		for (let z = -ARENA.halfWidth + 0.3; z <= ARENA.halfWidth - 0.3; z += kind === 'glitch' ? 0.62 : 0.74) if (Math.abs(z - gapZ) > gapWidth / 2) this.shoot(x, z, 0, speed, kind);
		this.events.push({ type: 'enemyFire', x, z: gapZ });
	}
	/** A ring from a point, with a gap of `gap` bullets starting at index `open`. */
	ring(x: number, z: number, count: number, speed: number, offset: number, open: number, gap: number, kind: Bullet['kind'] = 'talk') {
		for (let i = 0; i < count; i++) { const k = (i - open + count) % count; if (k < gap) continue; this.shoot(x, z, offset + i / count * Math.PI * 2, speed, kind); }
		this.events.push({ type: 'enemyFire', x, z });
	}
	zone(x0: number, z0: number, x1: number, z1: number, warn = 1, live = 0.45) { if (muted(this)) return; this.zones.push({ id: this.id(), x0, z0, x1, z1, warn, live, total: warn }); }
	/** A lobbed shot: thrown from (fx, fz), it lands on a circle that is marked on the ground for `warn` seconds first,
	 *  and what it leaves there hurts for `live` seconds. The circle is kept inside the part of the field players can reach. */
	lob(fx: number, fz: number, x: number, z: number, r: number, warn = 1.1, live = 0.3, quiet = false) {
		if (muted(this)) return;
		x = Math.max(ARENA.playerMinX, Math.min(ARENA.playerMaxX + 0.5, x)); z = Math.max(-ARENA.playerHalfWidth, Math.min(ARENA.playerHalfWidth, z));
		this.zones.push({ id: this.id(), x0: x - r, z0: z - r, x1: x + r, z1: z + r, warn, live, total: warn, r, fx, fz, quiet });
	}
}

export function nearest(list: Enemy[], x: number, z: number, skip?: Set<Enemy>, maxDist = Infinity): Enemy | null {
	let best: Enemy | null = null, bd = maxDist;
	for (const e of list) { if (e.dead || skip?.has(e)) continue; const d = Math.hypot(e.x - x, e.z - z) - e.r; if (d < bd) { bd = d; best = e; } }
	return best;
}
