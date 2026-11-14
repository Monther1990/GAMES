// The six weapons (pure). Each has its own way of firing and changes shape at levels 3 and 5; the numbers per level are
// in src/data/economy.json. Firing is automatic and goes up the screen from Cyber, just ahead of the player.
import { maxLevel, weaponDef, WeaponId } from './economy';
import eco from '../data/economy.json';
import { nearest } from './world';
import type { Enemy, Shot, World } from './world';

const ARENA = eco.arena;

export interface WeaponState { id: WeaponId; level: number; cool: number; queue: { at: number; fire: () => void }[]; hitTick: number }
const MUZZLE = 0.95;                                   // Cyber flies this far ahead of the player

export const levelStats = (id: WeaponId, level: number) => weaponDef(id).levels[Math.max(1, Math.min(maxLevel, level)) - 1];

/** Damage per second on one target when every shot lands (used by the shop to compare levels, and by tests). */
export function ratedDps(id: WeaponId, level: number): number {
	const s = levelStats(id, level);
	switch (id) {
		case 'pulse': return s.dmg * s.rate * s.streams;
		case 'scatter': return s.dmg * s.rate * s.pellets;
		case 'arc': return s.dmg * s.rate;
		case 'beam': return s.dps;
		case 'missile': return s.dmg * s.rate * s.count;
		case 'plasma': return (s.dmg + (s.shards ?? 0) * s.dmg * 0.16 + (s.second ?? 0)) * s.rate;
		case 'disc': return s.dmg * s.rate * s.count;
		case 'wave': return s.dmg * s.rate * s.count;
		case 'shield': return s.dmg * 2 * s.rate * s.count;                  // out and back
	}
}
/** Everything a weapon can deliver per second when its chains, blasts and extra shots all find targets (the shop's "power"). */
export function ratedPower(id: WeaponId, level: number): number {
	const s = levelStats(id, level);
	if (id === 'arc') { let k = 0; for (let n = 0; n < s.targets; n++) k += Math.pow(0.6, n); return s.dmg * s.rate * k; }
	if (id === 'missile') return ratedDps(id, level) * (s.splash ? 1.25 : 1);
	if (id === 'plasma') return ratedDps(id, level) + s.splash * s.rate * 0.8;
	if (id === 'beam') return ratedDps(id, level) * (s.pierce ? 1.4 : 1);
	if (id === 'disc') { let k = 0; for (let n = 0; n <= s.bounces; n++) k += Math.pow(0.82, n); return s.dmg * s.rate * s.count * k * 0.6 + (s.splash ?? 0) * s.rate; }
	if (id === 'wave') return ratedDps(id, level) * (1 + s.width * 0.35);
	if (id === 'shield') return ratedDps(id, level) * 1.5 + (s.nova ?? 0) * s.rate;
	return ratedDps(id, level);
}
/** How much of the arena a weapon covers, 1 to 5 (shown in the shop). */
export function ratedCoverage(id: WeaponId, level: number): number {
	const s = levelStats(id, level);
	switch (id) {
		case 'pulse': return 1 + (s.streams - 1) * 0.6;
		case 'scatter': return 3.4 + (s.pellets - 5) * 0.3;
		case 'arc': return 2.6 + (s.targets - 1) * 0.7;
		case 'beam': return 1 + (s.pierce ? 0.8 : 0);
		case 'missile': return 3.8 + (s.count - 1) * 0.4;
		case 'plasma': return 3 + (s.radius - 1.6) * 2 + (s.shards ? 0.6 : 0);
		case 'disc': return 2.4 + s.bounces * 0.5 + (s.count - 1) * 0.5;
		case 'wave': return 2.2 + s.width * 0.9;
		case 'shield': return 4.4 + (s.count - 1) * 0.7;
	}
}

function shot(w: World, kind: Shot['kind'], x: number, z: number, vx: number, vz: number, dmg: number, r: number, life: number, extra: Partial<Shot> = {}) {
	w.shots.push({ id: w.id(), kind, weapon: w.weapon.id, x, z, vx, vz, dmg, r, life, target: null, turn: 0, splash: 0, radius: 0, shards: 0, second: 0, age: 0, seen: null, bounces: 0, loop: null, ...extra });
}

export function updateWeapon(w: World, dt: number) {
	const st = w.weapon, s = levelStats(st.id, st.level), p = w.player;
	const mx = p.x + MUZZLE, mz = p.z;
	for (let i = st.queue.length - 1; i >= 0; i--) if (st.queue[i].at <= w.t) st.queue.splice(i, 1)[0].fire();
	w.beam.on = false;

	if (st.id === 'beam') {
		// a steady line straight ahead: it stops at the first enemy in its path (the second one too at level 5)
		const half = s.width / 2;
		const inPath = w.targets().filter(e => e.x > mx && Math.abs(e.z - mz) < half + e.r).sort((a, b) => a.x - b.x);
		const struck = inPath.slice(0, 1 + s.pierce);
		st.hitTick -= dt;
		const quiet = st.hitTick > 0;
		if (!quiet) st.hitTick = 0.09;
		for (const e of struck) w.damage(e, s.dps * dt, 'beam', e.x - e.r * 0.6, mz, quiet);
		// it ends on the last enemy it cannot pass; otherwise it runs to the top of the arena
		const end = struck.length > s.pierce ? struck[s.pierce].x : ARENA.length + 1;
		w.beam = { on: true, z: mz, x0: mx, x1: end, width: s.width };
		st.cool -= dt;
		if (st.cool <= 0) { st.cool = 0.5; w.events.push({ type: 'fire', weapon: 'beam', x: mx, z: mz }); }
		return;
	}

	st.cool -= dt;
	if (st.cool > 0) return;
	st.cool += 1 / s.rate;
	if (st.cool < 0) st.cool = 0;

	switch (st.id) {
		case 'pulse': {
			const lanes = s.streams === 1 ? [0] : s.streams === 2 ? [-0.3, 0.3] : [-0.52, 0, 0.52];
			for (const off of lanes) shot(w, 'pulse', mx, mz + off, 23, 0, s.dmg, 0.16, 1.1);
			break;
		}
		case 'scatter': {
			const volley = (count: number, offset: number) => {
				const spread = s.spread * Math.PI / 180;
				for (let i = 0; i < count; i++) {
					const a = (count === 1 ? 0 : (i / (count - 1) - 0.5) * spread) + offset;
					shot(w, 'pellet', p.x + MUZZLE, p.z, Math.cos(a) * 17, Math.sin(a) * 17, s.dmg, 0.14, s.range / 17);
				}
			};
			if (s.layers === 2) {                                             // two layers: a wide one, then a tighter one behind it
				const first = Math.ceil(s.pellets / 2) + 1, second = s.pellets - first;
				volley(first, 0);
				st.queue.push({ at: w.t + 0.09, fire: () => { volley(second, 0.5 * s.spread * Math.PI / 180 / Math.max(1, first - 1)); w.events.push({ type: 'fire', weapon: 'scatter', x: p.x + MUZZLE, z: p.z }); } });
			} else volley(s.pellets, 0);
			break;
		}
		case 'arc': {
			// instant: the nearest enemy ahead, then it jumps to enemies close to the one just struck
			const pool = w.targets().filter(e => e.x > p.x && Math.hypot(e.x - mx, e.z - mz) - e.r < s.range && Math.abs(Math.atan2(e.z - mz, e.x - mx)) < 1.05);
			const seen = new Set<Enemy>();
			const points = [mx, mz];
			let from = { x: mx, z: mz }, dmg = s.dmg;
			for (let n = 0; n < s.targets; n++) {
				const e = nearest(pool, from.x, from.z, seen, n === 0 ? s.range : s.jump);
				if (!e) break;
				seen.add(e); points.push(e.x, e.z);
				w.damage(e, dmg, 'arc', e.x, e.z);
				from = e; dmg *= 0.6;
			}
			if (points.length === 2) points.push(mx + 2.2, mz + (w.rnd() - 0.5) * 1.6);    // nothing in reach: a short spark
			w.events.push({ type: 'arc', points });
			break;
		}
		case 'missile': {
			const list = w.targets().slice().sort((a, b) => Math.hypot(a.x - mx, a.z - mz) - Math.hypot(b.x - mx, b.z - mz));
			for (let i = 0; i < s.count; i++) {
				const side = s.count === 1 ? 0 : (i / (s.count - 1) - 0.5) * 2;
				shot(w, 'missile', mx - 0.3, mz + side * 0.45, 5, side * 5, s.dmg, 0.2, 3.2,
					{ target: list.length ? list[i % list.length] : null, turn: s.turn, splash: s.splash ? s.dmg * 0.4 : 0, radius: s.splash });
			}
			break;
		}
		case 'disc': {
			const list = w.targets().slice().sort((a, b) => Math.hypot(a.x - mx, a.z - mz) - Math.hypot(b.x - mx, b.z - mz));
			for (let i = 0; i < s.count; i++) {
				const t = list.length ? list[i % list.length] : null;
				const a = t ? Math.atan2(t.z - mz, t.x - mx) : (s.count === 1 ? 0 : (i ? 0.25 : -0.25));
				shot(w, 'disc', mx, mz, Math.cos(a) * 16, Math.sin(a) * 16, s.dmg, 0.3, 1.6, { seen: new Set(), bounces: s.bounces, splash: s.splash ? s.dmg * 0.5 : 0, radius: s.splash ?? 0 });
			}
			break;
		}
		case 'wave': {
			const fire = () => shot(w, 'wave', p.x + MUZZLE, p.z, 13.5, 0, s.dmg, 0.3, 1.8, { seen: new Set(), radius: s.width / 2 });
			fire();
			if (s.count === 2) st.queue.push({ at: w.t + 0.16, fire: () => { fire(); w.events.push({ type: 'fire', weapon: 'wave', x: p.x + MUZZLE, z: p.z }); } });
			break;
		}
		case 'shield': {
			// thrown shields loop out and return; with one shield the side alternates from throw to throw
			const sides = s.count === 1 ? [st.hitTick > 0 ? 1 : -1] : s.count === 2 ? [-1, 1] : [-1, 0, 1];
			st.hitTick = st.hitTick > 0 ? 0 : 1;
			const time = 1 / s.rate * 0.92;
			sides.forEach((side, i) => shot(w, 'shield', mx, mz, 0, 0, s.dmg, 0.72, time + 0.1,
				{ seen: new Set(), loop: { time, side, reach: s.reach, spread: s.spread }, second: s.nova && i === 0 ? s.nova : 0 }));
			break;
		}
		case 'plasma':
			shot(w, 'plasma', mx, mz, 9.5, 0, s.dmg, s.orbit ? 0.56 : 0.4, (ARENA.length - mx) / 9.5,
				{ splash: s.splash, radius: s.radius, shards: s.shards ?? 0, second: s.second ?? 0 });
			break;
	}
	w.events.push({ type: 'fire', weapon: st.id, x: mx, z: mz });
}
