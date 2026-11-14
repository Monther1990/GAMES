// The pictures of the special skills (see src/sim/powers.ts for what each does). The arena hands this file a small kit
// of its own drawing tools, calls draw() once per frame with the world as it is, and show() for the one-off moments.
// Every shape and soft light used here is made here, so nothing in this file depends on how the weapons are drawn.
// Each lasting power shows that it is about to end: it flickers through its last second or so.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import eco from '../data/economy.json';
import { guardSpot, NOVA_DELAY, TUNE } from '../sim/powers';
import type { PowerId } from '../sim/powers';
import type { Body, SimEvent, World } from '../sim/world';

const A = eco.arena;
const C = (r: number, g: number, b: number) => new Color3(r, g, b);
type Draw = (g: CanvasRenderingContext2D, size: number) => void;
/** What the arena lends: its pools of shapes, its short-lived effects and its clock. */
export interface FxKit {
	scene: Scene;
	/** One instance of a shape for this frame (it is hidden again when a frame does not ask for it). */
	put(key: string, id: number): InstancedMesh;
	/** A soft light lying on the field for this frame. */
	soft(key: string, id: number, x: number, z: number, sx: number, sz?: number, y?: number): InstancedMesh;
	addFx(kind: 'ring' | 'debris' | 'bolt' | 'trail' | 'flash' | 'bloom', key: string, x: number, y: number, z: number, life: number, size: number, vx?: number, vy?: number, vz?: number): { mesh: InstancedMesh; wide: number } | null;
	burst(x: number, y: number, z: number, color: Color3, count: number): void;
	ringAt(x: number, z: number, size: number, life: number, key: string, y?: number): void;
	flashAt(x: number, z: number, size: number, life: number, key: string): void;
	bloomAt(x: number, z: number, size: number, life: number, key: string): void;
	after(seconds: number, run: () => void): void;
	/** Registers a glowing shape, a painted sheet, or paints a texture. */
	glow(key: string, mesh: Mesh, color: Color3, alpha?: number): void;
	sheet(key: string, tex: DynamicTexture, color: Color3 | null, alpha: number, add: boolean): void;
	painted(name: string, size: number, draw: Draw): DynamicTexture;
	mat(key: string): StandardMaterial | undefined;
	rnd(): number; time(): number; frame(): number; halfW(): number; reduce(): boolean;
	/** The small Cyber that leaves the fighter's side for Total Awareness (null until the characters are loaded). */
	courier(): TransformNode | null;
}
/** A number between 0 and 1 that is always the same for the same `i` (where a raindrop falls, how fast). */
const hash = (i: number) => { const v = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return v - Math.floor(v); };
const ease = (k: number) => k * k * (3 - 2 * k);
/** Signs that must be read the right way up (the mute sign, the lock, the question mark) are turned by this much:
 *  a painted sheet lies with the top of its picture toward the right of the screen. */
const UPRIGHT = Math.PI / 2;
/** How far up the screen something drawn at height y appears to move (the camera looks down at 58 degrees). */
const LIFT = Math.cos(58 * Math.PI / 180) / Math.sin(58 * Math.PI / 180);

export class PowerFx {
	/** True while Cyber is away from his fighter for Total Awareness, and whose Cyber it is (0 the main player's). */
	courierOut = false; courierOf = 0;
	private courierBack = 0; private courierAt = { x: 0, z: 0, y: 1, k: 0 };
	/** Seconds of warm light left over the field after the last flash, the dark of a thunder sky, and the last drop of rain seen. */
	private afterglow = 0; private dark = 0; private lastTick = 0;

	constructor(private k: FxKit) { this.build(); }

	private build() {
		const k = this.k, s = k.scene;
		const dot = k.painted('pwDot', 64, g => { const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 64, 64); });
		for (const [key, c, a] of [['pwSoftGold', C(1, 0.74, 0.2), 0.8], ['pwSoftWhite', C(1, 1, 1), 0.85], ['pwSoftBlue', C(0.3, 0.6, 1), 0.8], ['pwSoftCyan', C(0.3, 0.9, 1), 0.85],
			['pwSoftViolet', C(0.66, 0.42, 1), 0.85], ['pwSoftOrange', C(1, 0.5, 0.14), 0.85]] as [string, Color3, number][]) k.sheet(key, dot, c, a, true);
		k.sheet('pwShade', dot, C(0, 0, 0), 0.6, false);
		k.glow('pwRing', CreateTorus('pwRing', { diameter: 1, thickness: 0.08, tessellation: 28 }, s), C(1, 1, 1), 0.92);
		k.glow('pwGold', CreateTorus('pwGold', { diameter: 1, thickness: 0.1, tessellation: 24 }, s), C(1, 0.86, 0.38), 0.92);
		k.glow('pwBit', CreateBox('pwBit', { size: 0.17 }, s), C(0.8, 1, 0.95));
		// Khareef Rain: drops, and a veil that dims the land so they show on sand as well as on sea
		k.glow('pwRain', CreateBox('pwRain', { width: 0.05, height: 1.25, depth: 0.05 }, s), C(0.82, 0.94, 1), 0.85);
		k.glow('pwVeil', CreateGround('pwVeil', { width: 1, height: 1 }, s), C(0.03, 0.1, 0.24), 0.3);
		// Falcon Dive: seen from above, wings spread, head toward the way it flies
		k.sheet('pwFalcon', k.painted('pwFalcon', 256, paintFalcon), null, 1, false);
		// Rumour Mirror: shards of mirror circling the fighter
		k.glow('pwShard', CreateBox('pwShard', { width: 0.09, height: 0.72, depth: 0.5 }, s), C(0.86, 0.97, 1), 0.92);
		k.glow('pwThin', CreateTorus('pwThin', { diameter: 1, thickness: 0.016, tessellation: 40 }, s), C(0.75, 0.96, 1), 0.9);   // a ring that stays thin when it is made wide
		// Mute, Report, Private Account: flat signs
		k.sheet('pwMute', k.painted('pwMute', 128, paintMute), null, 1, false);
		k.sheet('pwMark', k.painted('pwMark', 256, paintMark), null, 1, false);
		k.sheet('pwLock', k.painted('pwLock', 128, paintLock), null, 1, false);
		k.sheet('pwLost', k.painted('pwLost', 128, paintLost), null, 1, false);
		// Identity Guards and their shots; the plates of the Identity Shield (the last one left is amber)
		k.glow('pwOrb', CreateSphere('pwOrb', { diameter: 0.46, segments: 10 }, s), C(1, 0.97, 0.8));
		k.glow('pwDart', CreateSphere('pwDart', { diameter: 0.26, segments: 6 }, s), C(1, 1, 0.85));
		k.glow('pwPlate', CreateBox('pwPlate', { width: 0.13, height: 0.56, depth: 0.72 }, s), C(0.5, 1, 0.9), 0.94);
		k.glow('pwPlateLast', CreateBox('pwPlateLast', { width: 0.13, height: 0.56, depth: 0.72 }, s), C(1, 0.68, 0.22), 0.94);
		// Mountain Lightning
		k.glow('pwBolt', CreateBox('pwBolt', { width: 1, height: 0.1, depth: 0.2 }, s), C(1, 1, 1));
		k.glow('pwBoltGlow', CreateBox('pwBoltGlow', { width: 1, height: 0.05, depth: 0.7 }, s), C(0.62, 0.6, 1), 0.45);
		// Sunrise of Awareness: the sun, its rays, and warm light over the land
		k.sheet('pwSun', k.painted('pwSun', 256, paintSun), null, 1, false);
		k.sheet('pwRays', k.painted('pwRays', 512, paintRays), null, 0.85, true);
		k.glow('pwWarm', CreateGround('pwWarm', { width: 1, height: 1 }, s), C(1, 0.7, 0.22), 0.3);
		const warm = k.mat('pwWarm'); if (warm) warm.alphaMode = 1;                 // added to the land, as light is
	}

	// ------------------------------------------------------------------ one-off moments
	show(e: SimEvent, w: World) {
		const k = this.k;
		switch (e.type) {
			case 'power': this.begin(e.power, e.x, e.z, w); break;
			case 'plate': {                                                         // a plate of the shield breaks into pieces
				const bit = k.mat('pwBit'); if (bit) bit.emissiveColor = e.left ? C(0.6, 1, 0.92) : C(1, 0.72, 0.3);
				for (let i = 0; i < 12; i++) { const a = k.rnd() * 6.28, v = 3 + k.rnd() * 5; k.addFx('debris', 'pwBit', e.x, 0.9, e.z, 0.35 + k.rnd() * 0.3, 1.2 + k.rnd(), Math.cos(a) * v, 1 + k.rnd() * 3, Math.sin(a) * v); }
				k.ringAt(e.x, e.z, 4, 0.3, 'pwRing'); k.flashAt(e.x, e.z, 3.4, 0.18, e.left ? 'pwSoftCyan' : 'pwSoftOrange'); k.burst(e.x, 0.9, e.z, C(0.6, 1, 0.9), 22);
				break;
			}
			case 'turned':                                                          // enemy shots turn round at the edge of the mirror
				for (let i = 0; i + 1 < e.points.length; i += 2) { k.flashAt(e.points[i], e.points[i + 1], 1.1, 0.16, 'pwSoftCyan'); k.flashAt(e.points[i], e.points[i + 1], 0.5, 0.1, 'pwSoftWhite'); if (i % 4 === 0) k.ringAt(e.points[i], e.points[i + 1], 1.3, 0.2, 'pwRing', 0.5); }
				break;
			case 'dart': k.flashAt(e.x, e.z, 0.9, 0.1, 'pwSoftWhite'); k.flashAt(e.x, e.z, 1.5, 0.16, 'pwSoftGold'); k.burst(e.x, 0.7, e.z, C(1, 0.9, 0.5), 5); break;
			case 'thunder': this.lightning(e.x, e.z, e.big); break;
			case 'dawn':                                                            // the sun is up: its light sets off from the bottom of the field
				k.flashAt(0, 0, 14, 0.5, 'pwSoftWhite'); k.flashAt(1, 0, 22, 0.8, 'pwSoftGold');
				for (let i = 0; i < 3; i++) k.after(i * 0.12, () => { const f = k.addFx('ring', 'pwGold', 0, 0.4, 0, 0.7 + i * 0.15, 20 + i * 8); if (f) f.mesh.scaling.setAll(0.3); });
				k.burst(1, 1, 0, C(1, 0.85, 0.4), 80);
				break;
			case 'nova': this.lastFlash(); break;
		}
	}
	/** What is seen at the moment a power is used (what lasts is drawn by draw()). */
	private begin(id: PowerId, x: number, z: number, w: World) {
		const k = this.k, cx = A.length / 2;
		switch (id) {
			case 'rain': k.flashAt(cx, 0, 20, 0.6, 'pwSoftBlue'); k.ringAt(x, z, 5, 0.4, 'pwRing'); k.burst(x + 0.9, 1, z, C(0.6, 0.85, 1), 40); break;
			case 'falcon': k.flashAt(x, z, 4, 0.3, 'pwSoftGold'); k.ringAt(x, z, 5, 0.4, 'pwGold'); k.burst(x + 0.9, 1, z, C(1, 0.82, 0.4), 30); break;
			case 'mirror': k.flashAt(x, z, 5, 0.3, 'pwSoftCyan'); k.ringAt(x, z, TUNE.mirror.reach * 2, 0.35, 'pwRing'); k.burst(x, 1, z, C(0.8, 0.97, 1), 40); break;
			case 'mute':                                                            // silence goes out over the field in waves
				for (let i = 0; i < 3; i++) k.after(i * 0.13, () => { const f = k.addFx('ring', 'pwRing', x, 0.4, z, 0.6 + i * 0.12, 34); if (f) f.mesh.scaling.setAll(0.3); });
				k.flashAt(x + 5, z, 14, 0.5, 'pwSoftViolet');
				break;
			case 'report':                                                          // every enemy on screen is stamped
				for (const e of w.enemies) if (!e.dead && e.kind !== 'crate') { k.flashAt(e.x, e.z, e.r * 4, 0.3, 'pwSoftOrange'); k.ringAt(e.x, e.z, e.r * 5, 0.3, 'pwGold'); }
				k.flashAt(x, z, 4, 0.25, 'pwSoftOrange');
				break;
			case 'guards': for (const i of [0, 1]) { const at = guardSpot({ x, z }, i); k.flashAt(at.x, at.z, 2.6, 0.3, 'pwSoftGold'); k.ringAt(at.x, at.z, 2.4, 0.35, 'pwGold', 0.9); k.burst(at.x, 1, at.z, C(1, 0.9, 0.5), 18); } break;
			case 'armor': k.flashAt(x, z, 4.5, 0.35, 'pwSoftCyan'); k.ringAt(x, z, 4.2, 0.4, 'pwRing'); k.burst(x, 1, z, C(0.6, 1, 0.9), 40); break;
			case 'private': k.flashAt(x, z, 5, 0.4, 'pwSoftBlue'); k.ringAt(x, z, 3.2, 0.35, 'pwRing'); k.burst(x, 1, z, C(0.6, 0.75, 1), 30); break;
			case 'bolt': this.dark = 0.75; k.flashAt(x, z, 4, 0.25, 'pwSoftViolet'); k.ringAt(x, z, 4, 0.35, 'pwRing'); break;      // the sky darkens a blink before the strikes
			case 'aware': k.flashAt(x + 0.9, z, 3.5, 0.3, 'pwSoftGold'); k.ringAt(x + 0.9, z, 4, 0.4, 'pwGold'); k.burst(x + 0.9, 1, z, C(1, 0.88, 0.4), 40); break;   // Cyber leaves to raise the sun
		}
	}
	/** Lightning from the top of the screen down to one point: two strokes, a white flash and a ring where it lands. */
	private lightning(x: number, z: number, big: boolean) {
		const k = this.k;
		const stroke = (fat: number, glow: boolean) => {
			const n = 9, lean = (k.rnd() - 0.5) * 3.4;
			let px = x + 13, pz = z + lean;
			for (let i = 1; i <= n; i++) {
				const u = i / n, qx = x + 13 * (1 - u), qz = i === n ? z : z + lean * (1 - u) + (k.rnd() - 0.5) * 1.2;
				const len = Math.hypot(qx - px, qz - pz), ang = -Math.atan2(qz - pz, qx - px);
				for (const key of glow ? ['pwBolt', 'pwBoltGlow'] : ['pwBolt']) { const f = k.addFx('bolt', key, (px + qx) / 2, 0.9, (pz + qz) / 2, 0.24, 1); if (f) { f.mesh.scaling.set(len, 1, fat); f.mesh.rotation.y = ang; } }
				px = qx; pz = qz;
			}
		};
		stroke(big ? 2.2 : 1.4, true);
		k.after(0.08, () => stroke(big ? 1.2 : 0.8, false));
		k.flashAt(x, z, big ? 6 : 3, 0.16, 'pwSoftWhite'); k.flashAt(x, z, big ? 10 : 5.5, 0.4, 'pwSoftViolet');
		k.ringAt(x, z, big ? 8 : 4, 0.36, 'pwRing'); k.bloomAt(x, z, big ? 5 : 3, 0.7, 'pwShade');
		k.burst(x, 0.7, z, C(0.82, 0.86, 1), big ? 50 : 26);
	}
	/** Total Awareness ends: the light has crossed the whole field, and one last flash covers the map. No fire and no
	 *  smoke: this is a sunrise, not an explosion. */
	private lastFlash() {
		const k = this.k, cx = A.length / 2;
		this.afterglow = 1.6;
		k.bloomAt(cx, 0, 44, 0.9, 'pwSoftWhite'); k.bloomAt(cx, 0, 60, 1.7, 'pwSoftGold'); k.bloomAt(cx + 5, 0, 40, 1.3, 'pwSoftOrange');
		k.flashAt(cx, 0, 26, 0.5, 'pwSoftWhite');
		const rays = k.addFx('flash', 'pwRays', cx, 0.9, 0, 1.3, 30); if (rays) rays.mesh.scaling.set(4, 1, 4);
		// rings of light go out from where the sun stands, one after another, past the top of the field
		for (let i = 0; i < 7; i++) k.after(i * 0.12, () => { const f = k.addFx('ring', i % 2 ? 'pwGold' : 'pwRing', 2, 0.4, 0, 0.8 + i * 0.07, 30 + i * 6); if (f) f.mesh.scaling.setAll(0.3); });
		// and gold falls over the whole map
		for (let i = 0; i < 16; i++) k.after(0.1 + i * 0.09, () => { const bx = 1 + k.rnd() * (A.length - 1), bz = (k.rnd() - 0.5) * A.halfWidth * 2.2; k.flashAt(bx, bz, 2.6 + k.rnd() * 2, 0.4, i % 2 ? 'pwSoftGold' : 'pwSoftWhite'); k.burst(bx, 1.2, bz, i % 2 ? C(1, 0.86, 0.4) : C(1, 1, 0.8), 22); });
		k.burst(cx, 1, 0, C(1, 0.9, 0.5), 160);
	}

	// ------------------------------------------------------------------ per frame
	draw(w: World, move: number, lively: boolean) {
		const s = w.pw, k = this.k;
		if (!s) return;
		const t = k.time(), frame = k.frame(), half = k.halfW() + 1;
		/** A power about to end flickers. */
		const lit = (left: number, warn = 1.2) => left > warn || Math.floor(t * 10) % 2 === 0;
		const pair: [Body, number][] = w.ally ? [[w.player, 0], [w.ally.body, 1]] : [[w.player, 0]];
		const foes = w.enemies.filter(e => !e.dead && e.kind !== 'crate' && e.x < A.length + 1.5);
		let veil = 0;

		// Khareef Rain: drops fall over the whole field, the land dims, and every enemy stands in a pool of cold light
		if (s.rain > 0) {
			const fade = Math.min(1, s.rain / 1.2, (TUNE.rain.time - s.rain) / 0.35 + 0.15);   // it thins out before it stops
			veil = 0.36 * fade;
			const n = Math.round((k.reduce() ? 34 : 86) * fade);
			for (let i = 0; i < n; i++) {
				const a = hash(i), b = hash(i + 91), c = hash(i + 177), fall = (t * (1.5 + a * 0.8) + b) % 1, y = 7.5 * (1 - fall);
				const d = k.put('pwRain', i);
				d.position.set(-2 + c * (A.length + 4) - y * LIFT * 0.25, y, (b * 2 - 1) * half + fall * 0.5); d.rotation.z = 0.1; d.scaling.set(1, 0.7 + a * 0.6, 1);
			}
			for (const e of foes) k.soft('pwSoftBlue', 21e6 + e.id, e.x, e.z, e.r * 5, e.r * 5, 0.22);
			if (lively && frame % 2 === 0) k.ringAt(k.rnd() * A.length, (k.rnd() * 2 - 1) * half, 0.9, 0.24, 'pwRing', 0.14);
			if (s.rainTick > this.lastTick) for (const e of foes.slice(0, 16)) { k.flashAt(e.x, e.z, e.r * 2.6, 0.16, 'pwSoftCyan'); if (lively) k.burst(e.x, 0.9, e.z, C(0.7, 0.9, 1), 4); }   // a drop of damage just fell on each
			this.lastTick = s.rainTick;
		}
		if (this.dark > 0) { this.dark -= move; veil = Math.max(veil, 0.5 * Math.min(1, this.dark / 0.3)); }
		if (veil > 0) { const v = k.put('pwVeil', 1), m = k.mat('pwVeil'); v.position.set(A.length / 2, 0.1, 0); v.scaling.set(A.length + 16, 1, 60); if (m) m.alpha = veil; }

		// Falcon Dive: the lane is lit from end to end, and the falcon flies it with its shadow under it
		const f = s.falcon;
		if (f.on) {
			const lane = TUNE.falcon.half, flap = Math.sin(t * 15), y = 1.5;
			k.soft('pwSoftGold', 22e6, A.length / 2, f.z, A.length + 8, lane * 3.2, 0.16);
			for (const side of [-1, 1]) k.soft('pwSoftWhite', 22e6 + 2 + side, A.length / 2, f.z + side * lane, A.length + 8, 0.34, 0.18);
			k.soft('pwShade', 22e6, f.x - 0.5, f.z + 0.9, 5.5, 6.5, 0.2);
			k.soft('pwSoftGold', 22e6 + 5, f.x, f.z, 7, 7, 0.6);
			const m = k.put('pwFalcon', 1);
			m.position.set(f.x - y * LIFT, y, f.z); m.rotation.y = f.dir > 0 ? 0 : Math.PI; m.scaling.set(4.8, 1, 5.6 * (1 + 0.1 * flap));
			if (lively) {
				const tr = k.addFx('trail', 'pwSoftGold', f.x - f.dir * 2, 0.6, f.z, 0.3, 3.2); if (tr) tr.wide = 2.2;
				if (frame % 2 === 0) k.burst(f.x - f.dir * 1.5, 1, f.z + (k.rnd() - 0.5) * lane * 2, C(1, 0.86, 0.45), 6);
			}
		}

		// Rumour Mirror: a ring at the distance where shots turn, with shards of mirror going round it
		if (s.mirror > 0 && lit(s.mirror)) for (const [who, n] of pair) {
			if (who.down) continue;
			const R = TUNE.mirror.reach, ring = k.put('pwThin', 23e6 + n);
			ring.position.set(who.x, 0.24, who.z); ring.scaling.setAll(R * 2 * (1 + 0.03 * Math.sin(t * 9)));
			k.soft('pwSoftCyan', 23e6 + n, who.x, who.z, R * 2.5, R * 2.5, 0.2);
			for (let i = 0; i < 6; i++) { const a = t * 1.9 + i * Math.PI / 3, m = k.put('pwShard', 23e6 + n * 10 + i); m.position.set(who.x + Math.cos(a) * R, 0.72, who.z + Math.sin(a) * R); m.rotation.y = -a; m.scaling.setAll(1 + 0.22 * Math.sin(t * 9 + i * 2)); }
		}
		for (const b of w.bullets) if (b.back) { k.soft('pwSoftCyan', 23.5e6 + b.id, b.x, b.z, b.r * 9, b.r * 9, 0.38); k.soft('pwSoftWhite', 23.5e6 + b.id, b.x, b.z, b.r * 4.5, b.r * 4.5, 0.4); }   // a returned shot is ours now: cold light, not red

		// Mute: a crossed-out voice over every enemy
		if (s.mute > 0 && lit(s.mute)) for (const e of foes) {
			const big = e.kind === 'boss', y = big ? 2.6 : 1.7, m = k.put('pwMute', e.id);
			m.position.set(e.x + e.r * 0.5 - y * LIFT + 0.9, y, e.z + e.r * 0.75); m.rotation.y = UPRIGHT + Math.sin(t * 5 + e.id) * 0.08; m.scaling.setAll((big ? 2.3 : 1.15) * (1 + 0.06 * Math.sin(t * 7 + e.id)));
			k.soft('pwSoftViolet', 24e6 + e.id, e.x, e.z, e.r * 4, e.r * 4, 0.2);
		}

		// Report: brackets close around every marked enemy and turn slowly
		if (s.report > 0 && lit(s.report, 1.5)) for (const e of foes) {
			if (!s.marked.has(e.id)) continue;
			const big = e.kind === 'boss', y = big ? 0.16 : 1.45, size = (big ? e.r * 3.3 : e.r * 3 + 0.45) * (1 + 0.07 * Math.sin(t * 8 + e.id)), m = k.put('pwMark', e.id);
			m.position.set(e.x - y * LIFT + (big ? 0 : 0.35), y, e.z); m.rotation.y = t * 1.3; m.scaling.set(size, 1, size);
			k.soft('pwSoftOrange', 24.5e6 + e.id, e.x, e.z, e.r * 3.4, e.r * 3.4, 0.21);
		}

		// Identity Guards: two lights beside their fighter, and the shots they send
		for (const [who, n] of pair) {
			const left = s.guards[n];
			if (left <= 0 || who.down || !lit(left, 1.5)) continue;
			for (const i of [0, 1]) {
				const at = guardSpot(who, i), y = 1.05 + Math.sin(t * 4 + i * Math.PI + n) * 0.14, id = 25e6 + n * 2 + i;
				const orb = k.put('pwOrb', id); orb.position.set(at.x - y * LIFT + 0.6, y, at.z); orb.scaling.setAll(1 + 0.16 * Math.sin(t * 11 + i));
				const ring = k.put('pwGold', id); ring.position.copyFrom(orb.position); ring.scaling.setAll(0.95); ring.rotation.x = t * 3 + i; ring.rotation.z = t * 2.2;
				k.soft('pwSoftGold', id, at.x, at.z, 2.2, 2.2, 0.5); k.soft('pwSoftWhite', id, at.x, at.z, 0.8, 0.8, 0.52);
			}
		}
		for (const d of s.darts) {
			const m = k.put('pwDart', d.id); m.position.set(d.x, 0.8, d.z); m.scaling.setAll(1 + 0.2 * Math.sin(t * 30 + d.id));
			k.soft('pwSoftGold', 25.5e6 + d.id, d.x, d.z, 1.5, 1.5, 0.45);
			if (lively && (frame + d.id) % 2 === 0) k.addFx('trail', 'pwSoftGold', d.x - d.vx * 0.02, 0.5, d.z - d.vz * 0.02, 0.16, 1);
		}

		// Identity Shield: the plates that are left go round the fighter; the last one is amber and hurries
		for (const [who, n] of pair) {
			const c = s.armor[n];
			if (c <= 0 || who.down) continue;
			const last = c === 1, R = 1.15, spin = t * (last ? 4.4 : 2.4);
			for (let i = 0; i < c; i++) { const a = spin + i * Math.PI * 2 / 3, m = k.put(last ? 'pwPlateLast' : 'pwPlate', 26e6 + n * 3 + i); m.position.set(who.x + Math.cos(a) * R, 0.95, who.z + Math.sin(a) * R); m.rotation.y = -a; m.scaling.setAll(last ? 1 + 0.18 * Math.sin(t * 14) : 1); }
			k.soft(last ? 'pwSoftOrange' : 'pwSoftCyan', 26e6 + n, who.x, who.z, 3.1, 3.1, 0.18);
		}

		// Private Account: a lock over the fighter (the game draws the fighter half transparent), and enemies that have
		// nobody left to look at wear a question mark
		let hiddenAll = true, anyHidden = false;
		for (const [who, n] of pair) {
			const left = s.hidden[n];
			if (!who.down && left <= 0) hiddenAll = false;
			if (left <= 0 || who.down) continue;
			anyHidden = true;
			if (!lit(left)) continue;
			const y = 2.5, m = k.put('pwLock', 27e6 + n); m.position.set(who.x - y * LIFT + 1.5, y, who.z + 0.8); m.rotation.y = UPRIGHT; m.scaling.setAll(1.05 + 0.05 * Math.sin(t * 6));
			const ring = k.put('pwRing', 27e6 + n); ring.position.set(who.x, 0.16, who.z); ring.scaling.setAll(2 + 0.15 * Math.sin(t * 5));
			k.soft('pwSoftBlue', 27e6 + n, who.x, who.z, 2.8, 2.8, 0.17);
		}
		if (anyHidden && hiddenAll) for (const e of foes) {
			const big = e.kind === 'boss', y = big ? 2.6 : 1.8, m = k.put('pwLost', e.id);
			m.position.set(e.x - y * LIFT + 1 + 0.12 * Math.sin(t * 4 + e.id), y, e.z - e.r * 0.7); m.rotation.y = UPRIGHT; m.scaling.setAll(big ? 1.9 : 1);
		}

		// Mountain Lightning: a ring closes on each target, crossed by two lines, a blink before the strike
		for (const b of s.bolts) {
			const u = Math.max(0, Math.min(1, b.in / TUNE.bolt.delay)), ring = k.put('pwRing', 28e6 + b.id);
			ring.position.set(b.x, 0.34, b.z); ring.scaling.setAll(1.2 + 3.4 * u);
			k.soft('pwSoftViolet', 28e6 + b.id, b.x, b.z, 3.6, 3.6, 0.3);
			k.soft('pwSoftWhite', 28e6 + b.id, b.x, b.z, 0.26, 2 + 3 * u, 0.32); k.soft('pwSoftWhite', 28.5e6 + b.id, b.x, b.z, 2 + 3 * u, 0.26, 0.32);
		}

		this.drawDawn(w, move, lively, t);
	}

	/** Total Awareness, the Sunrise of Awareness. While the simulation counts down (novaIn) a sun climbs over the bottom
	 *  edge of the field with Cyber in front of it, its rays turning and the land warming; then its light crosses the
	 *  whole map as a wall of gold with Cyber riding it, taking small enemies and shots as it passes; the last flash is
	 *  lastFlash(). Everything follows the simulation's own numbers, so both devices see the same moment. */
	private drawDawn(w: World, move: number, lively: boolean, t: number) {
		const k = this.k, d = w.pw.dawn, rising = w.novaIn > 0, T = TUNE.aware;
		const who = d.by === 1 && w.ally ? w.ally.body : w.player, hx = who.x + 0.95, hz = who.z;
		if (!rising && !d.on && this.afterglow <= 0 && this.courierBack <= 0) { if (this.courierOut) { this.courierOut = false; k.courier()?.setEnabled(false); } return; }
		const u = rising ? ease(1 - w.novaIn / NOVA_DELAY) : 1, across = d.on ? (d.x - T.from) / (T.to - T.from) : rising ? 0 : 1;
		const fading = !rising && !d.on, glow = fading ? Math.max(0, this.afterglow / 1.6) : 1;
		if (fading) this.afterglow -= move;
		// the sun: under the edge at first, then standing over the bottom of the field, and a little higher as its light goes out
		if (glow > 0) {
			const sx = -6 + 6.2 * u + across * 2.2, size = (6.5 + 3 * u + across * 1.5) * (1 + 0.03 * Math.sin(t * 9));
			for (const [id, turn, wide] of [[1, t * 0.5, 3.6], [2, -t * 0.8 + 0.4, 2.6]]) { const r = k.put('pwRays', id); r.position.set(sx, 0.34 + id * 0.02, 0); r.rotation.y = turn; r.scaling.set(size * wide * (0.4 + 0.6 * u) * glow, 1, size * wide * (0.4 + 0.6 * u) * glow); }
			const sun = k.put('pwSun', 1), sm = k.mat('pwSun'); sun.position.set(sx, 0.42, 0); sun.scaling.set(size, 1, size); if (sm) sm.alpha = glow;
			k.soft('pwSoftGold', 29e6 + 1, sx + 1.5, 0, 16 * u * glow, 30 * u * glow, 0.3);
			// the land warms: a little while the sun rises, fully where its light has passed
			const warm = k.put('pwWarm', 1), wm = k.mat('pwWarm'), reach = d.on ? Math.max(1, d.x + 3) : fading ? A.length + 6 : A.length + 6;
			warm.position.set(-3 + reach / 2, 0.14, 0); warm.scaling.set(reach, 1, 60); if (wm) wm.alpha = (d.on || fading ? 0.28 : 0.16 * u) * glow;
		}
		// the wall of light
		if (d.on) {
			const beat = 1 + 0.12 * Math.sin(t * 34);
			k.soft('pwSoftOrange', 29e6 + 2, d.x - 3, 0, 10, 90, 0.8); k.soft('pwSoftGold', 29e6 + 3, d.x, 0, 4.6 * beat, 90, 0.86); k.soft('pwSoftWhite', 29e6 + 4, d.x + 0.2, 0, 1.3 * beat, 90, 0.9);
			if (lively) for (let i = 0; i < 3; i++) { const z = (k.rnd() * 2 - 1) * (k.halfW() + 0.5); k.burst(d.x + 0.3, 0.9, z, C(1, 0.88, 0.45), 7); if (i === 0) k.addFx('trail', 'pwSoftWhite', d.x, 0.7, z, 0.35, 2.2); }
		}
		// Cyber: to the sun while it rises, on the crest of the light while it crosses, then home
		const n = k.courier(), at = this.courierAt;
		this.courierOut = true; this.courierOf = d.by;
		if (rising) { const c = ease(Math.min(1, (1 - w.novaIn / NOVA_DELAY) / 0.6)); at.x = hx + (1.4 - hx) * c; at.z = hz * (1 - c); at.y = 1 + 2.4 * Math.sin(c * Math.PI / 2); at.k = c; this.courierBack = 0.75; }
		else if (d.on) { at.x = d.x + 1; at.z = 0; at.y = 3.4; at.k = 1; this.courierBack = 0.75; }
		else if (this.courierBack > 0) {
			this.courierBack -= move;
			const c = ease(Math.max(0, this.courierBack / 0.75));                    // 1 at the top of the field .. 0 at home
			at.x = hx + (T.to + 1 - hx) * c; at.z = hz * (1 - c); at.y = 1 + 2.4 * c; at.k = c;
			if (this.courierBack <= 0) { this.courierOut = false; n?.setEnabled(false); return; }
		} else { this.courierOut = false; n?.setEnabled(false); return; }
		if (n) { n.setEnabled(true); n.position.set(at.x - at.y * LIFT * 0.4, at.y, at.z); n.rotation.set(0, Math.sin(t * 5) * 0.2, -0.3 * Math.sin(at.k * Math.PI)); n.scaling.setAll(1.1 + 1.6 * at.k); }
		k.soft('pwSoftGold', 29e6 + 5, at.x, at.z, 2.4 + 2 * at.k, 2.4 + 2 * at.k, 0.5);
		if (lively && k.frame() % 2 === 0) k.burst(at.x - 0.4, at.y, at.z, C(1, 0.88, 0.4), 5);
	}

	/** Between stages and screens: nothing is left over. */
	clear() { this.afterglow = 0; this.dark = 0; this.courierBack = 0; this.courierOut = false; }
}

// ------------------------------------------------------------------ the painted pictures
/** A rectangle with round corners (drawn by hand: older phones have no ready-made one). */
function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
/** A falcon seen from above, head toward +x of the picture: cream body, golden wings with dark tips, all inside a
 *  dark edge and a pale halo so it reads over sand and over sea. */
function paintFalcon(g: CanvasRenderingContext2D, S: number) {
	const c = S / 2;
	g.translate(c, c);
	const wing = (side: number) => { g.beginPath(); g.moveTo(42, side * 8); g.quadraticCurveTo(40, side * 70, 6, side * 120); g.lineTo(-14, side * 112); g.lineTo(-10, side * 96); g.lineTo(-30, side * 92); g.lineTo(-24, side * 76); g.lineTo(-44, side * 70); g.quadraticCurveTo(-40, side * 30, -34, side * 10); g.closePath(); };
	const tail = () => { g.beginPath(); g.moveTo(-50, -12); g.lineTo(-112, -34); g.lineTo(-100, -12); g.lineTo(-116, 0); g.lineTo(-100, 12); g.lineTo(-112, 34); g.lineTo(-50, 12); g.closePath(); };
	const body = () => { g.beginPath(); g.ellipse(6, 0, 66, 21, 0, 0, Math.PI * 2); };
	const head = () => { g.beginPath(); g.arc(76, 0, 17, 0, Math.PI * 2); };
	// halo, then the dark edge
	g.shadowColor = 'rgba(255,225,130,0.95)'; g.shadowBlur = 16; g.fillStyle = '#2b1806';
	for (const draw of [() => wing(-1), () => wing(1), tail, body, head]) { draw(); g.fill(); }
	g.shadowBlur = 0; g.lineJoin = 'round'; g.strokeStyle = '#2b1806'; g.lineWidth = 9;
	for (const draw of [() => wing(-1), () => wing(1), tail, body, head]) { draw(); g.stroke(); }
	for (const side of [-1, 1]) {
		const grd = g.createLinearGradient(0, 0, 0, side * 120); grd.addColorStop(0, '#ffd772'); grd.addColorStop(0.55, '#f0a024'); grd.addColorStop(0.86, '#a85a10'); grd.addColorStop(1, '#3a2108');
		wing(side); g.fillStyle = grd; g.fill();
		g.strokeStyle = 'rgba(90,45,8,0.75)'; g.lineWidth = 3;
		for (const k of [0.3, 0.5, 0.7, 0.88]) { g.beginPath(); g.moveTo(30 - k * 26, side * (14 + k * 100)); g.lineTo(-28 - k * 6, side * (14 + k * 62)); g.stroke(); }   // the lines of the feathers
	}
	tail(); g.fillStyle = '#c9781a'; g.fill();
	g.strokeStyle = '#fff3c4'; g.lineWidth = 5; g.beginPath(); g.moveTo(-104, -22); g.lineTo(-108, 22); g.stroke();
	const chest = g.createLinearGradient(-60, 0, 80, 0); chest.addColorStop(0, '#d98f25'); chest.addColorStop(0.5, '#fff1c9'); chest.addColorStop(1, '#ffffff');
	body(); g.fillStyle = chest; g.fill();
	head(); g.fillStyle = '#fffaf0'; g.fill();
	g.fillStyle = '#ffb300'; g.beginPath(); g.moveTo(90, -7); g.lineTo(112, 0); g.lineTo(90, 7); g.closePath(); g.fill(); g.strokeStyle = '#2b1806'; g.lineWidth = 3; g.stroke();
	g.fillStyle = '#1a0f04'; for (const side of [-1, 1]) { g.beginPath(); g.arc(80, side * 9, 3.6, 0, Math.PI * 2); g.fill(); }
}
/** Mute: a white speech bubble on a violet disc, struck through in red. */
function paintMute(g: CanvasRenderingContext2D, S: number) {
	const c = S / 2;
	g.beginPath(); g.arc(c, c, 56, 0, Math.PI * 2); g.fillStyle = 'rgba(52,22,96,0.92)'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke();
	g.fillStyle = '#ffffff'; rounded(g, c - 34, c - 28, 68, 44, 12); g.fill();
	g.beginPath(); g.moveTo(c - 14, c + 12); g.lineTo(c - 20, c + 34); g.lineTo(c + 4, c + 14); g.closePath(); g.fill();
	g.fillStyle = '#34165f'; for (const dx of [-17, 0, 17]) { g.beginPath(); g.arc(c + dx, c - 6, 5, 0, Math.PI * 2); g.fill(); }
	g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = 20; g.beginPath(); g.moveTo(c - 36, c - 36); g.lineTo(c + 36, c + 36); g.stroke();
	g.strokeStyle = '#ff2f55'; g.lineWidth = 12; g.beginPath(); g.moveTo(c - 36, c - 36); g.lineTo(c + 36, c + 36); g.stroke();
}
/** Report: four corner brackets, amber inside a dark edge. The middle is left open for the enemy. */
function paintMark(g: CanvasRenderingContext2D, S: number) {
	const c = S / 2, R = 104, L = 46;
	g.lineCap = 'round'; g.lineJoin = 'round';
	for (const [color, width] of [['#3a1500', 26], ['#ffb11f', 16], ['#fff4c2', 5]] as [string, number][]) {
		g.strokeStyle = color; g.lineWidth = width;
		for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.moveTo(c + sx * R, c + sy * (R - L)); g.lineTo(c + sx * R, c + sy * R); g.lineTo(c + sx * (R - L), c + sy * R); g.stroke(); }
	}
}
/** Private Account: a padlock on a blue disc. */
function paintLock(g: CanvasRenderingContext2D, S: number) {
	const c = S / 2;
	g.beginPath(); g.arc(c, c, 56, 0, Math.PI * 2); g.fillStyle = 'rgba(14,44,110,0.92)'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke();
	g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = 11; g.beginPath(); g.moveTo(c - 18, c - 4); g.lineTo(c - 18, c - 18); g.arc(c, c - 18, 18, Math.PI, 0); g.lineTo(c + 18, c - 4); g.stroke();
	g.fillStyle = '#ffd24a'; rounded(g, c - 30, c - 6, 60, 44, 9); g.fill(); g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
	g.fillStyle = '#0e2c6e'; g.beginPath(); g.arc(c, c + 12, 6.5, 0, Math.PI * 2); g.fill(); g.fillRect(c - 3, c + 12, 6, 14);
}
/** An enemy that has lost sight of its prey: a question mark on a dark disc (drawn from strokes, so it reads the same
 *  whichever way a sheet is laid). */
function paintLost(g: CanvasRenderingContext2D, S: number) {
	const c = S / 2;
	g.beginPath(); g.arc(c, c, 50, 0, Math.PI * 2); g.fillStyle = 'rgba(20,24,40,0.88)'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#9fd0ff'; g.stroke();
	g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = 12;
	g.beginPath(); g.arc(c, c - 14, 17, Math.PI, Math.PI * 0.5); g.lineTo(c, c + 14); g.stroke();
	g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c + 32, 7.5, 0, Math.PI * 2); g.fill();
}
/** The sun: white at its heart, then yellow, gold and orange, with a soft edge. */
function paintSun(g: CanvasRenderingContext2D, S: number) {
	const c = S / 2, grd = g.createRadialGradient(c, c, 0, c, c, c);
	grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,250,200,1)'); grd.addColorStop(0.52, 'rgba(255,214,70,1)'); grd.addColorStop(0.7, 'rgba(255,150,30,0.95)'); grd.addColorStop(0.82, 'rgba(255,110,20,0.5)'); grd.addColorStop(1, 'rgba(255,100,20,0)');
	g.fillStyle = grd; g.fillRect(0, 0, S, S);
}
/** The rays of the sun: sixteen wedges of light, long and short in turn, fading outward. */
function paintRays(g: CanvasRenderingContext2D, S: number) {
	const c = S / 2;
	for (let i = 0; i < 16; i++) {
		const a = i / 16 * Math.PI * 2, long = i % 2 === 0, R = long ? c * 0.98 : c * 0.7, w = long ? 0.075 : 0.05;
		const grd = g.createRadialGradient(c, c, c * 0.12, c, c, R); grd.addColorStop(0, 'rgba(255,246,190,0.95)'); grd.addColorStop(0.5, 'rgba(255,205,80,0.5)'); grd.addColorStop(1, 'rgba(255,170,40,0)');
		g.fillStyle = grd; g.beginPath(); g.moveTo(c + Math.cos(a - w * 2.2) * c * 0.1, c + Math.sin(a - w * 2.2) * c * 0.1); g.lineTo(c + Math.cos(a - w) * R, c + Math.sin(a - w) * R); g.lineTo(c + Math.cos(a + w) * R, c + Math.sin(a + w) * R); g.lineTo(c + Math.cos(a + w * 2.2) * c * 0.1, c + Math.sin(a + w * 2.2) * c * 0.1); g.closePath(); g.fill();
	}
}
