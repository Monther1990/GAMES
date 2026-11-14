// The picture of the nine weapons of part 2: everything a fighter's weapon puts on the field (the Shots of the
// simulation) and the one-off effects of firing, striking and bursting. Nothing here is a shot of part 1 in another
// colour: each weapon has its own shapes (a drop of water, an incense burner and its smoke, a watchtower, a palm blade,
// the cone of a lighthouse, a whirlpool, a falcon, an iron shell and its target ring, a star and its ring of light).
// The arena owns the pools, the soft glows and the effects; it hands them over as a Kit, so this file only says what
// to draw. It draws from the world as it is, and so works the same on a supporter's device (coop.ts sends what it needs).
// Axes as everywhere: x up the screen, y height, z across. The camera looks down at a slant from behind the player, so a
// thing lifted off the ground is seen further up the screen: that is how lobbed and falling things show their height.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { WeaponId } from '../sim/economy';
import { HALO_SPEED, HALO_START } from '../sim/weapons';
import type { SimEvent, World } from '../sim/world';
import { C, Models } from './models';
import { makeStar } from './star';

/** What the arena lends: its pools of instances, its soft glows and its passing effects. */
export interface Kit {
	scene: Scene; models: Models;
	pool(key: string): { put(id: number): InstancedMesh };
	/** Registers a shape that already has its material. */
	solid(key: string, mesh: Mesh): void;
	/** Registers a shape that glows in one colour. */
	glow(key: string, mesh: Mesh, color: Color3, alpha?: number): void;
	/** Registers a flat painted sheet: with no colour it shows the painting itself; `add` adds its light to what is under it. */
	sheet(key: string, tex: DynamicTexture, color: Color3 | null, alpha: number, add: boolean): void;
	painted(name: string, size: number, draw: (g: CanvasRenderingContext2D, size: number) => void): DynamicTexture;
	soft(key: string, id: number, x: number, z: number, sx: number, sz?: number, y?: number): InstancedMesh;
	fx(kind: 'ring' | 'trail' | 'flash' | 'bloom', pool: string, x: number, y: number, z: number, life: number, size: number): { mesh: InstancedMesh; wide: number } | null;
	ring(x: number, z: number, size: number, life?: number, key?: string, y?: number): void;
	flash(x: number, z: number, size: number, life?: number, key?: string): void;
	bloom(x: number, z: number, size: number, life: number, key: string): void;
	burst(x: number, y: number, z: number, color: Color3, count: number): void;
	rnd(): number;
}

/** The colour of each weapon's sparks. */
export const SHOT_COLORS: Record<WeaponId, Color3> = {
	pulse: C(0.4, 0.82, 1), scatter: C(1, 0.82, 0.5), arc: C(0.82, 0.62, 1), disc: C(0.5, 1, 0.45), beam: C(1, 0.9, 0.5),
	wave: C(0.35, 0.9, 0.95), missile: C(1, 0.72, 0.38), plasma: C(1, 0.55, 0.2), shield: C(1, 0.88, 0.4)
};
/** The soft glow of each weapon (the arena's glows), at the muzzle and where it strikes. */
export const SHOT_GLOW: Record<WeaponId, string> = { pulse: 'softCyan', scatter: 'softGold', arc: 'softViolet', disc: 'softGreen', beam: 'softGold', wave: 'softBlue', missile: 'softOrange', plasma: 'softOrange', shield: 'softGold' };
const hex = (h: string) => Color3.FromHexString(h);
interface Place { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number }
/** Colours every vertex of a solid and puts it in place, ready to be merged (as models.ts does for the enemies). */
function part(m: Mesh, color: Color3, p: Place = {}): Mesh {
	const n = m.getTotalVertices(), data = new Float32Array(n * 4);
	for (let i = 0; i < n; i++) { data[i * 4] = color.r; data[i * 4 + 1] = color.g; data[i * 4 + 2] = color.b; data[i * 4 + 3] = 1; }
	m.setVerticesData(VertexBuffer.ColorKind, data);
	m.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0); m.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0); m.scaling.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
	m.computeWorldMatrix(true);
	return m;
}
/** How many stars may be in the air at once (each is a small model of its own, not an instance). */
const MAX_STARS = 8;

export class ShotView {
	private stars: TransformNode[] = [];
	/** Shots seen in the last frame: one that is not in it was just born, and gets its opening effect. */
	private known = new Set<number>();
	private t = 0; private frame = 0;

	constructor(private k: Kit) { this.build(); }

	// ------------------------------------------------------------------ shapes
	private build() {
		const k = this.k, s = k.scene, flat = k.models.flat, lit = k.models.bright;
		const sphere = (d: number, seg = 8) => CreateSphere('s', { diameter: d, segments: seg }, s);
		const cyl = (d: number, h: number, tess = 8, top = d) => CreateCylinder('c', { diameterBottom: d, diameterTop: top, height: h, tessellation: tess }, s);
		const box = (w: number, h: number, d: number) => CreateBox('b', { width: w, height: h, depth: d }, s);
		const made = (key: string, parts: Mesh[], mat = flat) => { const m = Mesh.MergeMeshes(parts, true, true)!; m.material = mat; m.isPickable = false; k.solid(key, m); };
		const prism = (pts: number[][], h: number, color: Color3, p: Place = {}) => part(k.models.prism(pts, h), color, p);

		// نبع الفلج: a drop of water (round at the front, drawn out to a point behind) and the beads it bursts into
		made('drop', [part(sphere(0.4), hex('#eafcff'), { x: 0.14, sy: 0.8 }), part(cyl(0.38, 0.62, 8, 0), hex('#2aa9ff'), { x: -0.24, rz: Math.PI / 2, sy: 1, sx: 0.8 }), part(sphere(0.16, 6), hex('#ffffff'), { x: 0.22, y: 0.1 })]);
		made('bead', [part(sphere(0.3), hex('#8fdcff'), { sy: 0.8 }), part(sphere(0.13, 6), hex('#ffffff'), { x: 0.05, y: 0.09 })]);
		k.glow('ripple', CreateTorus('rp', { diameter: 1, thickness: 0.05, tessellation: 24 }, s), C(0.7, 0.93, 1), 0.9);

		// بخور اللبان: the burner (a footed bowl with a glowing coal), then its smoke
		made('burner', [part(cyl(0.3, 0.1, 8, 0.2), hex('#8a5a22'), { y: -0.2 }), part(cyl(0.12, 0.14, 6), hex('#b9812f'), { y: -0.1 }), part(cyl(0.24, 0.26, 8, 0.5), hex('#e0aa3e'), { y: 0.08 }),
			part(cyl(0.54, 0.05, 8), hex('#fff0b0'), { y: 0.22 }), part(sphere(0.3, 6), hex('#ff7a1a'), { y: 0.26, sy: 0.6 }), part(sphere(0.15, 6), hex('#fff3c0'), { y: 0.34 })]);
		const smoke = k.painted('smoke', 256, (g, S) => {
			const blob = (x: number, y: number, r: number, a: string, b: string) => { const d = g.createRadialGradient(x, y, 0, x, y, r); d.addColorStop(0, a); d.addColorStop(1, b); g.fillStyle = d; g.fillRect(0, 0, S, S); };
			for (let i = 0; i < 7; i++) { const a = i * 0.9; blob(S / 2 + Math.cos(a) * 46, S / 2 + Math.sin(a) * 46, 78, 'rgba(74,44,22,0.42)', 'rgba(74,44,22,0)'); }   // a brown shade first, so pale smoke shows on pale sand
			for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 14 + (i % 4) * 16; blob(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 46 + (i % 3) * 8, 'rgba(255,243,214,0.8)', 'rgba(255,226,170,0)'); }
		});
		k.sheet('smoke', smoke, null, 0.92, false);
		k.glow('smokeEdge', CreateTorus('se', { diameter: 1, thickness: 0.022, tessellation: 36 }, s), C(1, 0.86, 0.5), 0.75);
		const dashes = k.painted('dashes', 256, (g, S) => {                    // the ring of a cloud that slows: broken, pale and cold
			g.lineCap = 'round';
			for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.strokeStyle = 'rgba(40,60,120,0.75)'; g.lineWidth = 13; g.beginPath(); g.arc(S / 2, S / 2, 112, a, a + 0.28); g.stroke(); g.strokeStyle = 'rgba(205,225,255,1)'; g.lineWidth = 7; g.beginPath(); g.arc(S / 2, S / 2, 112, a, a + 0.28); g.stroke(); }
		});
		k.sheet('slowRing', dashes, null, 1, false);

		// برج الحراسة: a round Omani watchtower of mud brick, wider at the foot, with a toothed top, a door and a flag; and its darts
		const tower: Mesh[] = [part(cyl(1, 1.3, 12, 0.74), hex('#cfa56c'), { y: 0.65 }), part(cyl(0.8, 0.1, 12), hex('#a47c48'), { y: 1.0 }), part(cyl(0.92, 0.14, 12), hex('#e2c491'), { y: 1.37 }),
			part(box(0.06, 0.42, 0.24), hex('#4e3218'), { x: -0.47, y: 0.22, rz: -0.1 }), part(box(0.05, 0.16, 0.08), hex('#3a2612'), { x: -0.41, y: 0.85, rz: -0.1 }),
			part(cyl(0.04, 0.7, 5), hex('#f4efe2'), { y: 1.8 }), part(box(0.03, 0.2, 0.34), hex('#d92c2c'), { y: 2.02, z: 0.19 }), part(box(0.035, 0.07, 0.34), hex('#ffffff'), { y: 2.09, z: 0.19 }), part(box(0.035, 0.07, 0.34), hex('#1f9d55'), { y: 1.955, z: 0.19 })];
		for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; tower.push(part(box(0.17, 0.2, 0.17), hex('#ecd3a4'), { x: Math.cos(a) * 0.38, y: 1.54, z: Math.sin(a) * 0.38, ry: -a })); }
		made('tower', tower, lit);
		k.glow('towerRing', CreateTorus('tr2', { diameter: 1, thickness: 0.045, tessellation: 28 }, s), C(0.85, 0.68, 1), 0.9);
		k.glow('towerLamp', sphere(1, 8), C(0.97, 0.9, 1), 0.95);
		const dart = cyl(0.2, 0.62, 4, 0); dart.rotation.z = -Math.PI / 2; dart.bakeCurrentTransformIntoVertices();   // a slim point flying tip first
		k.glow('dart', dart, C(0.97, 0.9, 1));

		// طبق السعف: three palm leaves around a woven middle, spinning
		const leaf = (a: number, len: number, wide: number, c: string, y: number) => prism([[0.08, -wide], [len * 0.55, -wide * 0.8], [len, 0], [len * 0.55, wide * 0.8], [0.08, wide]], 0.07, hex(c), { y, ry: -a });
		const blade: Mesh[] = [part(cyl(0.34, 0.1, 10), hex('#f2c641'), {}), part(cyl(0.18, 0.13, 8), hex('#fff4c2'), {})];
		for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; blade.push(leaf(a, 0.74, 0.17, '#2f9e44', 0), leaf(a, 0.56, 0.07, '#b9f27c', 0.03)); }
		made('blade', blade);
		k.glow('bladeRing', CreateTorus('br', { diameter: 1, thickness: 0.05, tessellation: 24 }, s), C(0.8, 1, 0.6), 0.85);

		// فنار مسقط: the cone of the lighthouse (narrow at the lamp, wide and fading at its far end), a wide warm glow and a bright heart with an amber edge that shows on sand
		const cone = (name: string, near: number, far: number, stops: (a: number) => [number, string][]) => k.painted(name, 256, (g, S) => {
			for (let x = 0; x < S; x++) {
				const u = x / (S - 1), half = S * (near + (far - near) * u), a = Math.min(1, u / 0.05) * Math.min(1, (1 - u) / 0.16) * (1 - 0.3 * u);
				const d = g.createLinearGradient(0, S / 2 - half, 0, S / 2 + half);
				for (const [at, col] of stops(a)) d.addColorStop(at, col);
				g.fillStyle = d; g.fillRect(x, S / 2 - half, 1, half * 2);
			}
		});
		k.sheet('rayGlow', cone('rayGlow', 0.07, 0.5, a => [[0, 'rgba(255,205,90,0)'], [0.5, `rgba(255,232,150,${a})`], [1, 'rgba(255,205,90,0)']]), null, 0.8, true);
		k.sheet('rayCore', cone('rayCore', 0.05, 0.3, a => [[0, 'rgba(255,140,20,0)'], [0.22, `rgba(255,165,40,${a * 0.85})`], [0.42, `rgba(255,250,225,${a})`], [0.58, `rgba(255,250,225,${a})`], [0.78, `rgba(255,165,40,${a * 0.85})`], [1, 'rgba(255,140,20,0)']]), null, 1, false);
		k.glow('lamp', sphere(1, 8), C(1, 0.97, 0.8), 0.95);
		made('flame', [part(cyl(0.34, 0.6, 6, 0), hex('#ff7a1a'), { y: 0.3 }), part(cyl(0.2, 0.38, 6, 0), hex('#ffe066'), { y: 0.22 })]);

		// دوّامة بحر العرب: deep water turning, with arms of foam
		const spiral = k.painted('spiral', 256, (g, S) => {
			const c = S / 2, d = g.createRadialGradient(c, c, 4, c, c, c);
			d.addColorStop(0, 'rgba(2,18,52,0.95)'); d.addColorStop(0.2, 'rgba(8,62,128,0.85)'); d.addColorStop(0.62, 'rgba(22,138,186,0.62)'); d.addColorStop(0.9, 'rgba(70,206,232,0.3)'); d.addColorStop(1, 'rgba(70,206,232,0)');
			g.fillStyle = d; g.fillRect(0, 0, S, S);
			g.lineCap = 'round';
			for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 46; i++) {       // each arm winds outward, thick and white at the middle, thin at the rim
				const u0 = i / 46, u1 = (i + 1) / 46, a0 = arm * Math.PI * 2 / 3 + u0 * 5.2, a1 = arm * Math.PI * 2 / 3 + u1 * 5.2, r0 = 10 + u0 * (c - 22), r1 = 10 + u1 * (c - 22);
				g.strokeStyle = `rgba(240,252,255,${0.95 - 0.55 * u0})`; g.lineWidth = 9 - 6 * u0;
				g.beginPath(); g.moveTo(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0); g.lineTo(c + Math.cos(a1) * r1, c + Math.sin(a1) * r1); g.stroke();
			}
		});
		k.sheet('spiral', spiral, null, 1, false);
		k.glow('whirlRim', CreateTorus('wr', { diameter: 1, thickness: 0.035, tessellation: 36 }, s), C(0.82, 0.98, 1), 0.9);

		// صقور الصحراء: a falcon seen from above (body, pale head, fanned tail), and its two wings as a shape of their own so they can beat
		made('falcon', [part(sphere(0.5, 8), hex('#7b4a21'), { sx: 1.35, sy: 0.5, sz: 0.5 }), part(sphere(0.24, 6), hex('#f3e4c2'), { x: 0.33, y: 0.03 }), part(cyl(0.1, 0.16, 4, 0), hex('#f2b01e'), { x: 0.5, rz: -Math.PI / 2 }),
			prism([[-0.22, 0], [-0.66, 0.2], [-0.6, 0], [-0.66, -0.2]], 0.05, hex('#5d3716'), {}), prism([[-0.5, 0], [-0.68, 0.19], [-0.68, -0.19]], 0.06, hex('#f3e4c2'), { y: 0.01 })]);
		const wing = (side: number) => [prism([[0.2, side * 0.08], [0.02, side * 0.86], [-0.24, side * 0.8], [-0.2, side * 0.08]], 0.05, hex('#5d3716'), {}),
			prism([[0.02, side * 0.5], [0.0, side * 0.84], [-0.22, side * 0.78], [-0.16, side * 0.5]], 0.06, hex('#fff1d0'), { y: 0.01 })];   // pale wing tips, so the bird is not lost over sand
		made('falconWings', [...wing(1), ...wing(-1)]);

		// مدفع القلعة: an iron shell with a burning fuse, the ring that marks where it will land, and a glowing fragment
		made('shell', [part(sphere(0.56, 10), hex('#2b3040'), {}), part(sphere(0.3, 6), hex('#77809a'), { x: -0.1, y: 0.14, z: -0.08 }), part(cyl(0.6, 0.07, 12), hex('#11141c'), { rz: 0.5 }), part(sphere(0.2, 6), hex('#ffb347'), { y: 0.3 }), part(sphere(0.1, 5), hex('#ffffff'), { y: 0.36 })]);
		made('frag', [prism([[0.2, 0], [0.05, 0.07], [-0.14, 0.12], [-0.06, 0], [-0.16, -0.1], [0.04, -0.06]], 0.1, hex('#ff8a1e'), {}), part(sphere(0.12, 5), hex('#fff2c4'), {})]);
		const reticle = k.painted('reticle', 256, (g, S) => {
			const c = S / 2;
			for (const [w, col] of [[15, 'rgba(50,25,0,0.75)'], [7, 'rgba(255,238,170,1)']] as [number, string][]) {   // pale gold inside a dark edge: never the red of enemy danger
				g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'butt';
				for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(c, c, 104, i * Math.PI / 2 + 0.2, (i + 1) * Math.PI / 2 - 0.2); g.stroke(); }   // four arcs, with gaps
				for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.beginPath(); g.moveTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60); g.lineTo(c + Math.cos(a) * 116, c + Math.sin(a) * 116); g.stroke(); }
			}
			g.fillStyle = 'rgba(255,210,110,0.1)'; g.beginPath(); g.arc(c, c, 96, 0, Math.PI * 2); g.fill();
		});
		k.sheet('reticle', reticle, null, 1, false);

		// نجمة سهيل: the tail of light behind a falling star, and the ring of light that goes out from where it lands
		k.glow('starTail', box(1, 1, 1), C(1, 0.93, 0.55), 0.8);
		k.glow('starTailCore', box(1, 1, 1), C(1, 1, 0.92), 0.95);
		const ringOf = (name: string, strokes: [number, string][]) => k.painted(name, 256, (g, S) => { for (const [w, col] of strokes) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(S / 2, S / 2, 112, 0, Math.PI * 2); g.stroke(); } });
		k.sheet('haloAdd', ringOf('haloAdd', [[30, 'rgba(255,190,60,0.22)'], [18, 'rgba(255,214,110,0.5)'], [8, 'rgba(255,250,225,1)']]), null, 1, true);
		k.sheet('haloEdge', ringOf('haloEdge', [[13, 'rgba(120,60,0,0.55)'], [7, 'rgba(255,170,30,1)']]), null, 1, false);
	}

	// ------------------------------------------------------------------ every frame
	/** Draws everything the weapons have on the field. `lively` is false while the game is paused or motion is reduced. */
	draw(w: World, t: number, frame: number, lively: boolean) {
		this.t = t; this.frame = frame;
		const k = this.k, P = (key: string) => k.pool(key), now = new Set<number>();
		let stars = 0;
		for (const s of w.shots) {
			const mine = s.owner === 1 && w.ally ? w.ally : null, lvl = mine ? mine.weapon.level : w.weapon.level, who = mine ? mine.body : w.player;
			const id = s.id, own = id * 8, low = -id * 8, G = 1 + (lvl - 1) * 0.09, u = Math.min(1, s.age / Math.max(0.01, s.total)), left = s.total - s.age;
			const fresh = !this.known.has(id), every = (n: number) => lively && (frame + id) % n === 0;
			now.add(id);
			switch (s.kind) {
				case 'drop': {                                                      // a fat drop that wobbles as it flies; from level 3 it leaves beads of spray behind
					const m = P('drop').put(id), wob = 1 + 0.16 * Math.sin(t * 34 + id);
					m.position.set(s.x, 0.7, s.z); m.scaling.set(G * 1.15 * wob, G * 1.15, G * 1.15 / wob);
					k.soft('softCyan', low, s.x - 0.25, s.z, 1.9 * G, 0.85 * G);
					if (lvl >= 4) k.soft('softWhite', low, s.x + 0.1, s.z, 0.55, 0.55, 0.56);
					if (lvl >= 3 && every(3)) k.fx('trail', 'bead', s.x - 0.5, 0.62, s.z + (k.rnd() - 0.5) * 0.3, 0.2, 0.75);
					break;
				}
				case 'droplet': {                                                   // a bead of spray; one that can pass through an enemy is larger and drags a tail
					const m = P('bead').put(id), big = s.n > 0 || lvl >= 5 ? 1.3 : 1;
					m.position.set(s.x, 0.68, s.z); m.scaling.setAll(big * (1 + 0.2 * Math.sin(t * 30 + id)));
					k.soft('softCyan', low, s.x, s.z, 1 * big, 1 * big);
					if (big > 1 && every(2)) k.fx('trail', 'bead', s.x, 0.62, s.z, 0.16, 0.8);
					break;
				}
				case 'burner': {                                                    // thrown in a high arc, turning over; a ring opens where its smoke will be
					const y = 0.7 + 3.4 * 4 * u * (1 - u), m = P('burner').put(id);
					m.position.set(s.x, y, s.z); m.rotation.x = t * 9 + id; m.rotation.z = t * 6; m.scaling.setAll(1.35 * G);
					k.soft('shade', low, s.x, s.z, 1.1, 1.1, 0.3); k.soft('softGold', low, s.x, s.z, 1.5, 1.5, y - 0.1);
					const o = P('smokeEdge').put(own); o.position.set(s.tx, 0.4, s.tz); o.scaling.setAll(s.radius * 2 * (0.3 + 0.7 * u));
					if (every(2)) k.fx('trail', 'softGold', s.x, y, s.z, 0.26, 0.9);
					break;
				}
				case 'cloud': {                                                     // slow turning puffs over a shade, a thin ring at its edge; it thins out at the end
					const R = s.radius, grow = Math.min(1, s.age / 0.25) * (0.55 + 0.45 * Math.min(1, left / 0.5)), puffs = lvl >= 5 ? 4 : 3;
					k.soft('shade', low, s.x, s.z, R * 2.5 * grow, R * 2.5 * grow, 0.1);
					for (let j = 0; j < puffs; j++) {
						const a = t * (0.5 + 0.22 * j) * (j % 2 ? 1 : -1) + j * 2.1 + id, m = P('smoke').put(own + j), far = j ? 0.3 * R : 0;
						m.position.set(s.x + Math.cos(a) * far, 0.2 + 0.03 * j, s.z + Math.sin(a) * far); m.rotation.y = a * 1.3; m.scaling.setAll(R * (j ? 1.75 : 2.15) * grow * (1 + 0.06 * Math.sin(t * 3 + j)));   // low, so whoever stands in the smoke is still seen
					}
					const edge = P('smokeEdge').put(own); edge.position.set(s.x, 0.42, s.z); edge.scaling.setAll(R * 2 * Math.min(1, s.age / 0.25));
					k.soft('softGold', low, s.x, s.z, R * (0.6 + 0.1 * Math.sin(t * 8 + id)), R * (0.6 + 0.1 * Math.sin(t * 8 + id)), 0.7);   // the coal still glowing in the middle
					if (s.a > 0) { const o = P('slowRing').put(own); o.position.set(s.x, 0.46, s.z); o.rotation.y = -t * 1.1; o.scaling.setAll(R * 2.36); }   // the cloud that slows wears a cold broken ring
					if (every(5)) k.burst(s.x + (k.rnd() - 0.5) * R * 1.4, 0.8, s.z + (k.rnd() - 0.5) * R * 1.4, s.a > 0 ? C(0.8, 0.88, 1) : SHOT_COLORS.scatter, 2);
					break;
				}
				case 'tower': {
					// it springs out of the sand; its lamp turns to what it shoots at, and it kicks and flashes with every shot; a ring
					// closes round its foot as its time runs out, and then it sinks back into the sand (at the highest level it bursts instead)
					const up = Math.min(1, s.age / 0.2), over = 1 + 0.25 * Math.sin(Math.min(1, s.age / 0.35) * Math.PI), m = P('tower').put(id), ending = left < 1 && Math.floor(t * 9) % 2 === 0;
					const sink = s.power > 0 ? 1 : Math.max(0.02, Math.min(1, left / 0.3)), sand = hex('#e2c491');
					const kick = s.mode >= 0 ? Math.max(0, 1 - (s.age - s.mode) / 0.13) : 0;       // 1 at the moment of a shot, gone a moment later
					const aim = Math.atan2(s.tz - s.z, s.tx - s.x), ax = Math.cos(aim), az = Math.sin(aim), T = 1 + (lvl - 1) * 0.05, size = 1.05 * T;   // it grows less with the levels than other things do: three of them share a narrow field with the fighter
					m.position.set(s.x - ax * 0.08 * kick, 0, s.z - az * 0.08 * kick);
					m.scaling.set(size * (1 + 0.05 * kick), size * up * over * sink * (1 - 0.07 * kick) * (ending ? 0.94 : 1), size * (1 + 0.05 * kick));
					k.soft('shade', low, s.x + 0.25, s.z + 0.15, 2 * sink, 2 * sink, 0.06);
					const o = P('towerRing').put(own); o.position.set(s.x, 0.12, s.z); o.scaling.setAll(2.6 - 1.5 * u);
					// the lamp leans out over the wall on the side it is shooting to
					const lamp = P('towerLamp').put(own), beat = 0.5 + 0.5 * Math.sin(t * 31 + id), top = 1.62 * T * up * sink, lx = s.x + ax * 0.3 * T, lz = s.z + az * 0.3 * T;
					lamp.position.set(lx, top, lz); lamp.scaling.setAll((0.2 + 0.1 * beat + 0.3 * kick) * sink);
					k.soft('softViolet', low, s.x, s.z, (1.5 + 0.5 * beat) * sink, (1.5 + 0.5 * beat) * sink, 1.5);
					if (kick > 0) k.soft('softWhite', low - 1, lx + ax * 0.35, lz + az * 0.35, 0.5 + 1.4 * kick, 0.5 + 1.4 * kick, top);   // the flash at its mouth
					if (lvl >= 3) { const c = P('towerRing').put(own + 1); c.position.set(s.x, 1.47 * T * up * sink, s.z); c.scaling.setAll((0.98 + 0.04 * beat) * T * sink); }   // from the third level: a crown of light on its battlements
					if (lvl >= 5) k.soft('softGold', low - 2, s.x, s.z, 2.3 + 0.3 * beat, 2.3 + 0.3 * beat, 0.08);                       // and at the top level it stands in gold
					if (s.power > 0 && left < 1.2) k.soft('softOrange', low, s.x, s.z, 4.2 - 2.6 * left, 4.2 - 2.6 * left, 0.3);   // at the highest level it swells before it bursts
					if (fresh && lively) { k.ring(s.x, s.z, 3, 0.3, 'towerRing', 0.3); k.ring(s.x, s.z, 1.8, 0.45, 'towerRing', 0.2); k.bloom(s.x, s.z, 2.6, 0.5, 'shade'); k.burst(s.x, 0.4, s.z, sand, 18); }
					if (sink < 1 && every(2)) k.burst(s.x + (k.rnd() - 0.5) * 1.2, 0.25, s.z + (k.rnd() - 0.5) * 1.2, sand, 3);        // sand falls in as it goes down
					break;
				}
				case 'dart': {                                                      // it leaves from the top of the tower, comes down to its line and draws a short tail
					const yaw = -Math.atan2(s.vz, s.vx), m = P('dart').put(id), y = 1 + 0.55 * G * Math.max(0, 1 - s.age / 0.1);
					const far = s.mode === 1 ? 0.72 : 1;                                   // a long shot, at part strength, is a smaller dart
					m.position.set(s.x, y, s.z); m.rotation.y = yaw; m.scaling.setAll(1.35 * G * far);
					k.soft('softViolet', low, s.x, s.z, 1.8 * G * far, 0.8 * G * far, 0.6).rotation.y = yaw;
					if (every(2)) k.fx('trail', 'softViolet', s.x, y, s.z, 0.13, 0.75 * G);
					break;
				}
				case 'blade': {                                                     // spins hard, leaves a green wake, and at the highest level wears a ring
					const m = P('blade').put(id), size = 1.25 * G;
					m.position.set(s.x, 0.72, s.z); m.rotation.y = t * (20 + lvl * 2.5) * (id % 2 ? 1 : -1); m.scaling.set(size, 1.6, size);
					k.soft('softGreen', low, s.x, s.z, 2.3 * G, 2.3 * G);
					if (lvl >= 4) k.soft('softWhite', low, s.x, s.z, 0.7, 0.7, 0.56);
					if (lvl >= 5) { const o = P('bladeRing').put(own); o.position.set(s.x, 0.7, s.z); o.scaling.setAll(1.75 * (1 + 0.12 * Math.sin(t * 26 + id))); }
					if (every(2)) k.fx('trail', 'softGreen', s.x, 0.5, s.z, 0.2 + lvl * 0.02, 1.5 * G);
					break;
				}
				case 'ray': {                                                       // drawn from the fighter's own lamp, so it never lags behind them
					const ox = who.x + 0.95, oz = who.z, len = s.radius, cx = Math.cos(s.a), cz = Math.sin(s.a), flick = 1 + 0.07 * Math.sin(t * 37 + s.n * 2);
					const glow = P('rayGlow').put(id), core = P('rayCore').put(id), wide = (1.7 + s.r * 4) * flick;
					glow.position.set(ox + cx * len / 2, 0.74, oz + cz * len / 2); glow.rotation.y = -s.a; glow.scaling.set(len, 1, wide * (lvl >= 4 ? 1.25 : 1));
					core.position.set(ox + cx * len / 2, 0.78, oz + cz * len / 2); core.rotation.y = -s.a; core.scaling.set(len, 1, (0.75 + s.r * 3.4) * flick);
					const lamp = P('lamp').put(own); lamp.position.set(ox, 0.95, oz); lamp.scaling.setAll(0.3 + 0.03 * lvl + 0.05 * Math.sin(t * 30));
					k.soft('softGold', low, ox, oz, 1.9 + lvl * 0.2, 1.9 + lvl * 0.2, 0.6); k.soft('softWhite', low, ox, oz, 0.9, 0.9, 0.62);
					k.soft('softGold', low - 1, ox + cx * len * 0.93, oz + cz * len * 0.93, 1.6 + lvl * 0.15, 1.6 + lvl * 0.15, 0.6);
					if (every(lvl >= 4 ? 1 : 2)) { const d = (0.15 + 0.85 * k.rnd()) * len; k.burst(ox + cx * d, 0.8, oz + cz * d, SHOT_COLORS.beam, 1); }
					break;
				}
				case 'ember': {                                                     // a small flame on whoever the beam has set alight
					const m = P('flame').put(id), f = 0.9 + 0.3 * Math.sin(t * 27 + id);
					m.position.set(s.x, 0.95, s.z); m.scaling.set(1.1, 1.1 * f, 1.1); m.rotation.y = t * 5;
					k.soft('softOrange', low, s.x, s.z, 1.7 * f, 1.7 * f, 0.62);
					if (every(4)) k.burst(s.x, 1.2, s.z, C(1, 0.6, 0.15), 1);
					break;
				}
				case 'whirl': {                                                     // two sheets of turning water, the inner one faster, inside a rim of foam
					const R = s.radius, grow = Math.min(1, s.age / 0.3) * Math.min(1, Math.max(0.1, left / 0.3)), size = R * 2.35 * grow, dir = s.a < 0 ? -1 : 1;
					// it lies on the ground, under the enemies it has caught, so they are seen turning in it
					const a = P('spiral').put(own), b = P('spiral').put(own + 1);
					a.position.set(s.x, 0.1, s.z); a.rotation.y = dir * t * 4.2 + id; a.scaling.setAll(size);
					b.position.set(s.x, 0.14, s.z); b.rotation.y = dir * t * 7 + 2; b.scaling.setAll(size * 0.6);
					const rim = P('whirlRim').put(own); rim.position.set(s.x, 0.16, s.z); rim.scaling.setAll(R * 2 * grow * (1 + 0.04 * Math.sin(t * 9 + id)));
					if (s.power > 0 && left < 1) { const o = P('whirlRim').put(own + 1); o.position.set(s.x, 0.18, s.z); o.scaling.setAll(R * 2.6 * grow * (1 - 0.5 * left)); }   // at the highest level a second ring closes in before it bursts
					if (every(3)) { const q = k.rnd() * 6.28; k.burst(s.x + Math.cos(q) * R * 0.9, 0.5, s.z + Math.sin(q) * R * 0.9, SHOT_COLORS.wave, 2); }
					break;
				}
				case 'falcon': {                                                    // circling: slow wing beats, high up; diving: wings folded and a streak behind it; flying home: quick beats
					const v = Math.hypot(s.vx, s.vz), yaw = v > 0.5 ? -Math.atan2(s.vz, s.vx) : 0, dive = s.mode === 1, y = dive ? 1 : s.mode === 2 ? 1.3 : 1.5, size = 1.35 * G;
					const beat = dive ? 0.42 : s.mode === 2 ? 0.8 + 0.2 * Math.sin(t * 24 + id) : 0.78 + 0.22 * Math.sin(t * 9 + id * 2);
					const body = P('falcon').put(id), wings = P('falconWings').put(id);
					body.position.set(s.x, y, s.z); body.rotation.y = yaw; body.scaling.set(size * (dive ? 1.2 : 1), size, size);
					wings.position.set(s.x, y + 0.02, s.z); wings.rotation.y = yaw; wings.scaling.set(size * (dive ? 1.15 : 1), size, size * beat);
					k.soft('shade', low, s.x + 0.35, s.z + 0.2, 1.5, 1.5 * beat, 0.3);
					k.soft('softGold', low, s.x, s.z, lvl >= 5 ? 2 : 1.3, lvl >= 5 ? 2 : 1.3, y - 0.1);   // a little light under it; more at the highest level
					if (dive) { k.soft('softOrange', low, s.x, s.z, 2.4, 1.1, y - 0.1).rotation.y = yaw; if (lively) k.fx('trail', 'trail', s.x - Math.cos(-yaw) * 0.5, y, s.z - Math.sin(-yaw) * 0.5, 0.2 + lvl * 0.02, 1.1); }
					break;
				}
				case 'shell': case 'frag': {                                        // up and over in a high arc, turning, with smoke behind it; the ring on the ground closes as it comes down
					const big = s.kind === 'shell', y = 0.8 + (big ? 5.6 : 1.9) * 4 * u * (1 - u), m = P(s.kind).put(id);
					m.position.set(s.x, y, s.z); m.rotation.x = t * (big ? 6 : 16) + id; m.rotation.y = t * 3; m.scaling.setAll((big ? 1 + 0.5 * Math.sin(Math.PI * u) : 1.2) * G);
					k.soft('shade', low, s.x, s.z, big ? 1.5 : 0.7, big ? 1.5 : 0.7, 0.3); k.soft('softOrange', low, s.x, s.z, big ? 1.5 : 1, big ? 1.5 : 1, y - 0.1);
					const o = P('reticle').put(id); o.position.set(s.tx, 0.24, s.tz); o.rotation.y = t * (big ? 2.4 : -5); o.scaling.setAll(s.radius * 2.25 * (1.5 - 0.5 * u));
					if (big) k.soft('softOrange', low - 1, s.tx, s.tz, s.radius * 1.6 * u, s.radius * 1.6 * u, 0.3);
					if (every(big ? 3 : 4)) k.fx('trail', 'shade', s.x, y, s.z, 0.4, big ? 1.2 : 0.6);
					if (every(2)) k.fx('trail', 'trail', s.x, y + (big ? 0.3 : 0), s.z, 0.18, big ? 0.9 : 0.7);
					break;
				}
				case 'star': {                                                      // it comes down from high above its target, turning, with a long tail of light; a ring on the ground closes under it
					const y = 0.9 + 12 * (1 - u) * (1 - u), spin = t * 9 + id, tail = 2 + 4 * (1 - u);
					if (stars < MAX_STARS) {
						const n = this.stars[stars] ?? (this.stars[stars] = makeStar(k.scene));
						stars++;
						n.position.set(s.x, y, s.z); n.rotation.y = spin; n.scaling.setAll((0.85 + 0.45 * u) * G);
					}
					const a = P('starTail').put(id), b = P('starTailCore').put(id);
					a.position.set(s.x, y + 0.4 + tail / 2, s.z); a.scaling.set(0.22 * G, tail, 0.22 * G);
					b.position.set(s.x, y + 0.4 + tail * 0.35, s.z); b.scaling.set(0.1, tail * 0.7, 0.1);
					k.soft('softGold', low, s.x, s.z, 3 * G, 3 * G, y - 0.3); k.soft('softWhite', low, s.x, s.z, 1.2, 1.2, y - 0.2);
					const o = P('haloEdge').put(own + 2), c = P('haloAdd').put(own + 2), mark = 3.4 - 2.2 * u;
					o.position.set(s.x, 0.3, s.z); o.scaling.setAll(mark); c.position.set(s.x, 0.32, s.z); c.scaling.setAll(mark);
					k.soft('softGold', low - 1, s.x, s.z, 0.6 + 2 * u, 0.6 + 2 * u, 0.34);
					if (every(2)) k.burst(s.x, y + 0.6, s.z, SHOT_COLORS.shield, 2);
					break;
				}
				case 'halo': {                                                      // a widening ring of light: a white-gold line and an amber edge that shows on sand; the great ring of the fighter has a second line inside it
					const reach = Math.min(s.radius, HALO_START + HALO_SPEED * s.age), d = reach * 2 / 0.875;
					const a = P('haloAdd').put(own), b = P('haloEdge').put(own);
					a.position.set(s.x, 0.46, s.z); a.scaling.setAll(d); b.position.set(s.x, 0.44, s.z); b.scaling.setAll(d);
					if (s.mode === 1) { const c = P('haloAdd').put(own + 1); c.position.set(s.x, 0.47, s.z); c.scaling.setAll(d * 0.84); }
					if (lively) { const q = k.rnd() * 6.28; k.burst(s.x + Math.cos(q) * reach, 0.6, s.z + Math.sin(q) * reach, SHOT_COLORS.shield, s.mode === 1 ? 3 : 1); }
					break;
				}
			}
		}
		this.known = now;
		this.stars.forEach((n, i) => n.setEnabled(i < stars));
	}

	// ------------------------------------------------------------------ one-off effects
	/** The picture of a weapon firing, striking, bursting or bouncing. Returns false for any other event. */
	show(e: SimEvent, w: World): boolean {
		const k = this.k, lvl = w.weapon.level, g = 1 + (lvl - 1) * 0.12;
		switch (e.type) {
			case 'fire': {
				const c = SHOT_COLORS[e.weapon], glow = SHOT_GLOW[e.weapon];
				switch (e.weapon) {
					case 'pulse': k.flash(e.x, e.z, 0.5 * g, 0.09, glow); if (this.frame % 2 === 0) k.ring(e.x, e.z, 0.9 * g, 0.16, 'ripple', 0.7); break;
					case 'scatter': k.flash(e.x, e.z, 1.2 * g, 0.14, glow); k.burst(e.x, 0.9, e.z, c, 8); break;
					case 'arc': k.flash(e.x - 0.95, e.z, 1.6, 0.2, glow); break;    // the tower itself rises where the fighter stands (see draw)
					case 'disc': k.flash(e.x, e.z, 1.1 * g, 0.12, glow); k.burst(e.x, 0.8, e.z, c, 6); break;
					case 'beam': k.flash(e.x, e.z, 1.4 * g, 0.16, 'softWhite'); k.ring(e.x, e.z, 1.6, 0.2, 'ring', 0.8); break;   // the lamp flashes as the beam turns back
					case 'wave': k.flash(e.x, e.z, 1.6 * g, 0.18, glow); k.ring(e.x, e.z, 2.2 * g, 0.3, 'ripple', 0.6); k.ring(e.x, e.z, 1.2 * g, 0.2, 'ripple', 0.6); k.burst(e.x, 0.8, e.z, c, 10); break;
					case 'missile': k.flash(e.x, e.z, 0.9 * g, 0.12, glow); k.burst(e.x, 1.3, e.z, hex('#f3e4c2'), 5); break;   // a falcon leaves its circle: a few feathers
					case 'plasma': k.flash(e.x, e.z, 2 * g, 0.16); k.flash(e.x + 0.3, e.z, 2.8 * g, 0.24, glow); k.bloom(e.x - 0.2, e.z, 2.6, 0.7, 'shade'); k.ring(e.x, e.z, 2.2 * g, 0.24, 'ring', 0.8); k.burst(e.x + 0.3, 1, e.z, c, 16); break;   // the gun speaks: fire, a ring, and smoke
					case 'shield': k.flash(e.x, e.z, 1.6 * g, 0.2, glow); k.ring(e.x, e.z, 2.4, 0.3, 'gold', 0.8); k.burst(e.x, 1.4, e.z, c, 10); break;
				}
				return true;
			}
			case 'hit': {
				const c = e.blocked ? C(0.7, 0.85, 1) : SHOT_COLORS[e.weapon];
				k.flash(e.x, e.z, e.blocked ? 0.5 : 0.8 * g, 0.08);
				k.burst(e.x, 0.6, e.z, c, e.blocked ? 3 : 6 + lvl * 2);
				if (e.blocked) return true;
				k.flash(e.x, e.z, 1.2 * g, 0.14, SHOT_GLOW[e.weapon]);
				switch (e.weapon) {
					case 'pulse': case 'wave': k.ring(e.x, e.z, (e.weapon === 'wave' ? 1.5 : 1.1) * g, 0.2, 'ripple', 0.6); break;   // water: a ring of spray
					case 'disc': k.ring(e.x, e.z, 1.3 * g, 0.16, 'bladeRing', 0.7); break;
					case 'arc': k.ring(e.x, e.z, 1.05 * g, 0.14, 'towerRing', 0.75); break;                                          // a dart strikes: a small bright ring
					case 'missile': k.ring(e.x, e.z, 1.6 * g, 0.2); k.burst(e.x, 1, e.z, hex('#f3e4c2'), 6); break;
					case 'beam': k.flash(e.x, e.z, 1.7 * g, 0.2, 'softOrange'); break;
					case 'shield': k.ring(e.x, e.z, 2.2, 0.26, 'gold', 0.6); k.flash(e.x, e.z, 2.4, 0.2, 'softWhite'); break;
				}
				return true;
			}
			case 'explode': {
				const c = SHOT_COLORS[e.weapon], r = e.radius;
				switch (e.weapon) {
					case 'scatter': k.bloom(e.x, e.z, r * 2.6, 0.45, 'softGold'); k.ring(e.x, e.z, r * 2.2, 0.3, 'smokeEdge', 0.5); k.burst(e.x, 0.7, e.z, c, 14); break;   // the burner breaks open and the smoke rolls out
					case 'arc': k.flash(e.x, e.z, r * 1.6, 0.14); k.bloom(e.x, e.z, r * 2.6, 0.4, 'softViolet'); k.ring(e.x, e.z, r * 2.2, 0.32, 'towerRing', 0.5); k.burst(e.x, 0.8, e.z, hex('#e2c491'), 22); break;
					case 'wave': for (let i = 0; i < 3; i++) k.ring(e.x, e.z, r * (1.4 + i * 0.5), 0.3 + i * 0.12, 'ripple', 0.5); k.bloom(e.x, e.z, r * 2.4, 0.4, 'softBlue'); k.burst(e.x, 0.7, e.z, c, 22); break;
					case 'missile': k.ring(e.x, e.z, r * 2, 0.24); k.flash(e.x, e.z, r * 1.8, 0.2, 'softOrange'); break;
					case 'shield': k.flash(e.x, e.z, 1.5, 0.12); k.bloom(e.x, e.z, 2.4, 0.35, 'softGold'); k.burst(e.x, 0.8, e.z, c, 22); break;   // the star lands (its ring of light is drawn as it widens)
					default: {                                                       // a shell or one of its fragments: white heart, fire, a ring, then smoke
						const big = r > 1.3;
						k.flash(e.x, e.z, r * 1.5, 0.12); k.bloom(e.x, e.z, r * 2.5, big ? 0.5 : 0.3, 'softOrange'); k.ring(e.x, e.z, r * 2, big ? 0.34 : 0.22);
						if (big) { k.bloom(e.x, e.z, r * 1.5, 0.3, 'softWhite'); k.ring(e.x, e.z, r * 1.4, 0.46, 'ring', 0.5); k.bloom(e.x, e.z, r * 2.4, 1, 'shade'); }
						k.burst(e.x, 0.6, e.z, c, big ? 26 : 10);
					}
				}
				return true;
			}
			case 'bounce': k.flash(e.x, e.z, 1.4, 0.12, 'softGreen'); k.ring(e.x, e.z, 1.5, 0.2, 'bladeRing', 0.7); k.burst(e.x, 0.7, e.z, SHOT_COLORS.disc, 8); return true;   // a blade strikes sparks from the side wall
		}
		return false;
	}

	/** Between stages and screens: nothing is left in the air. */
	clear() { this.known.clear(); for (const n of this.stars) n.setEnabled(false); }
}
