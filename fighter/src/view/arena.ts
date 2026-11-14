// Everything drawn in 3D above the land: the tilted top-down camera, the malware, the bosses, every weapon's shots and
// the effects of firing and impact. Shapes come from models.ts; the land below comes from scenery.ts. The simulation
// (src/sim) knows nothing about this file: it is given the world each frame and draws what is there.
// Axes: right-handed, Y up; x goes up the screen, z goes to the right.
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Meshes/instancedMesh';   // the import above is type-only and is erased; instancing needs the module itself
import eco from '../data/economy.json';
import type { WeaponId } from '../sim/economy';
import { World } from '../sim/world';
import type { Body, Enemy, SimEvent } from '../sim/world';
import { C, LOGO, Models } from './models';
import logo from '../data/omcode-logo.json';
import malware from '../data/malware-ar.json';
import { Scenery } from './scenery';

const A = eco.arena;
const PITCH = 58 * Math.PI / 180, SIN = Math.sin(PITCH), COS = Math.cos(PITCH);
export const WEAPON_COLORS: Record<WeaponId, Color3> = {
	pulse: C(0.3, 0.9, 1), scatter: C(1, 0.85, 0.3), arc: C(0.78, 0.55, 1), disc: C(0.35, 1, 0.95), beam: C(0.6, 0.95, 1),
	wave: C(0.55, 0.8, 1), missile: C(1, 0.75, 0.4), plasma: C(0.3, 1, 0.75), shield: C(1, 0.88, 0.4)
};
/** How large the flash at Cyber is when each weapon fires. */
const MUZZLE: Record<WeaponId, number> = { pulse: 0.7, scatter: 1.5, arc: 1.1, disc: 1.1, beam: 0.8, wave: 1.9, missile: 1, plasma: 1.7, shield: 2.2 };
/** Every stage has its own four kinds of small malware and its own rare kind (malware-ar.json). Which one an enemy is
 *  depends only on its id, so a wave is always mixed and the same stage always looks the same. */
const KINDS = malware.stages as { small: string[]; rare: string }[];
const KIND_COLOR = (kind: string) => { const item = (malware.items as Record<string, { color: string } | undefined>)[kind]; return item ? Color3.FromHexString(item.color) : C(1, 1, 1); };
/** The armoured lock wears a different colour in each stage. */
const LOCK_COLORS = [['#5f7fb8', '#3d5488'], ['#c2506e', '#7d2c44'], ['#3fa873', '#226a45'], ['#8f68d8', '#553a94'], ['#d48a3a', '#8a5418']];
/** The soft glow under each kind of shot. */
const SOFT: Record<string, string> = { pulse: 'softCyan', pellet: 'softGold', missile: 'softOrange', plasma: 'softGreen', disc: 'softCyan', wave: 'softBlue', shard: 'softGreen' };
const DANGER = C(1, 0.2, 0.35), WHITE = C(1, 1, 1);
/** The soft flash of each weapon, at the muzzle and where it strikes. */
const GLOW_OF: Record<WeaponId, string> = { pulse: 'softCyan', scatter: 'softGold', arc: 'softViolet', disc: 'softCyan', beam: 'softCyan', wave: 'softBlue', missile: 'softOrange', plasma: 'softGreen', shield: 'softGold' };
/** Turns a thrown Cyber onto his back so his face looks up at the camera while he spins. */
const CYBER_FLAT = 1.25;

/** Instances of one shape, reused: put() the ones wanted this frame, end() hides the rest. */
class Pool {
	private free: InstancedMesh[] = []; private live = new Map<number, InstancedMesh>(); private seen = new Set<number>();
	constructor(private src: Mesh) { src.isVisible = false; src.isPickable = false; }
	private fresh() { const m = this.free.pop() ?? this.src.createInstance(this.src.name); m.isPickable = false; m.setEnabled(true); m.scaling.setAll(1); m.rotation.setAll(0); return m; }
	begin() { this.seen.clear(); }
	put(id: number): InstancedMesh { let m = this.live.get(id); if (!m) { m = this.fresh(); this.live.set(id, m); } this.seen.add(id); return m; }
	end() { for (const [id, m] of this.live) if (!this.seen.has(id)) { m.setEnabled(false); this.free.push(m); this.live.delete(id); } }
	take(): InstancedMesh { return this.fresh(); }
	give(m: InstancedMesh) { m.setEnabled(false); this.free.push(m); }
	clear() { this.begin(); this.end(); }
}
interface Fx { kind: 'ring' | 'debris' | 'bolt' | 'trail' | 'flash' | 'bloom'; mesh: InstancedMesh; pool: Pool; age: number; life: number; vx: number; vy: number; vz: number; size: number; wide: number }
interface BossView { id: string; root: TransformNode; moving: Record<string, TransformNode | Mesh>; tail: Mesh[]; shield: Mesh; path: number[]; shut: number }
/** The signs that the code boss throws. */
const GLYPHS = ['{', '}', '<', '>', ';', '/', '0', '1'];
/** Turns a painter so that what it draws reads upright on screen: on these flat sheets the picture's x runs up the screen. */
const upright = (g: CanvasRenderingContext2D, w: number, h: number) => { g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); g.scale(1, -1); };

export class Arena {
	halfW = 4.3; halfH = 9.2; centreX = 10;
	reduceMotion = false;
	/** 0.25 calm (questions, shop) .. 1 fighting .. 1.6 boss: how fast the land passes below. */
	energy = 1;
	readonly models: Models;
	readonly scenery: Scenery;
	/** Makes one flying Cyber shield (set by the game once the characters are loaded). */
	makeShield: (() => TransformNode) | null = null;
	private mats = new Map<string, StandardMaterial>();
	private pools = new Map<string, Pool>();
	private fx: Fx[] = [];
	/** Effects that are due a little later (the stages of a great blast). */
	private due: { at: number; run: () => void }[] = [];
	private sparks!: ParticleSystem;
	private floor!: Mesh;
	private beam: { core: Mesh; halo: Mesh; tip: Mesh; rings: Mesh[] };
	private beam2: { core: Mesh; halo: Mesh; tip: Mesh; rings: Mesh[] };          // the supporter's beam
	private boss: BossView | null = null;
	private shields: TransformNode[] = [];
	/** The Cyber that carries the bomb of Total Awareness, and the seconds he still needs to fly home after dropping it. */
	private courier: TransformNode | null = null; private courierBack = 0;
	/** True while that Cyber is away from the player (the game hides the one beside the player meanwhile). */
	courierOut = false;
	private t = 0; private width = 1; private height = 1; private frame = 0; private stage = 0;
	/** An enemy to point at while its card is read: a ring turns around it. */
	spotlight: Enemy | null = null;
	private softTex!: DynamicTexture;
	private rnd = (() => { let a = 99173; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

	constructor(readonly scene: Scene, readonly cam: FreeCamera) {
		cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
		cam.minZ = 1; cam.maxZ = 140;
		this.models = new Models(scene);
		this.scenery = new Scenery(scene, this.models);
		this.buildFloor();
		this.buildShapes();
		this.beam = this.buildBeam(); this.beam2 = this.buildBeam();
		this.sparks = this.buildSparks();
		this.setStage(0);
	}

	// ------------------------------------------------------------------ camera and coordinates
	resize(width: number, height: number) {
		this.width = Math.max(1, width); this.height = Math.max(1, height);
		const aspect = this.width / this.height;
		this.halfH = 9.25; this.halfW = this.halfH * aspect;
		if (this.halfW < A.halfWidth + 0.3) { this.halfW = A.halfWidth + 0.3; this.halfH = this.halfW / aspect; }   // narrow phones: fit the width, see more above
		this.centreX = -0.95 + this.halfH / SIN;
		this.cam.position.set(this.centreX - COS * 50, SIN * 50, 0);
		this.cam.setTarget(new Vector3(this.centreX, 0, 0));
		this.cam.orthoLeft = -this.halfW; this.cam.orthoRight = this.halfW; this.cam.orthoTop = this.halfH; this.cam.orthoBottom = -this.halfH;
	}
	/** A point of the world in CSS pixels of the canvas. */
	toScreen(x: number, y: number, z: number) {
		return { x: (0.5 + z / (2 * this.halfW)) * this.width, y: (0.5 - ((x - this.centreX) * SIN + y * COS) / (2 * this.halfH)) * this.height };
	}
	/** A finger movement in pixels as a movement on the floor. */
	dragToWorld(dxPx: number, dyPx: number) {
		return { dx: -dyPx / this.height * 2 * this.halfH / SIN, dz: dxPx / this.width * 2 * this.halfW };
	}

	// ------------------------------------------------------------------ materials and shapes
	private neon(name: string, color: Color3, alpha = 1): StandardMaterial {
		const m = new StandardMaterial(name, this.scene);
		m.disableLighting = true; m.emissiveColor = color.clone(); m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.alpha = alpha;
		this.mats.set(name, m);
		return m;
	}
	/** A glowing, unlit shape (shots, danger, effects). */
	private glow(key: string, mesh: Mesh, color: Color3, alpha = 1) { mesh.name = key; mesh.material = this.neon(key + 'Mat', color, alpha); this.pools.set(key, new Pool(mesh)); }
	/** A lit, coloured model (malware). */
	private solid(key: string, mesh: Mesh) { mesh.name = key; this.pools.set(key, new Pool(mesh)); }
	private pool(key: string) { return this.pools.get(key)!; }
	/** A flat sheet lying on the fight plane that shows a painted texture: soft glows add light, shades take it away. */
	private sheet(key: string, tex: DynamicTexture, color: Color3 | null, alpha: number, add: boolean) {
		const m = CreateGround(key, { width: 1, height: 1 }, this.scene);
		const mat = this.neon(key + 'Mat', color ?? Color3.Black(), alpha);
		mat.opacityTexture = tex; mat.backFaceCulling = false; mat.alphaMode = add ? 1 : 2;      // 1 = add, 2 = blend
		if (!color) mat.emissiveTexture = tex;
		m.name = key; m.material = mat; this.pools.set(key, new Pool(m));
	}
	private painted(name: string, size: number, draw: (g: CanvasRenderingContext2D, size: number) => void, height = size) {
		const tex = new DynamicTexture(name, { width: size, height }, this.scene, true);
		tex.hasAlpha = true;
		draw(tex.getContext() as unknown as CanvasRenderingContext2D, size); tex.update();
		return tex;
	}
	/** Puts the soft glow of one colour under something for this frame. */
	private soft(key: string, id: number, x: number, z: number, sx: number, sz = sx, y = 0.5) { const g = this.pool(key).put(id); g.position.set(x, y, z); g.scaling.set(sx, 1, sz); g.rotation.y = 0; return g; }

	private buildFloor() {
		// the fighting area: a dark, calm sheet over the land so shots and danger stay readable, with bright edges
		this.floor = CreateGround('floor', { width: A.length + 6, height: A.halfWidth * 2 + 0.2 }, this.scene);
		this.floor.position.set(A.length / 2, -0.6, 0); this.floor.isPickable = false;
		this.floor.material = this.neon('floorMat', C(0.01, 0.03, 0.09), 0.4);
		for (const side of [-1, 1]) {
			const edge = CreateBox('edge', { width: 70, height: 0.05, depth: 0.08 }, this.scene);
			edge.position.set(10, -0.55, side * (A.halfWidth + 0.12)); edge.isPickable = false;
			edge.material = this.mats.get('edgeMat') ?? this.neon('edgeMat', C(0.45, 0.9, 1), 0.9);
		}
	}
	private buildShapes() {
		const s = this.scene, M = this.models;
		const wedge = (d: number, h: number, sides: number) => { const m = CreateCylinder('w', { diameterTop: 0, diameterBottom: d, height: h, tessellation: sides }, s); m.rotation.z = Math.PI / 2; m.bakeCurrentTransformIntoVertices(); return m; };
		this.solid('virus', M.virus()); this.solid('worm', M.worm()); this.solid('bug', M.bug()); this.solid('spy', M.eye());
		this.solid('spam', M.spam()); this.solid('bait', M.bait()); this.solid('cracker', M.cracker()); this.solid('fakeapp', M.fakeapp()); this.solid('adware', M.adware());
		this.solid('scare', M.scare()); this.solid('door', M.door()); this.solid('doc', M.doc()); this.solid('wifi', M.wifi()); this.solid('poly', M.poly()); this.solid('dropper', M.dropper());
		this.solid('thief', M.thief()); this.solid('fakeacct', M.fakeacct()); this.solid('idthief', M.idthief()); this.solid('zeroday', M.zeroday()); this.solid('wiper', M.wiper()); this.solid('miner', M.miner());
		LOCK_COLORS.forEach(([a, b], i) => this.solid('lock' + i, M.lock(a, b, 'lock' + i)));
		this.solid('bomb', M.bomb()); this.solid('keylog', M.keylog()); this.solid('bot', M.bot()); this.solid('crate', M.crate()); this.solid('crateRare', M.crate('#08080e', '#c9a2ff', 'crateRare', true)); this.solid('awareBomb', M.awareBomb()); this.solid('crateHeart', M.heartBox());
		this.glow('bubble', CreateSphere('bu', { diameter: 1, segments: 12 }, s), C(0.5, 1, 0.9), 0.3);
		this.solid('shackle', M.shackle()); this.solid('rootkit', M.skull()); this.solid('pod', M.pod());
		// the player's shots: bright cores with a softer glow around them
		// soft light: one painted dot, in the colour of each weapon, added to whatever is under it
		this.softTex = this.painted('dot', 64, g => { const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 64, 64); });
		for (const [key, c, a] of [['softCyan', C(0.25, 0.85, 1), 0.85], ['softGold', C(1, 0.7, 0.15), 0.6], ['softOrange', C(1, 0.5, 0.15), 0.85], ['softGreen', C(0.2, 1, 0.65), 0.8],
			['softBlue', C(0.35, 0.6, 1), 0.8], ['softViolet', C(0.7, 0.4, 1), 0.85], ['softWhite', C(1, 1, 1), 0.8], ['softRed', C(1, 0.15, 0.25), 0.7]] as [string, Color3, number][]) this.sheet(key, this.softTex, c, a, true);
		this.sheet('shade', this.softTex, C(0, 0, 0), 0.7, false);                 // under enemy fire, so red stays red on sand
		const bolt = CreateSphere('s', { diameter: 1, segments: 8 }, s); bolt.scaling.set(1.15, 0.16, 0.2); bolt.bakeCurrentTransformIntoVertices();
		this.glow('pulse', bolt, C(0.9, 1, 1));
		this.glow('pellet', wedge(0.32, 0.5, 3), C(1, 0.95, 0.6));
		this.glow('pelletGlow', CreateSphere('s', { diameter: 0.55, segments: 5 }, s), WEAPON_COLORS.scatter, 0.4);
		this.glow('missile', wedge(0.36, 0.85, 6), C(0.95, 0.97, 1));
		this.glow('plasma', CreateSphere('pl', { diameter: 1, segments: 10 }, s), C(0.85, 1, 0.95));
		this.glow('halo', CreateSphere('h', { diameter: 1, segments: 8 }, s), WEAPON_COLORS.plasma, 0.32);
		this.glow('shard', wedge(0.26, 0.55, 3), WEAPON_COLORS.plasma);
		this.glow('disc', CreateCylinder('d', { diameter: 0.62, height: 0.09, tessellation: 18 }, s), C(0.9, 1, 1));
		this.glow('discRing', CreateTorus('dr', { diameter: 0.95, thickness: 0.08, tessellation: 20 }, s), WEAPON_COLORS.disc);
		// the piercing wave: a painted crescent of light, bulging the way it flies
		const crescent = this.painted('crescent', 256, (g, S) => {
			g.lineCap = 'round';
			for (const [w, c] of [[70, 'rgba(70,130,255,0.16)'], [46, 'rgba(90,170,255,0.3)'], [26, 'rgba(150,215,255,0.65)'], [12, 'rgba(225,245,255,0.95)'], [5, 'rgba(255,255,255,1)']] as [number, string][]) {
				g.strokeStyle = c; g.lineWidth = w * 0.8; g.beginPath(); g.arc(S * 0.5 - 110 + 70, S / 2, 110, -0.95, 0.95); g.stroke();
			}
		});
		this.sheet('wave', crescent, null, 1, true);
		this.sheet('waveGhost', crescent, null, 0.4, true);
		// the Cyber Shield: a golden shield of light around Cyber himself
		const emblem = this.painted('emblem', 256, (g, S) => {
			const shape = (k: number) => { const c = S / 2; g.beginPath(); g.moveTo(c, c - 100 * k); g.bezierCurveTo(c + 40 * k, c - 86 * k, c + 78 * k, c - 84 * k, c + 92 * k, c - 70 * k); g.bezierCurveTo(c + 96 * k, c + 10 * k, c + 62 * k, c + 72 * k, c, c + 108 * k); g.bezierCurveTo(c - 62 * k, c + 72 * k, c - 96 * k, c + 10 * k, c - 92 * k, c - 70 * k); g.bezierCurveTo(c - 78 * k, c - 84 * k, c - 40 * k, c - 86 * k, c, c - 100 * k); g.closePath(); };
			const halo = g.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S / 2); halo.addColorStop(0, 'rgba(255,190,60,0.6)'); halo.addColorStop(1, 'rgba(255,170,40,0)');
			g.fillStyle = halo; g.fillRect(0, 0, S, S);
			const gold = g.createLinearGradient(0, 30, 0, S - 20); gold.addColorStop(0, '#ffe27a'); gold.addColorStop(0.5, '#ffb41f'); gold.addColorStop(1, '#e8760a');
			shape(1); g.fillStyle = gold; g.fill(); g.lineWidth = 9; g.strokeStyle = '#ffffff'; g.stroke();
			shape(0.72); g.lineWidth = 6; g.strokeStyle = 'rgba(255,246,200,0.95)'; g.stroke(); g.fillStyle = 'rgba(255,214,90,0.5)'; g.fill();
			shape(0.4); g.fillStyle = 'rgba(40,220,255,0.9)'; g.fill();
		});
		this.sheet('emblem', emblem, null, 1, false);
		this.sheet('emblemGhost', emblem, null, 0.2, true);
		// danger: red, round with a pale core, or a red diamond; never the shapes above
		this.glow('orb', CreateSphere('o', { diameter: 1, segments: 8 }, s), DANGER);
		this.glow('orbCore', CreateSphere('oc', { diameter: 1, segments: 6 }, s), C(1, 0.9, 0.9));
		GLYPHS.forEach((sign, i) => this.sheet('code' + i, this.painted('codeTex' + i, 128, (g, S) => {   // enemy fire shaped like code: red with a pale heart, as all danger is
			upright(g, S, S);
			g.font = '700 104px Consolas, "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
			g.shadowColor = 'rgba(255,30,60,0.9)'; g.shadowBlur = 14;
			g.lineWidth = 16; g.strokeStyle = '#ff2545'; g.strokeText(sign, 0, 4);
			g.shadowBlur = 0; g.fillStyle = '#fff1f1'; g.fillText(sign, 0, 4);
		}), null, 1, false));
		this.glow('dshard', CreateCylinder('d', { diameterTop: 0, diameterBottom: 0.44, height: 0.3, tessellation: 4 }, s), C(1, 0.4, 0.15));
		this.glow('zoneWarn', CreateGround('zw', { width: 1, height: 1 }, s), DANGER, 0.25);
		this.glow('zoneLive', CreateGround('zl', { width: 1, height: 1 }, s), C(1, 0.65, 0.65), 0.8);
		// effects
		this.glow('ring', CreateTorus('ri', { diameter: 1, thickness: 0.08, tessellation: 28 }, s), WHITE, 0.9);
		this.sheet('flash', this.softTex, WHITE, 1, true);
		this.glow('debris', CreateBox('db', { size: 0.17 }, s), WHITE);
		this.glow('bolt', CreateBox('bo', { width: 1, height: 0.07, depth: 0.13 }, s), C(0.95, 0.9, 1));
		this.glow('boltGlow', CreateBox('bg', { width: 1, height: 0.04, depth: 0.4 }, s), WEAPON_COLORS.arc, 0.4);
		this.glow('trail', CreateSphere('tr', { diameter: 0.3, segments: 4 }, s), C(1, 0.7, 0.3), 0.85);
		this.glow('spark', CreateSphere('sp', { diameter: 0.2, segments: 5 }, s), C(1, 1, 1));
		this.glow('gold', CreateTorus('go', { diameter: 1, thickness: 0.1, tessellation: 24 }, s), WEAPON_COLORS.shield, 0.9);
	}
	private buildBeam() {
		const mk = (name: string, c: Color3, a: number) => { const m = CreateBox(name, { size: 1 }, this.scene); m.material = this.neon(name + 'Mat', c, a); m.isPickable = false; m.setEnabled(false); return m; };
		const rings = [0, 1, 2].map(i => { const r = CreateTorus('beamRing' + i, { diameter: 1, thickness: 0.09, tessellation: 20 }, this.scene); r.rotation.z = Math.PI / 2; r.material = this.neon('beamRing' + i + 'Mat', WEAPON_COLORS.beam, 0.85); r.setEnabled(false); r.isPickable = false; return r; });
		const tip = CreateSphere('beamTip', { diameter: 1, segments: 8 }, this.scene); tip.material = this.neon('beamTipMat', C(1, 0.95, 0.8), 0.9); tip.setEnabled(false); tip.isPickable = false;
		return { core: mk('beamCore', WHITE, 1), halo: mk('beamHalo', WEAPON_COLORS.beam, 0.42), tip, rings };
	}
	private buildSparks() {
		const tex = this.softTex;
		const p = new ParticleSystem('sparks', 420, this.scene);
		p.particleTexture = tex; p.blendMode = ParticleSystem.BLENDMODE_ADD; p.emitter = new Vector3(0, 0, 0);
		p.minSize = 0.14; p.maxSize = 0.46; p.minLifeTime = 0.2; p.maxLifeTime = 0.6; p.emitRate = 0;
		p.minEmitPower = 2.5; p.maxEmitPower = 8.5; p.direction1 = new Vector3(-1.5, 0.3, -1.5); p.direction2 = new Vector3(1.8, 1.2, 1.5); p.gravity = new Vector3(0, 0, 0);
		p.start();
		return p;
	}

	setStage(index: number) {
		this.stage = Math.max(0, Math.min(KINDS.length - 1, index));
		this.scenery.setStage(index);
		(this.floor.material as StandardMaterial).alpha = this.scenery.dim;
		this.clear();
	}

	// ------------------------------------------------------------------ effects
	/** A puff of sparks. */
	burst(x: number, y: number, z: number, color: Color3, count: number) {
		if (this.reduceMotion) count = Math.ceil(count / 3);
		(this.sparks.emitter as Vector3).set(x, y, z);
		this.sparks.color1 = new Color4(color.r, color.g, color.b, 1); this.sparks.color2 = new Color4(1, 1, 1, 0.9); this.sparks.colorDead = new Color4(color.r, color.g, color.b, 0);
		this.sparks.manualEmitCount = count;
	}
	private addFx(kind: Fx['kind'], poolKey: string, x: number, y: number, z: number, life: number, size: number, vx = 0, vy = 0, vz = 0) {
		if (this.fx.length > (this.reduceMotion ? 90 : 340)) return null;
		const pool = this.pool(poolKey), mesh = pool.take();
		mesh.position.set(x, y, z);
		const f: Fx = { kind, mesh, pool, age: 0, life, vx, vy, vz, size, wide: 0 };
		this.fx.push(f);
		return f;
	}
	private ringAt(x: number, z: number, size: number, life = 0.32, key = 'ring', y = 0.3) { const f = this.addFx('ring', key, x, y, z, life, size); if (f) f.mesh.scaling.setAll(0.15); }
	/** A ball of light that swells quickly and sinks slowly. */
	private bloomAt(x: number, z: number, size: number, life: number, key: string) { const f = this.addFx('bloom', key, x, key === 'shade' ? 0.9 : 0.8, z, life, size); if (f) f.mesh.scaling.set(0.1, 1, 0.1); }
	private after(seconds: number, run: () => void) { this.due.push({ at: this.t + seconds, run }); }
	private flashAt(x: number, z: number, size: number, life = 0.1, key = 'flash') { const f = this.addFx('flash', key, x, 0.85, z, life, size * 2.2); if (f) f.mesh.scaling.set(0.2, 1, 0.2); }

	/** Turns one simulation event into a picture. Sound and money are the game's business. */
	show(e: SimEvent, w: World) {
		switch (e.type) {
			case 'fire': {
				const lvl = w.weapon.level, c = WEAPON_COLORS[e.weapon], k = MUZZLE[e.weapon] * (1 + (lvl - 1) * 0.17);
				this.flashAt(e.x, e.z, k, e.weapon === 'beam' ? 0.2 : 0.11);
				this.flashAt(e.x + 0.3, e.z, k * 1.5, 0.16, GLOW_OF[e.weapon]);
				if (e.weapon !== 'beam') this.burst(e.x + 0.2, 0.9, e.z, c, Math.round(5 + k * 6 + lvl * 2));
				if (lvl >= 4 && e.weapon !== 'beam') this.flashAt(e.x + 0.2, e.z, k * 0.9, 0.14, 'softWhite');
				if (lvl >= 5 || e.weapon === 'plasma' || e.weapon === 'wave' || e.weapon === 'shield' || e.weapon === 'scatter') this.ringAt(e.x, e.z, k * 1.3, 0.22, e.weapon === 'shield' ? 'gold' : 'ring', 0.8);
				break;
			}
			case 'hit': {
				const lvl = w.weapon.level, g = 1 + (lvl - 1) * 0.14;
				this.flashAt(e.x, e.z, e.blocked ? 0.5 : 0.9 * g, 0.08);
				if (!e.blocked) this.flashAt(e.x, e.z, 1.3 * g, 0.14, GLOW_OF[e.weapon]);
				this.burst(e.x, 0.6, e.z, e.blocked ? C(0.7, 0.85, 1) : WEAPON_COLORS[e.weapon], e.blocked ? 3 : 7 + lvl * 3);
				if (!e.blocked && lvl >= 4 && this.frame % 2 === 0) this.ringAt(e.x, e.z, 0.7 + lvl * 0.14, 0.18);
				if (e.weapon === 'shield') { this.ringAt(e.x, e.z, 2.2, 0.28, 'gold', 0.6); this.flashAt(e.x, e.z, 2.4, 0.2, 'softGold'); }
				else if (e.weapon === 'wave' || e.weapon === 'disc') this.ringAt(e.x, e.z, 1.1, 0.2);
				break;
			}
			case 'bounce': this.bolt(e.x0, e.z0, e.x1, e.z1, false); break;
			case 'fizz':                                                             // enemy fire that was cleared: each piece goes out in a small flash
				for (let i = 0; i + 1 < e.points.length; i += 2) { this.flashAt(e.points[i], e.points[i + 1], 0.55, 0.22, 'softRed'); if (i % 6 === 0) this.ringAt(e.points[i], e.points[i + 1], 0.9, 0.2); }
				break;
			case 'explode':
				this.ringAt(e.x, e.z, e.radius * 2); this.flashAt(e.x, e.z, e.radius * 1.5, 0.12); this.flashAt(e.x, e.z, e.radius * 2.4, 0.3, GLOW_OF[e.weapon]);
				if (e.weapon === 'plasma' || e.weapon === 'shield') this.ringAt(e.x, e.z, e.radius * 1.4, 0.46, e.weapon === 'shield' ? 'gold' : 'ring', 0.5);
				this.burst(e.x, 0.5, e.z, WEAPON_COLORS[e.weapon], 18);
				break;
			case 'arc':
				for (let i = 0; i + 3 < e.points.length; i += 2) { this.bolt(e.points[i], e.points[i + 1], e.points[i + 2], e.points[i + 3], true, w.weapon.level); this.ringAt(e.points[i + 2], e.points[i + 3], 0.8 + w.weapon.level * 0.14, 0.18); }
				break;
			case 'kill': this.shatter(e.enemy, KIND_COLOR(this.kindOf(e.enemy))); break;
			case 'crate': this.burst(e.x, 0.8, e.z, WEAPON_COLORS.shield, 40); this.ringAt(e.x, e.z, 5, 0.5, 'gold'); this.ringAt(e.x, e.z, 3, 0.35); this.flashAt(e.x, e.z, 3.5, 0.35, 'softGold'); break;
			case 'nova': {                                                           // Total Awareness goes off, in stages
				const x = e.x, z = e.z;
				// 1. the fireball: white at its heart, then gold, then orange, each larger and slower than the last
				this.bloomAt(x, z, 30, 0.8, 'softWhite'); this.bloomAt(x, z, 40, 1.5, 'softGold'); this.bloomAt(x, z, 50, 2.3, 'softOrange'); this.bloomAt(x, z, 34, 2.9, 'softRed');
				this.flashAt(x, z, 20, 0.5, 'softWhite');
				// 2. shock waves, one after another, out past the edges of the field
				for (let i = 0; i < 8; i++) this.after(i * 0.13, () => { const f = this.addFx('ring', i % 2 ? 'gold' : 'ring', x, 0.4, z, 0.75 + i * 0.07, 22 + i * 5); if (f) f.mesh.scaling.setAll(0.2); });
				// 3. burning pieces thrown outward
				const ember = this.mats.get('debrisMat'); if (ember) ember.emissiveColor = C(1, 0.78, 0.3);        // embers, whatever was destroyed last
				for (let i = 0; i < 40; i++) { const a = this.rnd() * 6.28, v = 6 + this.rnd() * 16; this.addFx('debris', 'debris', x, 0.6, z, 0.8 + this.rnd() * 0.9, 1.1 + this.rnd() * 1.5, Math.cos(a) * v, 2 + this.rnd() * 6, Math.sin(a) * v); }
				this.burst(x, 1, z, WEAPON_COLORS.shield, 160);
				// 4. secondary blasts all over the field while the fireball sinks
				for (let i = 0; i < 14; i++) this.after(0.25 + i * 0.11, () => { const bx = 2 + this.rnd() * (A.length - 2), bz = (this.rnd() - 0.5) * A.halfWidth * 2; this.bloomAt(bx, bz, 5 + this.rnd() * 4, 0.55, i % 2 ? 'softGold' : 'softOrange'); this.ringAt(bx, bz, 5 + this.rnd() * 3, 0.4, i % 3 ? 'ring' : 'gold'); this.burst(bx, 0.8, bz, i % 2 ? C(1, 0.8, 0.3) : C(1, 0.5, 0.2), 26); });
				// 5. smoke: a dark cloud that spreads after the fire and thins away
				this.after(0.7, () => { this.bloomAt(x, z, 36, 2.6, 'shade'); this.bloomAt(x - 3, z + 1.5, 20, 2.2, 'shade'); this.bloomAt(x + 4, z - 1.5, 22, 2.4, 'shade'); });
				this.after(1.5, () => { for (let i = 0; i < 3; i++) { const f = this.addFx('ring', 'gold', x, 0.35, z, 1.1 + i * 0.3, 34 + i * 6); if (f) f.mesh.scaling.setAll(0.3); } });
				break;
			}
			case 'revive': case 'down': {                                            // one falls, or rises with a heart from the friend
				const who = (e.type === 'revive' ? e.by === 0 : e.who === 1) ? w.ally?.body : w.player;
				if (!who) break;
				this.flashAt(who.x, who.z, 5, 0.45, e.type === 'revive' ? 'softGold' : 'softRed'); this.ringAt(who.x, who.z, 5, 0.45, e.type === 'revive' ? 'gold' : 'ring');
				this.burst(who.x, 1, who.z, e.type === 'revive' ? WEAPON_COLORS.shield : DANGER, 44);
				break;
			}
			case 'allyHit': { const b = w.ally?.body; if (b) { this.burst(b.x, 0.8, b.z, DANGER, 28); this.ringAt(b.x, b.z, 2.2, 0.3); } break; }
			case 'revived': {                                                        // the backup brings the player back
				const p = e.who === 1 && w.ally ? w.ally.body : w.player;
				this.flashAt(p.x, p.z, 7, 0.6, 'softGreen'); this.flashAt(p.x, p.z, 3, 0.3);
				for (let i = 0; i < 3; i++) { const f = this.addFx('ring', i % 2 ? 'ring' : 'gold', p.x, 0.4, p.z, 0.45 + i * 0.2, 6 + i * 3); if (f) f.mesh.scaling.setAll(0.3); }
				this.burst(p.x, 1, p.z, C(0.5, 1, 0.7), 70);
				break;
			}
			case 'power': {
				if (e.power === 'wall' || e.power === 'scan' || e.power === 'update' || e.power === 'backup') {   // these show themselves while they last
					this.flashAt(e.x + 0.9, e.z, 3.2, 0.3, e.power === 'wall' ? 'softOrange' : e.power === 'scan' ? 'softGreen' : 'softBlue'); this.ringAt(e.x + 0.9, e.z, 3.4, 0.36);
					this.burst(e.x + 0.9, 1, e.z, e.power === 'wall' ? C(1, 0.6, 0.2) : e.power === 'scan' ? C(0.4, 1, 0.6) : C(0.5, 0.75, 1), 36);
					break;
				}
				if (e.power === 'aware') {                                           // Cyber takes off with the bomb (drawCourier flies him)
					this.flashAt(e.x + 0.9, e.z, 3.5, 0.3, 'softGold'); this.ringAt(e.x + 0.9, e.z, 4, 0.4, 'gold'); this.burst(e.x + 0.9, 1, e.z, WEAPON_COLORS.shield, 40);
					break;
				}
				const big = e.power === 'mega', key = e.power === 'freeze' ? 'softBlue' : e.power === 'laser' ? 'softViolet' : e.power === 'guard' ? 'softGreen' : big ? 'softGold' : 'softCyan';
				this.flashAt(e.x + 5, e.z, e.power === 'guard' ? 4 : 16, big ? 0.7 : 0.5, key); this.flashAt(e.x, e.z, 5, 0.25);
				if (e.power === 'laser') break;
				for (let i = 0; i < (big ? 4 : e.power === 'guard' ? 1 : 2); i++) { const f = this.addFx('ring', big || e.power === 'guard' ? 'gold' : 'ring', e.x, 0.4, e.z, 0.5 + i * 0.22, e.power === 'guard' ? 4 : 30); if (f) f.mesh.scaling.setAll(0.3); }
				this.burst(e.x, 1, e.z, big ? WEAPON_COLORS.shield : WEAPON_COLORS.pulse, 60);
				break;
			}
			case 'bossDead': this.shatter(e.enemy, DANGER, 40); this.ringAt(e.enemy.x, e.enemy.z, 7, 0.6); break;
			case 'playerHit': this.burst(w.player.x, 0.8, w.player.z, DANGER, 28); this.ringAt(w.player.x, w.player.z, 2.2, 0.3); break;
			case 'enemyFire': this.flashAt(e.x - 0.4, e.z, 0.5, 0.08); break;
		}
	}
	/** An enemy bursts into small pieces that fade quickly, with a shock ring. */
	shatter(e: Enemy, color: Color3, count = e.kind === 'normal' ? 9 : 14) {
		if (this.reduceMotion) count = Math.ceil(count / 3);
		const m = this.mats.get('debrisMat'); if (m) m.emissiveColor = color.clone();
		for (let i = 0; i < count; i++) {
			const a = this.rnd() * 6.28, v = 2 + this.rnd() * 6;
			this.addFx('debris', 'debris', e.x, 0.4, e.z, 0.3 + this.rnd() * 0.3, 1 + this.rnd(), Math.cos(a) * v, 1 + this.rnd() * 3, Math.sin(a) * v);
		}
		this.ringAt(e.x, e.z, e.r * 4, 0.28); this.flashAt(e.x, e.z, e.r * 3, 0.1); this.flashAt(e.x, e.z, e.r * 4.5, 0.26, 'softOrange');
		this.burst(e.x, 0.5, e.z, color, e.kind === 'normal' ? 12 : 22);
	}
	/** Lightning between two points: a bright core inside a wide glow (the arc), or one thin line (a ricochet). */
	private bolt(x0: number, z0: number, x1: number, z1: number, thick: boolean, lvl = 1) {
		if (thick && lvl >= 4) this.bolt(x0, z0, x1, z1, false);                  // a second, thinner strand beside the main one
		const fat = thick ? 1 + (lvl - 1) * 0.3 : 1;
		const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.8));
		let px = x0, pz = z0;
		for (let i = 1; i <= n; i++) {
			const k = i / n, j = i === n ? 0 : 0.34 + lvl * 0.07;
			const qx = x0 + (x1 - x0) * k + (this.rnd() - 0.5) * j, qz = z0 + (z1 - z0) * k + (this.rnd() - 0.5) * j;
			const len = Math.hypot(qx - px, qz - pz), ang = -Math.atan2(qz - pz, qx - px);
			for (const key of thick ? ['bolt', 'boltGlow'] : ['bolt']) {
				const f = this.addFx('bolt', key, (px + qx) / 2, 0.7, (pz + qz) / 2, thick ? 0.13 : 0.09, 1);
				if (f) { f.mesh.scaling.set(len, 1, fat); f.mesh.rotation.y = ang; }
			}
			px = qx; pz = qz;
		}
		this.burst(x1, 0.6, z1, thick ? WEAPON_COLORS.arc : WEAPON_COLORS.disc, 4 + lvl * 2);
	}
	/** Which shape a small enemy wears in this stage. */
	kindOf(e: Enemy): string { const k = KINDS[this.stage]; return e.kind === 'normal' ? k.small[e.id % k.small.length] : e.kind === 'rare' ? k.rare : e.kind === 'armored' ? 'ransom' : e.kind; }

	// ------------------------------------------------------------------ per frame
	/** Draws the world as it is now. Call once per frame, also while the simulation is paused. */
	sync(w: World | null, dt: number, paused: boolean) {
		const move = paused ? 0 : dt;
		this.t += move; this.frame++;
		this.scenery.reduceMotion = this.reduceMotion;
		this.scenery.update(move, this.energy);
		const lively = !this.reduceMotion && move > 0;

		for (let i = this.due.length - 1; i >= 0; i--) if (this.due[i].at <= this.t) this.due.splice(i, 1)[0].run();
		for (const p of this.pools.values()) p.begin();
		for (const set of [this.beam, this.beam2]) { set.core.setEnabled(false); set.halo.setEnabled(false); set.tip.setEnabled(false); for (const r of set.rings) r.setEnabled(false); }
		let bossSeen = false, shieldsUsed = 0;
		if (w) {
			for (const e of w.enemies) {
				if (e.dead) continue;
				const pop = 1 + (e.flash > 0 ? 0.22 : 0), wob = Math.sin(this.t * 3 + e.seed);
				if (e.kind === 'boss') { bossSeen = true; this.drawBoss(e, w, pop); continue; }
				if (e.kind === 'crate') {                                              // the Cyber box: it turns, shines and sheds sparks so it is noticed
					if (e.pattern === 2) {                                             // the heart box beats like a heart
						const beat = 1 + 0.16 * Math.max(0, Math.sin(this.t * 7)) ** 3, m = this.pool('crateHeart').put(e.id); m.position.set(e.x, 0.55 + wob * 0.1, e.z); m.scaling.setAll(1.45 * pop * beat);
						this.soft('softRed', e.id, e.x, e.z, 4 * beat); this.soft('softWhite', e.id, e.x, e.z, 1.3 * beat); const o = this.pool('ring').put(e.id + 1e6); o.position.set(e.x, 0.3, e.z); o.scaling.setAll(2.3 * beat);
						continue;
					}
					const rare = e.pattern === 1, m = this.pool(rare ? 'crateRare' : 'crate').put(e.id); m.position.set(e.x, 0.55 + wob * 0.14, e.z); m.rotation.y = this.t * (rare ? 3.6 : 2.4); m.scaling.setAll((rare ? 1.38 : 1.3) * pop);
					if (rare) { this.soft('softViolet', e.id, e.x, e.z, 4.6 + 0.7 * Math.sin(this.t * 9)); this.soft('softWhite', e.id, e.x, e.z, 1.5 + 0.5 * Math.sin(this.t * 13)); const o = this.pool('gold').put(e.id + 1e6); o.position.set(e.x, 0.34, e.z); o.scaling.setAll(2.9 + 0.3 * Math.cos(this.t * 7)); if (lively && this.frame % 3 === 0) this.burst(e.x, 1, e.z, C(0.85, 0.6, 1), 3); }
					else this.soft('softGold', e.id, e.x, e.z, 3.8 + 0.5 * Math.sin(this.t * 7)); const r = this.pool('gold').put(e.id); r.position.set(e.x, 0.3, e.z); r.scaling.setAll(2 + 0.2 * Math.sin(this.t * 9));
					if (lively && this.frame % 6 === 0) this.burst(e.x, 1, e.z, WEAPON_COLORS.shield, 3);
					continue;
				}
				if (w.freeze > 0) this.soft('softBlue', e.id + 5e6, e.x, e.z, e.r * 5.5);
				if (e.kind === 'armored') {
					const m = this.pool('lock' + this.stage).put(e.id); m.position.set(e.x, 0.3, e.z); m.scaling.setAll(pop);
					const sh = this.pool('shackle').put(e.id);                           // down and shut while it blocks; lifted and tilted while it can be hurt
					sh.position.set(e.x - 0.1, e.shielded ? 0.52 : 1.05, e.z); sh.rotation.x = e.shielded ? 0 : 0.6; sh.scaling.setAll(pop);
				} else if (e.kind === 'rare') {                                      // the rare one of this stage: golden, larger, leaving a trail
					const kind = this.kindOf(e), m = this.pool(kind).put(e.id); m.position.set(e.x, 0.5 + wob * 0.1, e.z); m.scaling.setAll(1.35 * pop);
					m.rotation.y = kind === 'wiper' ? this.t * 9 : kind === 'zeroday' ? this.t * 3 : Math.sin(this.t * 4) * 0.5;
					this.soft('softGold', e.id + 1e6, e.x, e.z, 2.6);
					if (lively && this.frame % 5 === 0) this.addFx('trail', 'trail', e.x + 0.3, 0.5, e.z, 0.35, 1);
				} else if (e.kind === 'turret') {
					const m = this.pool('pod').put(e.id); m.position.set(e.x, 0.3, e.z); m.rotation.y = this.t * 1.5; m.scaling.setAll(pop * (1 + 0.05 * wob));
				} else {
					const kind = this.kindOf(e), m = this.pool(kind).put(e.id);
					m.position.set(e.x, 0.45 + wob * 0.06, e.z); m.scaling.setAll(1.3 * pop);
					if (kind === 'virus' || kind === 'poly') { m.rotation.y = this.t * 2 + e.seed; m.rotation.x = wob * 0.3; }
					else if (kind === 'worm' || kind === 'bait') m.rotation.y = Math.sin(this.t * 6 + e.seed) * 0.5;
					else if (kind === 'scare' || kind === 'adware') { m.rotation.y = Math.sin(this.t * 2 + e.seed) * 0.2; m.scaling.setAll(1.3 * pop * (1 + 0.08 * Math.sin(this.t * 10 + e.seed))); }
					else if (kind === 'dropper') { m.rotation.y = Math.sin(this.t * 2 + e.seed) * 0.3; m.rotation.z = wob * 0.18; m.rotation.x = Math.sin(this.t * 3.3 + e.seed) * 0.15; }
					else if (kind === 'keylog') { m.rotation.y = Math.sin(this.t * 3 + e.seed) * 0.3; m.rotation.z = wob * 0.12; }
					else if (kind === 'bug') m.rotation.y = Math.sin(this.t * 9 + e.seed) * 0.16;
					else if (kind === 'bomb') { m.rotation.z = wob * 0.25; m.scaling.setAll(1.3 * pop * (1 + 0.07 * Math.sin(this.t * 12 + e.seed))); }
					else if (kind === 'bot') m.rotation.y = Math.sin(this.t * 2.5 + e.seed) * 0.45;
					else { m.rotation.y = Math.sin(this.t * 2.4 + e.seed) * 0.32; m.rotation.z = wob * 0.14; }
				}
			}
			const spot = this.spotlight;
			if (spot && !spot.dead) { const r = this.pool('gold').put(2e6); r.position.set(spot.x, 0.25, spot.z); r.scaling.setAll(spot.r * 3.4 + 0.25 * Math.sin(this.frame * 0.2)); this.soft('softWhite', 2e6, spot.x, spot.z, spot.r * 6, spot.r * 6, 0.2); }
			for (const s of w.shots) {
				const yaw = -Math.atan2(s.vz, s.vx), lvl = s.owner === 1 && w.ally ? w.ally.weapon.level : w.weapon.level, G = 1 + (lvl - 1) * 0.13;   // every level is a little larger and brighter
				if (s.kind === 'shield') { this.drawShield(shieldsUsed++, s.x, s.z, lively, lvl); continue; }
				const m = this.pool(s.kind).put(s.id);
				m.position.set(s.x, 0.7, s.z); m.rotation.y = yaw;
				const softKey = SOFT[s.kind];
				switch (s.kind) {
					case 'pulse': { m.scaling.set(G, G, (1 + (lvl - 1) * 0.16) * G); this.soft(softKey, s.id, s.x - 0.35 * G, s.z, 2.6 * G, (0.9 + lvl * 0.14) * G).rotation.y = yaw; break; }
					case 'pellet': m.scaling.setAll(G); this.soft(softKey, s.id, s.x - 0.15, s.z, 1.5 * G, 1.1 * G).rotation.y = yaw; break;
					case 'plasma': {
						const k = s.r * 2 * (1 + 0.14 * Math.sin(this.t * 22)); m.scaling.setAll(k);
						const h = this.pool('halo').put(s.id); h.position.set(s.x, 0.7, s.z); h.scaling.setAll(k * (1.7 + lvl * 0.12 + 0.2 * Math.sin(this.t * 14)));
						this.soft(softKey, s.id, s.x, s.z, k * (4.6 + lvl * 0.5));
						const moons = lvl >= 5 ? 3 : lvl >= 4 ? 2 : lvl >= 2 ? 1 : 0;        // sparks of energy circle the ball, more with each level
						for (let i = 0; i < moons; i++) { const o = this.pool('shard').put(s.id * 4 + i + 1e6); const a = this.t * 12 + i * Math.PI * 2 / moons; o.position.set(s.x + Math.cos(a) * 0.8, 0.7, s.z + Math.sin(a) * 0.8); o.rotation.y = -a - Math.PI / 2; }
						if (lively && this.frame % 3 === 0) this.addFx('trail', 'halo', s.x - 0.4, 0.7, s.z, 0.25, 0.7);
						break;
					}
					case 'shard': m.scaling.setAll(G); this.soft(softKey, s.id, s.x, s.z, 1.2 * G); break;
					case 'missile': m.scaling.setAll(G); this.soft(softKey, s.id, s.x - 0.3, s.z, 2.2 * G, 1.3 * G).rotation.y = yaw; if (lively && (lvl >= 3 || this.frame % 2 === 0)) this.addFx('trail', 'trail', s.x - Math.cos(-yaw) * 0.45, 0.7, s.z - Math.sin(-yaw) * 0.45, 0.26 + lvl * 0.05, 1 + lvl * 0.2); break;
					case 'disc': {
						m.rotation.y = this.t * 20; m.scaling.set(G, 1, G); this.soft(softKey, s.id, s.x, s.z, 2.4 * G);
						const r = this.pool('discRing').put(s.id); r.position.set(s.x, 0.7, s.z); r.scaling.setAll(G * (1 + 0.2 * Math.sin(this.t * 30)));
						if (lvl >= 4) { const o = this.pool('discRing').put(s.id + 1e6); o.position.set(s.x, 0.66, s.z); o.scaling.setAll(G * (1.55 + 0.15 * Math.cos(this.t * 24))); }   // a second ring
						if (lively && this.frame % Math.max(1, 5 - lvl) === 0) this.addFx('trail', 'discRing', s.x, 0.68, s.z, 0.16 + lvl * 0.03, 0.9 * G);
						break;
					}
					case 'wave': {
						// the painted crescent takes three quarters of its sheet across and its tip is a third of the way ahead
						const wd = s.radius * 2 * 1.42, len = (2.2 + wd * 0.42) * (1 + (lvl - 1) * 0.08); m.scaling.set(len, 1, wd); m.rotation.y = 0; m.position.x = s.x - len * 0.27;
						this.soft(softKey, s.id, s.x - 0.2, s.z, 2.2 * G, wd * 0.8);
						if (lively && this.frame % Math.max(2, 7 - lvl) === 0) { const f = this.addFx('trail', 'waveGhost', s.x - len * 0.27 - 0.4, 0.62, s.z, 0.2, len); if (f) f.wide = wd; }
						break;
					}
				}
				// the MOTION of a shot changes with every level, so an upgrade shows in how it flies and not only in its size:
				// 2 it throbs along its flight, 3 it weaves from side to side, 4 a spark winds around it, 5 two sparks, and it rolls
				const few = s.kind === 'pellet' || s.kind === 'shard', th = -yaw, px = -Math.sin(th), pz = Math.cos(th), beatT = this.t * 19 + s.id * 1.3;
				if (lvl >= 2 && s.kind !== 'plasma') {
					const k = 1 + (few ? 0.14 : 0.2) * Math.sin(beatT);
					if (s.kind === 'disc') m.rotation.x = Math.sin(beatT * 0.6) * 0.35; else if (s.kind === 'wave') m.scaling.x *= k; else if (s.kind === 'missile') m.rotation.y = yaw + Math.sin(beatT) * 0.2; else m.scaling.x *= k;
				}
				if (lvl >= 3 && s.kind !== 'wave') { const sway = Math.sin(this.t * 15 + s.id * 1.7) * (few ? 0.05 : 0.1); m.position.x += px * sway; m.position.z += pz * sway; }
				else if (lvl >= 3) m.scaling.z *= 1 + 0.06 * Math.sin(this.t * 13 + s.id);
				if (lvl >= 4 && !few && s.kind !== 'plasma') for (let i = 0; i < (lvl >= 5 ? 2 : 1); i++) {
					const a = this.t * 16 + s.id + i * Math.PI, reach = s.kind === 'wave' ? s.radius * 1.15 : s.kind === 'disc' ? 0.52 : 0.36, o = this.pool('spark').put(s.id * 2 + i);
					o.position.set(s.x + px * Math.cos(a) * reach, 0.72 + Math.sin(a) * 0.16, s.z + pz * Math.cos(a) * reach); o.scaling.setAll(1 + 0.3 * Math.sin(a * 2));
				}
				if (lvl >= 5 && (s.kind === 'pulse' || few || s.kind === 'missile')) m.rotation.x = this.t * 22 + s.id;
				// what every weapon gains with its levels: a trail of light from level 2, a white-hot heart from level 4, sparks at level 5
				const light = s.kind === 'pellet' || s.kind === 'shard' || s.kind === 'pulse';   // many quick shots: keep their extras small, or they merge into one white column
				if (lvl >= 4 && s.kind !== 'wave') this.soft('softWhite', s.id, s.x, s.z, (light ? 0.6 : 1) * G, (light ? 0.6 : 1) * G, 0.56);
				if (lively && softKey && lvl >= (light ? 4 : 2) && (this.frame + s.id) % (light ? 4 : Math.max(1, 6 - lvl)) === 0 && s.kind !== 'wave' && s.kind !== 'missile')
					this.addFx('trail', softKey, s.x - Math.cos(-yaw) * 0.4, 0.5, s.z - Math.sin(-yaw) * 0.4, 0.14 + lvl * 0.035, (light ? 0.9 : 1.5) * G);
				if (lively && lvl >= 5 && (this.frame + s.id) % 7 === 0) this.burst(s.x, 0.7, s.z, WEAPON_COLORS[s.weapon], 2);
			}
			// the glow at Cyber grows with the level of the weapon in hand, and at the highest level a ring turns around him
			const pair: [Body, { id: WeaponId; level: number }, number][] = w.ally ? [[w.player, w.weapon, 0], [w.ally.body, w.ally.weapon, 1]] : [[w.player, w.weapon, 0]];
			if (w.firing) for (const [who, gun, n] of pair) {
				if (who.down || who.busy) continue;
				const lvl = gun.level, px = who.x + 0.95, pz = who.z, beat = 1 + 0.1 * Math.sin(this.t * 9 + n);
				this.soft(GLOW_OF[gun.id], 4e6 + n * 10, px, pz, (1 + 0.42 * (lvl - 1)) * beat, (1 + 0.42 * (lvl - 1)) * beat, 0.58);
				if (lvl >= 3) this.soft('softWhite', 4e6 + n * 10, px, pz, 0.5 + 0.14 * lvl, 0.5 + 0.14 * lvl, 0.6);
				if (lvl >= 5) { const r = this.pool('ring').put(4e6 + n * 10); r.position.set(px, 0.62, pz); r.scaling.setAll(1.5 + 0.12 * Math.sin(this.t * 12)); }
			}
			for (const b of w.bullets) {
				this.soft('shade', b.id, b.x, b.z, b.r * 7, b.r * 7, 0.3);
				if (b.kind === 'orb') { this.soft('softRed', b.id, b.x, b.z, b.r * 6, b.r * 6, 0.34); const m = this.pool('orb').put(b.id); m.position.set(b.x, 0.5, b.z); m.scaling.setAll(b.r * 2.5 * (1 + 0.08 * Math.sin(this.t * 16 + b.id))); const c = this.pool('orbCore').put(b.id); c.position.set(b.x, 0.62, b.z); c.scaling.setAll(b.r * 1.15); }
				else if (b.kind === 'code') { this.soft('softRed', b.id, b.x, b.z, b.r * 6.5, b.r * 6.5, 0.34); const m = this.pool('code' + b.id % GLYPHS.length).put(b.id), k = 0.92 + 0.08 * Math.sin(this.t * 12 + b.id); m.position.set(b.x, 0.56, b.z); m.rotation.y = 0; m.scaling.set(k, 1, k); }
				else { const m = this.pool('dshard').put(b.id); m.position.set(b.x, 0.5, b.z); m.rotation.y = this.t * 7 + b.id; }
			}
			for (const z of w.zones) {
				const warn = z.warn > 0, m = this.pool(warn ? 'zoneWarn' : 'zoneLive').put(z.id);
				m.position.set((z.x0 + z.x1) / 2, 0.02, (z.z0 + z.z1) / 2);
				const k = warn ? 0.86 + 0.14 * Math.abs(Math.sin(z.warn * 12)) : 1;
				m.scaling.set((z.x1 - z.x0) * k, 1, (z.z1 - z.z0) * k);
			}
			if (w.beam.on) this.drawBeam(w.beam, w.weapon.level, this.beam, 0, lively);
			if (w.ally?.beam.on) this.drawBeam(w.ally.beam, w.ally.weapon.level, this.beam2, 1000, lively);
			const pl = w.laserBy === 1 && w.ally ? w.ally.body : w.player;
			if (w.laser > 0) {                                                       // the laser wave: a wide column of light from the player to the top
				const len = A.length + 3 - pl.x, cx = pl.x + len / 2, flick = 1 + 0.12 * Math.sin(this.t * 40);
				this.soft('softViolet', 6e6, cx, pl.z, len * 1.25, 6.4 * flick, 0.62); this.soft('softWhite', 6e6, cx, pl.z, len * 1.25, 2.6 * flick, 0.66);
				this.soft('softViolet', 6e6 + 1, pl.x + 0.8, pl.z, 5, 5, 0.7);
				if (lively) for (let i = 0; i < 2; i++) this.burst(pl.x + 1 + this.rnd() * len * 0.8, 0.8, pl.z + (this.rnd() - 0.5) * 3, C(1, 0.6, 1), 3);
			}
			if (w.wall.left > 0 && (w.wall.left > 1 || Math.floor(this.t * 10) % 2 === 0)) {   // the firewall: a burning line that enemy fire cannot cross
				const x = w.wall.x, flick = 1 + 0.15 * Math.sin(this.t * 30);
				this.soft('softOrange', 2e6 + 1, x, 0, 1.9 * flick, 13, 0.6); this.soft('softRed', 2e6 + 1, x + 0.3, 0, 1.2, 13, 0.58); this.soft('softWhite', 2e6 + 1, x, 0, 0.42 * flick, 12, 0.64);
				if (lively) for (let i = 0; i < 2; i++) this.burst(x + 0.2, 0.8, (this.rnd() - 0.5) * A.halfWidth * 2.2, C(1, 0.55 + this.rnd() * 0.3, 0.15), 4);
			}
			if (w.scan.on) {                                                         // the antivirus scan: a bright line sweeping down the field
				const x = w.scan.x;
				this.soft('softGreen', 2e6 + 2, x, 0, 1.6, 13, 0.6); this.soft('softWhite', 2e6 + 2, x, 0, 0.34, 12, 0.64); this.soft('softGreen', 2e6 + 3, x + 2.2, 0, 4.5, 13, 0.56);
				if (lively) this.burst(x, 0.8, (this.rnd() - 0.5) * A.halfWidth * 2.2, C(0.5, 1, 0.65), 5);
			}
			for (const [who, , n] of pair) {                                         // the security update: the weapon glows while it is stronger
				if ((n ? w.ally!.boost : w.boost) <= 0) continue;
				const k = 1 + 0.2 * Math.sin(this.t * 14), px = who.x + 0.95;
				this.soft('softBlue', 2e6 + 4 + n * 10, px, who.z, 3.4 * k, 3.4 * k, 0.6); const r = this.pool('ring').put(2e6 + 4 + n * 10); r.position.set(px, 0.7, who.z); r.scaling.setAll(1.2 + ((this.t * 2.2) % 1) * 1.4);
			}
			this.drawCourier(w, move, lively);
			for (const [who, , n] of pair) {
				if (who.bubble > 0 && !who.down && (who.bubble > 1 || Math.floor(this.t * 10) % 2 === 0)) { const b = this.pool('bubble').put(1 + n); b.position.set(who.x, 0.9, who.z); b.scaling.setAll(2.5 + 0.12 * Math.sin(this.t * 8)); const r = this.pool('gold').put(6e6 + n); r.position.set(who.x, 0.2, who.z); r.scaling.setAll(2.4); }
				if (who.down) {                                                    // fallen: a red ring calls for help, and a gold one closes in while the friend revives
					const ask = this.pool('ring').put(5e6 + n); ask.position.set(who.x, 0.2, who.z); ask.scaling.setAll(2.2 + 0.4 * Math.sin(this.t * 6));
					this.soft('softRed', 5e6 + n, who.x, who.z, 3.2, 3.2, 0.3);
					if (w.reviving > 0) { const g = this.pool('gold').put(5e6 + n); g.position.set(who.x, 0.3, who.z); g.scaling.setAll(3.4 - 2.2 * w.reviving); this.soft('softGold', 5e6 + n, who.x, who.z, 2 + 3 * w.reviving); }
				}
			}
		}
		for (const p of this.pools.values()) p.end();
		this.shields.forEach((n, i) => n.setEnabled(i < shieldsUsed));
		if (!w) { this.courierOut = false; this.courierBack = 0; this.courier?.setEnabled(false); }
		if (this.boss) { this.boss.root.setEnabled(bossSeen); for (const seg of this.boss.tail) seg.setEnabled(bossSeen); }

		for (let i = this.fx.length - 1; i >= 0; i--) {
			const f = this.fx[i];
			f.age += move;
			const k = f.age / f.life;
			if (k >= 1) { f.pool.give(f.mesh); this.fx.splice(i, 1); continue; }
			if (f.kind === 'ring') f.mesh.scaling.set(f.size * (0.15 + 0.85 * k), Math.max(0.05, 1 - k), f.size * (0.15 + 0.85 * k));
			else if (f.kind === 'bloom') { const s = f.size * Math.sin(Math.PI * Math.pow(k, 0.5)); f.mesh.scaling.set(Math.max(0.05, s), 1, Math.max(0.05, s)); }
			else if (f.kind === 'flash') { const s = f.size * (k < 0.4 ? 0.3 + k * 1.75 : 1 - (k - 0.4) * 0.9); f.mesh.scaling.set(s, 1, s); }
			else if (f.kind === 'debris') { f.mesh.position.addInPlaceFromFloats(f.vx * move, f.vy * move, f.vz * move); f.mesh.scaling.setAll(f.size * (1 - k)); f.mesh.rotation.x += move * 9; f.mesh.rotation.y += move * 7; }
			else if (f.kind === 'trail') { const s = f.size * (1 - k); f.mesh.scaling.set(s, s, f.wide || s); }
			else f.mesh.scaling.y = 1 - k;                                        // lightning keeps its length and width, and thins away
		}
	}

	/** A thrown Cyber Shield: Cyber himself, lying flat and spinning inside a golden shield of light, with a comet of
	 *  fading shields, rings and sparks behind him. */
	private drawShield(i: number, x: number, z: number, lively: boolean, lvl = 1) {
		const G = 1 + (lvl - 1) * 0.07;
		if (!this.shields[i] && this.makeShield) this.shields[i] = this.makeShield();
		const spin = this.t * (9 + lvl * 2.6) + i * 2, n = this.shields[i], beat = 1 + (0.05 + lvl * 0.014) * Math.sin(this.t * 24 + i);
		const lean = lvl >= 3 ? Math.sin(this.t * 6 + i) * 0.22 : 0;
		if (n) { n.position.set(x, 1.05, z); n.rotation.set(lean, spin, CYBER_FLAT + lean * 0.5); }
		for (let k = 0; k < (lvl >= 5 ? 2 : lvl >= 4 ? 1 : 0); k++) { const a = -this.t * 7 + k * Math.PI, o = this.pool('emblemGhost').put(8e6 + i * 2 + k + 10); o.position.set(x + Math.cos(a) * 1.9, 0.78, z + Math.sin(a) * 1.9); o.rotation.y = a * 2; o.scaling.set(1.1, 1, 1.1); }
		const e = this.pool('emblem').put(9e6 + i); e.position.set(x, 0.8, z); e.rotation.y = spin; e.scaling.set(2.5 * G * beat, 1, 2.5 * G * beat);
		this.soft('softGold', 9e6 + i, x, z, (3.8 + lvl * 0.3) * beat, (3.8 + lvl * 0.3) * beat, 0.45);
		const r = this.pool('gold').put(9e6 + i); r.position.set(x, 0.6, z); r.scaling.setAll(2.3 * G + 0.25 * Math.sin(this.t * 22));
		if (lvl >= 4) { const o = this.pool('emblemGhost').put(9e6 + i); o.position.set(x, 0.74, z); o.rotation.y = -spin * 0.6; o.scaling.set(3.5 * G, 1, 3.5 * G); }   // a second shield of light turning the other way
		if (lvl >= 2) this.soft('softWhite', 9e6 + i, x, z, 0.9 + lvl * 0.25, 0.9 + lvl * 0.25, 0.5);
		if (!lively) return;
		if (this.frame % Math.max(2, 5 - lvl) === 0) { const f = this.addFx('trail', 'emblemGhost', x, 0.7, z, 0.24 + lvl * 0.03, 2.3 * G); if (f) f.mesh.rotation.y = spin; }
		if (this.frame % Math.max(3, 8 - lvl) === 0) { const f = this.addFx('ring', 'gold', x, 0.5, z, 0.34, 2 * G); if (f) f.mesh.scaling.setAll(1.4); }
		if (this.frame % 2 === 0) this.burst(x, 0.8, z, WEAPON_COLORS.shield, 2 + lvl);
	}
	/** Total Awareness: Cyber climbs from the player to the middle of the field, lets the bomb go, and it falls where the
	 *  blast will be; then he flies home. His flight follows the simulation's own countdown, so the bomb lands exactly
	 *  when the blast happens. */
	private drawCourier(w: World, move: number, lively: boolean) {
		const flying = w.novaIn > 0;
		if (!flying && this.courierBack <= 0) { if (this.courierOut) { this.courierOut = false; this.courier?.setEnabled(false); } return; }
		if (!this.courier && this.makeShield) this.courier = this.makeShield();
		const n = this.courier, p = w.player, hx = p.x + 0.95, hz = p.z, cx = A.length / 2, cz = 0, ease = (k: number) => k * k * (3 - 2 * k);
		this.courierOut = true;
		let k: number, bomb = -1;
		if (flying) {
			const u = 1 - w.novaIn / World.NOVA_DELAY;                              // 0 .. 1 over the whole run-up
			k = ease(Math.min(1, u / 0.5)); bomb = u > 0.5 ? (u - 0.5) / 0.5 : -1;
			this.courierBack = 0.75;
		} else { this.courierBack -= move; k = ease(Math.max(0, this.courierBack / 0.75)); }
		const x = hx + (cx - hx) * k, z = hz + (cz - hz) * k, high = 1 + 5.5 * Math.sin(k * Math.PI / 2);
		if (n) { n.setEnabled(true); n.position.set(x, high, z); n.rotation.set(0, Math.sin(this.t * 5) * 0.2, -0.35 * Math.sin(k * Math.PI)); n.scaling.setAll(1.1 + 1.7 * k); }
		this.soft('softGold', 3e6, x, z, 2.2 + 2 * k, 2.2 + 2 * k, 0.5);
		if (lively && this.frame % 2 === 0) { this.burst(x - 0.4, high, z, WEAPON_COLORS.shield, 5); if (flying && k < 1) this.addFx('trail', 'softGold', x - 0.5, 0.6, z, 0.3, 1.6); }
		if (bomb >= 0) {                                                         // the bomb falls from Cyber to the ground: smaller as it drops, a ring marks where it lands
			const drop = bomb * bomb, y = 0.7 + 5.8 * (1 - drop);
			const m = this.pool('awareBomb').put(1); m.position.set(cx, y, cz); m.rotation.set(this.t * 4, this.t * 3, 0); m.scaling.setAll(2.3 - 1.2 * drop);
			this.soft('softViolet', 3e6, cx, cz, 2 + 6 * drop, 2 + 6 * drop, 0.42); this.soft('softWhite', 3e6, cx, cz, 0.6 + 2 * drop, 0.6 + 2 * drop, 0.44);
			const r = this.pool('gold').put(3e6); r.position.set(cx, 0.3, cz); r.scaling.setAll(7 - 4.5 * drop);
			if (lively && this.frame % 2 === 0) this.addFx('trail', 'softViolet', cx, y, cz, 0.25, 1.4);
		}
	}
	private drawBoss(e: Enemy, w: World, pop: number) {
		const id = w.stage.boss.id;
		if (!this.boss || this.boss.id !== id) this.buildBoss(id);
		const b = this.boss!, t = this.t, ph = w.director.bossState?.phase ?? 0, guarded = e.guard < 1, mv = b.moving;
		b.root.position.set(e.x, 0.55, e.z);
		b.root.scaling.setAll(pop > 1 ? 1.05 : 1);
		switch (id) {
			case 'angler': mv.jaw.rotation.z = 0.2 + 0.28 * Math.sin(t * (3 + ph * 2)) ** 2; mv.line.rotation.y = Math.sin(t * 1.6) * 0.6; b.root.rotation.z = Math.sin(t * 2) * 0.05; break;
			case 'warden': mv.bar.position.y += ((guarded ? 0.3 : 1.25) - mv.bar.position.y) * 0.2; mv.bar.rotation.z += ((guarded ? 0 : 0.4) - mv.bar.rotation.z) * 0.2; mv.chain.rotation.y = t * (guarded ? 1.8 : 0.5); break;
			case 'factory': {                                                      // the body follows where the head has been
				b.root.rotation.y = Math.sin(t * 2) * 0.25;
				b.path.unshift(e.x, e.z); if (b.path.length > 400) b.path.length = 400;
				b.tail.forEach((seg, i) => {
					const k = Math.min(b.path.length / 2 - 1, (i + 1) * 7) * 2;
					seg.position.set((b.path[k] ?? e.x) + (i + 1) * 0.5, 0.5 + Math.sin(t * 5 - i * 0.8) * 0.12, (b.path[k + 1] ?? e.z) + Math.sin(t * 2.4 - i * 0.7) * 0.5);
					seg.rotation.y = t + i;
				});
				break;
			}
			case 'core': mv.ball.rotation.y = t * (0.7 + ph * 0.4); mv.ball.rotation.x = Math.sin(t * 0.6) * 0.25; mv.ring.rotation.y = -t * 1.4; mv.ring.rotation.x = Math.sin(t) * 0.35; break;
			case 'omcode': {                                                       // the brackets leave the wordmark and shut in front of it, then go home
				b.shut += ((guarded ? 1 : 0) - b.shut) * 0.16;
				const s = b.shut;
				for (const [node, side] of [[mv.open, -1], [mv.close, 1]] as [TransformNode, number][]) {
					const home = node.metadata.homeZ as number;
					node.position.set(-0.35 + (-2.3 + 0.35) * s, 1.04, home * (1 - s) + side * 0.66 * s + side * 0.035 * Math.sin(t * 3) * (1 - s));
					node.scaling.set(1 + 2 * s, 1 + 1.2 * s, 1 + 2 * s);
				}
				mv.ring.rotation.y = t * (0.7 + ph * 0.3);
				b.root.rotation.z = Math.sin(t * 1.6) * 0.03;
				if (s > 0.2) { this.soft('softRed', 8e6 + 1, e.x - 2.3, e.z, 4.6 * s, 4.2 * s, 0.6); this.soft('softWhite', 8e6 + 1, e.x - 2.3, e.z, 1.6 * s, 2.6 * s, 0.62); }
				break;
			}
			default: b.root.rotation.y = 0.5 + Math.sin(t * 0.8) * 0.22; b.root.rotation.z = Math.sin(t * 2.2) * 0.04; mv.hatch.rotation.z += ((ph === 1 ? -1.2 : 0) - mv.hatch.rotation.z) * 0.1;
		}
		this.soft('shade', 8e6, e.x + 0.4, e.z + 0.3, e.r * 5, e.r * 5, 0.05);
		b.shield.setEnabled(guarded && id !== 'omcode');                         // the code boss shows its own shield: the brackets
		if (guarded) b.shield.scaling.setAll(e.r * 2.7 * (1 + 0.04 * Math.sin(t * 9)));
	}
	private buildBoss(id: string) {
		if (this.boss) { this.boss.root.dispose(false, false); for (const seg of this.boss.tail) seg.dispose(); }
		const built = this.models.boss(id);
		const shield = CreateSphere('bossShield', { diameter: 1, segments: 12 }, this.scene);
		shield.parent = built.root; shield.material = this.mats.get('bossShieldMat') ?? this.neon('bossShieldMat', C(0.6, 0.9, 1), 0.3); shield.isPickable = false;
		if (id === 'omcode') {                                                    // the wordmark, painted from the logo's own paths (the brackets are solid and move)
			const tex = this.painted('omcodeTex', 256, (g, S) => {
				upright(g, S, 1024);
				const k = 1000 / logo.viewBox[2];
				g.scale(k, k); g.translate(-LOGO.cx, -LOGO.cy);
				g.fillStyle = logo.red; for (const d of logo.om) g.fill(new Path2D(d));
				g.fillStyle = '#ffffff'; for (const d of logo.letters) g.fill(new Path2D(d));
			}, 1024);
			const plate = CreateGround('logoPlate', { width: LOGO.height, height: LOGO.length }, this.scene);
			const mat = this.mats.get('logoMat') ?? this.neon('logoMat', Color3.Black());
			mat.emissiveTexture = tex; mat.opacityTexture = tex; mat.backFaceCulling = false;
			plate.material = mat; plate.isPickable = false; plate.parent = built.root; plate.position.set(-0.35, 1.03, 0);
		}
		this.boss = { id, ...built, shield, path: [], shut: 0 };
	}
	private drawBeam(b: World['beam'], lvl: number, set: Arena['beam'], base: number, lively: boolean) {
		const { core, halo, tip, rings } = set, len = Math.max(0.1, b.x1 - b.x0);
		const flick = 1 + (0.1 + lvl * 0.035) * Math.sin(this.t * (30 + lvl * 7));
		const G = 1 + (lvl - 1) * 0.16;                                           // thicker and brighter with every level
		core.setEnabled(true); core.position.set(b.x0 + len / 2, 0.75, b.z); core.scaling.set(len, 0.1, b.width * 0.5 * G * flick);
		halo.setEnabled(true); halo.position.set(b.x0 + len / 2, 0.72, b.z); halo.scaling.set(len, 0.06, b.width * 2.1 * G * flick);
		this.soft('softCyan', 7e6 + base, b.x1, b.z, 2.2 + lvl * 0.5); this.soft('softWhite', 7e6 + base, b.x0, b.z, 1.2 + lvl * 0.25);
		if (lvl >= 2) this.soft('softCyan', 7e6 + 1 + base, b.x0 + len / 2, b.z, len * 1.15, b.width * (5 + lvl * 2.2) * flick, 0.58);   // light spilling along the whole beam
		if (lvl >= 4) this.soft('softWhite', 7e6 + 1 + base, b.x0 + len / 2, b.z, len * 1.1, b.width * 4 * flick, 0.6);
		tip.setEnabled(true); tip.position.set(b.x1, 0.75, b.z); tip.scaling.setAll(0.3 + lvl * 0.12 + 0.2 * Math.sin(this.t * 30));
		if (lively && this.frame % 2 === 0 && b.x1 < A.length) this.burst(b.x1, 0.7, b.z, WEAPON_COLORS.beam, 1 + lvl);
		for (let k = 0; k < (lvl >= 5 ? 8 : lvl >= 4 ? 4 : 0); k++) {              // sparks winding along the beam: one strand at level 4, two at level 5
			const u = ((this.t * 1.6 + k / (lvl >= 5 ? 4 : 4)) % 1), a = u * 18 + (k >= 4 ? Math.PI : 0) + this.t * 6, o = this.pool('spark').put(7e6 + base + k);
			o.position.set(b.x0 + u * len, 0.75 + Math.sin(a) * 0.2, b.z + Math.cos(a) * b.width * 1.6); o.scaling.setAll(1.2);
		}
		const count = lvl >= 5 ? 3 : lvl >= 3 ? 2 : 1;
		for (let i = 0; i < count; i++) { const r = rings[i]; r.setEnabled(true); r.position.set(b.x0 + ((this.t * (7 + lvl * 2) + i * len / count) % len), 0.75, b.z); r.scaling.setAll(b.width * 2.6 * G); }
	}

	/** Removes every moving thing (between stages and screens). */
	clear() {
		for (const p of this.pools.values()) p.clear();
		for (const f of this.fx) f.pool.give(f.mesh);
		this.fx = []; this.due = [];
		for (const n of this.shields) n.setEnabled(false);
		this.courier?.setEnabled(false); this.courierOut = false; this.courierBack = 0;
		if (this.boss) { this.boss.root.setEnabled(false); for (const seg of this.boss.tail) seg.setEnabled(false); this.boss.path = []; }
	}
	dispose() { this.sparks.dispose(); }
}
