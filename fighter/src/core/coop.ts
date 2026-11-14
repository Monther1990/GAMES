// Playing with a supporter: what travels between the two devices, and the picture of the fight the supporter keeps.
// The main player's device runs the whole fight (the same simulation as in single play, with a second fighter in it)
// and sends what it looks like about fifteen times a second; the supporter's device draws that, moves the supporter
// itself so the finger never lags, and sends back where the supporter is. Money, progress and the knowledge score
// belong to the main player alone: nothing here touches them.
import type { StageDef, WeaponId } from '../sim/economy';
import { ARENA } from '../sim/world';
import type { Body, Bullet, Enemy, Shot, SimEvent, World, Zone } from '../sim/world';

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Seconds on this device's own clock. Only differences matter: the two devices never have to agree on the hour. */
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const clamp = (n: number, by: number) => Math.max(-by, Math.min(by, n));
const body = (b: Body) => [r2(b.x), r2(b.z), b.hp, b.maxHp, b.invuln > 0 ? 1 : 0, r2(b.bubble), b.down ? 1 : 0, b.busy ? 1 : 0];
type Beam = { on: boolean; z: number; x0: number; x1: number; width: number };
const beam = (b: Beam) => (b.on ? [1, r2(b.z), r2(b.x0), r2(b.x1), r2(b.width)] : [0]);

export interface Snapshot {
	t: 's'; p: number[]; a: number[]; w: [WeaponId, number, WeaponId, number];
	e: (string | number)[][]; sh: (string | number)[][]; b: (string | number)[][]; z: number[][];
	bm: number[]; bm2: number[]; x: number[]; d: number[];
	/** When this picture was taken, on the main player's clock (seconds), and how fast the fight was running then (1,
	 *  or less in slow motion). A picture from an older build has neither and is drawn as it arrives. */
	ts?: number; k?: number;
}
/** The fight as it is now, small enough to send many times a second. */
export function snapshot(w: World, now = clock(), rate = 1): Snapshot {
	const a = w.ally!, s = w.director.bossState;
	return {
		t: 's', ts: Math.round(now * 1000) / 1000, ...(rate !== 1 ? { k: Math.round(rate * 1000) / 1000 } : {}), p: body(w.player), a: body(a.body), w: [w.weapon.id, w.weapon.level, a.weapon.id, a.weapon.level],
		e: w.enemies.filter(e => !e.dead).map(e => [e.id, e.kind, r2(e.x), r2(e.z), e.r, r2(e.hp), (e.shielded ? 1 : 0) | (e.guard < 1 ? 2 : 0) | (e.flash > 0 ? 4 : 0) | (e === w.boss ? 8 : 0), e.pattern, e.mode, r2(e.seed), r2(e.age), r2(e.maxHp)]),
		sh: w.shots.map(q => [q.id, q.kind, q.weapon, q.owner ? 1 : 0, r2(q.x), r2(q.z), r2(q.vx), r2(q.vz), q.r, r2(q.radius), r2(q.age)]),   // the age tells the other device when it was fired
		b: w.bullets.map(q => [q.id, q.kind, r2(q.x), r2(q.z), r2(q.vx), r2(q.vz), q.r]),
		z: w.zones.map(q => [q.id, r2(q.x0), r2(q.z0), r2(q.x1), r2(q.z1), r2(q.warn)]),
		bm: beam(w.beam), bm2: beam(a.beam),
		x: [r2(w.freeze), r2(w.laser), w.laserBy, r2(w.novaIn), r2(w.wall.left), r2(w.wall.x), w.scan.on ? 1 : 0, r2(w.scan.x), r2(w.boost), r2(a.boost), r2(w.reviving), w.firing ? 1 : 0],
		d: [w.director.wave, w.director.waveCount, s ? s.phase : -1]
	};
}
/** Events are sent as plain data: an enemy inside one becomes the few numbers the picture needs. */
export function plainEvent(e: SimEvent): Record<string, unknown> {
	if ('enemy' in e) { const n = e.enemy; return { ...e, enemy: { id: n.id, kind: n.kind, x: r2(n.x), z: r2(n.z), r: n.r, index: n.index, pattern: n.pattern } }; }
	return { ...e } as Record<string, unknown>;
}

/** What the supporter's device keeps of the fight: shaped like the simulation's world, so the same code draws it. */
export class Mirror {
	t = 0;
	player: Body = blank(); ally: { body: Body; weapon: { id: WeaponId; level: number }; beam: Beam; boost: number };
	weapon: { id: WeaponId; level: number };
	enemies: Enemy[] = []; shots: Shot[] = []; bullets: Bullet[] = []; zones: Zone[] = [];
	beam: Beam = { on: false, z: 0, x0: 0, x1: 0, width: 0 };
	boss: Enemy | null = null;
	freeze = 0; laser = 0; laserBy = 0; novaIn = 0; boost = 0; reviving = 0; firing = true; over = false; godMode = false;
	wall = { left: 0, x: 0 }; scan = { on: false, x: 0, seen: new Set<number>() };
	director = { wave: 0, waveCount: 1, bossState: null as { phase: number } | null };
	readonly events: SimEvent[] = [];
	readonly bounds = { minX: ARENA.playerMinX, maxX: ARENA.playerMaxX, halfWidth: ARENA.playerHalfWidth };
	private byId = new Map<number, Enemy & { tx: number; tz: number }>();
	// Pictures arrive late and unevenly (through the server, several tenths of a second apart). So nothing that flies
	// is ever put back where an old picture had it:
	// - a shot is kept by its number with the line it flies on, and drawn a short moment behind the main player's clock:
	//   it appears at the instant it was fired, at its fighter, and runs smoothly to where it ended;
	// - enemy fire is carried forward to "now" and any difference is closed gently.
	private flying = new Map<number, Flying>();
	private fire = new Map<number, Bullet & { ex: number; ez: number }>();
	/** The smallest difference seen between this clock and the main player's: the delay of the freshest picture. */
	private base = Infinity;
	/** How late pictures have been coming lately beyond that, the longest wait between two, and the last one's time. */
	private late = 0; private gap = 0.07; private lastTs = -1;
	/** How far behind the main player's clock the shots are drawn (it follows the two numbers above). */
	private behind = 0.1;
	/** Where the two fighters stood in the last pictures, to know where a shot left its weapon. */
	private trail: { ts: number; p: [number, number]; a: [number, number] }[] = [];
	private rate = 1;
	/** Where the main player was in the last picture: their figure glides there. */
	private goal = { x: 2.4, z: -1.4 };
	/** True until the first picture arrives. */
	empty = true;

	constructor(readonly stage: StageDef, readonly stageIndex: number, mine: { id: WeaponId; level: number }) {
		this.weapon = { id: 'pulse', level: 1 };
		this.ally = { body: blank(), weapon: { ...mine }, beam: { on: false, z: 0, x0: 0, x1: 0, width: 0 }, boost: 0 };
		this.ally.body.z = 1.4; this.player.z = -1.4;
	}
	targets() { return this.enemies; }
	prey() { return this.player; }

	/** Takes a new picture from the main player. The supporter's own place is kept as it is on this device (unless down
	 *  or answering), so moving never waits for the network. */
	apply(s: Snapshot, now = clock()) {
		const timed = typeof s.ts === 'number', ts = timed ? s.ts! : now - (this.base === Infinity ? 0 : this.base);
		if (timed && ts < this.lastTs) return;                                   // an older picture overtaken on the way: the newer one stands
		if (now - ts < this.base) {                                              // the freshest picture so far: the clocks are known better now,
			if (this.base !== Infinity) this.behind += this.base - (now - ts);     // but the moment being drawn stays where it was (it catches up gently)
			this.base = now - ts;
		}
		const late = Math.max(0, now - ts - this.base), since = this.lastTs >= 0 ? ts - this.lastTs : 0;
		this.late = Math.max(late, this.late * 0.9);
		if (since > 0) this.gap = Math.max(Math.min(since, 0.6), this.gap * 0.9);
		this.lastTs = ts; this.rate = s.k ?? 1;
		this.trail.push({ ts, p: [s.p[0], s.p[1]], a: [s.a[0], s.a[1]] }); if (this.trail.length > 16) this.trail.shift();
		setBody(this.player, s.p, this.empty);
		this.goal.x = s.p[0]; this.goal.z = s.p[1];
		this.empty = false;
		setBody(this.ally.body, s.a, this.ally.body.down || s.a[6] === 1 || s.a[7] === 1);
		this.weapon.id = s.w[0]; this.weapon.level = s.w[1]; this.ally.weapon.id = s.w[2]; this.ally.weapon.level = s.w[3];
		const seen = new Set<number>();
		this.boss = null;
		for (const q of s.e) {
			const id = q[0] as number; seen.add(id);
			let e = this.byId.get(id);
			if (!e) {
				e = { id, kind: q[1] as Enemy['kind'], x: q[2] as number, z: q[3] as number, tx: 0, tz: 0, hp: 1, maxHp: 1, r: q[4] as number, index: -1, age: 0, mode: 'hold', sx: 0, sz: 0, hx: 0, hz: 0,
					pattern: 0, seed: 0, stay: 0, fireIn: 0, shooter: false, flash: 0, shielded: false, cycle: 0, guard: 1, dead: false };
				this.byId.set(id, e);
			}
			const f = q[6] as number;
			const hp = q[5] as number, max = (q[11] as number) || 1;
			if (e.maxHp === max && hp < e.hp) e.took = (e.took ?? 0) + (e.hp - hp);       // what it lost since the last picture, for the damage numbers
			e.tx = q[2] as number; e.tz = q[3] as number; e.hp = hp; e.maxHp = max; e.shielded = !!(f & 1); e.guard = f & 2 ? 0.1 : 1; if (f & 4) e.flash = 0.09;
			e.pattern = q[7] as number; e.mode = q[8] as Enemy['mode']; e.seed = q[9] as number; e.age = q[10] as number;
			if (f & 8) this.boss = e;
		}
		for (const [id, e] of this.byId) if (!seen.has(id)) { e.dead = true; this.byId.delete(id); }
		this.enemies = [...this.byId.values()];
		// shots: each keeps its number and its line; one that is missing from this picture ended somewhere since the last
		const here = new Set<number>();
		for (const q of s.sh) {
			const id = q[0] as number; here.add(id);
			let f = this.flying.get(id);
			if (!f) {
				f = { id, kind: q[1], weapon: q[2], owner: q[3], x: q[4], z: q[5], dmg: 0, life: 1, target: null, turn: 0, splash: 0, shards: 0, second: 0, age: 0, seen: null, bounces: 0, loop: null,
					shown: -1, lx: 0, lz: 0, ox: 0, oz: 0, hid: false, path: [], a0: 0, va: 0 } as unknown as Flying;
				this.flying.set(id, f);
			}
			let vx = q[6] as number, vz = q[7] as number;
			if (f.kind === 'shield') {
				// the thrown shield follows a loop, and what is sent as its speed is only its last step: its real speed is
				// taken from where it was in the picture before (or, the first time, from that step at sixty a second)
				const was = f.ts !== undefined && ts > f.ts ? (ts - f.ts) * (this.rate || 1) : 0;
				if (was > 0) { vx = ((q[4] as number) - f.px) / was; vz = ((q[5] as number) - f.pz) / was; } else { vx *= 60; vz *= 60; }
			}
			f.ts = ts; f.px = q[4] as number; f.pz = q[5] as number; f.vx = vx; f.vz = vz; f.r = q[8] as number; f.radius = q[9] as number;
			f.born = timed ? ts - ((q[10] as number) ?? 0) / (this.rate || 1) : -Infinity; f.gone = Infinity; f.rate = this.rate;
			if (!f.path.length || ts > f.path[f.path.length - 1][0]) { f.path.push([ts, f.px, f.pz, 0]); if (f.path.length > 6) f.path.shift(); }
		}
		for (const [id, f] of this.flying) if (!here.has(id)) { if (f.hid) this.flying.delete(id); else if (f.gone === Infinity) f.gone = ts - Math.min(since, 0.5) / 2; }
		// enemy fire: carried forward by how late this picture is, and an old one is never thrown back
		const frozenNow = s.x[0] > 0, ahead = frozenNow ? 0 : late * this.rate, shotAt = new Set<number>();
		for (const q of s.b) {
			const id = q[0] as number, vx = q[4] as number, vz = q[5] as number, x = (q[2] as number) + vx * ahead, z = (q[3] as number) + vz * ahead;
			shotAt.add(id);
			const b = this.fire.get(id);
			if (!b) { this.fire.set(id, { id, kind: q[1], x, z, vx, vz, r: q[6], ex: 0, ez: 0 } as unknown as Bullet & { ex: number; ez: number }); continue; }
			b.vx = vx; b.vz = vz; b.r = q[6] as number;
			const ex = x - b.x, ez = z - b.z;
			if (Math.hypot(ex, ez) > 2.6) { b.x = x; b.z = z; b.ex = 0; b.ez = 0; } else { b.ex = ex; b.ez = ez; }   // far off (it bounced, or was turned): there at once
		}
		for (const id of this.fire.keys()) if (!shotAt.has(id)) this.fire.delete(id);
		this.bullets = [...this.fire.values()];
		this.place(now, 0);
		this.zones = s.z.map(q => ({ id: q[0], x0: q[1], z0: q[2], x1: q[3], z1: q[4], warn: q[5], live: 1, total: 1 }));
		setBeam(this.beam, s.bm); setBeam(this.ally.beam, s.bm2);
		const x = s.x;
		this.freeze = x[0]; this.laser = x[1]; this.laserBy = x[2]; this.novaIn = x[3]; this.wall.left = x[4]; this.wall.x = x[5]; this.scan.on = !!x[6]; this.scan.x = x[7]; this.boost = x[8]; this.ally.boost = x[9]; this.reviving = x[10]; this.firing = !!x[11];
		this.director.wave = s.d[0]; this.director.waveCount = s.d[1]; this.director.bossState = s.d[2] >= 0 ? { phase: s.d[2] } : null;
	}
	/** Between two pictures things keep moving the way they were going, so the fight looks smooth. */
	advance(dt: number, now = clock()) {
		this.t += dt;
		const want = Math.min(0.45, this.late + this.gap + 0.02);
		this.behind += (want - this.behind) * Math.min(1, dt * 1.5);
		this.late *= Math.pow(0.8, dt);                                         // a bad moment on the network is forgotten slowly
		const frozen = this.freeze > 0;
		for (const e of this.byId.values()) { const k = Math.min(1, dt * 14); e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.flash = Math.max(0, e.flash - dt); }
		this.place(now, dt);
		for (const q of this.fire.values()) {
			if (!frozen) { q.x += q.vx * this.rate * dt; q.z += q.vz * this.rate * dt; }
			const k = Math.min(1, dt * 9), mx = q.ex * k, mz = q.ez * k;           // what a late picture showed to be off is closed over a few frames
			q.x += mx; q.z += mz; q.ex -= mx; q.ez -= mz;
		}
		for (const q of this.zones) q.warn = Math.max(0, q.warn - dt);
		for (const b of [this.player, this.ally.body]) b.bubble = Math.max(0, b.bubble - dt);
		const p = this.player, k = Math.min(1, dt * 16), mx = (this.goal.x - p.x) * k, mz = (this.goal.z - p.z) * k;
		p.x += mx; p.z += mz;
		if (dt > 0) { p.vx += (mx / dt - p.vx) * Math.min(1, dt * 10); p.vz += (mz / dt - p.vz) * Math.min(1, dt * 10); }
		if (this.scan.on) this.scan.x -= 9 * dt;
		for (const k of ['freeze', 'laser', 'novaIn', 'boost'] as const) this[k] = Math.max(0, this[k] - dt);
		this.wall.left = Math.max(0, this.wall.left - dt);
	}
	/** Where a fighter stood at a moment of the main player's clock, from the last pictures. */
	private stoodAt(who: 'p' | 'a', when: number): [number, number] {
		const t = this.trail;
		if (!t.length) return who === 'p' ? [this.player.x, this.player.z] : [this.ally.body.x, this.ally.body.z];
		let i = t.length - 1; while (i > 0 && t[i].ts > when) i--;
		const a = t[i], b = t[Math.min(t.length - 1, i + 1)];
		if (b.ts <= a.ts || when <= a.ts) return a[who];
		const k = Math.min(1, (when - a.ts) / (b.ts - a.ts));
		return [a[who][0] + (b[who][0] - a[who][0]) * k, a[who][1] + (b[who][1] - a[who][1]) * k];
	}
	/** Puts every shot where it is at the moment being drawn (a little behind the main player's clock), and makes the
	 *  list the picture is drawn from. A shot not fired yet at that moment waits; one that has ended there is gone. */
	private place(now: number, dt: number) {
		const at = now - (this.base === Infinity ? 0 : this.base) - this.behind, out: Shot[] = [];
		for (const [id, f] of this.flying) {
			if (at >= f.gone) { this.flying.delete(id); continue; }
			if (f.hid || at < f.born - 1e-6) continue;
			const [cx, cz] = whereAt(f, at);
			if (cx > ARENA.length + 4 || cx < -4 || Math.abs(cz) > ARENA.halfWidth + 4) continue;   // outside the field at this moment: not drawn, not forgotten
			if (f.shown < 0) {
				f.shown = at; f.lx = cx; f.lz = cz;
				// it leaves from where its fighter stands on this screen, and joins its own line within a moment
				if (at - f.born < 0.15) {
					const then = this.stoodAt(f.owner ? 'a' : 'p', f.born), b = f.owner ? this.ally.body : this.player;
					f.ox = clamp(b.x - then[0], 4); f.oz = clamp(b.z - then[1], 4);
				}
			} else {
				f.lx += f.vx * f.rate * dt; f.lz += f.vz * f.rate * dt;                // on its way...
				const k = Math.min(1, dt * 12); f.lx += (cx - f.lx) * k; f.lz += (cz - f.lz) * k;   // ...and where a new picture bent that way, it bends smoothly
			}
			const fade = Math.max(0, 1 - (at - f.shown) / 0.3);
			f.x = f.lx + f.ox * fade; f.z = f.lz + f.oz * fade;
			// a shot that stops at the first thing it strikes stops here too, though the news of it comes a moment later
			if (STOPS.has(f.kind) && at - f.shown > 0.04 && this.enemies.some(e => !e.dead && Math.hypot(e.x - f.x, e.z - f.z) < e.r + f.r * 0.6)) { f.hid = true; continue; }   // kept, unseen, until the pictures stop naming it: so it is not born again
			out.push(f);
		}
		this.shots = out;
	}
}
/** A shot as the supporter's device keeps it: the line it was on in the last picture (place, speed, the time of that
 *  picture), when it was fired and when it ended, where it is drawn, and the shift that lets it leave from its fighter. */
type Flying = Shot & { owner: number; ts: number; px: number; pz: number; born: number; gone: number; rate: number; shown: number; lx: number; lz: number; ox: number; oz: number; hid: boolean;
	/** Where the last pictures had it: [their time, x, z, angle]. And its angle and turning in the newest (part 1 has none). */
	path: [number, number, number, number][]; a0: number; va: number };
/** Where a shot was at a moment of the main player's clock, and the angle it had: between two pictures, on the
 *  straight way from one to the next; after the last, carried on at the speed it had; before the first, carried back. */
function whereAt(f: Flying, at: number): [number, number, number] {
	const h = f.path, n = h.length - 1;
	if (n <= 0 || at >= h[n][0]) { const on = f.rate * (at - f.ts); return [f.px + f.vx * on, f.pz + f.vz * on, f.a0 + f.va * on]; }
	let i = n - 1; while (i > 0 && h[i][0] > at) i--;
	const a = h[i], b = h[i + 1], k = (at - a[0]) / (b[0] - a[0]);
	return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}
const STOPS = new Set<string>(['pulse', 'pellet', 'missile', 'plasma', 'shard']);
function blank(): Body { return { x: 2.4, z: 0, vx: 0, vz: 0, hp: 4, maxHp: 4, invuln: 0, bubble: 0, down: false, busy: false }; }
function setBody(b: Body, q: number[], place: boolean) {
	if (place) { b.vx = 0; b.vz = 0; b.x = q[0]; b.z = q[1]; }
	b.hp = q[2]; b.maxHp = q[3]; b.invuln = q[4]; b.bubble = q[5]; b.down = !!q[6]; b.busy = !!q[7];
}
function setBeam(b: Beam, q: number[]) { b.on = !!q[0]; if (b.on) { b.z = q[1]; b.x0 = q[2]; b.x1 = q[3]; b.width = q[4]; } }
