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
import '@babylonjs/core/Rendering/outlineRenderer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/core/Meshes/instancedMesh';   // the import above is type-only and is erased; instancing needs the module itself
import eco from '../data/economy.json';
import type { WeaponId } from '../sim/economy';
import { rareKind, smallKind } from '../sim/director';
import { World } from '../sim/world';
import type { Body, Enemy, SimEvent } from '../sim/world';
import { C, Models } from './models';
import malware from '../data/malware-ar.json';
import { Scenery, SPACE } from './scenery';
import { SHOT_COLORS, SHOT_GLOW, ShotView } from './shots';
import { PowerFx } from './powerfx';
import type { FxKit } from './powerfx';

const A = eco.arena;
const PITCH = 58 * Math.PI / 180, SIN = Math.sin(PITCH), COS = Math.cos(PITCH);
/** The colour of each weapon (its sparks, its glow beside the fighter): the weapons themselves are drawn in shots.ts. */
export const WEAPON_COLORS: Record<WeaponId, Color3> = SHOT_COLORS;
/** Every stage has its own four kinds of small enemy and its own rare kind (malware-ar.json). Which one an enemy is
 *  depends only on its id, so a wave is always mixed and the same stage always looks the same. */
const KINDS = malware.stages as { small: string[]; rare: string }[];
const KIND_COLOR = (kind: string) => { const item = (malware.items as Record<string, { color: string } | undefined>)[kind]; return item ? Color3.FromHexString(item.color) : C(1, 1, 1); };
/** The armoured fake account wears a different colour in each stage. */
const CARD_COLORS = [['#5f7fb8', '#3d5488'], ['#c2506e', '#7d2c44'], ['#3fa873', '#226a45'], ['#8f68d8', '#553a94'], ['#d48a3a', '#8a5418']];
const DANGER = C(1, 0.2, 0.35), WHITE = C(1, 1, 1);
/** The dark line drawn around every enemy, boss and fighter, as in a drawn cartoon: it keeps their shapes apart from the photograph of the land. */
const INK = C(0.05, 0.07, 0.16);
const INKED = new Set<AbstractMesh>(); let inkOn = true;
export function inked(m: AbstractMesh, width = 0.022) { m.outlineColor = INK; m.outlineWidth = width; m.renderOutline = inkOn; INKED.add(m); m.onDisposeObservable.add(() => INKED.delete(m)); }
/** The ink line costs a second drawing of each outlined shape: it is left out at low quality, and dropped first when a phone struggles. */
export function setInk(on: boolean) { inkOn = on; for (const m of INKED) m.renderOutline = on; }
export const inkIsOn = () => inkOn;
/** The soft glow of each weapon beside the fighter who holds it. */
const GLOW_OF: Record<WeaponId, string> = SHOT_GLOW;

/** Instances of one shape, reused: put() the ones wanted this frame, end() hides the rest. */
class Pool {
	private free: InstancedMesh[] = []; private live = new Map<number, InstancedMesh>(); private seen = new Set<number>();
	constructor(private src: Mesh) { src.isVisible = false; src.isPickable = false; }
	get source() { return this.src; }
	private fresh() { const m = this.free.pop() ?? this.src.createInstance(this.src.name); m.isPickable = false; m.setEnabled(true); m.scaling.setAll(1); m.rotation.setAll(0); return m; }
	begin() { this.seen.clear(); }
	put(id: number): InstancedMesh { let m = this.live.get(id); if (!m) { m = this.fresh(); this.live.set(id, m); } this.seen.add(id); return m; }
	end() { for (const [id, m] of this.live) if (!this.seen.has(id)) { m.setEnabled(false); this.free.push(m); this.live.delete(id); } }
	take(): InstancedMesh { return this.fresh(); }
	give(m: InstancedMesh) { m.setEnabled(false); this.free.push(m); }
	clear() { this.begin(); this.end(); }
}
interface Fx { kind: 'ring' | 'debris' | 'bolt' | 'trail' | 'flash' | 'bloom'; mesh: InstancedMesh; pool: Pool; age: number; life: number; vx: number; vy: number; vz: number; size: number; wide: number }
/** A boss on screen. `shut` runs from 0 to 1 and back as it closes its guard (or, for some, as it readies a blow). */
interface BossView { id: string; root: TransformNode; moving: Record<string, TransformNode | Mesh>; tail: Mesh[]; shield: Mesh; shut: number }

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
	/** The two ramparts and their lines of light: only over the land, never around the Earth in space. */
	private ramparts: Mesh[] = [];
	private boss: BossView | null = null;
	/** The pictures of the nine weapons (shots.ts). */
	private shotView!: ShotView;
	/** The pictures of the special skills (powerfx.ts), and the Cyber that leaves a fighter's side to raise the sun of Total Awareness. */
	private powerFx!: PowerFx;
	private courier: TransformNode | null = null;
	/** True while that Cyber is away (the game hides the one beside the fighter meanwhile), and whose he is (0 the main player's, 1 the supporter's). */
	courierOut = false; courierOf = 0;
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
		this.powerFx = new PowerFx(this.kit());
		this.shotView = new ShotView({
			scene, models: this.models, pool: key => this.pool(key), solid: (key, mesh) => this.solid(key, mesh), glow: (key, mesh, color, alpha) => this.glow(key, mesh, color, alpha),
			sheet: (key, tex, color, alpha, add) => this.sheet(key, tex, color, alpha, add), painted: (name, size, draw) => this.painted(name, size, draw),
			soft: (key, id, x, z, sx, sz, y) => this.soft(key, id, x, z, sx, sz, y), fx: (kind, key, x, y, z, life, size) => this.addFx(kind, key, x, y, z, life, size),
			ring: (x, z, size, life, key, y) => this.ringAt(x, z, size, life, key, y), flash: (x, z, size, life, key) => this.flashAt(x, z, size, life, key), bloom: (x, z, size, life, key) => this.bloomAt(x, z, size, life, key),
			burst: (x, y, z, color, count) => this.burst(x, y, z, color, count), rnd: () => this.rnd()
		});
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
		// the fighting area: a dark, calm sheet over the land so shots and danger stay readable, held between two ramparts of
		// Omani stone (a frame in the foreground, so the land reads as far below), each with a thin line of light on its inner foot
		this.floor = CreateGround('floor', { width: A.length + 6, height: A.halfWidth * 2 + 0.2 }, this.scene);
		this.floor.position.set(A.length / 2, -0.6, 0); this.floor.isPickable = false;
		this.floor.material = this.neon('floorMat', C(0.01, 0.03, 0.09), 0.4);
		const rampart = this.models.rampart(70);
		for (const side of [-1, 1]) {
			const wall = side > 0 ? rampart : rampart.clone('rampart2');
			wall.position.set(10, -0.62, side * (A.halfWidth + 0.06)); wall.rotation.y = side > 0 ? 0 : Math.PI; wall.isPickable = false;
			wall.freezeWorldMatrix(); this.ramparts.push(wall);
			const edge = CreateBox('edge', { width: 70, height: 0.04, depth: 0.06 }, this.scene);
			edge.position.set(10, -0.55, side * (A.halfWidth + 0.04)); edge.isPickable = false;
			edge.material = this.mats.get('edgeMat') ?? this.neon('edgeMat', C(0.45, 0.9, 1), 0.8); this.ramparts.push(edge);
		}
	}
	private buildShapes() {
		const s = this.scene, M = this.models;
		const wedge = (d: number, h: number, sides: number) => { const m = CreateCylinder('w', { diameterTop: 0, diameterBottom: d, height: h, tessellation: sides }, s); m.rotation.z = Math.PI / 2; m.bakeCurrentTransformIntoVertices(); return m; };
		// the small enemies: four kinds and a rare one for each stage, the armoured card in the colour of each stage with its guard plate, and the hive's tower
		this.solid('rumor', M.rumor()); this.solid('clickbait', M.clickbait()); this.solid('fakepic', M.fakepic()); this.solid('chain', M.chain()); this.solid('deepfake', M.deepfake());
		this.solid('trend', M.trend()); this.solid('vortex', M.vortex()); this.solid('mocker', M.mocker()); this.solid('noise', M.noise()); this.solid('fakestar', M.fakestar());
		this.solid('tracker', M.tracker()); this.solid('quizbot', M.quizbot()); this.solid('snapper', M.snapper()); this.solid('footprint', M.footprint()); this.solid('broker', M.broker());
		this.solid('stranger', M.stranger()); this.solid('bully', M.bully()); this.solid('impostor', M.impostor()); this.solid('lure', M.lure()); this.solid('puppeteer', M.puppeteer());
		this.solid('troll', M.troll()); this.solid('echo', M.echo()); this.solid('inciter', M.inciter()); this.solid('swarm', M.swarm()); this.solid('stormseed', M.stormseed());
		CARD_COLORS.forEach(([a, b], i) => this.solid('fakewall' + i, M.fakewall(a, b, 'fakewall' + i)));
		this.solid('guardPlate', M.guardPlate()); this.solid('pod', M.relay());
		this.solid('crate', M.crate()); this.solid('crateRare', M.crate('#08080e', '#c9a2ff', 'crateRare', true)); this.solid('awareBomb', M.awareBomb()); this.solid('crateHeart', M.heartBox());
		for (const key of ['rumor', 'clickbait', 'fakepic', 'chain', 'deepfake', 'trend', 'vortex', 'mocker', 'noise', 'fakestar', 'tracker', 'quizbot', 'snapper', 'footprint', 'broker',
			'stranger', 'bully', 'impostor', 'lure', 'puppeteer', 'troll', 'echo', 'inciter', 'swarm', 'stormseed', 'fakewall0', 'fakewall1', 'fakewall2', 'fakewall3', 'fakewall4', 'guardPlate', 'pod', 'crate', 'crateHeart']) inked(this.pool(key).source);
		this.glow('bubble', CreateSphere('bu', { diameter: 1, segments: 12 }, s), C(0.5, 1, 0.9), 0.3);
		// the player's shots: bright cores with a softer glow around them
		// soft light: one painted dot, in the colour of each weapon, added to whatever is under it
		this.softTex = this.painted('dot', 64, g => { const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 64, 64); });
		for (const [key, c, a] of [['softCyan', C(0.25, 0.85, 1), 0.85], ['softGold', C(1, 0.7, 0.15), 0.6], ['softOrange', C(1, 0.5, 0.15), 0.85], ['softGreen', C(0.2, 1, 0.65), 0.8],
			['softBlue', C(0.35, 0.6, 1), 0.8], ['softViolet', C(0.7, 0.4, 1), 0.85], ['softWhite', C(1, 1, 1), 0.8], ['softRed', C(1, 0.15, 0.25), 0.7]] as [string, Color3, number][]) this.sheet(key, this.softTex, c, a, true);
		this.sheet('shade', this.softTex, C(0, 0, 0), 0.7, false);                 // under enemy fire, so red stays red on sand
		// (the shapes of the players' own weapons are built in shots.ts)
		// danger: four flat signs (a jagged bubble of talk, an exclamation mark, a glitch square, a shard of lightning), each
		// with a dark edge and a pale heart and always over a red glow; never the shapes above
		this.solid('talk', M.shotTalk()); this.solid('bang', M.shotBang()); this.solid('glitch', M.shotGlitch()); this.solid('zap', M.shotZap());
		this.glow('zoneWarn', CreateGround('zw', { width: 1, height: 1 }, s), DANGER, 0.25);
		this.glow('zoneLive', CreateGround('zl', { width: 1, height: 1 }, s), C(1, 0.65, 0.65), 0.8);
		this.glow('roundWarn', CreateCylinder('rw', { diameter: 1, height: 0.02, tessellation: 28 }, s), DANGER, 0.3);       // where a lobbed shot will land
		this.glow('roundLive', CreateCylinder('rl', { diameter: 1, height: 0.02, tessellation: 28 }, s), C(1, 0.65, 0.65), 0.8);
		this.glow('dangerRing', CreateTorus('dg', { diameter: 1, thickness: 0.07, tessellation: 28 }, s), C(1, 0.25, 0.3));   // the edge of that circle, and the ring that closes on a shot about to dart or burst
		// danger is drawn last, over everything: however bright the player's own weapons grow, what must be dodged stays crisp
		for (const key of ['talk', 'bang', 'glitch', 'zap', 'dangerRing']) this.pool(key).source.renderingGroupId = 1;
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
		for (const m of this.ramparts) m.setEnabled(index !== SPACE);
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
	/** The drawing tools lent to powerfx.ts, which draws the special skills. */
	private kit(): FxKit {
		return {
			scene: this.scene, put: (key, id) => this.pool(key).put(id), soft: (key, id, x, z, sx, sz, y) => this.soft(key, id, x, z, sx, sz, y),
			addFx: (kind, key, x, y, z, life, size, vx, vy, vz) => this.addFx(kind, key, x, y, z, life, size, vx, vy, vz), burst: (x, y, z, color, count) => this.burst(x, y, z, color, count),
			ringAt: (x, z, size, life, key, y) => this.ringAt(x, z, size, life, key, y), flashAt: (x, z, size, life, key) => this.flashAt(x, z, size, life, key), bloomAt: (x, z, size, life, key) => this.bloomAt(x, z, size, life, key),
			after: (seconds, run) => this.after(seconds, run), glow: (key, mesh, color, alpha) => this.glow(key, mesh, color, alpha), sheet: (key, tex, color, alpha, add) => this.sheet(key, tex, color, alpha, add),
			painted: (name, size, draw) => this.painted(name, size, draw), mat: key => this.mats.get(key + 'Mat'),
			rnd: () => this.rnd(), time: () => this.t, frame: () => this.frame, halfW: () => this.halfW, reduce: () => this.reduceMotion,
			courier: () => { if (!this.courier && this.makeShield) this.courier = this.makeShield(); return this.courier; }
		};
	}
	private flashAt(x: number, z: number, size: number, life = 0.1, key = 'flash') { const f = this.addFx('flash', key, x, 0.85, z, life, size * 2.2); if (f) f.mesh.scaling.set(0.2, 1, 0.2); }

	/** Turns one simulation event into a picture. Sound and money are the game's business. */
	show(e: SimEvent, w: World) {
		switch (e.type) {
			case 'fire': case 'hit': case 'explode': case 'bounce': this.shotView.show(e, w); break;   // the weapons: all drawn in shots.ts
			case 'fizz':                                                            // enemy fire that was cleared: each piece goes out in a small flash
				for (let i = 0; i + 1 < e.points.length; i += 2) { this.flashAt(e.points[i], e.points[i + 1], 0.55, 0.22, 'softRed'); if (i % 6 === 0) this.ringAt(e.points[i], e.points[i + 1], 0.9, 0.2); }
				break;
			case 'kill': this.shatter(e.enemy, KIND_COLOR(this.kindOf(e.enemy))); break;
			case 'crate': this.burst(e.x, 0.8, e.z, WEAPON_COLORS.shield, 40); this.ringAt(e.x, e.z, 5, 0.5, 'gold'); this.ringAt(e.x, e.z, 3, 0.35); this.flashAt(e.x, e.z, 3.5, 0.35, 'softGold'); break;
			// the special skills, and the last flash of Total Awareness: all drawn in powerfx.ts
			case 'power': case 'plate': case 'turned': case 'dart': case 'thunder': case 'dawn': case 'nova': this.powerFx.show(e, w); break;
			case 'revive': case 'down': {                                            // one falls, or rises with a heart from the friend
				const who = (e.type === 'revive' ? e.by === 0 : e.who === 1) ? w.ally?.body : w.player;
				if (!who) break;
				this.flashAt(who.x, who.z, 5, 0.45, e.type === 'revive' ? 'softGold' : 'softRed'); this.ringAt(who.x, who.z, 5, 0.45, e.type === 'revive' ? 'gold' : 'ring');
				this.burst(who.x, 1, who.z, e.type === 'revive' ? WEAPON_COLORS.shield : DANGER, 44);
				break;
			}
			case 'allyHit': { const b = w.ally?.body; if (b) { this.burst(b.x, 0.8, b.z, DANGER, 28); this.ringAt(b.x, b.z, 2.2, 0.3); } break; }
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
	/** Which shape an enemy wears in this stage (the simulation uses the same rule to choose how it attacks). */
	kindOf(e: Enemy): string { return e.kind === 'normal' ? smallKind(this.stage, e.id) : e.kind === 'rare' ? rareKind(this.stage) : e.kind === 'armored' ? 'fakewall' : e.kind; }

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
		let bossSeen = false;
		if (w) {
			for (const e of w.enemies) {
				if (e.dead) continue;
				const pop = 1 + (e.flash > 0 ? 0.22 : 0), wob = Math.sin(this.t * 3 + e.seed);
				if (e.kind === 'boss') { bossSeen = true; this.drawBoss(e, w, pop, move); continue; }
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
				if (e.kind === 'armored') {
					const m = this.pool('fakewall' + this.stage).put(e.id); m.position.set(e.x, 0.3, e.z); m.scaling.setAll(pop); m.rotation.y = Math.sin(this.t * 1.2 + e.seed) * 0.07;
					const sh = this.pool('guardPlate').put(e.id);                        // flat over the card while it blocks; raised behind it and tipped toward us while the card can be hurt
					sh.rotation.z += ((e.shielded ? 0 : 0.5) - sh.rotation.z) * Math.min(1, move * 14);
					const lift = sh.rotation.z / 0.5;
					sh.position.set(e.x + 0.02 + 0.62 * lift, 0.6 + 0.5 * lift, e.z); sh.scaling.setAll(pop * (1.04 - 0.2 * lift));
				} else if (e.kind === 'rare') {                                      // the rare one of this stage: golden, larger, leaving a trail
					const kind = this.kindOf(e), m = this.pool(kind).put(e.id), a = this.t, k = 1.35 * pop; m.position.set(e.x, 0.5 + wob * 0.1, e.z); m.scaling.setAll(k);
					switch (kind) {
						case 'deepfake': m.rotation.y = Math.sin(a * 4) * 0.35; if (Math.sin(a * 23 + e.seed) > 0.8) { m.position.z += 0.1; m.scaling.z = k * 1.18; } break;   // it rocks, and now and then it slips sideways like a bad picture
						case 'fakestar': m.rotation.y = a * 2.4; m.scaling.setAll(k * (1 + 0.1 * Math.sin(a * 11))); break;                                              // it turns and twinkles
						case 'broker': m.rotation.y = Math.sin(a * 5) * 0.3; m.rotation.z = Math.sin(a * 10) * 0.1; break;                                             // it waddles, shaking its cards loose
						case 'puppeteer': m.rotation.x = Math.sin(a * 3) * 0.28; m.rotation.y = Math.sin(a * 1.5) * 0.3; break;                                        // its puppets swing under it
						default: m.rotation.y = a * 5; m.scaling.set(k, k * (1 + 0.12 * Math.sin(a * 14)), k);                                                           // the storm seed spins and throbs
					}
					this.soft('softGold', e.id + 1e6, e.x, e.z, 2.6);
					if (lively && this.frame % 5 === 0) this.addFx('trail', 'trail', e.x + 0.3, 0.5, e.z, 0.35, 1);
				} else if (e.kind === 'turret') {                                    // a relay tower: it turns, and its lamp flashes
					const m = this.pool('pod').put(e.id); m.position.set(e.x, 0.3, e.z); m.rotation.y = this.t * 1.5; m.scaling.setAll(pop * (1 + 0.05 * wob));
					if (Math.sin(this.t * 6 + e.id) > 0.55) this.soft('softRed', e.id + 1e6, e.x, e.z, 1.5, 1.5, 0.9);
				} else {                                                             // each kind keeps still in its own way
					const kind = this.kindOf(e), m = this.pool(kind).put(e.id), a = this.t + e.seed, k = 1.3 * pop;
					m.position.set(e.x, 0.45 + wob * 0.06, e.z); m.scaling.setAll(k);
					switch (kind) {
						case 'rumor': m.rotation.y = Math.sin(a * 3) * 0.32; m.scaling.setAll(k * (1 + 0.09 * Math.max(0, Math.sin(a * 9)))); break;                       // it looks from side to side and swells with each shout
						case 'clickbait': m.rotation.y = Math.sin(a * 4) * 0.45; m.rotation.x = Math.sin(a * 4 + 1.2) * 0.14; break;                                   // it swings on its hook
						case 'fakepic': m.rotation.x = Math.sin(a * 2.6) * 0.3; m.rotation.y = Math.sin(a * 1.3) * 0.2; break;                                        // it tips from one half to the other
						case 'chain': m.rotation.y = Math.sin(a * 5) * 0.4; m.rotation.x = Math.sin(a * 5 + 1.5) * 0.16; break;                                       // it wriggles
						case 'trend': m.position.y += Math.abs(Math.sin(a * 6)) * 0.22; m.rotation.z = Math.sin(a * 6) * 0.1; break;                                   // it jumps, as charts do
						case 'vortex': m.rotation.y = -a * 4; break;                                                                                                    // it never stops turning
						case 'mocker': m.rotation.x = Math.sin(a * 8) * 0.26; m.position.y += Math.abs(Math.sin(a * 8)) * 0.08; break;                                 // its head rocks with laughter
						case 'noise': { const j = Math.floor(a * 13); m.rotation.y = (j * 7 % 5 - 2) * 0.07; m.scaling.setAll(k * (j % 3 ? 1 : 1.12)); break; }                // it jerks, as static does
						case 'tracker': m.position.y += Math.abs(Math.sin(a * 4)) * 0.26; m.rotation.y = Math.sin(a * 2) * 0.22; break;                                // it hops from place to place
						case 'quizbot': m.rotation.y = Math.sin(a * 3) * 0.36; m.rotation.z = Math.sin(a * 6) * 0.1; break;                                           // it turns to see who will answer
						case 'snapper': m.rotation.y = Math.sin(a * 2) * 0.3; m.rotation.z = wob * 0.18; m.rotation.x = Math.sin(a * 3.3) * 0.15;                     // it hovers, and its flash goes off
							if (lively && (this.frame + e.id * 37) % 140 === 0) this.flashAt(e.x - 0.35, e.z + 0.35, 1, 0.14); break;
						case 'footprint': m.rotation.y = Math.sin(a * 2.4) * 0.3; m.scaling.setAll(k * (1 + 0.07 * Math.sin(a * 10))); break;                          // it pulls
						case 'stranger': m.rotation.y = Math.sin(a * 1.6) * 0.42; m.rotation.x = Math.sin(a * 0.9) * 0.1; break;                                      // it looks around slowly
						case 'bully': m.rotation.y = Math.sin(a * 22) * 0.07; m.scaling.setAll(k * (1 + 0.11 * Math.max(0, Math.sin(a * 5)))); break;                    // it shakes with anger and puffs itself up
						case 'impostor': m.rotation.x = Math.sin(a * 3) * 0.36; m.rotation.y = Math.sin(a * 1.4) * 0.2; break;                                        // it shows one side, then the other
						case 'lure': m.rotation.z = Math.sin(a * 7) * 0.13; m.position.y += Math.abs(Math.sin(a * 3.5)) * 0.1; break;                                  // it rocks and snaps
						case 'troll': m.rotation.x = Math.sin(a * 40) * 0.13; m.rotation.y = Math.sin(a * 3) * 0.5; m.position.z += Math.sin(a * 17) * 0.05; break;     // it buzzes
						case 'echo': m.rotation.y = Math.sin(a) * 0.2; m.scaling.setAll(k * (1 + 0.15 * Math.sin(a * 6))); break;                                      // its rings swell and shrink
						case 'inciter': m.rotation.y = Math.sin(a * 4) * 0.3; m.scaling.set(k, k * (1 + 0.14 * Math.sin(a * 17)), k); break;                             // its flames leap
						case 'swarm': m.rotation.y = a * 1.8; m.rotation.z = wob * 0.12; break;                                                                         // it turns with its small ones
						default: m.rotation.y = Math.sin(a * 2.4) * 0.32; m.rotation.z = wob * 0.14;
					}
				}
			}
			const spot = this.spotlight;
			if (spot && !spot.dead) { const r = this.pool('gold').put(2e6); r.position.set(spot.x, 0.25, spot.z); r.scaling.setAll(spot.r * 3.4 + 0.25 * Math.sin(this.frame * 0.2)); this.soft('softWhite', 2e6, spot.x, spot.z, spot.r * 6, spot.r * 6, 0.2); }
			this.shotView.draw(w, this.t, this.frame, lively);                    // everything the weapons have put on the field
			// the glow at Cyber grows with the level of the weapon in hand, and at the highest level a ring turns around him
			const pair: [Body, { id: WeaponId; level: number }, number][] = w.ally ? [[w.player, w.weapon, 0], [w.ally.body, w.ally.weapon, 1]] : [[w.player, w.weapon, 0]];
			if (w.firing) for (const [who, gun, n] of pair) {
				if (who.down || who.busy) continue;
				const lvl = gun.level, px = who.x + 0.95, pz = who.z, beat = 1 + 0.1 * Math.sin(this.t * 9 + n);
				this.soft(GLOW_OF[gun.id], 4e6 + n * 10, px, pz, (1 + 0.42 * (lvl - 1)) * beat, (1 + 0.42 * (lvl - 1)) * beat, 0.58);
				if (lvl >= 3) this.soft('softWhite', 4e6 + n * 10, px, pz, 0.5 + 0.14 * lvl, 0.5 + 0.14 * lvl, 0.6);
				if (lvl >= 5) { const r = this.pool('ring').put(4e6 + n * 10); r.position.set(px, 0.62, pz); r.scaling.setAll(1.5 + 0.12 * Math.sin(this.t * 12)); }
			}
			for (const b of w.bullets) {                                             // enemy fire: a flat sign over a dark shade and a red glow, so it reads on sand, on sea and at night
				this.soft('shade', b.id, b.x, b.z, b.r * 7.5, b.r * 7.5, 0.3); if (!b.back) this.soft('softRed', b.id, b.x, b.z, b.r * 6.5, b.r * 6.5, 0.34);   // one turned by the Rumour Mirror is no danger: powerfx.ts lights it
				const m = this.pool(b.kind).put(b.id), k = b.r * (b.kind === 'glitch' ? 6.4 : 4.8), a = this.t;   // the coloured part of each sign is about as wide as what it hits
				m.position.set(b.x, 0.5, b.z);
				if (b.kind === 'talk') { m.rotation.y = Math.sin(a * 9 + b.id) * 0.3; m.scaling.setAll(k * (1 + 0.12 * Math.sin(a * 14 + b.id))); }               // loud talk shakes and swells
				else if (b.kind === 'bang') { m.rotation.y = a * 8 + b.id; m.scaling.setAll(k); }                                                              // a shout turns end over end
				else if (b.kind === 'glitch') { const j = Math.floor(a * 14 + b.id * 0.37); m.position.x += (j * 7 % 3 - 1) * 0.04; m.position.z += (j * 5 % 3 - 1) * 0.04; m.scaling.set(k * (j % 4 ? 1 : 1.35), 1, k * (j % 4 === 2 ? 1.35 : 1)); }   // a glitch never turns: it jumps and stretches
				else { if (b.vx || b.vz) m.rotation.y = Math.atan2(b.vz, -b.vx); m.scaling.set(k, 1, k * (1 + 0.28 * Math.sin(a * 30 + b.id))); }             // lightning points where it flies, and flickers
				if (b.hot) {                                                         // it is about to dart or burst: a ring closes on it, and it whitens at the last moment
					const o = this.pool('dangerRing').put(b.id); o.position.set(b.x, 0.46, b.z); o.scaling.setAll(b.r * (10 - 6.5 * b.hot));
					if (b.hot > 0.75) this.soft('softWhite', b.id + 9.5e6, b.x, b.z, b.r * 7, b.r * 7, 0.36);
				}
			}
			for (const z of w.zones) {
				const warn = z.warn > 0, cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2, k = warn ? 0.86 + 0.14 * Math.abs(Math.sin(z.warn * 12)) : 1;
				if (z.r) {                                                           // a lobbed shot: its circle is marked, a ring closes on it as the shot comes down, and the shot is seen in the air on its way
					const d = z.r * 2, m = this.pool(warn ? 'roundWarn' : 'roundLive').put(z.id);
					m.position.set(cx, 0.02, cz); m.scaling.set(d * k, 1, d * k);
					const edge = this.pool('dangerRing').put(z.id); edge.position.set(cx, 0.04, cz); edge.scaling.setAll(d);
					if (warn) {
						const u = Math.max(0, 1 - z.warn / z.total), o = this.pool('dangerRing').put(z.id + 9.5e6), fx = z.fx ?? cx, fz = z.fz ?? cz, shot = this.pool('bang').put(z.id);
						o.position.set(cx, 0.05, cz); o.scaling.setAll(Math.max(0.05, d * (1 - u)));
						shot.position.set(fx + (cx - fx) * u, 0.6 + 12.8 * u * (1 - u), fz + (cz - fz) * u); shot.rotation.y = this.t * 9; shot.scaling.setAll(1.1 + 1.2 * u * (1 - u));
					} else { this.soft('softOrange', z.id, cx, cz, d * 1.5, d * 1.5, 0.3); if (lively && this.frame % 3 === 0) this.burst(cx + (this.rnd() - 0.5) * z.r, 0.5, cz + (this.rnd() - 0.5) * z.r, C(1, 0.6, 0.2), 4); }
					continue;
				}
				const m = this.pool(warn ? 'zoneWarn' : 'zoneLive').put(z.id);
				m.position.set(cx, 0.02, cz);
				m.scaling.set((z.x1 - z.x0) * k, 1, (z.z1 - z.z0) * k);
			}
			this.powerFx.draw(w, move, lively);                                      // every special skill that is running
			this.courierOut = this.powerFx.courierOut; this.courierOf = this.powerFx.courierOf;
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
		if (!w) this.shotView.clear();
		if (!w) {this.courierOut = false; this.powerFx.clear(); this.courier?.setEnabled(false); }
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

	private drawBoss(e: Enemy, w: World, pop: number, move: number) {
		const id = w.stage.boss.id;
		if (!this.boss || this.boss.id !== id) this.buildBoss(id);
		const b = this.boss!, t = this.t, s = w.director.bossState, ph = s?.phase ?? 0, guarded = e.guard < 1, mv = b.moving, ease = Math.min(1, move * 60);
		const prey = w.prey(), look = Math.max(-0.6, Math.min(0.6, Math.atan2(prey.z - e.z, Math.max(1, e.x - prey.x))));   // the way to whoever it is aiming at
		b.root.position.set(e.x, 0.55, e.z);
		b.root.scaling.setAll(pop > 1 ? 1.05 : 1);
		switch (id) {
			case 'rumorking': {                                                    // the horn turns with each sweep of its fire, the crown bounces as it strides, and its shout rolls out in waves
				const total = ph ? 11 : 9, sweeping = !!s && s.n > 0;
				const aim = sweeping ? Math.atan2(-e.z, e.x - 3) + s.dir * ((total - s.n) / (total - 1) - 0.5) * (ph ? 1.15 : 0.95) : look * 0.5 + Math.sin(t * 1.3) * 0.1;
				mv.horn.rotation.y += (aim - mv.horn.rotation.y) * 0.22 * ease; mv.horn.rotation.z = Math.sin(t * 2.4) * 0.04;
				mv.crown.position.y = 1.22 + Math.abs(Math.sin(t * 2.4)) * 0.16; mv.crown.rotation.y = t * 0.8; mv.crown.rotation.z = Math.sin(t * 2.4) * 0.1;
				for (let k = 0; k < 3; k++) { const u = (t * (sweeping ? 2.6 : 1.1) + k / 3) % 1, wave = mv['wave' + k]; wave.scaling.set(0.7 + u * 0.9, 1.2 - u, 0.7 + u * 0.9); }
				break;
			}
			case 'whirl': {                                                        // the arms turn the way its fire turns; the lids meet over the eye while it guards itself
				b.shut += ((guarded ? 1 : 0) - b.shut) * 0.22 * ease;
				mv.arms.rotation.y = s?.turn ?? t * 0.6; mv.arms.position.y = Math.sin(t * 3) * 0.05;
				mv.lidA.scaling.x = mv.lidB.scaling.x = 0.14 + 0.86 * b.shut;
				mv.eye.rotation.y = look; mv.eye.scaling.setAll(1 + 0.04 * Math.sin(t * 5));
				b.root.rotation.z = Math.sin(t * 1.6) * 0.04;
				break;
			}
			case 'octodata': {                                                     // the cables wave, rise together before each row and beat it down; the head bobs
				b.shut += ((s && s.calm <= 0 ? Math.max(0, 1 - s.a / 0.45) : 0) - b.shut) * 0.35 * ease;
				for (let i = 0; i < 8; i++) { const arm = mv['arm' + i]; arm.rotation.y = -(i + 0.5) * Math.PI / 4 + Math.sin(t * 1.7 + i * 1.3) * 0.16; arm.rotation.z = 0.04 + 0.09 * Math.sin(t * 2.3 + i * 0.8) + 0.4 * b.shut; }
				mv.head.position.y = Math.sin(t * 2.2) * 0.08 - 0.1 * b.shut; mv.head.rotation.y = look * 0.4;
				break;
			}
			case 'maskmaster': {                                                   // faces go round from hand to hand, the hand that throws jumps, and the great mask comes down in front while it guards itself
				b.shut += ((guarded ? 1 : 0) - b.shut) * 0.18 * ease;
				const k = b.shut, spin = t * (1.5 + ph * 0.35), wait = 0.86 - ph * 0.08, kick = s && s.calm <= 0 ? Math.max(0, 1 - (wait - s.a) / 0.22) : 0;
				mv.juggle.rotation.x = spin;
				for (let i = 0; i < 5; i++) { const face = mv['mask' + i]; face.rotation.x = -spin; face.rotation.z = 0.45; }   // each face stays turned toward us as it goes round
				for (const [hand, side] of [[mv.handL, -1], [mv.handR, 1]] as [TransformNode, number][]) {
					const throwing = s?.dir === side ? kick : 0;
					hand.position.set(-0.35 - 0.55 * throwing, 0.95 + Math.sin(t * 3 + side) * 0.12 + 0.2 * throwing, side * (1.55 + Math.sin(t * 1.5) * 0.08));
				}
				mv.guard.position.set(1.1 - 2.6 * k, 1.6 - 0.55 * k, 0); mv.guard.scaling.setAll(0.5 + 0.5 * k); mv.guard.rotation.z = 0.25 + 0.3 * k + Math.sin(t * 2) * 0.04;
				b.root.rotation.z = Math.sin(t * 1.8) * 0.03;
				break;
			}
			case 'hivequeen': {                                                    // drones circle it, its top turns to and fro, and its door lifts while a tower is on its way out
				b.shut += ((w.enemies.some(x => x.kind === 'turret' && !x.dead && x.mode === 'enter') ? 1 : 0) - b.shut) * 0.15 * ease;
				mv.drones.rotation.y = t * (0.9 + ph * 0.3); mv.drones.position.y = 0.9 + Math.sin(t * 3) * 0.12;
				mv.cap.rotation.y = Math.sin(t * 0.9) * 0.5; mv.cap.position.y = Math.abs(Math.sin(t * 2.6)) * 0.07;
				mv.door.position.y = 0.08 + 0.78 * b.shut;
				b.root.rotation.z = Math.sin(t * 1.4) * 0.02;
				break;
			}
			default: {                                                             // the storm: its two arms of lightning leave its sides and cross in front of it, then go home
				b.shut += ((guarded ? 1 : 0) - b.shut) * 0.16 * ease;
				const k = b.shut, grow = 1 + 0.55 * k, flick = k > 0.5 ? 1 + 0.08 * Math.sin(t * 37) : 1;
				for (const [arm, side] of [[mv.armL, -1], [mv.armR, 1]] as [TransformNode, number][]) {
					arm.position.set(-0.2 - (1.9 + side * 0.16) * k, 0.9 - 0.25 * k, side * (1.2 - 2.55 * k));   // each starts from the far side, one a little ahead of the other, so both show
					arm.rotation.y = side * (k * Math.PI / 4 + (1 - k) * Math.sin(t * 2.2 + side) * 0.12);
					arm.scaling.set(grow, 1, grow * flick);
				}
				mv.eye.rotation.y = look; mv.eye.scaling.setAll(1 + 0.05 * Math.sin(t * 6));
				mv.ring.rotation.y = t * (0.7 + ph * 0.3); mv.ring.position.y = 0.15 + Math.sin(t * 2) * 0.06;
				b.root.rotation.z = Math.sin(t * 1.6) * 0.03;
				if (k > 0.2) { this.soft('softViolet', 8e6 + 1, e.x - 2.1, e.z, 1.9 * k, 5 * k, 0.6); this.soft('softWhite', 8e6 + 1, e.x - 2.1, e.z, 0.7 * k, 3.6 * k, 0.62); }
				if (k > 0.6 && move > 0 && !this.reduceMotion && this.frame % 4 === 0) this.burst(e.x - 2.1, 1.2, e.z + (this.rnd() - 0.5) * 3, C(1, 0.95, 0.45), 3);
			}
		}
		this.soft('shade', 8e6, e.x + 0.4, e.z + 0.3, e.r * 5, e.r * 5, 0.05);
		b.shield.setEnabled(guarded && id !== 'warstorm');                       // the storm shows its own shield: its arms of lightning
		if (guarded) b.shield.scaling.setAll(e.r * 2.7 * (1 + 0.04 * Math.sin(t * 9)));
	}
	private buildBoss(id: string) {
		if (this.boss) { this.boss.root.dispose(false, false); for (const seg of this.boss.tail) seg.dispose(); }
		const built = this.models.boss(id);
		for (const m of built.root.getChildMeshes()) inked(m, 0.03); for (const m of built.tail) inked(m, 0.03);
		const shield = CreateSphere('bossShield', { diameter: 1, segments: 12 }, this.scene);
		shield.parent = built.root; shield.material = this.mats.get('bossShieldMat') ?? this.neon('bossShieldMat', C(0.6, 0.9, 1), 0.3); shield.isPickable = false;
		this.boss = { id, ...built, shield, shut: 0 };
	}

	/** Removes every moving thing (between stages and screens). */
	clear() {
		for (const p of this.pools.values()) p.clear();
		for (const f of this.fx) f.pool.give(f.mesh);
		this.fx = []; this.due = [];
		this.shotView?.clear();
		this.courier?.setEnabled(false); this.courierOut = false; this.powerFx?.clear();
		if (this.boss) { this.boss.root.setEnabled(false); for (const seg of this.boss.tail) seg.setEnabled(false); }
	}
	dispose() { this.sparks.dispose(); }
}
