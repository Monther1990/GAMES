// The nine weapons of part 2 (pure). None of them works as its namesake did in part 1: here a weapon may leave something
// on the field that goes on working by itself (a cloud of incense, a watchtower, a whirlpool, falcons that circle their
// owner), or strike from above (a mortar shell, a falling star), or sweep (the lighthouse). The numbers per level are in
// src/data/economy.json; levels 3 and 5 change what a weapon does, not only how hard it hits.
// Everything a weapon puts on the field is a Shot (world.ts), so the same list is drawn, sent to a supporter's device
// and cleared when a supporter leaves. Whoever owns a shot is credited with what it does (`owner`, `World.acting`).
import { maxLevel, weaponDef, WeaponId } from './economy';
import eco from '../data/economy.json';
import { nearest } from './world';
import type { Enemy, Shot, ShotKind, World } from './world';

const r2 = (v: number) => Math.round(v * 100) / 100;

const ARENA = eco.arena;

export interface WeaponState { id: WeaponId; level: number; cool: number; queue: { at: number; fire: () => void }[]; hitTick: number }
const MUZZLE = 0.95;                                   // Cyber flies this far ahead of the player
/** A ring of light from a fallen star: how wide it starts and how fast it widens (the picture uses the same figures). */
export const HALO_START = 0.3, HALO_SPEED = 7.5;
/** Falcons circle their owner at this distance, this fast (radians a second). */
export const ORBIT = 1.3, ORBIT_SPEED = 2.6;
/** How long a target goes on burning after the lighthouse beam has passed. */
const BURN_TIME = 0.8;
/** A droplet carries this share of the drop it burst from. */
export const DROPLET = 0.35;
/** A whirlpool bites what is inside it this often, and drags small enemies this fast. */
const WHIRL_BITE = 0.2, WHIRL_PULL = 5;
/** A whirlpool travels up to this line and turns there for its last moment (what it carried stays on the field). */
const WHIRL_END = ARENA.length - 1.5;

export const levelStats = (id: WeaponId, level: number) => weaponDef(id).levels[Math.max(1, Math.min(maxLevel, level)) - 1];

/** Damage per second on one target when everything lands on it (used by the shop to compare levels, and by tests).
 *  What a weapon does to the enemies around that target is not counted here: see ratedPower. */
export function ratedDps(id: WeaponId, level: number): number {
	const s = levelStats(id, level);
	switch (id) {
		case 'pulse': return s.dmg * s.rate * s.streams;
		case 'scatter': return s.dmg * s.ticks * s.last * s.rate * s.clouds;         // clouds thrown on the same spot overlap
		case 'arc': return s.dmg * s.shots * s.towers;
		case 'disc': return s.dmg * s.rate * s.count;
		case 'beam': return (s.dmg + (s.burn ?? 0)) * s.beams / s.pass;
		case 'wave': return s.dmg * s.bites * s.rate * s.count;
		case 'missile': return s.dmg * s.rate * s.count;
		case 'plasma': return (s.dmg + (s.second ?? 0)) * s.rate;
		case 'shield': return s.dmg * s.count * s.rate + (s.nova ? s.nova * s.rate / s.every : 0);
	}
}
/** Everything a weapon can deliver per second in a crowd: its droplets, clouds, blasts and rings find more than one
 *  enemy (the shop's "power"). */
export function ratedPower(id: WeaponId, level: number): number {
	const s = levelStats(id, level), dps = ratedDps(id, level);
	switch (id) {
		case 'pulse': return dps * (1 + DROPLET * s.split * (1 + 0.5 * (s.pierce ?? 0)) * 0.25);       // a droplet in four finds somebody
		case 'scatter': return dps * (1 + 0.2 * (s.radius + (s.clouds - 1) * 0.9) + (s.slow ? 0.15 : 0));
		case 'arc': return dps * (1 + 0.25 * s.towers) + (s.burst ?? 0) * s.towers / s.last;          // towers aim by themselves and go on working where the fighter is not
		case 'disc': return dps * (1 + 0.25 * s.bounces);
		case 'beam': return dps * (1 + s.cone * Math.PI / 180 * 1.2 + (s.burn ? 0.1 : 0));
		case 'wave': return dps * (1 + 0.35 * s.radius * (s.count > 1 ? 1.3 : 1)) + (s.burst ?? 0) * s.rate * s.count;
		case 'missile': return dps * (1 + 0.15 * s.count + (s.splash ? 0.3 : 0));                    // falcons find their own prey
		case 'plasma': return dps * (1 + 0.35 * s.radius) + (s.frags ?? 0) * (s.frag ?? 0) * s.rate * (s.second ? 2 : 1) * 0.3;
		case 'shield': return dps + (s.ring * s.count * s.rate + (s.nova ? s.nova * s.rate / s.every : 0)) * 2.5;
	}
}
/** How much of the arena a weapon covers, 1 to 6 (shown in the shop). */
export function ratedCoverage(id: WeaponId, level: number): number {
	const s = levelStats(id, level);
	switch (id) {
		case 'pulse': return 1.2 + (s.streams - 1) * 0.5 + s.split * 0.3 + (s.pierce ? 0.4 : 0);
		case 'scatter': return 2 + s.radius * 0.6 + (s.clouds - 1) * 0.7;
		case 'arc': return 2.4 + (s.towers - 1) * 0.8;
		case 'disc': return 3 + s.bounces * 0.25 + (s.count - 1) * 0.3;
		case 'beam': return 2.2 + s.cone / 16 + (s.beams - 1) * 0.6;
		case 'wave': return 2 + s.radius * 0.8 + (s.count - 1) * 0.7;
		case 'missile': return 3.4 + (s.count - 1) * 0.5 + (s.splash ? 0.3 : 0);
		case 'plasma': return 2.6 + s.radius * 0.6 + (s.frags ?? 0) * 0.15 + (s.second ? 0.5 : 0);
		case 'shield': return 4.4 + (s.count - 1) * 0.35 + (s.nova ? 0.4 : 0);
	}
}
/** How many times a second a weapon strikes (the shop's "speed"). */
export function ratedRate(id: WeaponId, level: number): number {
	const s = levelStats(id, level);
	switch (id) {
		case 'pulse': return s.rate * s.streams;
		case 'scatter': return s.ticks * s.clouds;
		case 'arc': return s.shots * s.towers;
		case 'beam': return s.beams / s.pass;
		case 'wave': return s.count / WHIRL_BITE;
		case 'disc': case 'missile': case 'shield': return s.rate * s.count;
		case 'plasma': return s.rate * (s.second ? 2 : 1);
	}
}

/** Puts one thing on the field for whoever is acting now. (It takes its number from the world, as shots always have:
 *  which kind a small enemy is depends on its own number, so the mix of a wave shifts with how much has been fired.) */
function mk(w: World, kind: ShotKind, weapon: WeaponId, x: number, z: number, o: Partial<Shot>): Shot {
	const s: Shot = { id: w.id(), kind, weapon, x, z, vx: 0, vz: 0, dmg: 0, r: 0.2, life: 1, age: 0, total: 0, target: null, tx: x, tz: z, radius: 0, a: 0, va: 0, n: 0, mode: 0, tick: 0, power: 0, seen: null, ...o };
	if (!s.total) s.total = s.life;
	if (w.acting === 1) s.owner = 1;
	w.shots.push(s);
	return s;
}
/** Everything inside a circle is hurt at once. Whoever is listed in `spared` is passed over, and those struck are added to it. */
function blast(w: World, x: number, z: number, radius: number, dmg: number, weapon: WeaponId, spared?: Map<number, number> | null, except?: Enemy | null) {
	w.events.push({ type: 'explode', x, z, radius, weapon });
	for (const e of w.targets()) {
		if (e === except || spared?.has(e.id) || Math.hypot(e.x - x, e.z - z) >= radius + e.r) continue;
		spared?.set(e.id, 1);
		w.damage(e, dmg, weapon, e.x, e.z, true);
	}
}
/** Whoever is answering the question of a box opens no other meanwhile: what they left on the field passes the boxes by. */
const sparesBoxes = (w: World, s: Shot) => (s.owner === 1 && w.ally ? w.ally.body : w.player).busy;
const mineOf = (w: World, kind: ShotKind) => { const me = w.acting === 1 ? 1 : 0; return w.shots.filter(q => q.kind === kind && (q.owner ?? 0) === me && q.life > 0); };

/** The angle at which a palm blade is thrown to one side so that, bouncing off the side walls, it crosses the target.
 *  (The walls are unfolded: each bounce is a mirror image of the target further out.) Thrown at a steady slant when
 *  there is no target or none of the ways to it is a diagonal. */
function bladeAngle(mx: number, mz: number, t: Enemy | null, side: number, bounces: number, liking: number): number {
	const W = ARENA.halfWidth, MIN = 0.5, MAX = 1.36;                        // from a shallow slant to nearly sideways (for an enemy close ahead)
	let best = liking, gap = Infinity;
	if (t && t.x - mx > 0.8) for (let k = -bounces; k <= bounces; k++) {
		const dz = 2 * k * W + (k % 2 ? -t.z : t.z) - mz;
		if (dz * side <= 0) continue;
		const a = Math.atan2(Math.abs(dz), t.x - mx);
		if (a >= MIN && a <= MAX && Math.abs(a - liking) < gap) { gap = Math.abs(a - liking); best = a; }
	}
	return best * side;
}
/** How far apart two watchtowers stand at least, and how far from the fighter one is planted. */
export const TOWER_APART = 1.9, TOWER_ASIDE = 1.9;
/** A watchtower with nobody in its reach does not stand idle: it takes long shots at the nearest enemy on the field, each worth this part of a full one. */
export const TOWER_FAR = 0.5;
/** Where a new watchtower goes: beside the fighter, on the side asked for when there is room - never on the fighter
 *  (it would hide them) and never on a tower already standing (they would look like one). Further spots are tried in
 *  turn: the other side, straight ahead, ahead on a slant, then a wider ring, and only then behind the fighter (a
 *  tower there stands in front of them on the screen); if every one is crowded, the roomiest. */
function towerSpot(w: World, p: { x: number; z: number }, side: number): { x: number; z: number } {
	const W = ARENA.halfWidth - 0.75, lo = 0.7, hi = ARENA.length - 1.5;
	const standing = w.shots.filter(q => q.kind === 'tower' && q.life > 0);
	let best = { x: Math.max(lo, Math.min(hi, p.x)), z: Math.max(-W, Math.min(W, p.z + side * TOWER_ASIDE)) }, room = -1;
	for (const [d, deg] of [0, 1, 2, 3].flatMap(n => [90, -90, 0, 45, -45].map(v => [TOWER_ASIDE + n, v])).concat([[TOWER_ASIDE, 135], [TOWER_ASIDE, -135], [TOWER_ASIDE + 1, 135], [TOWER_ASIDE + 1, -135]])) {
		const a = deg * side * Math.PI / 180, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
		if (x < lo || x > hi || Math.abs(z) > W) continue;
		let r = Infinity;
		for (const q of standing) r = Math.min(r, Math.hypot(q.x - x, q.z - z));
		if (r >= TOWER_APART) return { x, z };
		if (r > room) { room = r; best = { x, z }; }
	}
	return best;
}
/** Where a mortar shell is worth most: the boss, or else the enemy with the most others around it. `away` keeps a
 *  second shell off the place the first one is already falling on. */
function thickest(w: World, radius: number, away?: { x: number; z: number }): Enemy | null {
	const list = w.targets(), far = (e: Enemy) => !away || Math.hypot(e.x - away.x, e.z - away.z) >= radius * 1.2;
	if (w.boss && list.includes(w.boss) && far(w.boss)) return w.boss;
	let best: Enemy | null = null, top = -Infinity;
	for (const e of list) {
		if (!far(e)) continue;
		let n = -e.x * 0.01;                                                      // of two equal groups, the nearer
		for (const o of list) if (Math.hypot(o.x - e.x, o.z - e.z) < radius + o.r) n += o.kind === 'crate' ? 0.5 : 1;
		if (n > top) { top = n; best = e; }
	}
	return best;
}
/** A target is left burning: what is still owed to it is paid out over the next moment. */
function burn(w: World, e: Enemy, amount: number) {
	const old = mineOf(w, 'ember').find(q => q.target === e);
	if (old) { old.dmg += amount; old.life = old.total = BURN_TIME; old.age = 0; }
	else mk(w, 'ember', 'beam', e.x, e.z, { target: e, dmg: amount, life: BURN_TIME });
}

export function updateWeapon(w: World, dt: number) {
	const st = w.weapon, s = levelStats(st.id, st.level), p = w.player;
	const mx = p.x + MUZZLE, mz = p.z;
	for (let i = st.queue.length - 1; i >= 0; i--) if (st.queue[i].at <= w.t) st.queue.splice(i, 1)[0].fire();
	w.beam.on = false;                                                        // part 1's fixed beam is not used by any weapon here

	if (st.id === 'beam') { sweep(w, s, dt, mx, mz); return; }
	if (st.id === 'missile') { fly(w, s, dt); return; }

	st.cool -= dt;
	if (st.cool > 0) return;
	st.cool += 1 / s.rate;
	if (st.cool < 0) st.cool = 0;

	switch (st.id) {
		case 'pulse': {
			// drops of water, straight and fast; each bursts on the first enemy it meets (see stepShots)
			for (const off of s.streams === 1 ? [0] : [-0.32, 0.32]) mk(w, 'drop', 'pulse', mx, mz + off, { vx: 23, dmg: s.dmg, r: 0.17, life: 1.1, n: s.split, mode: s.pierce ?? 0 });
			break;
		}
		case 'scatter': {
			// a burner is lobbed onto the nearest enemy in reach that is not already standing in smoke; with nobody in reach, to a spot ahead
			const smoke = [...mineOf(w, 'cloud').filter(c => c.life > 1), ...mineOf(w, 'burner')];
			const inSmoke = (e: Enemy) => smoke.some(c => Math.hypot(e.x - c.tx, e.z - c.tz) < c.radius);
			const reach = w.targets().filter(e => e.x > p.x - 0.5 && Math.hypot(e.x - mx, e.z - mz) - e.r < s.range);
			const t = nearest(reach.filter(e => !inSmoke(e)), mx, mz) ?? nearest(reach, mx, mz);
			const tx = Math.min(ARENA.length - 0.5, t ? t.x : mx + 5.5), tz = t ? t.z : mz, time = 0.5;
			for (const side of s.clouds === 2 ? [-1, 1] : [0]) {
				const lz = Math.max(-ARENA.halfWidth, Math.min(ARENA.halfWidth, tz + side * 1.25));
				mk(w, 'burner', 'scatter', mx, mz, { tx, tz: lz, vx: (tx - mx) / time, vz: (lz - mz) / time, life: time, dmg: s.dmg, radius: s.radius, tick: s.last, n: Math.round(s.last * s.ticks), va: 1 / s.ticks, a: s.slow ?? 0 });
			}
			break;
		}
		case 'arc': {
			// a watchtower is planted beside the fighter, on one side and then the other; when there are more than the level allows, the oldest goes
			st.hitTick = st.hitTick ? 0 : 1;
			const spot = towerSpot(w, p, st.hitTick ? 1 : -1);
			mk(w, 'tower', 'arc', spot.x, spot.z, { life: s.last, dmg: s.dmg, radius: s.range, va: 1 / s.shots, tick: 0.25, power: s.burst ?? 0, r: 0.5, tx: spot.x + 4, tz: spot.z, mode: -1 });
			const mine = mineOf(w, 'tower').sort((a, b) => b.age - a.age);
			while (mine.length > s.towers) mine.shift()!.life = 0;
			break;
		}
		case 'disc': {
			// palm blades: thrown to the side so that they zig-zag up the field between the side walls and cross the nearest enemy
			const ahead = w.targets().filter(e => e.x > mx + 0.8).sort((a, b) => Math.hypot(a.x - mx, a.z - mz) - Math.hypot(b.x - mx, b.z - mz));
			const flip = st.hitTick ? 1 : -1;
			st.hitTick = st.hitTick ? 0 : 1;
			const throwOne = (side: number, t: Enemy | null, liking: number) => {
				const a = bladeAngle(p.x + MUZZLE, p.z, t && !t.dead ? t : null, side, s.bounces, liking);
				mk(w, 'blade', 'disc', p.x + MUZZLE, p.z, { vx: Math.cos(a) * 16, vz: Math.sin(a) * 16, dmg: s.dmg, r: 0.5, life: 5, n: s.bounces, seen: new Map() });
			};
			if (s.count === 1) throwOne(flip, ahead[0] ?? null, 0.95);
			else { throwOne(-1, ahead[0] ?? null, 0.95); throwOne(1, ahead[0] ?? null, 0.95); }
			if (s.count >= 3) st.queue.push({ at: w.t + 0.14, fire: () => throwOne(flip, ahead[1] ?? ahead[0] ?? null, 0.72) });   // the third follows, on a flatter line
			break;
		}
		case 'wave': {
			// a whirlpool that travels slowly up the field
			const launch = (off: number) => {
				const x = p.x + MUZZLE + 0.4, z = Math.max(-ARENA.halfWidth + 0.4, Math.min(ARENA.halfWidth - 0.4, p.z + off));
				mk(w, 'whirl', 'wave', x, z, { vx: s.speed, dmg: s.dmg, radius: s.radius, n: s.bites, power: s.burst ?? 0, life: Math.max(0, (WHIRL_END - x) / s.speed) + 0.8, seen: new Map(), a: off < 0 ? -1 : 1 });
			};
			if (s.count === 2) { launch(-0.9); st.queue.push({ at: w.t + 0.3, fire: () => { launch(0.9); w.events.push({ type: 'fire', weapon: 'wave', x: p.x + MUZZLE, z: p.z }); } }); }
			else launch(0);
			break;
		}
		case 'plasma': {
			// a mortar: the shell is thrown high and lands a moment later on the thickest group; its ring follows that group until just before it lands
			const shell = (dmg: number, away?: { x: number; z: number }) => {
				const t = thickest(w, s.radius, away) ?? (away ? thickest(w, s.radius) : null);
				return mk(w, 'shell', 'plasma', p.x + MUZZLE, p.z, { target: t, tx: t ? t.x : Math.min(ARENA.length - 1, p.x + 8), tz: t ? t.z : p.z, life: s.fly, dmg, radius: s.radius, n: s.frags ?? 0, power: s.frag ?? 0, r: 0.4 });
			};
			const first = shell(s.dmg);
			if (s.second) st.queue.push({ at: w.t + 0.3, fire: () => { shell(s.second, { x: first.tx, z: first.tz }); w.events.push({ type: 'fire', weapon: 'plasma', x: p.x + MUZZLE, z: p.z }); } });
			break;
		}
		case 'shield': {
			// stars fall on whoever has the most health anywhere on the field; a star already on its way counts, so a volley is not wasted on one small enemy
			st.hitTick++;
			const pool = w.targets().map(e => ({ e, hp: e.hp }));
			for (let i = 0; i < s.count; i++) {
				let best: { e: Enemy; hp: number } | null = null;
				for (const q of pool) if (!best || q.hp > best.hp) best = q;
				if (best) best.hp -= s.dmg;
				const t = best?.e ?? null;
				mk(w, 'star', 'shield', t ? t.x : Math.min(ARENA.length - 2, p.x + 7), t ? t.z : p.z + (i - (s.count - 1) / 2) * 2, { target: t, life: s.fall + i * 0.12, dmg: s.dmg, radius: s.reach, power: s.ring, n: i, r: 0.6 });
			}
			// every few volleys a great ring goes out from the fighter himself
			if (s.nova && st.hitTick % s.every === 0) mk(w, 'halo', 'shield', p.x, p.z, { radius: s.novaReach, dmg: s.nova, life: (s.novaReach - HALO_START) / HALO_SPEED + 0.06, seen: new Map(), mode: 1 });
			break;
		}
	}
	w.events.push({ type: 'fire', weapon: st.id, x: mx, z: mz });
}

/** The lighthouse: each beam swings from one edge of its cone to the other and strikes whatever it passes, once per pass,
 *  along its whole length. */
function sweep(w: World, s: Record<string, number>, dt: number, mx: number, mz: number) {
	const cone = s.cone * Math.PI / 180, rate = 2 * cone / s.pass, half = s.width / 2, list = w.targets();
	const rays = mineOf(w, 'ray');
	for (let i = 0; i < s.beams; i++) if (!rays.some(q => q.n === i)) {
		rays.push(mk(w, 'ray', 'beam', mx, mz, { n: i, a: i % 2 ? cone : -cone, va: i % 2 ? -rate : rate, seen: new Map(), life: 0.2 }));
		if (i === 0) w.events.push({ type: 'fire', weapon: 'beam', x: mx, z: mz });
	}
	for (const q of rays) {
		if (q.n >= s.beams) { q.life = 0; continue; }                            // the weapon went back a level
		q.life = 0.2; q.x = mx; q.z = mz; q.radius = s.length; q.r = half; q.va = (q.va < 0 ? -1 : 1) * rate;
		const steps = Math.max(1, Math.ceil(rate * dt / 0.025));               // small steps of the angle, so nothing far away is jumped over
		for (let k = 0; k < steps; k++) {
			q.a += q.va * dt / steps;
			if (Math.abs(q.a) >= cone) {                                          // the edge of the cone: it turns back, and may strike everyone again
				q.a = Math.sign(q.a) * cone; q.va = -q.va; q.seen!.clear();
				if (q.n === 0) w.events.push({ type: 'fire', weapon: 'beam', x: mx, z: mz });
			}
			const cx = Math.cos(q.a), cz = Math.sin(q.a);
			for (const e of list) {
				if (e.dead || q.seen!.has(e.id)) continue;
				const dx = e.x - mx, dz = e.z - mz, along = dx * cx + dz * cz;
				if (along < -e.r || along > s.length + e.r || Math.abs(dz * cx - dx * cz) > half + e.r) continue;
				q.seen!.set(e.id, 1);
				w.damage(e, s.dmg, 'beam', e.x, e.z);
				if (s.burn && !e.dead) burn(w, e, s.burn);
			}
		}
	}
}

/** The falcons: each circles its owner until it may dive, dives at the nearest enemy in reach (one that no other falcon
 *  is already diving at, when there is a choice), strikes it, and flies home before it can dive again. */
function fly(w: World, s: Record<string, number>, dt: number) {
	const p = w.player, birds = mineOf(w, 'falcon');
	for (let i = 0; i < s.count; i++) if (!birds.some(f => f.n === i)) {
		const a = w.t * ORBIT_SPEED + i * Math.PI * 2 / s.count;
		birds.push(mk(w, 'falcon', 'missile', p.x + Math.cos(a) * ORBIT, p.z + Math.sin(a) * ORBIT, { n: i, tick: 0.35 + i * 0.3, life: 0.3, r: 0.3 }));
	}
	const reach = w.targets().filter(e => Math.hypot(e.x - p.x, e.z - p.z) - e.r < s.range);
	for (const f of birds) {
		if (f.n >= s.count) { f.life = 0; continue; }
		f.life = 0.3; f.tick -= dt;
		const a = w.t * ORBIT_SPEED + f.n * Math.PI * 2 / s.count, hx = p.x + Math.cos(a) * ORBIT, hz = p.z + Math.sin(a) * ORBIT;
		if (f.mode === 0) {
			f.vx = (hx - f.x) / dt; f.vz = (hz - f.z) / dt; f.x = hx; f.z = hz;
			if (f.tick > 0) continue;
			const taken = new Set(birds.filter(o => o.mode === 1 && o.target).map(o => o.target!));
			const t = nearest(reach, p.x, p.z, taken) ?? nearest(reach, p.x, p.z);
			if (!t) continue;
			f.mode = 1; f.target = t; f.tick = 1 / s.rate;
			w.events.push({ type: 'fire', weapon: 'missile', x: f.x, z: f.z });
			continue;
		}
		if (f.mode === 1) {
			if (!f.target || f.target.dead || f.target.mode === 'leave') f.target = nearest(w.targets(), f.x, f.z, undefined, 6);   // its prey is gone: the nearest other one, or home
			const t = f.target;
			if (!t) { f.mode = 2; continue; }
			const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz) || 0.001, step = s.speed * dt;
			f.vx = dx / d * s.speed; f.vz = dz / d * s.speed;
			if (d - t.r - 0.2 > step) { f.x += f.vx * dt; f.z += f.vz * dt; continue; }
			f.x = t.x - dx / d * t.r; f.z = t.z - dz / d * t.r;
			w.damage(t, s.dmg, 'missile', f.x, f.z);
			if (s.splash) blast(w, f.x, f.z, s.splash, s.dmg * 0.4, 'missile', null, t);
			f.mode = 2; f.target = null;
			continue;
		}
		const dx = hx - f.x, dz = hz - f.z, d = Math.hypot(dx, dz) || 0.001, v = s.speed * 1.15;
		if (d < v * dt + 0.3) { f.mode = 0; f.x = hx; f.z = hz; continue; }
		f.vx = dx / d * v; f.vz = dz / d * v; f.x += f.vx * dt; f.z += f.vz * dt;
	}
}

/** Where a diving enemy was a frame ago, for the smoke that slows it (its dive is a step added each frame, so half of
 *  the step is taken back). */
const lastPlace = new WeakMap<Enemy, { x: number; z: number; t: number }>();
/** Smoke that slows: an enemy holding its place lives its pattern more slowly (so it sways, sinks and decides to dive
 *  later), and one that dives through loses part of each step. Bosses, their towers and Cyber boxes are not slowed. */
function slow(w: World, e: Enemy, k: number, dt: number) {
	if (e.kind === 'boss' || e.kind === 'turret' || e.kind === 'crate') return;
	if (e.mode === 'hold') e.age -= k * dt;
	else if (e.mode === 'dive') {
		const q = lastPlace.get(e);
		if (q && w.t - q.t < dt * 1.5) { e.x = q.x + (e.x - q.x) * (1 - k); e.z = q.z + (e.z - q.z) * (1 - k); }
		lastPlace.set(e, { x: e.x, z: e.z, t: w.t });
	}
}
/** Flies toward the point it is thrown at so as to arrive exactly when its time is up (a burner, a shell, a fragment). */
function lob(s: Shot, dt: number) {
	const left = s.life + dt, k = Math.min(1, dt / left);
	s.vx = (s.tx - s.x) / left; s.vz = (s.tz - s.z) / left;
	s.x += (s.tx - s.x) * k; s.z += (s.tz - s.z) * k;
}

/** Moves everything the weapons have put on the field, for one step, and lets it do its work. */
export function stepShots(w: World, dt: number) {
	const list = w.targets(), slowed = new Set<number>(), L = ARENA.length, W = ARENA.halfWidth;
	const gone = (e: Enemy | null) => !e || e.dead || e.mode === 'leave';
	for (let i = 0; i < w.shots.length; i++) {                                  // by index: what is born during the step takes its first step at once
		const s = w.shots[i];
		w.acting = s.owner ?? 0;
		s.age += dt; s.life -= dt;
		switch (s.kind) {
			case 'dart': case 'drop': case 'droplet': {
				if (s.kind === 'dart' && gone(s.target)) s.target = nearest(list, s.x, s.z, undefined, 3.5);   // its target fell on the way: it turns to the next one close by
				if (s.kind === 'dart' && !gone(s.target)) {                         // a tower's shot keeps to its target
					const t = s.target!, d = Math.hypot(t.x - s.x, t.z - s.z) || 1, v = Math.hypot(s.vx, s.vz);
					s.vx = (t.x - s.x) / d * v; s.vz = (t.z - s.z) / d * v;
				}
				s.x += s.vx * dt; s.z += s.vz * dt;
				let hit: Enemy | null = null;
				const past = sparesBoxes(w, s);
				for (const e of list) if (!e.dead && !s.seen?.has(e.id) && !(past && e.kind === 'crate') && Math.hypot(e.x - s.x, e.z - s.z) < e.r + s.r) { hit = e; break; }
				if (hit) {
					w.damage(hit, s.dmg, s.weapon, s.x, s.z);
					if (s.kind === 'drop') {                                         // the drop bursts: its droplets fly on to either side (and straight on, at the highest level), past the one it struck
						for (const a of s.n >= 3 ? [-0.75, 0, 0.75] : [-0.75, 0.75])
							mk(w, 'droplet', s.weapon, s.x, s.z, { vx: Math.cos(a) * 15, vz: Math.sin(a) * 15, dmg: s.dmg * DROPLET, r: 0.14, life: 0.5, n: s.mode, seen: new Map<number, number>([[hit.id, 1]]) });
					}
					if (s.kind === 'droplet' && s.n > 0) { s.n--; s.seen!.set(hit.id, 1); } else s.life = 0;
				}
				if (s.x > L + 1.5 || s.x < -1 || Math.abs(s.z) > 19) s.life = 0;
				break;
			}
			case 'burner': {
				if (s.life > 0) { lob(s, dt); break; }
				// it lands: the cloud opens here and stays
				s.kind = 'cloud'; s.x = s.tx; s.z = s.tz; s.vx = 0; s.vz = 0; s.life = s.total = s.tick + 0.05; s.age = 0; s.tick = 0;
				w.events.push({ type: 'explode', x: s.x, z: s.z, radius: s.radius, weapon: 'scatter' });
				break;
			}
			case 'cloud': {
				if (s.a > 0 && w.freeze <= 0) for (const e of list) if (!e.dead && !slowed.has(e.id) && Math.hypot(e.x - s.x, e.z - s.z) < s.radius + e.r) { slowed.add(e.id); slow(w, e, s.a, dt); }
				s.tick -= dt;
				if (s.tick > 0 || s.n <= 0) break;
				s.tick += s.va; s.n--;
				for (const e of list) if (!e.dead && Math.hypot(e.x - s.x, e.z - s.z) < s.radius + e.r) w.damage(e, s.dmg, s.weapon, e.x, e.z, true);
				break;
			}
			case 'tower': {
				if (s.life <= 0) { if (s.power > 0) blast(w, s.x, s.z, 1.9, s.power, s.weapon); break; }   // at the highest level it bursts when its time is up
				if (gone(s.target)) s.target = null;
				if (s.target) { s.tx = r2(s.target.x); s.tz = r2(s.target.z); }       // where it looks (the picture turns its lamp there)
				s.tick -= dt;
				if (s.tick > 0) break;
				// the towers of one fighter share the enemies out: each takes the nearest in its reach that no other of them is on, when there is one
				const taken = new Set<Enemy>();
				for (const o of w.shots) if (o !== s && o.kind === 'tower' && o.life > 0 && (o.owner ?? 0) === (s.owner ?? 0) && o.target) taken.add(o.target);
				const pool = sparesBoxes(w, s) ? list.filter(e => e.kind !== 'crate') : list;
				let t = nearest(pool, s.x, s.z, taken, s.radius) ?? nearest(pool, s.x, s.z, undefined, s.radius), far = false;
				// nobody in its reach (the field is longer than its reach, and enemies hold far up it): it takes a long shot, at part strength - a tower never stands silent while an enemy is on the field
				if (!t) { t = nearest(pool, s.x, s.z, taken) ?? nearest(pool, s.x, s.z); far = !!t; }
				s.target = t;
				if (!t) { s.tick = 0.05; break; }
				s.tick += s.va;
				s.tx = r2(t.x); s.tz = r2(t.z); s.mode = r2(s.age); s.n++;            // when it last fired, and how often: the picture kicks and flashes with it
				w.events.push({ type: 'towerShot', x: s.x, z: s.z });
				const d = Math.hypot(t.x - s.x, t.z - s.z) || 1;
				mk(w, 'dart', s.weapon, s.x + (t.x - s.x) / d * 0.5, s.z + (t.z - s.z) / d * 0.5, { vx: (t.x - s.x) / d * 24, vz: (t.z - s.z) / d * 24, target: t, dmg: s.dmg * (far ? TOWER_FAR : 1), r: 0.16, life: far ? 1.3 : 0.8, mode: far ? 1 : 0 });
				break;
			}
			case 'blade': {
				s.x += s.vx * dt; s.z += s.vz * dt;
				if (Math.abs(s.z) > W && s.z * s.vz > 0 && s.n > 0) {               // off the side wall and back across the field
					s.n--; s.z = Math.sign(s.z) * (2 * W - Math.abs(s.z)); s.vz = -s.vz;
					w.events.push({ type: 'bounce', x: s.x, z: Math.sign(s.z) * W });
				}
				for (const e of list) if (!e.dead && !s.seen!.has(e.id) && Math.hypot(e.x - s.x, e.z - s.z) < e.r + s.r) { s.seen!.set(e.id, 1); w.damage(e, s.dmg, s.weapon, s.x, s.z); }
				if (s.x > L + 1.5 || Math.abs(s.z) > W + 2.5) s.life = 0;
				break;
			}
			case 'ember': {
				const t = s.target;
				if (gone(t)) { s.life = 0; break; }
				s.x = t!.x; s.z = t!.z;
				const part = Math.min(s.dmg, s.dmg * dt / Math.max(dt, s.life + dt));
				s.dmg -= part;
				w.damage(t!, part, s.weapon, s.x, s.z, true);
				break;
			}
			case 'whirl': {
				if (s.life <= 0) { if (s.power > 0) blast(w, s.x, s.z, s.radius * 1.3, s.power, s.weapon); break; }
				if (s.x < WHIRL_END) s.x = Math.min(WHIRL_END, s.x + s.vx * dt); else s.vx = 0;   // at the top of the field it stays and turns until its time is up
				// small enemies near it are dragged to its middle and carried along (where they hold is moved, so they stay where it leaves them)
				if (w.freeze <= 0) for (const e of list) {
					if (e.dead || e.kind !== 'normal' || (e.mode !== 'hold' && e.mode !== 'dive')) continue;
					const dx = s.x - e.x, dz = s.z - e.z, d = Math.hypot(dx, dz);
					if (d > s.radius * 1.5 + e.r || d < 0.05) continue;
					const m = Math.min(d, WHIRL_PULL * dt), px = dx / d * m, pz = dz / d * m;
					e.x += px; e.z += pz;
					if (e.mode === 'hold') { e.hx = Math.min(WHIRL_END, e.hx + px); e.hz = Math.max(-W + 0.4, Math.min(W - 0.4, e.hz + pz)); }
				}
				s.tick -= dt;
				if (s.tick > 0) break;
				s.tick += WHIRL_BITE;
				for (const e of list) {                                            // it grinds whatever is inside, each enemy a set number of times
					const had = s.seen!.get(e.id) ?? 0;
					if (e.dead || had >= s.n || Math.hypot(e.x - s.x, e.z - s.z) >= s.radius + e.r) continue;
					s.seen!.set(e.id, had + 1);
					w.damage(e, s.dmg, s.weapon, e.x, e.z, had % 2 === 1);
				}
				break;
			}
			case 'shell': case 'frag': {
				if (gone(s.target)) s.target = null;
				if (s.target && s.life > 0.25) { s.tx = s.target.x; s.tz = s.target.z; }   // the ring rides on its target until just before the shell comes down
				if (s.life > 0) { lob(s, dt); break; }
				s.x = s.tx; s.z = s.tz;
				const struck = s.seen ?? new Map<number, number>();
				blast(w, s.x, s.z, s.radius, s.dmg, s.weapon, struck);
				if (s.kind === 'shell' && s.n > 0) {
					// fragments are thrown out and burst again: on enemies the blast did not reach, or else in a ring around it
					const near = list.filter(e => !e.dead && !struck.has(e.id) && Math.hypot(e.x - s.x, e.z - s.z) < s.radius * 2.4).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
					const turn = w.rnd() * 6.28;
					for (let k = 0; k < s.n; k++) {
						const t = near[k] ?? null, a = turn + k * Math.PI * 2 / s.n;
						mk(w, 'frag', s.weapon, s.x, s.z, { target: t, tx: t ? t.x : Math.max(1, Math.min(L - 0.5, s.x + Math.cos(a) * s.radius * 1.3)), tz: t ? t.z : Math.max(-W, Math.min(W, s.z + Math.sin(a) * s.radius * 1.3)),
							life: 0.42, dmg: s.power, radius: s.radius * 0.55, seen: struck, r: 0.2 });
					}
				}
				break;
			}
			case 'star': {
				if (gone(s.target)) {                                               // its target fell first: while still high it turns to the next strongest, later it comes down where it was going
					s.target = null;
					if (s.age < s.total * 0.6) for (const e of list) if (!e.dead && (!s.target || e.hp > s.target.hp)) s.target = e;
				}
				if (s.target) { s.x = s.target.x; s.z = s.target.z; }
				if (s.life > 0) break;
				const struck = s.target ?? nearest(list, s.x, s.z, undefined, 0.9);
				if (struck) w.damage(struck, s.dmg, s.weapon, s.x, s.z);
				w.events.push({ type: 'explode', x: s.x, z: s.z, radius: 1.1, weapon: s.weapon });
				// the ring of light it sends out (the one it fell on has had its share)
				mk(w, 'halo', s.weapon, s.x, s.z, { radius: s.radius, dmg: s.power, life: (s.radius - HALO_START) / HALO_SPEED + 0.06, seen: new Map<number, number>(struck ? [[struck.id, 1]] : []) });
				break;
			}
			case 'halo': {
				const reach = Math.min(s.radius, HALO_START + HALO_SPEED * s.age);
				for (const e of list) if (!e.dead && !s.seen!.has(e.id) && Math.hypot(e.x - s.x, e.z - s.z) < reach + e.r) { s.seen!.set(e.id, 1); w.damage(e, s.dmg, s.weapon, e.x, e.z, true); }
				break;
			}
			// 'ray' and 'falcon' are kept alive and moved by their weapon while its owner fires (sweep, fly); left alone they fade here
		}
	}
	w.shots = w.shots.filter(s => s.life > 0);
}
