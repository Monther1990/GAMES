// The special skills of part 2 (pure: no rendering). One-use powers won from Cyber boxes. None of them is a blast that
// clears the screen, as most of part 1's were: each changes the fight in its own way for a few seconds, or strikes
// chosen targets. Total Awareness ('aware') keeps its rules and has a new show, the Sunrise of Awareness.
// The world calls in here through a few small hooks (see world.ts: usePower, step, hurt, damage, shoot, prey, aim,
// moveBullets). Everything the screen needs is kept in one plain object, PowerState, so the supporter's device can be
// sent it and draw the same picture.
import eco from '../data/economy.json';
import type { Body, Bullet, Enemy, World } from './world';

const A = eco.arena;

export type PowerId = 'rain' | 'falcon' | 'mirror' | 'mute' | 'report' | 'guards' | 'armor' | 'private' | 'bolt' | 'aware';
/** What an ordinary box may hold. Total Awareness ('aware') comes only from the rare black box. */
export const POWERS: PowerId[] = ['rain', 'mirror', 'mute', 'report', 'armor', 'private', 'guards', 'falcon', 'bolt'];
/** The first stage (0-based) in whose boxes each power may appear: the ones that strike hardest come later. */
export const POWER_FROM: Partial<Record<PowerId, number>> = { guards: 1, falcon: 1, bolt: 2 };
/** Every id a save may hold. */
export const POWER_IDS: PowerId[] = [...POWERS, 'aware'];

/** The numbers of every power, in one place. Shares are of an enemy's full health. No ordinary power takes more of a
 *  boss than a quarter (what part 1's strongest took); Total Awareness takes two fifths. */
export const TUNE = {
	rain: { time: 5, tick: 0.25, small: 0.04, turret: 0.03, boss: 0.005, slow: 0.55 },   // 20 drops of damage: four fifths of a small enemy, a tenth of a boss
	falcon: { half: 1.5, speed: 24, small: 0.75, turret: 0.5, boss: 0.07, from: -3, top: A.length + 4 },   // per pass, and it passes twice
	mirror: { time: 5, reach: 2.3, speed: 10, boss: 0.12 },                             // a returned shot is worth one small enemy; all of them together never more than this share of a boss
	mute: { time: 6 },
	report: { time: 8, small: 2, boss: 1.5 },
	guards: { time: 10, every: 0.5, speed: 17, life: 1.5, side: 1.15, ahead: 0.35, boss: 0.004 },   // each shot is worth half a small enemy
	armor: { plates: 3, grace: 0.9 },
	private: { time: 6 },
	bolt: { count: 5, delay: 0.45, boss: 0.15 },
	aware: { boss: 0.4, speed: 15, from: -1.5, to: A.length + 2.5, safe: 5 }
};
/** How long the wall of light of Total Awareness needs to cross the field. */
export const DAWN_TIME = (TUNE.aware.to - TUNE.aware.from) / TUNE.aware.speed;

/** A shot of light from an identity guard. */
export interface Dart { id: number; x: number; z: number; vx: number; vz: number; life: number; by: number; target: number }
/** A lightning strike that is about to fall: where (it follows its target), and in how many seconds. */
export interface Strike { id: number; x: number; z: number; in: number; by: number; e: Enemy | null }
export interface PowerState {
	/** Khareef Rain: seconds left, the wait until the next drop of damage, and who called it. */
	rain: number; rainTick: number; rainBy: number;
	/** Falcon Dive: where the falcon is, its lane (z), which way it flies (1 up, -1 back down), whom it struck on this pass. */
	falcon: { on: boolean; x: number; z: number; dir: number; by: number; seen: Set<number> };
	/** Rumour Mirror: seconds left, who raised it, how much of the boss it has taken, and the shots turned this frame. */
	mirror: number; mirrorBy: number; mirrorBoss: number; turned: number[];
	/** Mute: seconds left. */
	mute: number;
	/** Report: seconds left, who is marked, and by whom (nobody is credited through it: it only multiplies). */
	report: number; marked: Set<number>;
	/** Identity Guards: seconds left for each fighter, the wait of each of their two lights, and the shots in the air. */
	guards: [number, number]; guardCool: number[]; darts: Dart[];
	/** Identity Shield: plates left around each fighter. */
	armor: [number, number];
	/** Private Account: seconds left for each fighter, and where each was last seen. */
	hidden: [number, number]; ghost: [Body | null, Body | null];
	/** Mountain Lightning: the strikes about to fall. */
	bolts: Strike[];
	/** Sunrise of Awareness: the wall of light crossing the field after the sun has risen (the rise is World.novaIn). */
	dawn: { on: boolean; x: number; by: number; seen: Set<number> };
}
export function blankPowers(): PowerState {
	return { rain: 0, rainTick: 0, rainBy: 0, falcon: { on: false, x: 0, z: 0, dir: 1, by: 0, seen: new Set() }, mirror: 0, mirrorBy: 0, mirrorBoss: 0, turned: [],
		mute: 0, report: 0, marked: new Set(), guards: [0, 0], guardCool: [0, 0, 0, 0], darts: [], armor: [0, 0], hidden: [0, 0], ghost: [null, null], bolts: [],
		dawn: { on: false, x: 0, by: 0, seen: new Set() } };
}

const foes = (w: World) => w.targets().filter(e => e.kind !== 'crate');
const bodyOf = (w: World, who: number) => (who === 1 && w.ally ? w.ally.body : w.player);
/** Strikes in the name of whoever used the power, whatever else is going on in the step. */
function hit(w: World, e: Enemy, amount: number, by: number) { const before = w.acting; w.acting = by; try { w.strike(e, amount); } finally { w.acting = before; } }
/** What one small enemy of this stage can take: the measure of shots that are not shares of health. */
const smallHp = (w: World) => eco.enemy.normal.hp * w.stage.enemyHp * w.hard.hp;

/** Where the two lights of a fighter's identity guards fly (the screen adds their bobbing). */
export function guardSpot(b: { x: number; z: number }, i: number) { return { x: b.x + TUNE.guards.ahead, z: b.z + (i ? TUNE.guards.side : -TUNE.guards.side) }; }

/** The lane the falcon takes: over the boss when there is one, else where most enemies stand (the nearer to whoever
 *  called it when two lanes are equal), kept inside the field. */
export function falconLane(w: World, p: Body) {
	const list = foes(w), half = TUNE.falcon.half, edge = A.halfWidth - half * 0.6;
	const keep = (z: number) => Math.max(-edge, Math.min(edge, z));
	if (w.boss && !w.boss.dead) return keep(w.boss.z);
	let best = keep(p.z), most = 0;
	for (const c of list) {
		const z = keep(c.z), n = list.filter(e => Math.abs(e.z - z) < half + e.r).length;
		if (n > most || (n === most && Math.abs(z - p.z) < Math.abs(best - p.z))) { most = n; best = z; }
	}
	return best;
}

/** One power begins. `by` is 0 for the main player and 1 for the supporter; `p` is that fighter. */
export function startPower(w: World, id: PowerId, by: number, p: Body) {
	const s = w.pw;
	switch (id) {
		case 'rain': s.rain = TUNE.rain.time; s.rainTick = TUNE.rain.tick; s.rainBy = by; break;
		case 'falcon': s.falcon = { on: true, x: TUNE.falcon.from, z: falconLane(w, p), dir: 1, by, seen: new Set() }; break;
		case 'mirror': s.mirror = TUNE.mirror.time; s.mirrorBy = by; s.mirrorBoss = 0; break;
		case 'mute': s.mute = TUNE.mute.time; break;
		case 'report': s.report = TUNE.report.time; s.marked = new Set(foes(w).map(e => e.id)); break;
		case 'guards': s.guards[by] = TUNE.guards.time; s.guardCool[by * 2] = 0.15; s.guardCool[by * 2 + 1] = 0.15 + TUNE.guards.every / 2; break;
		case 'armor': p.hp = Math.min(p.maxHp, p.hp + 1); s.armor[by] = TUNE.armor.plates; break;
		case 'private': s.hidden[by] = TUNE.private.time; s.ghost[by] = { ...p }; break;
		case 'bolt': {
			// the five strongest: a boss is always one of them, then whoever has most health left
			const list = foes(w).sort((a, b) => (a.kind === 'boss' ? -1 : b.kind === 'boss' ? 1 : b.hp - a.hp)).slice(0, TUNE.bolt.count);
			for (const e of list) s.bolts.push({ id: e.id, x: e.x, z: e.z, in: TUNE.bolt.delay, by, e });
			break;
		}
		case 'aware':                                                            // the fight stands still while the sun rises and the light crosses the field
			w.freeze = Math.max(w.freeze, NOVA_DELAY + DAWN_TIME + 0.2); w.novaIn = NOVA_DELAY;
			s.dawn = { on: false, x: TUNE.aware.from, by, seen: new Set() };
			p.invuln = Math.max(p.invuln, TUNE.aware.safe); p.bubble = Math.max(p.bubble, TUNE.aware.safe);
			break;
	}
}
/** How long the sun of Total Awareness needs to rise before its light sets off across the field. */
export const NOVA_DELAY = 1.5;

/** One step of everything that lasts. Called once per step of the world, also while Total Awareness holds the fight still. */
export function runPowers(w: World, dt: number) {
	const s = w.pw;
	// Khareef Rain: a little damage to every enemy several times a second (the slowing is slowOf, below)
	if (s.rain > 0) {
		s.rain = Math.max(0, s.rain - dt); s.rainTick -= dt;
		if (s.rainTick <= 0) {
			s.rainTick += TUNE.rain.tick;
			for (const e of foes(w)) hit(w, e, e.maxHp * (e.kind === 'boss' ? TUNE.rain.boss : e.kind === 'turret' ? TUNE.rain.turret : TUNE.rain.small), s.rainBy);
		}
	}
	// Falcon Dive: up the lane, round, and back down it; everything in the lane is struck once on each pass
	const f = s.falcon;
	if (f.on) {
		const from = f.x, T = TUNE.falcon;
		f.x += f.dir * T.speed * dt;
		const lo = Math.min(from, f.x) - 0.7, hi = Math.max(from, f.x) + 0.7;
		for (const e of foes(w)) {
			if (f.seen.has(e.id) || e.x < lo - e.r || e.x > hi + e.r || Math.abs(e.z - f.z) > T.half + e.r) continue;
			f.seen.add(e.id);
			hit(w, e, e.maxHp * (e.kind === 'boss' ? T.boss : e.kind === 'turret' ? T.turret : T.small), f.by);
		}
		if (f.dir > 0 && f.x >= T.top) { f.dir = -1; f.seen = new Set(); }
		else if (f.dir < 0 && f.x <= T.from) f.on = false;
	}
	if (s.mirror > 0) s.mirror = Math.max(0, s.mirror - dt);
	if (s.turned.length) { w.events.push({ type: 'turned', points: s.turned.slice(0, 40) }); s.turned = []; }
	if (s.mute > 0) s.mute = Math.max(0, s.mute - dt);
	if (s.report > 0) { s.report = Math.max(0, s.report - dt); if (s.report <= 0) s.marked = new Set(); }
	// Identity Guards: two lights beside their fighter, each firing at whoever is nearest to it
	for (const who of [0, 1]) {
		if (s.guards[who] <= 0) continue;
		const b = who === 1 ? w.ally?.body : w.player;
		if (!b) { s.guards[who] = 0; continue; }
		s.guards[who] = Math.max(0, s.guards[who] - dt);
		if (b.down || b.busy) continue;                                            // they wait with their fighter
		const list = foes(w);
		for (const i of [0, 1]) {
			const k = who * 2 + i;
			s.guardCool[k] -= dt;
			if (s.guardCool[k] > 0) continue;
			const at = guardSpot(b, i), e = closest(list, at.x, at.z);
			if (!e) { s.guardCool[k] = 0.1; continue; }
			s.guardCool[k] = TUNE.guards.every;
			const d = Math.hypot(e.x - at.x, e.z - at.z) || 1, v = TUNE.guards.speed;
			s.darts.push({ id: w.id(), x: at.x, z: at.z, vx: (e.x - at.x) / d * v, vz: (e.z - at.z) / d * v, life: TUNE.guards.life, by: who, target: e.id });
		}
	}
	if (s.darts.length) {
		const list = foes(w), dmg = smallHp(w) * 0.5;
		for (const d of s.darts) {
			d.life -= dt;
			const t = list.find(e => e.id === d.target && !e.dead);
			if (t) { const k = Math.hypot(t.x - d.x, t.z - d.z) || 1, v = TUNE.guards.speed; d.vx = (t.x - d.x) / k * v; d.vz = (t.z - d.z) / k * v; }   // it follows the one it was sent after
			d.x += d.vx * dt; d.z += d.vz * dt;
			const e = list.find(e => !e.dead && Math.hypot(e.x - d.x, e.z - d.z) < e.r + 0.22);
			if (e) { hit(w, e, (e.kind === 'boss' ? Math.min(dmg, e.maxHp * TUNE.guards.boss) : dmg) * markOf(w, e), d.by); d.life = -1; w.events.push({ type: 'dart', x: d.x, z: d.z }); }
		}
		s.darts = s.darts.filter(d => d.life > 0 && d.x < A.length + 2 && d.x > -2);
	}
	for (const who of [0, 1]) if (s.hidden[who] > 0) { s.hidden[who] = Math.max(0, s.hidden[who] - dt); if (s.hidden[who] <= 0) s.ghost[who] = null; }
	// Mountain Lightning: each strike follows its target until it falls
	for (const b of s.bolts) {
		if (b.e && !b.e.dead) { b.x = b.e.x; b.z = b.e.z; }
		b.in -= dt;
		if (b.in > 0) continue;
		const e = b.e, boss = e?.kind === 'boss';
		w.events.push({ type: 'thunder', x: b.x, z: b.z, big: !!boss });
		if (e && !e.dead) hit(w, e, boss ? e.maxHp * TUNE.bolt.boss : 1e9, b.by);
	}
	if (s.bolts.length) s.bolts = s.bolts.filter(b => b.in > 0);
	// Sunrise of Awareness: the sun rises (novaIn), then a wall of light crosses the field from the bottom to the top.
	// Small enemies and enemy fire are taken as it passes, a boss loses two fifths when it is reached, and the last
	// flash ('nova') comes when the light leaves the top of the field.
	const d = s.dawn;
	if (w.novaIn > 0) { w.novaIn -= dt; if (w.novaIn <= 0) { w.novaIn = 0; d.on = true; d.x = TUNE.aware.from; w.zones = []; w.events.push({ type: 'dawn' }); } }
	if (d.on) {
		d.x += TUNE.aware.speed * dt;
		const gone = w.bullets.filter(b => b.x <= d.x);
		if (gone.length) { w.events.push({ type: 'fizz', points: gone.slice(0, 30).flatMap(b => [b.x, b.z]) }); w.bullets = w.bullets.filter(b => b.x > d.x); }
		const last = d.x >= TUNE.aware.to;
		for (const e of foes(w)) {
			if (d.seen.has(e.id) || (!last && e.x - e.r * 0.5 > d.x)) continue;
			d.seen.add(e.id);
			hit(w, e, e.kind === 'boss' ? e.maxHp * TUNE.aware.boss : 1e9, d.by);
		}
		if (last) { d.on = false; w.clearFire(); w.events.push({ type: 'nova', x: A.length / 2, z: 0 }); }
	}
}
function closest(list: Enemy[], x: number, z: number): Enemy | null {
	let best: Enemy | null = null, bd = Infinity;
	for (const e of list) { if (e.dead) continue; const d = Math.hypot(e.x - x, e.z - z) - e.r; if (d < bd) { bd = d; best = e; } }
	return best;
}

// ------------------------------------------------------------------ the hooks the world calls
/** Khareef Rain: how fast enemies move and act while it rains (1 when it does not). */
export function slowOf(w: World) { return w.pw.rain > 0 ? TUNE.rain.slow : 1; }
/** Report: how much harder a marked enemy is struck. */
export function markOf(w: World, e: Enemy) { const s = w.pw; return s.report > 0 && s.marked.has(e.id) ? (e.kind === 'boss' ? TUNE.report.boss : TUNE.report.small) : 1; }
/** Mute: no enemy can fire. */
export function muted(w: World) { return w.pw.mute > 0; }
/** Mute: the muzzle flashes of shots that were never fired are taken back (events added since `from`). */
export function hush(w: World, from: number) { for (let i = w.events.length - 1; i >= from; i--) if (w.events[i].type === 'enemyFire') w.events.splice(i, 1); }
/** Identity Shield: a plate takes the hit instead of a heart. True when one did. */
export function plateTakes(w: World, who: number, p: Body) {
	const s = w.pw;
	if (s.armor[who] <= 0) return false;
	s.armor[who]--;
	p.invuln = Math.max(p.invuln, TUNE.armor.grace);                           // a breath, so one cluster of shots does not take every plate at once
	w.events.push({ type: 'plate', who, left: s.armor[who], x: p.x, z: p.z });
	return true;
}
/** Private Account: can the enemies see this fighter? */
const seen = (w: World, who: number) => w.pw.hidden[who] <= 0;
/** Private Account: true when nobody who is standing can be seen. Aimed shots then go straight down, and seeking
 *  shots lose their prey. */
export function unseen(w: World) {
	const p = w.player, q = w.ally?.body;
	const a = !p.down && seen(w, 0), b = !!q && !q.down && seen(w, 1);
	if (a || b) return false;
	return (!p.down && !seen(w, 0)) || (!!q && !q.down && !seen(w, 1));
}
/** Whom enemy fire is aimed at: the one still standing, or each in turn every few seconds when both are. A fighter
 *  with a private account is not chosen while the other can be seen; when nobody can be seen, the enemies are given
 *  the place where their prey was last seen (lobbed shots land there). */
export function preyOf(w: World): Body {
	const p = w.player, q = w.ally?.body, s = w.pw;
	if (!q || q.down) return (seen(w, 0) ? p : s.ghost[0]) ?? p;
	if (p.down) return (seen(w, 1) ? q : s.ghost[1]) ?? q;
	if (seen(w, 0) !== seen(w, 1)) return seen(w, 0) ? p : q;
	const who = Math.floor(w.t / 2.5) % 2;
	return (seen(w, who) ? (who ? q : p) : s.ghost[who]) ?? (who ? q : p);
}
/** Rumour Mirror, for one enemy shot in one step. A shot that has been turned flies back and strikes the enemy it
 *  touches; one that comes near a standing fighter while the mirror is up is turned. True when the shot was dealt
 *  with here (the world then leaves it alone for this step). */
export function mirrored(w: World, b: Bullet, dt: number) {
	const s = w.pw, T = TUNE.mirror;
	if (b.back) {
		b.x += b.vx * dt; b.z += b.vz * dt;
		for (const e of foes(w)) {
			if (e.dead || Math.hypot(e.x - b.x, e.z - b.z) > e.r + b.r) continue;
			let dmg = smallHp(w) * markOf(w, e);
			if (e.kind === 'boss') { dmg = Math.min(dmg, e.maxHp * T.boss - s.mirrorBoss); s.mirrorBoss += Math.max(0, dmg); }
			if (dmg > 0) hit(w, e, dmg, b.back - 1);
			w.events.push({ type: 'dart', x: b.x, z: b.z });
			b.x = -99;
			break;
		}
		return true;
	}
	if (s.mirror <= 0) return false;
	const p = w.player, q = w.ally?.body;
	const near = (o: Body | undefined) => !!o && !o.down && Math.hypot(o.x - b.x, o.z - b.z) < T.reach + b.r;
	if (!near(p) && !near(q)) return false;
	// back to whoever sent it: toward the nearest enemy, or straight up the field when there is none
	const e = closest(foes(w), b.x, b.z), v = Math.max(T.speed, Math.hypot(b.vx, b.vz) * 1.5), d = e ? Math.hypot(e.x - b.x, e.z - b.z) || 1 : 1;
	b.vx = e ? (e.x - b.x) / d * v : v; b.vz = e ? (e.z - b.z) / d * v : 0;
	b.back = s.mirrorBy + 1; b.fly = undefined; b.hot = 0;
	s.turned.push(b.x, b.z);
	return true;
}

// ------------------------------------------------------------------ what the supporter's device is sent
const r2 = (n: number) => Math.round(n * 100) / 100;
/** The powers as plain numbers, small enough to travel with every picture of the fight. */
export interface PowerPack { f: number[]; d: number[][]; b: number[][]; m: number[]; r: number[] }
export function packPowers(w: World): PowerPack {
	const s = w.pw, f = s.falcon;
	return {
		f: [r2(s.rain), f.on ? f.dir : 0, r2(f.x), r2(f.z), r2(s.mirror), r2(s.mute), r2(s.report), r2(s.guards[0]), r2(s.guards[1]), s.armor[0], s.armor[1], r2(s.hidden[0]), r2(s.hidden[1]), s.dawn.on ? 1 : 0, r2(s.dawn.x), s.dawn.by],
		d: s.darts.map(d => [d.id, r2(d.x), r2(d.z), r2(d.vx), r2(d.vz), d.by]),
		b: s.bolts.map(b => [b.id, r2(b.x), r2(b.z), r2(b.in)]),
		m: s.report > 0 ? [...s.marked] : [],
		r: w.bullets.filter(b => b.back).map(b => b.id)
	};
}
/** Takes a pack into the state the supporter's device keeps, and marks the returned shots among `bullets`. */
export function unpackPowers(s: PowerState, k: PowerPack | undefined, bullets: Bullet[]) {
	if (!k) return;
	const f = k.f;
	s.rain = f[0]; s.falcon.on = f[1] !== 0; s.falcon.dir = f[1] || 1; s.falcon.x = f[2]; s.falcon.z = f[3]; s.mirror = f[4]; s.mute = f[5]; s.report = f[6];
	s.guards = [f[7], f[8]]; s.armor = [f[9], f[10]]; s.hidden = [f[11], f[12]]; s.dawn.on = !!f[13]; s.dawn.x = f[14]; s.dawn.by = f[15] ?? 0;
	s.darts = k.d.map(q => ({ id: q[0], x: q[1], z: q[2], vx: q[3], vz: q[4], by: q[5], life: 1, target: 0 }));
	s.bolts = k.b.map(q => ({ id: q[0], x: q[1], z: q[2], in: q[3], by: 0, e: null }));
	s.marked = new Set(k.m);
	if (k.r.length) { const back = new Set(k.r); for (const b of bullets) if (back.has(b.id)) b.back = 1; }
}
/** Between two pictures the powers keep moving the way they were going. */
export function glidePowers(s: PowerState, dt: number) {
	for (const k of ['rain', 'mirror', 'mute', 'report'] as const) s[k] = Math.max(0, s[k] - dt);
	for (const who of [0, 1]) { s.guards[who] = Math.max(0, s.guards[who] - dt); s.hidden[who] = Math.max(0, s.hidden[who] - dt); }
	if (s.falcon.on) s.falcon.x += s.falcon.dir * TUNE.falcon.speed * dt;
	for (const d of s.darts) { d.x += d.vx * dt; d.z += d.vz * dt; }
	for (const b of s.bolts) b.in = Math.max(0, b.in - dt);
	if (s.dawn.on) s.dawn.x += TUNE.aware.speed * dt;
}
