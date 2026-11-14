// The digital city: road, data towers, zone scenery, obstacles, pickups, decision gates and the vault. Everything is
// built in code from simple shapes with glowing unlit materials (cheap on phones), and recycled around the runner.
// Axes: right-handed, Y up; the runner goes toward +X, lanes are on Z (left lane is -Z).
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Particles/particleSystemComponent';
import balance from '../data/balance.json';
import { laneZ, LANES, StageTrack } from './track';

export type PortalState = 'idle' | 'open' | 'selected' | 'dim' | 'safe' | 'unsafe';
const C = (r: number, g: number, b: number) => new Color3(r, g, b);
const THEMES = [
	{ primary: C(0.16, 0.84, 1), second: C(0.45, 0.46, 1), sky: C(0.016, 0.035, 0.11) },      // message street: cyan
	{ primary: C(0.76, 0.44, 1), second: C(0.2, 0.75, 1), sky: C(0.05, 0.022, 0.12) },        // accounts district: violet
	{ primary: C(0.2, 0.95, 0.78), second: C(1, 0.76, 0.3), sky: C(0.012, 0.055, 0.09) }      // road to the vault: teal and gold
];
export const LANE_COLORS = [C(0.2, 0.9, 1), C(0.78, 0.55, 1), C(1, 0.76, 0.22)];
const GREEN = C(0.22, 1, 0.52), RED = C(1, 0.22, 0.26), GOLD = C(1, 0.84, 0.26);
const ROAD_WIDTH = balance.laneWidth * LANES + 1.4;
const ROAD_PERIOD = 6;
const SEE_AHEAD = 135, SEE_BEHIND = 9;

interface Piece { node: TransformNode; x: number; zone: number; drift: number }
interface Portal { frame: Mesh; curtain: Mesh; badge: Mesh; mat: StandardMaterial; curtainMat: StandardMaterial; badgeMat: StandardMaterial; state: PortalState }

export class City {
	reduceMotion = false;
	private mats = new Map<string, StandardMaterial>();
	private tex = new Map<string, DynamicTexture>();
	private road!: Mesh; private rails: Mesh[] = []; private bars: InstancedMesh[] = [];
	private towers: Piece[] = []; private decor: Piece[] = []; private streams: Piece[] = [];
	private sources = new Map<string, Mesh>();
	private free = new Map<string, InstancedMesh[]>();
	private live = new Map<number, { kind: string; mesh: InstancedMesh; baseY: number }>();
	private portals: Portal[][] = [];
	private stageNodes: TransformNode[] = [];
	private vault: { root: TransformNode; rings: Mesh[]; door: Mesh; light: Mesh; open: number; opening: boolean } | null = null;
	private beacon!: Mesh;
	private motes!: ParticleSystem; private sparks!: ParticleSystem;
	private theme = { primary: THEMES[0].primary.clone(), second: THEMES[0].second.clone(), sky: THEMES[0].sky.clone() };
	private stages: StageTrack[] = [];
	private t = 0;
	private rnd = mulberry(20261112);

	constructor(readonly scene: Scene) {
		scene.fogMode = Scene.FOGMODE_EXP2;
		scene.fogDensity = 0.0105;
		const hemi = new HemisphericLight('fill', new Vector3(0.2, 1, -0.2), scene);
		hemi.intensity = 1.05; hemi.groundColor = C(0.25, 0.3, 0.55);
		const key = new DirectionalLight('key', new Vector3(0.6, -1, 0.25), scene);
		key.intensity = 0.75;
		this.buildRoad();
		this.buildScenery();
		this.buildItemSources();
		this.buildParticles();
		this.applyTheme();
	}

	// ------------------------------------------------------------------ materials and textures
	private neon(name: string, color: Color3, alpha = 1, texture?: DynamicTexture): StandardMaterial {
		const m = new StandardMaterial(name, this.scene);
		m.disableLighting = true; m.emissiveColor = color.clone(); m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black();
		m.alpha = alpha;
		if (texture) { m.diffuseTexture = texture; m.diffuseColor = Color3.White(); if (texture.hasAlpha) { m.useAlphaFromDiffuseTexture = true; m.backFaceCulling = false; } }
		this.mats.set(name, m);
		return m;
	}
	private draw(name: string, w: number, h: number, alpha: boolean, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): DynamicTexture {
		const t = new DynamicTexture(name, { width: w, height: h }, this.scene, true);
		t.hasAlpha = alpha;
		const g = t.getContext() as unknown as CanvasRenderingContext2D;
		g.clearRect(0, 0, w, h);
		paint(g, w, h);
		t.update();
		this.tex.set(name, t);
		return t;
	}
	private icon(name: string, paint: (g: CanvasRenderingContext2D) => void): DynamicTexture {
		return this.draw(name, 128, 128, true, g => { g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#fff'; g.fillStyle = '#fff'; paint(g); });
	}

	// ------------------------------------------------------------------ road and scenery
	private buildRoad() {
		const length = 420;
		const t = this.draw('road', 64, 512, false, (g, w, h) => {
			const v = (z: number) => h * (0.5 + z / ROAD_WIDTH);
			g.fillStyle = '#1d2a58'; g.fillRect(0, 0, w, h);
			// each lane is a slightly different shade, so the three lanes read as lanes even far away
			g.fillStyle = '#263672'; g.fillRect(0, v(-balance.laneWidth / 2), w, v(balance.laneWidth / 2) - v(-balance.laneWidth / 2));
			g.fillStyle = '#141d40'; g.fillRect(0, 0, w, v(-balance.laneWidth * 1.5)); g.fillRect(0, v(balance.laneWidth * 1.5), w, h);
			g.fillStyle = '#ffffff';
			for (const z of [-balance.laneWidth * 1.5, balance.laneWidth * 1.5]) g.fillRect(0, v(z) - 6, w, 12);    // edges
		});
		t.uScale = length / ROAD_PERIOD;
		t.anisotropicFilteringLevel = 8;
		this.road = CreateGround('road', { width: length, height: ROAD_WIDTH }, this.scene);
		this.road.material = this.neon('roadMat', C(1, 1, 1), 1, t);
		for (const side of [-1, 1]) {
			const rail = CreateBox('rail', { width: length, height: 0.16, depth: 0.16 }, this.scene);
			rail.position.set(0, 0.2, side * (ROAD_WIDTH / 2 + 0.05));
			rail.material = this.mats.get('railMat') ?? this.neon('railMat', C(1, 1, 1));
			this.rails.push(rail);
		}
		// lane dividers, and bars across the road that rush past and give the feeling of speed
		for (const side of [-1, 1]) {
			const line = CreateBox('laneLine', { width: length, height: 0.03, depth: 0.09 }, this.scene);
			line.position.set(0, 0.015, side * balance.laneWidth / 2);
			line.material = this.mats.get('lineMat') ?? this.neon('lineMat', C(1, 1, 1));
			this.rails.push(line);
		}
		const bar = CreateBox('roadBar', { width: 0.14, height: 0.02, depth: balance.laneWidth * LANES }, this.scene);
		bar.material = this.neon('barMat', C(1, 1, 1));
		bar.isVisible = false;
		for (let i = 0; i < 24; i++) this.bars.push(bar.createInstance('roadBar' + i));
		// The vault's light, seen from far away: closer and taller as the run goes on.
		this.beacon = CreateCylinder('beacon', { diameter: 1.6, height: 150, tessellation: 12 }, this.scene);
		this.beacon.material = this.neon('beaconMat', GOLD, 0.55);
		this.beacon.applyFog = false;
	}

	private buildScenery() {
		const windows = (name: string) => this.draw(name, 128, 256, false, (g, w, h) => {
			g.fillStyle = '#0d1226'; g.fillRect(0, 0, w, h);
			for (let y = 6; y < h - 8; y += 16) for (let x = 6; x < w - 8; x += 15) {
				const r = this.rnd();
				if (r < 0.34) continue;
				g.fillStyle = r > 0.9 ? '#ffffff' : r > 0.6 ? '#b8c4dd' : '#5d6a8c';
				g.fillRect(x, y, 9, 8);
			}
			g.fillStyle = '#e8eeff'; g.fillRect(0, 0, w, 3);
		});
		for (const [key, tname] of [['towerA', 'winA'], ['towerB', 'winB']] as const) {
			const src = CreateBox(key, { size: 1 }, this.scene);
			src.material = this.neon(key + 'Mat', C(1, 1, 1), 1, windows(tname));
			src.isVisible = false;
			this.sources.set(key, src);
		}
		for (let i = 0; i < 34; i++) {
			const inst = this.sources.get(i % 3 === 0 ? 'towerB' : 'towerA')!.createInstance('tower' + i);
			this.towers.push({ node: inst, x: -1e9, zone: -1, drift: i % 2 ? 1 : -1 });
		}
		// Zone scenery: floating message panels, account rings, bridge pylons.
		const panelIcons: [string, (g: CanvasRenderingContext2D) => void][] = [
			['envelope', g => { g.strokeRect(18, 34, 92, 62); g.beginPath(); g.moveTo(18, 36); g.lineTo(64, 72); g.lineTo(110, 36); g.stroke(); }],
			['lock', g => { g.fillRect(30, 60, 68, 50); g.beginPath(); g.arc(64, 60, 22, Math.PI, 0); g.stroke(); }],
			['star', g => { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 48, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(64 + r * Math.cos(a), 64 + r * Math.sin(a)); } g.closePath(); g.fill(); }]
		];
		panelIcons.forEach(([name, paint], zone) => {
			const src = CreatePlane('panel' + zone, { width: 1.7, height: 1.7 }, this.scene);
			src.material = this.neon('panelMat' + zone, THEMES[zone].second, 0.85, this.icon(name, paint));
			src.isVisible = false;
			for (let i = 0; i < 8; i++) {
				const inst = src.createInstance(`panel${zone}_${i}`);
				inst.billboardMode = TransformNode.BILLBOARDMODE_ALL;
				this.decor.push({ node: inst, x: -1e9, zone, drift: this.rnd() * 6 });
			}
		});
		const ring = CreateTorus('ring', { diameter: 11, thickness: 0.2, tessellation: 40 }, this.scene);
		ring.rotation.z = Math.PI / 2; ring.bakeCurrentTransformIntoVertices();
		ring.material = this.neon('ringMat', THEMES[1].primary);
		ring.isVisible = false;
		for (let i = 0; i < 6; i++) this.decor.push({ node: ring.createInstance('ring' + i), x: -1e9, zone: 1, drift: -1 });
		const pylonParts = [-1, 1].map(side => { const p = CreateBox('p', { width: 0.5, height: 10, depth: 0.5 }, this.scene); p.position.set(0, 5, side * (ROAD_WIDTH / 2 + 1.1)); return p; });
		const beam = CreateBox('b', { width: 0.4, height: 0.4, depth: ROAD_WIDTH + 2.7 }, this.scene); beam.position.y = 10;
		const pylon = Mesh.MergeMeshes([...pylonParts, beam], true)!;
		pylon.material = this.neon('pylonMat', THEMES[2].primary);
		pylon.isVisible = false;
		for (let i = 0; i < 6; i++) this.decor.push({ node: pylon.createInstance('pylon' + i), x: -1e9, zone: 2, drift: -2 });
		// Streams of data rising beside the road.
		const stream = CreateBox('stream', { width: 0.07, height: 1, depth: 0.07 }, this.scene);
		stream.material = this.neon('streamMat', C(1, 1, 1), 0.55);
		stream.isVisible = false;
		for (let i = 0; i < 26; i++) this.streams.push({ node: stream.createInstance('stream' + i), x: -1e9, zone: -1, drift: this.rnd() });
	}

	private buildItemSources() {
		const stripes = this.draw('stripes', 64, 64, false, (g, w, h) => {
			g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
			g.fillStyle = '#7a7a7a'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 7);
		});
		const src = (key: string, mesh: Mesh, mat: StandardMaterial) => { mesh.material = mat; mesh.isVisible = false; this.sources.set(key, mesh); this.free.set(key, []); };
		const w = balance.laneWidth - 0.24;
		src('low', CreateBox('low', { width: 0.36, height: 0.58, depth: w }, this.scene), this.neon('lowMat', C(1, 0.58, 0.12), 1, stripes));
		const bar = CreateBox('bar', { width: 0.3, height: 0.34, depth: w + 0.1 }, this.scene); bar.position.y = 1.3;
		const posts = [-1, 1].map(s => { const p = CreateBox('post', { width: 0.14, height: 1.3, depth: 0.14 }, this.scene); p.position.set(0, 0.65, s * (w / 2)); return p; });
		src('high', Mesh.MergeMeshes([bar, ...posts], true)!, this.neon('highMat', C(1, 0.3, 0.62), 1, stripes));
		src('block', CreateBox('block', { width: 0.8, height: 2.35, depth: w }, this.scene), this.neon('blockMat', C(1, 0.2, 0.24), 1, stripes));
		const bit = CreateBox('bit', { size: 0.3 }, this.scene);
		bit.rotation.set(Math.PI / 4, 0, Math.atan(Math.SQRT1_2)); bit.bakeCurrentTransformIntoVertices();        // a cube standing on a corner
		src('bit', bit, this.neon('bitMat', GOLD));
		const icons: [string, Color3, (g: CanvasRenderingContext2D) => void][] = [
			['shield', C(0.35, 0.8, 1), g => { g.beginPath(); g.moveTo(64, 16); g.lineTo(106, 32); g.lineTo(100, 78); g.quadraticCurveTo(84, 104, 64, 114); g.quadraticCurveTo(44, 104, 28, 78); g.lineTo(22, 32); g.closePath(); g.fill(); }],
			['lens', C(0.6, 1, 0.75), g => { g.lineWidth = 12; g.beginPath(); g.arc(54, 54, 30, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(78, 78); g.lineTo(110, 110); g.stroke(); }],
			['hint', C(1, 0.92, 0.5), g => { g.beginPath(); g.arc(64, 52, 32, 0, Math.PI * 2); g.fill(); g.fillRect(50, 86, 28, 12); g.fillRect(54, 102, 20, 10); }]
		];
		for (const [key, color, paint] of icons) {
			const p = CreatePlane(key, { size: 0.86 }, this.scene);
			src(key, p, this.neon(key + 'Mat', color, 1, this.icon(key + 'Icon', paint)));
		}
		// portal symbols and results (all left-right symmetric, so mirroring cannot spoil them)
		this.icon('sym0', g => { g.beginPath(); g.moveTo(64, 14); g.lineTo(112, 64); g.lineTo(64, 114); g.lineTo(16, 64); g.closePath(); g.fill(); });
		this.icon('sym1', g => { g.beginPath(); g.arc(64, 64, 46, 0, Math.PI * 2); g.fill(); });
		this.icon('sym2', g => { g.beginPath(); g.moveTo(64, 16); g.lineTo(114, 108); g.lineTo(14, 108); g.closePath(); g.fill(); });
		this.icon('symSafe', g => { g.lineWidth = 14; g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(64, 64, 16, 0, Math.PI * 2); g.fill(); });
		this.icon('symUnsafe', g => { g.lineWidth = 18; g.beginPath(); g.moveTo(26, 26); g.lineTo(102, 102); g.moveTo(102, 26); g.lineTo(26, 102); g.stroke(); });
	}

	private buildParticles() {
		const dot = this.draw('dot', 64, 64, true, g => {
			const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
			grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
			g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
		});
		const make = (name: string, capacity: number) => {
			const p = new ParticleSystem(name, capacity, this.scene);
			p.particleTexture = dot; p.blendMode = ParticleSystem.BLENDMODE_ADD;
			p.emitter = new Vector3(0, 0, 0);
			return p;
		};
		this.motes = make('motes', 90);
		this.motes.minEmitBox = new Vector3(0, 0.3, -9); this.motes.maxEmitBox = new Vector3(60, 7, 9);
		this.motes.minSize = 0.05; this.motes.maxSize = 0.16; this.motes.minLifeTime = 1.6; this.motes.maxLifeTime = 3.4;
		this.motes.emitRate = 26; this.motes.minEmitPower = 0.1; this.motes.maxEmitPower = 0.6;
		this.motes.direction1 = new Vector3(-1, 0.6, -0.2); this.motes.direction2 = new Vector3(-0.2, 1.4, 0.2);
		this.motes.gravity = new Vector3(0, 0, 0);
		this.motes.start();
		this.sparks = make('sparks', 160);
		this.sparks.minSize = 0.08; this.sparks.maxSize = 0.24; this.sparks.minLifeTime = 0.25; this.sparks.maxLifeTime = 0.7;
		this.sparks.emitRate = 0; this.sparks.minEmitPower = 2; this.sparks.maxEmitPower = 6.5;
		this.sparks.direction1 = new Vector3(-1.2, 0.2, -1.2); this.sparks.direction2 = new Vector3(1.6, 1.8, 1.2);
		this.sparks.gravity = new Vector3(0, -6, 0);
		this.sparks.start();
	}

	/** A puff of light at a point (pickups, hits, results, the vault). */
	burst(x: number, y: number, z: number, color: Color3, count: number) {
		if (this.reduceMotion) count = Math.ceil(count / 3);
		(this.sparks.emitter as Vector3).set(x, y, z);
		this.sparks.color1 = new Color4(color.r, color.g, color.b, 1);
		this.sparks.color2 = new Color4(Math.min(1, color.r + 0.3), Math.min(1, color.g + 0.3), Math.min(1, color.b + 0.3), 1);
		this.sparks.colorDead = new Color4(color.r, color.g, color.b, 0);
		this.sparks.manualEmitCount = count;
	}

	// ------------------------------------------------------------------ stages
	setRun(stages: StageTrack[]) { this.stages = stages; for (const p of [...this.towers, ...this.decor, ...this.streams]) p.x = -1e9; }

	private zoneAt(x: number) {
		for (const s of this.stages) if (x < s.end) return s.index;
		return Math.max(0, this.stages.length - 1);
	}

	/** Gates, the finish arch and (on the last stage) the vault of the stage the runner is entering. */
	enterStage(track: StageTrack) {
		for (const n of this.stageNodes) n.dispose(false, true);
		this.stageNodes = []; this.portals = []; this.vault = null;
		this.releaseAll();
		const zone = THEMES[track.index % THEMES.length];
		for (const gate of track.gates) {
			const group: Portal[] = [];
			for (let lane = 0; lane < LANES; lane++) {
				const half = balance.laneWidth / 2 - 0.08;
				const posts = [-1, 1].map(s => { const p = CreateBox('gp', { width: 0.16, height: 2.8, depth: 0.16 }, this.scene); p.position.set(0, 1.4, s * half); return p; });
				const top = CreateBox('gt', { width: 0.2, height: 0.2, depth: half * 2 + 0.16 }, this.scene); top.position.y = 2.8;
				const frame = Mesh.MergeMeshes([...posts, top], true)!;
				frame.position.set(gate.s, 0, laneZ(lane));
				const mat = this.neon(`portal${gate.index}_${lane}`, LANE_COLORS[lane]);
				frame.material = mat;
				const curtain = CreatePlane('curtain', { width: half * 2, height: 2.7 }, this.scene);
				curtain.rotation.y = Math.PI / 2; curtain.position.set(gate.s, 1.38, laneZ(lane));
				const curtainMat = this.neon(`curtain${gate.index}_${lane}`, LANE_COLORS[lane], 0.16); curtainMat.backFaceCulling = false;
				curtain.material = curtainMat;
				const badge = CreatePlane('badge', { size: 0.8 }, this.scene);
				badge.position.set(gate.s, 3.5, laneZ(lane)); badge.billboardMode = TransformNode.BILLBOARDMODE_ALL;
				const badgeMat = this.neon(`badge${gate.index}_${lane}`, LANE_COLORS[lane], 1, this.tex.get('sym' + lane));
				badge.material = badgeMat;
				for (const m of [frame, curtain, badge]) { m.isPickable = false; this.stageNodes.push(m); }
				group.push({ frame, curtain, badge, mat, curtainMat, badgeMat, state: 'idle' });
			}
			this.portals.push(group);
			this.setPortals(gate.index, ['idle', 'idle', 'idle']);
		}
		const last = track.index === this.stages.length - 1;
		if (last) this.buildVault(track.end + 7);
		else {
			const posts = [-1, 1].map(s => { const p = CreateBox('ap', { width: 0.4, height: 5.4, depth: 0.4 }, this.scene); p.position.set(0, 2.7, s * (ROAD_WIDTH / 2 + 0.4)); return p; });
			const top = CreateBox('at', { width: 0.5, height: 0.5, depth: ROAD_WIDTH + 1.2 }, this.scene); top.position.y = 5.4;
			const arch = Mesh.MergeMeshes([...posts, top], true)!;
			arch.position.x = track.end + 3;
			arch.material = this.neon('arch' + track.index, zone.second);
			this.stageNodes.push(arch);
		}
	}

	private buildVault(x: number) {
		const root = new TransformNode('vault', this.scene);
		root.position.set(x, 0, 0);
		const part = (m: Mesh, mat: StandardMaterial) => { m.parent = root; m.material = mat; m.isPickable = false; return m; };
		const wall = part(CreateBox('vaultWall', { width: 1.2, height: 9, depth: ROAD_WIDTH + 6 }, this.scene), this.neon('vaultWall', C(0.05, 0.12, 0.2)));
		wall.position.set(0.9, 4.5, 0);
		const light = part(CreateDisc('vaultLight', { radius: 2.65, tessellation: 40 }, this.scene), this.neon('vaultLight', C(1, 0.93, 0.62), 0));
		light.rotation.y = Math.PI / 2; light.position.set(0.2, 3.1, 0); (light.material as StandardMaterial).backFaceCulling = false;
		const door = part(CreateCylinder('vaultDoor', { diameter: 5.4, height: 0.5, tessellation: 40 }, this.scene), this.neon('vaultDoor', C(0.1, 0.42, 0.5)));
		door.rotation.z = Math.PI / 2; door.position.set(0, 3.1, 0);
		const rings = [6.4, 4.2, 2.2].map((d, i) => {
			const r = part(CreateTorus('vaultRing' + i, { diameter: d, thickness: 0.22, tessellation: 44 }, this.scene), this.neon('vaultRing' + i, i === 1 ? GOLD : THEMES[2].primary));
			r.rotation.z = Math.PI / 2; r.position.set(-0.35, 3.1, 0);
			return r;
		});
		this.vault = { root, rings, door, light, open: 0, opening: false };
		this.stageNodes.push(root);
	}
	openVault() { if (this.vault) this.vault.opening = true; }

	setPortals(gateIndex: number, states: PortalState[]) {
		const group = this.portals[gateIndex];
		if (!group) return;
		group.forEach((p, lane) => {
			const state = states[lane] ?? 'idle';
			p.state = state;
			const base = state === 'safe' ? GREEN : state === 'unsafe' ? RED : LANE_COLORS[lane];
			const k = state === 'idle' ? 0.45 : state === 'dim' ? 0.16 : state === 'open' ? 0.85 : 1.25;
			p.mat.emissiveColor = base.scale(k);
			p.curtainMat.emissiveColor = base.scale(Math.min(1, k));
			p.curtainMat.alpha = state === 'selected' ? 0.42 : state === 'safe' || state === 'unsafe' ? 0.5 : state === 'dim' ? 0.05 : 0.16;
			p.badgeMat.emissiveColor = base.scale(Math.min(1.2, k + 0.2));
			p.badgeMat.diffuseTexture = this.tex.get(state === 'safe' ? 'symSafe' : state === 'unsafe' ? 'symUnsafe' : 'sym' + lane)!;
			p.badge.setEnabled(state !== 'dim');
		});
	}

	// ------------------------------------------------------------------ obstacles and pickups
	private acquire(kind: string): InstancedMesh {
		const m = this.free.get(kind)!.pop() ?? this.sources.get(kind)!.createInstance(kind);
		m.setEnabled(true); m.isPickable = false;
		if (kind === 'shield' || kind === 'lens' || kind === 'hint') m.billboardMode = TransformNode.BILLBOARDMODE_ALL;
		return m;
	}
	private releaseAll() { for (const [id, v] of this.live) { v.mesh.setEnabled(false); this.free.get(v.kind)!.push(v.mesh); this.live.delete(id); } }
	private place(id: number, kind: string, show: boolean, x: number, y: number, z: number) {
		const have = this.live.get(id);
		if (!show) { if (have) { have.mesh.setEnabled(false); this.free.get(kind)!.push(have.mesh); this.live.delete(id); } return; }
		if (have) return;
		const mesh = this.acquire(kind);
		mesh.position.set(x, y, z);
		this.live.set(id, { kind, mesh, baseY: y });
	}
	private syncItems(track: StageTrack, s: number) {
		for (const o of track.obstacles) {
			const show = !o.hit && o.s > s - SEE_BEHIND && o.s < s + SEE_AHEAD;
			this.place(o.id, o.kind, show, o.s, o.kind === 'low' ? 0.29 : o.kind === 'block' ? 1.175 : 0, laneZ(o.lane));
		}
		for (const p of track.pickups) this.place(p.id, p.kind, !p.taken && p.s > s - SEE_BEHIND && p.s < s + SEE_AHEAD, p.s, p.y, laneZ(p.lane));
	}

	// ------------------------------------------------------------------ per frame
	private applyTheme() {
		const { primary, second, sky } = this.theme;
		this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
		this.scene.fogColor = sky;
		const set = (name: string, c: Color3) => { const m = this.mats.get(name); if (m) m.emissiveColor = c; };
		set('roadMat', Color3.Lerp(C(1, 1, 1), primary, 0.55));
		set('railMat', primary);
		set('lineMat', Color3.Lerp(C(1, 1, 1), primary, 0.4).scale(0.6));
		set('barMat', primary.scale(0.32));
		set('towerAMat', primary.scale(0.82));
		set('towerBMat', second.scale(0.82));
		set('streamMat', second);
	}

	update(dt: number, track: StageTrack | null, s: number, z: number, overall: number) {
		this.t += dt;
		const zone = THEMES[this.zoneAt(s) % THEMES.length];
		const k = Math.min(1, dt * 1.6);
		for (const key of ['primary', 'second', 'sky'] as const) Color3.LerpToRef(this.theme[key], zone[key], k, this.theme[key]);
		this.applyTheme();

		const snapped = Math.floor(s / ROAD_PERIOD) * ROAD_PERIOD;
		this.road.position.x = snapped + 150;
		for (const r of this.rails) r.position.x = snapped + 150;
		const barGap = 8, barBase = Math.floor(s / barGap) * barGap - barGap;
		this.bars.forEach((b, i) => b.position.set(barBase + i * barGap, 0.012, 0));
		(this.motes.emitter as Vector3).set(s + 4, 0, z * 0.5);
		this.motes.emitRate = this.reduceMotion ? 6 : 26;
		const c = this.theme.second;
		this.motes.color1 = new Color4(c.r, c.g, c.b, 0.9); this.motes.color2 = new Color4(1, 1, 1, 0.7); this.motes.colorDead = new Color4(c.r, c.g, c.b, 0);

		// towers: recycled ahead, each takes the profile of the zone it lands in
		this.towers.forEach((p, i) => {
			if (p.x < s - 22) {
				const spacing = 9.5;
				const side = i % 2 ? 1 : -1;
				const furthest = Math.max(s - 22, ...this.towers.filter((q, j) => j % 2 === i % 2).map(q => q.x));
				p.x = furthest + spacing;
				const zi = this.zoneAt(p.x);
				const near = zi === 2 ? 17 : 6.6;
				const w = 3 + this.rnd() * 4.5, d = 3 + this.rnd() * 5, h = (zi === 2 ? 5 : 8) + this.rnd() * (zi === 1 ? 34 : zi === 2 ? 16 : 24);
				p.node.scaling.set(w, h, d);
				p.node.position.set(p.x, zi === 2 ? h / 2 - 9 : h / 2, side * (near + d / 2 + this.rnd() * 13));
			}
		});
		// zone decor
		for (const p of this.decor) {
			if (p.x < s - 16) {
				const kind = p.drift === -1 ? 30 : p.drift === -2 ? 27 : 14;
				const same = this.decor.filter(q => q.zone === p.zone && (q.drift < 0) === (p.drift < 0));
				p.x = Math.max(s + 20, ...same.map(q => q.x)) + kind * (p.drift < 0 ? 1 : 0.6 + this.rnd() * 0.8);
				const here = this.zoneAt(p.x) === p.zone;
				p.node.setEnabled(here);
				if (p.drift < 0) (p.node as InstancedMesh).position.set(p.x, p.drift === -1 ? 1.8 : 0, 0);
				else { p.drift = this.rnd() * 6; (p.node as InstancedMesh).position.set(p.x, 3.2 + this.rnd() * 5, (this.rnd() < 0.5 ? -1 : 1) * (5 + this.rnd() * 5)); }
			} else if (p.drift >= 0 && !this.reduceMotion) (p.node as InstancedMesh).position.y += Math.sin(this.t * 1.3 + p.drift) * dt * 0.25;
		}
		for (const p of this.streams) {
			const n = p.node as InstancedMesh;
			if (p.x < s - 14) {
				p.x = s + 20 + this.rnd() * 130;
				n.scaling.y = 4 + this.rnd() * 12;
				n.position.set(p.x, this.rnd() * 14, (this.rnd() < 0.5 ? -1 : 1) * (4.6 + this.rnd() * 16));
			}
			if (!this.reduceMotion) { n.position.y += dt * (2 + p.drift * 5); if (n.position.y > 26) n.position.y = -6; }
		}

		if (track) this.syncItems(track, s);
		for (const v of this.live.values()) {
			if (v.kind === 'bit') { v.mesh.rotation.y = this.t * 3.2 + v.mesh.position.x; v.mesh.position.y = v.baseY + Math.sin(this.t * 4 + v.mesh.position.x) * 0.06; }
			else if (v.kind === 'shield' || v.kind === 'lens' || v.kind === 'hint') { const p = 1 + 0.12 * Math.sin(this.t * 5); v.mesh.scaling.set(p, p, p); }
		}
		for (const group of this.portals) for (const p of group) {
			const pulse = p.state === 'selected' ? 1 + 0.05 * Math.sin(this.t * 9) : 1;
			p.frame.scaling.set(1, pulse, 1);
		}
		// beacon and vault
		const vaultX = this.stages.length ? this.stages[this.stages.length - 1].end + 7 : s + 400;
		this.beacon.position.set(Math.min(vaultX + 1.5, s + 400 - 350 * overall), 60, 0);
		const near = Math.max(0, Math.min(1, (vaultX - s - 30) / 90));          // the real vault takes over on the final approach
		const bm = this.mats.get('beaconMat')!; bm.alpha = (0.35 + 0.25 * overall + 0.06 * Math.sin(this.t * 2)) * near;
		this.beacon.setEnabled(near > 0.01);
		this.beacon.scaling.x = this.beacon.scaling.z = 0.7 + overall * 1.6;
		if (this.vault) {
			const v = this.vault;
			if (v.opening) v.open = Math.min(1, v.open + dt * 0.55);
			v.rings.forEach((r, i) => { r.rotation.y = Math.sin(this.t * (0.7 + i * 0.35 + v.open * 3) + i) * (0.35 + v.open * 0.5); });
			const shrink = 1 - v.open;
			v.door.scaling.set(Math.max(0.001, shrink), 1, Math.max(0.001, shrink));
			(v.light.material as StandardMaterial).alpha = v.open * 0.9;
		}
	}

	dispose() { this.motes.dispose(); this.sparks.dispose(); }
}

function mulberry(a: number) {
	return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
