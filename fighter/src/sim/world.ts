// The combat simulation (pure: no rendering, no DOM, no storage). One World is one try at a stage: the player, the
// enemies, everyone's projectiles and warned danger zones. It reports what happened as events; the game layer turns
// them into pictures, sound and money. Time is whatever the caller passes to step(), so the game can pause it, slow it
// or run it in fixed steps for tests.
// Axes: x goes up the screen (0 at the bottom, 20 at the top), z goes across (-4 left, +4 right).
import eco from '../data/economy.json';
import { EnemyClass, StageDef, WeaponId } from './economy';
import { Director } from './director';
import { updateWeapon, WeaponState } from './weapons';

export const ARENA = eco.arena;
const P = eco.player;

export type EnemyKind = EnemyClass | 'boss' | 'turret' | 'crate';
/** Emergency powers, won from Cyber boxes and used when the player chooses. */
export type PowerId = 'bomb' | 'laser' | 'freeze' | 'guard' | 'mega' | 'aware' | 'wall' | 'scan' | 'backup' | 'update';
/** What an ordinary box may hold. Total Awareness ('aware') comes only from the rare black box. */
export const POWERS: PowerId[] = ['bomb', 'guard', 'freeze', 'wall', 'update', 'laser', 'scan', 'backup', 'mega'];
/** The first stage (0-based) in whose boxes each power may appear: the strong ones come later. */
export const POWER_FROM: Partial<Record<PowerId, number>> = { laser: 1, scan: 1, backup: 1, mega: 2 };
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
export type ShotKind = 'pulse' | 'pellet' | 'missile' | 'plasma' | 'shard' | 'disc' | 'wave' | 'shield';
export interface Shot {
	id: number; kind: ShotKind; weapon: WeaponId; x: number; z: number; vx: number; vz: number; dmg: number; r: number; life: number;
	target: Enemy | null; turn: number; splash: number; radius: number; shards: number; second: number; age: number;
	/** Shots that pass through enemies remember whom they already struck. */
	seen: Set<number> | null;
	/** The ricochet disc: how many more enemies it may jump to. */
	bounces: number;
	/** The Cyber Shield: a thrown shield follows a loop out from the player and back (flight time, side, reach, sideways swing). */
	loop: { time: number; side: number; reach: number; spread: number } | null;
	/** 1 when the supporter fired it. */
	owner?: number;
}
export interface Bullet { id: number; kind: 'orb' | 'shard' | 'code'; x: number; z: number; vx: number; vz: number; r: number }
/** A rectangle that is announced first (warn) and then hurts for a moment (live). */
export interface Zone { id: number; x0: number; z0: number; x1: number; z1: number; warn: number; live: number; total: number }
export interface Blast { x: number; z: number; radius: number; dmg: number; weapon: WeaponId; at: number; owner?: number }
/** What one fighter did in a fight: damage dealt (to everything but boxes), how much of it to the boss, and kills. */
export interface Tally { damage: number; boss: number; kills: number }

export type SimEvent =
	| { type: 'fire'; weapon: WeaponId; x: number; z: number }
	| { type: 'hit'; x: number; z: number; weapon: WeaponId; blocked: boolean }
	| { type: 'bounce'; x0: number; z0: number; x1: number; z1: number }
	| { type: 'kill'; enemy: Enemy; by: number }
	| { type: 'crateIn'; rare: boolean; heart: boolean }
	| { type: 'crate'; x: number; z: number; rare: boolean; heart: boolean; by: number }
	| { type: 'revived'; who: number }
	| { type: 'allyHit'; hp: number }
	| { type: 'down'; who: number }
	| { type: 'revive'; by: number }
	| { type: 'nova'; x: number; z: number }
	| { type: 'power'; power: PowerId; x: number; z: number }
	| { type: 'explode'; x: number; z: number; radius: number; weapon: WeaponId }
	| { type: 'arc'; points: number[] }
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
export interface Ally { body: Body; weapon: WeaponState; beam: { on: boolean; z: number; x0: number; x1: number; width: number }; boost: number; baseLevel: number; backups: number }

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
	/** Who raised the laser wave (it rises from them). */
	laserBy = 0;
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
	/** Seconds left of the powers that last: everything hostile stands still; a wall of light rises from the player. */
	freeze = 0; laser = 0;
	/** Total Awareness gathers for a moment before it goes off: seconds left until the blast (0: none). */
	novaIn = 0;
	/** The firewall: seconds left, and the line across the field that enemy fire cannot pass. */
	wall = { left: 0, x: 0 };
	/** The antivirus scan: the line sweeping down the field (on while x > -1), and whom it has already struck. */
	scan = { on: false, x: 0, seen: new Set<number>() };
	/** The security update: seconds left of a weapon one level higher and harder-hitting, and the level it returns to. */
	boost = 0; private baseLevel = 1;
	/** The count of the fight for each fighter (0 the main player, 1 the supporter): each is paid for their own kills. */
	readonly stats: Tally[] = [{ damage: 0, boss: 0, kills: 0 }, { damage: 0, boss: 0, kills: 0 }];
	/** Who set off the antivirus scan and Total Awareness (their kills are theirs). */
	private scanBy = 0; private novaBy = 0;
	/** Backups in store (the game sets this): at zero health one of them brings the player back instead of losing. */
	backups = 0;
	private ids = 1;

	constructor(readonly stage: StageDef, readonly stageIndex: number, weapon: WeaponId, level: number, options: WorldOptions) {
		this.rnd = seeded(options.seed);
		this.weapon = { id: weapon, level, cool: 0.4, queue: [], hitTick: 0 };
		this.baseLevel = level;
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
			if (ally.boost > 0) { ally.boost -= dt; if (ally.boost <= 0) { ally.boost = 0; ally.weapon.level = ally.baseLevel; } }
			if (this.firing && !b.down && !b.busy) this.asAlly(() => updateWeapon(this, dt)); else ally.beam.on = false;
			this.runRevive(dt);
		}
		this.moveShots(dt);
		this.acting = 0;
		const frozen = this.freeze > 0;
		this.freeze = Math.max(0, this.freeze - dt);
		if (!frozen) { this.director.update(dt); this.moveBullets(dt); }
		if (this.laser > 0) { this.acting = this.laserBy; this.runLaser(dt); }
		if (this.wall.left > 0) this.runWall(dt);
		if (this.scan.on) { this.acting = this.scanBy; this.runScan(dt); }
		this.acting = 0;
		if (this.boost > 0) { this.boost -= dt; if (this.boost <= 0) { this.boost = 0; this.weapon.level = this.baseLevel; } }
		if (this.novaIn > 0) { this.novaIn -= dt; if (this.novaIn <= 0) { this.novaIn = 0; this.acting = this.novaBy; this.detonate(); this.acting = 0; } }
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
	/** One of the two is struck (0 the main player, 1 the supporter). At zero health a stored backup brings them back;
	 *  otherwise they fall and wait for the other to revive them, and when nobody is left standing the stage is lost. */
	hurt(who: number) {
		const a = this.ally, p = who === 1 ? a?.body : this.player;
		if (!p || p.down || p.invuln > 0 || this.godMode || this.over) return;
		p.hp--; p.invuln = P.invulnerable;
		this.events.push(who === 1 ? { type: 'allyHit', hp: p.hp } : { type: 'playerHit', hp: p.hp });
		if (p.hp > 0) return;
		const backups = who === 1 ? a!.backups : this.backups;
		if (backups > 0) {                                                         // the backup restores what was lost: two hearts, a moment of safety, a clear screen
			if (who === 1) a!.backups--; else this.backups--;
			p.hp = Math.min(p.maxHp, 2); p.invuln = 3; p.bubble = 3;
			this.clearFire();
			this.events.push({ type: 'revived', who });
			return;
		}
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
			weapon: { id: weapon, level, cool: 0.6, queue: [], hitTick: 0 }, beam: { on: false, z: 0, x0: 0, x1: 0, width: 0 }, boost: 0, baseLevel: level, backups: 0 };
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
	/** The supporter changed or upgraded their weapon on their own device. A running security update stays on top. */
	setAllyWeapon(id: WeaponId, level: number) {
		const a = this.ally;
		if (!a) return;
		if (a.weapon.id !== id) { a.weapon.id = id; a.weapon.queue = []; a.weapon.cool = 0.4; a.beam.on = false; }
		a.baseLevel = level; a.weapon.level = a.boost > 0 ? Math.min(5, level + 1) : level;
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
		if ((this.acting === 1 ? this.ally?.boost ?? 0 : this.boost) > 0) amount *= 1.3;   // the security update of whoever struck
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

	// ------------------------------------------------------------------ emergency powers
	/** Damage that no plate or shield reduces. */
	private strike(e: Enemy, amount: number) { const g = e.guard; e.guard = 1; this.flat = true; this.damage(e, amount, this.weapon.id, e.x, e.z, true); this.flat = false; e.guard = g; }
	private flat = false;
	/** Uses one power now. The game decides whether the player has one; this only says what it does. */
	usePower(id: PowerId, by = 0) {
		if (this.over) return;
		const a = by === 1 ? this.ally : null, p = a ? a.body : this.player;
		if (p.down) return;
		this.events.push({ type: 'power', power: id, x: p.x, z: p.z });
		const before = this.acting;
		this.acting = a ? 1 : 0;
		try { this.power(id, a, p); } finally { this.acting = before; }
	}
	private power(id: PowerId, a: Ally | null, p: Body) {
		switch (id) {
			case 'bomb': case 'mega':                                                // clears the screen of fire and small malware, and wounds a boss
				this.clearFire();
				for (const e of this.targets()) {
					if (e.kind === 'crate') continue;
					this.strike(e, e.kind === 'boss' ? e.maxHp * (id === 'mega' ? 0.25 : 0.1) : e.kind === 'turret' ? e.maxHp * (id === 'mega' ? 1 : 0.6) : 1e9);
				}
				if (id === 'mega') { p.invuln = Math.max(p.invuln, 2.5); p.bubble = Math.max(p.bubble, 2.5); }
				break;
			case 'aware':                                                            // everything stands still while it gathers, then the blast
				this.freeze = Math.max(this.freeze, World.NOVA_DELAY + 0.2); this.novaIn = World.NOVA_DELAY; this.novaBy = a ? 1 : 0;
				p.invuln = Math.max(p.invuln, 4); p.bubble = Math.max(p.bubble, 4);
				break;
			case 'laser': this.laser = 3; this.laserBy = a ? 1 : 0; break;
			case 'wall': this.wall = { left: 6, x: Math.min(ARENA.playerMaxX + 1.6, p.x + 2.6) }; break;
			case 'scan': this.scan = { on: true, x: ARENA.length + 1, seen: new Set() }; this.scanBy = a ? 1 : 0; break;
			case 'update': if (a) { a.boost = 8; a.weapon.level = Math.min(5, a.baseLevel + 1); } else { this.boost = 8; this.weapon.level = Math.min(5, this.baseLevel + 1); } break;
			case 'backup': break;                                                    // it is not pressed: it works by itself when health runs out
			case 'freeze': this.freeze = 5; break;
			case 'guard': p.hp = Math.min(p.maxHp, p.hp + 1); p.invuln = Math.max(p.invuln, 6); p.bubble = 6; break;
		}
	}
	/** Sets the level of the weapon in hand (an upgrade in the middle of a fight). A running security update stays on top of it. */
	setWeaponLevel(level: number) { this.baseLevel = level; this.weapon.level = this.boost > 0 ? Math.min(5, level + 1) : level; }
	/** Gives hearts back, never above the maximum. Returns how many were really added. */
	heal(hearts: number, who = 0) { const p = who === 1 && this.ally ? this.ally.body : this.player, before = p.hp; if (p.down) return 0; p.hp = Math.min(p.maxHp, p.hp + hearts); return p.hp - before; }
	/** The firewall: enemy fire that reaches the line is stopped there. */
	private runWall(dt: number) {
		this.wall.left = Math.max(0, this.wall.left - dt);
		const x = this.wall.x, stopped = this.bullets.filter(b => b.x <= x + 0.15 && b.x > x - 1.2);
		if (!stopped.length) return;
		this.events.push({ type: 'fizz', points: stopped.slice(0, 30).flatMap(b => [x, b.z]) });
		this.bullets = this.bullets.filter(b => !stopped.includes(b));
	}
	/** The antivirus scan: a line that sweeps from the top of the field to the bottom. Everything it passes is struck once
	 *  (small malware is removed, a boss loses an eighth), and the enemy fire it passes is erased. */
	static readonly SCAN_SPEED = 9;
	private runScan(dt: number) {
		const s = this.scan, from = s.x;
		s.x -= World.SCAN_SPEED * dt;
		this.bullets = this.bullets.filter(b => !(b.x <= from && b.x >= s.x));
		for (const e of this.targets()) {
			if (e.kind === 'crate' || s.seen.has(e.id) || e.x < s.x - e.r || e.x > from + e.r) continue;
			s.seen.add(e.id);
			this.strike(e, e.kind === 'boss' ? e.maxHp * 0.125 : e.kind === 'turret' ? e.maxHp * 0.6 : 1e9);
		}
		if (s.x < -1) s.on = false;
	}
	/** How long Cyber needs to fly up and drop the bomb before it goes off. */
	static readonly NOVA_DELAY = 1.3;
	/** Total Awareness goes off: nothing small survives, no enemy fire remains, and a boss loses two fifths of its health
	 *  whatever shield it holds. */
	private detonate() {
		this.clearFire();
		this.events.push({ type: 'nova', x: ARENA.length / 2, z: 0 });
		for (const e of this.targets()) {
			if (e.kind === 'crate') continue;
			this.strike(e, e.kind === 'boss' ? e.maxHp * 0.4 : 1e9);
		}
	}
	/** The laser wave: a wide column of light ahead of the player that erases enemy fire and burns whatever stands in it. */
	static readonly LASER_HALF = 1.7;
	private runLaser(dt: number) {
		this.laser = Math.max(0, this.laser - dt);
		const p = this.laserBy === 1 && this.ally ? this.ally.body : this.player, half = World.LASER_HALF;
		this.bullets = this.bullets.filter(b => !(b.x > p.x - 0.4 && Math.abs(b.z - p.z) < half));
		for (const e of this.targets()) if (e.x > p.x && Math.abs(e.z - p.z) < half + e.r) this.strike(e, (e.kind === 'boss' ? e.maxHp * 0.07 : e.kind === 'crate' ? e.maxHp * 0.5 : e.maxHp * 2.5) * dt);
	}
	explode(x: number, z: number, radius: number, dmg: number, weapon: WeaponId, except: Enemy | null) {
		this.events.push({ type: 'explode', x, z, radius, weapon });
		for (const e of this.targets()) if (e !== except && Math.hypot(e.x - x, e.z - z) < radius + e.r) this.damage(e, dmg, weapon, e.x, e.z, true);
	}

	// ------------------------------------------------------------------ projectiles
	private moveShots(dt: number) {
		const list = this.targets();
		for (const s of this.shots) {
			this.acting = s.owner ?? 0;
			s.age += dt; s.life -= dt;
			if (s.kind === 'missile') {
				if (!s.target || s.target.dead || s.target.mode === 'leave') s.target = nearest(list, s.x, s.z);
				if (s.target) {
					const want = Math.atan2(s.target.z - s.z, s.target.x - s.x), now = Math.atan2(s.vz, s.vx);
					let d = want - now; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
					const a = now + Math.max(-s.turn * dt, Math.min(s.turn * dt, d)), v = Math.min(13, Math.hypot(s.vx, s.vz) + 14 * dt);
					s.vx = Math.cos(a) * v; s.vz = Math.sin(a) * v;
				}
			}
			if (s.loop) { this.flyShield(s, list); continue; }
			s.x += s.vx * dt; s.z += s.vz * dt;
			if (s.kind === 'wave') {                                                  // a wide front that passes through: each enemy is struck once
				for (const e of list) if (!e.dead && !s.seen!.has(e.id) && Math.abs(e.x - s.x) < 0.45 + e.r && Math.abs(e.z - s.z) < s.radius + e.r) { s.seen!.add(e.id); this.damage(e, s.dmg, s.weapon, e.x, e.z); }
				if (s.x > ARENA.length + 1.5) s.life = -1;
				continue;
			}
			let hit: Enemy | null = null;
			for (const e of list) if (!e.dead && !s.seen?.has(e.id) && Math.hypot(e.x - s.x, e.z - s.z) < e.r + s.r) { hit = e; break; }
			if (hit && s.kind === 'disc') {                                           // strike, then jump to the nearest enemy not yet struck
				this.damage(hit, s.dmg, s.weapon, s.x, s.z);
				if (s.splash > 0) this.explode(s.x, s.z, s.radius, s.splash, s.weapon, hit);
				s.seen!.add(hit.id);
				const next = s.bounces > 0 ? nearest(list.filter(e => !s.seen!.has(e.id)), s.x, s.z, undefined, 9) : null;
				if (!next) { s.life = -1; continue; }
				s.bounces--; s.dmg *= 0.82; s.target = next; s.life = Math.max(s.life, 1.2);
				const a = Math.atan2(next.z - s.z, next.x - s.x);
				s.vx = Math.cos(a) * 16; s.vz = Math.sin(a) * 16;
				this.events.push({ type: 'bounce', x0: s.x, z0: s.z, x1: next.x, z1: next.z });
				continue;
			}
			if (hit) {
				this.damage(hit, s.dmg, s.weapon, s.x, s.z);
				if (s.kind === 'plasma') this.burst(s, hit);
				else if (s.splash > 0) this.explode(s.x, s.z, s.radius, s.splash, s.weapon, hit);
				s.life = -1;
			} else if (s.life <= 0 && s.kind === 'plasma') this.burst(s, null);
			if (s.x > ARENA.length + 1.5 || s.x < -1 || Math.abs(s.z) > World.SIDE) s.life = -1;
		}
		this.shots = this.shots.filter(s => s.life > 0);
	}
	/** The Cyber Shield in flight: out along a loop and back to the player, through everything. It strikes each enemy once
	 *  on the way out and once on the way back. */
	private flyShield(s: Shot, list: Enemy[]) {
		const L = s.loop!, p = s.owner === 1 && this.ally ? this.ally.body : this.player, u = Math.min(1, s.age / L.time);
		const px = s.x, pz = s.z;
		s.x = p.x + 0.9 + L.reach * Math.sin(Math.PI * u);
		s.z = Math.max(-ARENA.halfWidth - 0.6, Math.min(ARENA.halfWidth + 0.6, p.z + L.side * L.spread * Math.sin(2 * Math.PI * u)));
		s.vx = s.x - px; s.vz = s.z - pz;
		const half = u < 0.5 ? 0 : 1e6;                                             // the same enemy may be struck again on the way back
		for (const e of list) if (!e.dead && !s.seen!.has(e.id + half) && Math.hypot(e.x - s.x, e.z - s.z) < e.r + s.r) { s.seen!.add(e.id + half); this.damage(e, s.dmg, s.weapon, s.x, s.z); }
		if (u >= 1) { s.life = -1; if (s.second > 0) this.explode(p.x + 0.9, p.z, 2.6, s.second, s.weapon, null); }
	}
	/** A plasma ball going off: area damage, then (at higher levels) shards and a second, smaller blast. */
	private burst(s: Shot, hit: Enemy | null) {
		this.explode(s.x, s.z, s.radius, s.splash, s.weapon, hit);
		for (let i = 0; i < s.shards; i++) {
			const a = (i - (s.shards - 1) / 2) * 0.5;
			this.shots.push({ id: this.id(), kind: 'shard', weapon: s.weapon, x: s.x, z: s.z, vx: Math.cos(a) * 12, vz: Math.sin(a) * 12, dmg: s.dmg * 0.16, r: 0.16, life: 0.5,
				target: null, turn: 0, splash: 0, radius: 0, shards: 0, second: 0, age: 0, seen: null, bounces: 0, loop: null });
		}
		if (s.second > 0) this.blasts.push({ x: s.x, z: s.z, radius: s.radius * 0.75, dmg: s.second, weapon: s.weapon, at: this.t + 0.32, owner: s.owner });
	}
	private moveBullets(dt: number) {
		for (const b of this.bullets) {
			b.x += b.vx * dt; b.z += b.vz * dt;
			if (this.touches(b.x, b.z, b.r)) { this.hurt(0); b.x = -99; }
			else if (this.ally && this.near(this.ally.body, b.x, b.z, b.r)) { this.hurt(1); b.x = -99; }
		}
		this.bullets = this.bullets.filter(b => b.x > -1.6 && b.x < ARENA.length + 3 && Math.abs(b.z) < World.SIDE);
		const p = this.player, q = this.ally?.body;
		for (const z of this.zones) {
			if (z.warn > 0) { z.warn -= dt; if (z.warn <= 0) this.events.push({ type: 'zone' }); continue; }
			z.live -= dt;
			if (!p.down && p.x > z.x0 && p.x < z.x1 && p.z > z.z0 && p.z < z.z1) this.hurt(0);
			if (q && !q.down && q.x > z.x0 && q.x < z.x1 && q.z > z.z0 && q.z < z.z1) this.hurt(1);
		}
		this.zones = this.zones.filter(z => z.warn > 0 || z.live > 0);
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
	/** One enemy bullet. `angle` is measured from straight down the screen, positive toward +z. */
	shoot(x: number, z: number, angle: number, speed: number, kind: Bullet['kind'] = 'orb') {
		if (this.bullets.length > 260) return;
		this.bullets.push({ id: this.id(), kind, x, z, vx: -Math.cos(angle) * speed, vz: Math.sin(angle) * speed, r: kind === 'shard' ? 0.14 : 0.17 });
	}
	/** Whom enemy fire is aimed at: the one still standing, or each in turn every few seconds when both are. */
	prey(): Body { const p = this.player, q = this.ally?.body; if (!q || q.down) return p; if (p.down) return q; return Math.floor(this.t / 2.5) % 2 ? q : p; }
	aim(x: number, z: number) { const p = this.prey(); return Math.atan2(p.z - z, x - p.x); }
	fan(x: number, z: number, count: number, spread: number, speed: number, centre: number, kind: Bullet['kind'] = 'orb') {
		for (let i = 0; i < count; i++) this.shoot(x, z, centre + (count === 1 ? 0 : (i / (count - 1) - 0.5) * spread), speed, kind);
		this.events.push({ type: 'enemyFire', x, z });
	}
	/** A row across the arena moving down, with one gap wide enough to pass. */
	row(x: number, gapZ: number, gapWidth: number, speed: number, kind: Bullet['kind'] = 'shard') {
		for (let z = -ARENA.halfWidth + 0.3; z <= ARENA.halfWidth - 0.3; z += kind === 'code' ? 0.74 : 0.62) if (Math.abs(z - gapZ) > gapWidth / 2) this.shoot(x, z, 0, speed, kind);
		this.events.push({ type: 'enemyFire', x, z: gapZ });
	}
	/** A ring from a point, with a gap of `gap` bullets starting at index `open`. */
	ring(x: number, z: number, count: number, speed: number, offset: number, open: number, gap: number, kind: Bullet['kind'] = 'orb') {
		for (let i = 0; i < count; i++) { const k = (i - open + count) % count; if (k < gap) continue; this.shoot(x, z, offset + i / count * Math.PI * 2, speed, kind); }
		this.events.push({ type: 'enemyFire', x, z });
	}
	zone(x0: number, z0: number, x1: number, z1: number, warn = 1, live = 0.45) { this.zones.push({ id: this.id(), x0, z0, x1, z1, warn, live, total: warn }); }
}

export function nearest(list: Enemy[], x: number, z: number, skip?: Set<Enemy>, maxDist = Infinity): Enemy | null {
	let best: Enemy | null = null, bd = maxDist;
	for (const e of list) { if (e.dead || skip?.has(e)) continue; const d = Math.hypot(e.x - x, e.z - z) - e.r; if (d < bd) { bd = d; best = e; } }
	return best;
}
