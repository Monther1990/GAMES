// The land the player flies over: five Omani landscapes, one per stage, each with its own ground, colours, light and
// landmarks: a palm oasis with its falaj, forts and watchtowers, a wadi of turquoise pools, dunes at sunset, and
// mountains and a lantern-lit fort at night. The ground and everything on it scroll toward the player; scenery is laid
// down in "scenes" (a grove, a fortress, a village, a camp...) chosen so the same one never comes twice in a row.
// The land lies well below the fight, and the arena floor dims it a little, so danger stays easy to read.
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { C, Models } from './models';

export const GROUND_Y = -8.5;
/** Meshes of the characters carry this bit: the lights of the land leave them alone, and one steady light is theirs. */
export const CHARACTER_LAYER = 0x10000000;
// one tile of painted ground: TILE_X along the flight, TILE_Z across it. Its middle line passes under the fight.
const TILE_X = 48, TILE_Z = 24, TEX_W = 2048, TEX_H = 1024, SPEED = 4.2, FAR = 48, NEAR = -16;
type Kind = 'palm' | 'tower' | 'wall' | 'keep' | 'house' | 'rock' | 'bush' | 'dune' | 'tent' | 'mountain' | 'pool' | 'lantern' | 'cloud' | 'shadow';
interface Look { name: string; sky: string; light: Color3; fill: Color3; key: number; hemi: number; dim: number; cloud: number; shadow: number; scenes: string[] }
/** One landscape per stage. `dim` is how strongly the arena floor darkens the land under the fight. */
const LOOKS: Look[] = [
	{ name: 'oasis', sky: '#b8a070', light: C(1, 0.98, 0.9), fill: C(0.7, 0.8, 0.66), key: 0.95, hemi: 0.95, dim: 0.3, cloud: 0.09, shadow: 0.42, scenes: ['grove', 'village', 'fields', 'falaj', 'grove2', 'watchtower'] },
	{ name: 'forts', sky: '#b08a55', light: C(1, 0.92, 0.74), fill: C(0.8, 0.7, 0.58), key: 1.05, hemi: 0.9, dim: 0.3, cloud: 0.07, shadow: 0.46, scenes: ['fortress', 'watchtower', 'wallLine', 'village', 'rocks', 'gate'] },
	{ name: 'wadi', sky: '#7f9a8c', light: C(0.96, 1, 0.98), fill: C(0.62, 0.85, 0.85), key: 0.95, hemi: 0.95, dim: 0.26, cloud: 0.08, shadow: 0.4, scenes: ['pools', 'banks', 'boulders', 'palmBank', 'pools2', 'cliffs'] },
	{ name: 'dunes', sky: '#c9743a', light: C(1, 0.76, 0.52), fill: C(0.95, 0.58, 0.5), key: 1.05, hemi: 0.85, dim: 0.32, cloud: 0.06, shadow: 0.5, scenes: ['dunes', 'camp', 'bigDune', 'acacia', 'dunes2', 'ruin'] },
	{ name: 'night', sky: '#1d1a3a', light: C(0.62, 0.72, 1), fill: C(0.5, 0.5, 0.9), key: 0.6, hemi: 0.9, dim: 0.12, cloud: 0.08, shadow: 0.3, scenes: ['peaks', 'nightFort', 'nightVillage', 'ridge', 'peaks2', 'nightGrove'] },
	{ name: 'code', sky: '#0d0b2a', light: C(0.75, 0.75, 1), fill: C(0.6, 0.45, 0.8), key: 0.6, hemi: 0.9, dim: 0.1, cloud: 0.05, shadow: 0.3, scenes: ['lights', 'lights2', 'lights3'] }
];
/** How wide the soft shadow of each thing is (times its scale). Flat things cast none. */
const SHADOW: Partial<Record<Kind, number>> = { palm: 2.6, tower: 4.2, keep: 6, house: 3.8, tent: 3.6, rock: 1.5, mountain: 7, wall: 3.2 };

interface Item { mesh: InstancedMesh; kind: Kind; x: number; drift: number }

export class Scenery {
	reduceMotion = false;
	private ground: Mesh; private tex: DynamicTexture;
	private hemi: HemisphericLight; private key: DirectionalLight; private characters: HemisphericLight;
	private sources = new Map<Kind, Mesh>();
	private free = new Map<Kind, InstancedMesh[]>();
	private items: Item[] = [];
	private frontier = NEAR; private lastScene = '';
	private look = LOOKS[0];
	private t = 0;
	private rnd = (() => { let a = 20261113; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

	constructor(private scene: Scene, models: Models) {
		this.hemi = new HemisphericLight('fill', new Vector3(0.3, 1, 0), scene);
		this.key = new DirectionalLight('key', new Vector3(0.55, -1, 0.3), scene);
		this.hemi.excludeWithLayerMask = CHARACTER_LAYER; this.key.excludeWithLayerMask = CHARACTER_LAYER;
		this.characters = new HemisphericLight('characters', new Vector3(-0.3, 1, 0), scene);
		this.characters.includeOnlyWithLayerMask = CHARACTER_LAYER; this.characters.intensity = 0.95;
		this.tex = new DynamicTexture('land', { width: TEX_W, height: TEX_H }, scene, true);
		this.tex.wrapU = this.tex.wrapV = 1;
		this.tex.uScale = 120 / TILE_X; this.tex.vScale = 80 / TILE_Z;
		this.tex.vOffset = 0.5 - ((0.5 * this.tex.vScale) % 1);                 // the middle line of the painting lies under the fight
		this.tex.anisotropicFilteringLevel = 4;
		this.ground = CreateGround('land', { width: 120, height: 80 }, scene);
		this.ground.position.set(14, GROUND_Y, 0); this.ground.isPickable = false;
		const gm = new StandardMaterial('landTexMat', scene);
		gm.disableLighting = true; gm.diffuseTexture = this.tex; gm.emissiveColor = C(1, 1, 1); gm.specularColor = C(0, 0, 0);
		this.ground.material = gm;
		const add = (kind: Kind, mesh: Mesh) => { mesh.isVisible = false; mesh.isPickable = false; this.sources.set(kind, mesh); this.free.set(kind, []); };
		add('palm', models.palm()); add('tower', models.tower()); add('wall', models.wall()); add('keep', models.keep()); add('house', models.house());
		add('rock', models.rock()); add('bush', models.bush()); add('dune', models.dune()); add('tent', models.tent()); add('mountain', models.mountain()); add('pool', models.pool());
		const lantern = CreateSphere('lantern', { diameter: 0.5, segments: 6 }, scene);
		const lm = new StandardMaterial('lanternMat', scene); lm.disableLighting = true; lm.emissiveColor = C(1, 0.78, 0.35); lantern.material = lm;
		add('lantern', lantern);
		// soft blots: white for the clouds that pass between the land and the fight, black for the shadows on the ground
		const blot = (name: string, spots: number[][]) => {
			const t = new DynamicTexture(name, { width: 128, height: 128 }, scene, true); t.hasAlpha = true;
			const g = t.getContext() as unknown as CanvasRenderingContext2D;
			for (const [x, y, r] of spots) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
			t.update();
			return t;
		};
		const sheet = (name: string, size: number, tex: DynamicTexture, color: Color3, alpha: number) => {
			const m = CreateGround(name, { width: size, height: size }, scene);
			const mat = new StandardMaterial(name + 'Mat', scene); mat.disableLighting = true; mat.opacityTexture = tex; mat.emissiveColor = color; mat.diffuseColor = C(0, 0, 0); mat.specularColor = C(0, 0, 0); mat.alpha = alpha; mat.backFaceCulling = false;
			m.material = mat;
			return m;
		};
		add('cloud', sheet('cloud', 9, blot('cloudTex', [[52, 64, 40], [78, 60, 34], [40, 70, 26]]), C(1, 1, 1), 0.16));
		add('shadow', sheet('shadow', 1, blot('shadowTex', [[64, 64, 62]]), C(0, 0, 0), 0.4));
		this.setStage(0);
	}
	/** How strongly the arena floor should darken the land of this stage. */
	get dim() { return this.look.dim; }

	setStage(index: number) {
		this.look = LOOKS[Math.max(0, Math.min(LOOKS.length - 1, index))];
		const L = this.look;
		this.hemi.diffuse = L.light; this.hemi.groundColor = L.fill; this.hemi.intensity = L.hemi;
		this.key.diffuse = L.light; this.key.intensity = L.key;
		this.characters.diffuse = Color3.Lerp(C(1, 1, 1), L.light, 0.3); this.characters.groundColor = Color3.Lerp(C(0.6, 0.6, 0.62), L.fill, 0.3);
		const sky = Color3.FromHexString(L.sky);
		this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
		(this.sources.get('cloud')!.material as StandardMaterial).alpha = L.cloud;
		(this.sources.get('shadow')!.material as StandardMaterial).alpha = L.shadow;
		this.paint();
		for (const it of this.items) this.free.get(it.kind)!.push(it.mesh), it.mesh.setEnabled(false);
		this.items = [];
		this.frontier = NEAR; this.lastScene = '';
		while (this.frontier < FAR) this.addScene();
		for (let i = 0; i < 3; i++) this.put('cloud', NEAR + this.rnd() * (FAR - NEAR), (this.rnd() - 0.5) * 26, 0.8 + this.rnd() * 1.4, this.rnd() * 6, -2 - this.rnd() * 2);
	}

	// ------------------------------------------------------------------ the ground: painted once per stage, tiling cleanly
	// On the canvas, x runs along the flight and y across it; y = H / 2 is the line under the middle of the fight.
	private paint() {
		const g = this.tex.getContext() as unknown as CanvasRenderingContext2D, W = TEX_W, H = TEX_H, M = H / 2, rnd = this.rnd, name = this.look.name;
		const base: Record<string, [string, string, string]> = {
			oasis: ['#dcbf82', '#c9a768', '#ecd6a2'], forts: ['#d6a565', '#bf8848', '#e9c48a'], wadi: ['#cfc6ac', '#b3a88c', '#e4dcc6'],
			dunes: ['#e68c3c', '#cc6c28', '#f7ad5c'], night: ['#27224f', '#1a173c', '#3a3478'], code: ['#15123f', '#0d0b2a', '#221d5c'] };
		const [c0, c1, c2] = base[name];
		g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
		g.fillStyle = c0; g.fillRect(0, 0, W, H);
		// every shape is drawn nine times around the tile, so the pattern has no seam
		const tiled = (x: number, y: number, draw: () => void) => { for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { g.save(); g.translate(x + ox, y + oy); draw(); g.restore(); } };
		/** Soft patches; `band` keeps them within that distance of the middle line (0 = anywhere). */
		const blot = (color: string, n: number, r0: number, r1: number, alpha: number, band = 0) => {
			g.globalAlpha = alpha; g.fillStyle = color;
			for (let i = 0; i < n; i++) { const r = r0 + rnd() * (r1 - r0), k = 0.5 + rnd() * 0.6, a = rnd() * 3, y = band ? M + (rnd() - 0.5) * 2 * band : rnd() * H; tiled(rnd() * W, y, () => { g.rotate(a); g.beginPath(); g.ellipse(0, 0, r, r * k, 0, 0, 6.3); g.fill(); }); }
			g.globalAlpha = 1;
		};
		/** A band along the flight that wanders and joins itself at the ends of the tile. */
		const river = (y0: number, width: number, color: string, alpha: number, wobble: number, phase = 0) => {
			g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
			for (const oy of [-H, 0, H]) { g.beginPath(); for (let x = -40; x <= W + 40; x += 16) { const k = x / W * Math.PI * 2, y = y0 + oy + Math.sin(k * 2 + phase) * wobble + Math.sin(k * 5 + phase * 2) * wobble * 0.35; if (x === -40) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
			g.globalAlpha = 1;
		};
		blot(c1, 40, 60, 200, 0.5); blot(c2, 34, 40, 150, 0.45); blot(c1, 110, 6, 22, 0.35);
		if (name === 'oasis') {
			blot('#5fa33f', 26, 70, 190, 0.8); blot('#84c455', 30, 30, 90, 0.6); blot('#3f8a34', 40, 12, 30, 0.5);          // gardens
			// date plots: a low wall around rows of young palms seen from above
			for (let i = 0; i < 16; i++) { const a = rnd() < 0.5 ? 0 : Math.PI / 2; tiled(rnd() * W, rnd() * H, () => { g.rotate(a); g.fillStyle = 'rgba(96,150,62,0.9)'; g.fillRect(-90, -58, 180, 116); g.strokeStyle = 'rgba(120,88,46,0.85)'; g.lineWidth = 5; g.strokeRect(-90, -58, 180, 116); g.fillStyle = 'rgba(40,110,45,0.95)'; for (let px = -70; px <= 70; px += 28) for (let py = -40; py <= 40; py += 27) { g.beginPath(); g.arc(px, py, 8, 0, 6.3); g.fill(); } }); }
			river(M - 150, 30, '#8a6a3c', 0.5, 46); river(M - 150, 20, '#1fa9d2', 1, 46); river(M - 150, 7, '#c3f4fa', 0.85, 46);   // the falaj and its banks
			river(M + 210, 22, '#8a6a3c', 0.45, 30, 2); river(M + 210, 13, '#1fa9d2', 1, 30, 2);
			river(M + 40, 14, '#f1dfb4', 0.7, 70, 1);                                                                        // a footpath
		} else if (name === 'forts') {
			blot('#a8703a', 40, 10, 34, 0.5); blot('#8c9440', 40, 6, 16, 0.6);                                              // stones, dry shrubs
			river(M + 30, 58, '#f0d6a0', 0.9, 110); river(M + 16, 5, '#b98b50', 0.6, 110); river(M + 44, 5, '#b98b50', 0.6, 110);   // the old road and its ruts
			g.strokeStyle = 'rgba(110,76,38,0.6)'; g.lineWidth = 6;
			for (let i = 0; i < 14; i++) { const a = rnd() * 3; tiled(rnd() * W, rnd() * H, () => { g.rotate(a); g.strokeRect(-80, -54, 160, 108); g.fillStyle = 'rgba(190,150,86,0.5)'; g.fillRect(-80, -54, 160, 108); }); }   // old field walls
		} else if (name === 'wadi') {
			blot('#8f7a5c', 24, 80, 200, 0.55);                                                                              // the rock of the gorge
			river(M, 360, '#a79e86', 0.9, 80); blot('#e9e2cf', 150, 5, 18, 0.8, 190);                                        // the gravel bed and its pale stones
			river(M, 200, '#0f8f9e', 1, 80); river(M, 160, '#17b4b8', 1, 80); river(M, 100, '#3fd6cf', 0.95, 80); river(M - 16, 26, '#b6f7ee', 0.7, 80);
			g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 4; g.lineCap = 'round';
			for (let i = 0; i < 60; i++) tiled(rnd() * W, M + (rnd() - 0.5) * 120, () => { g.beginPath(); g.moveTo(-14, 0); g.quadraticCurveTo(0, 5, 14, 0); g.stroke(); });   // ripples
			blot('#4a9a3c', 80, 8, 22, 0.85, 230); blot('#7cc356', 60, 5, 12, 0.8, 220);                                    // reeds on the banks
		} else if (name === 'dunes') {
			blot('#f9b866', 22, 60, 170, 0.4);
			g.lineCap = 'round';
			for (let i = 0; i < 70; i++) { const len = 180 + rnd() * 320, w = 40 + rnd() * 70, light = i % 2 === 0; g.strokeStyle = light ? 'rgba(255,208,140,0.75)' : 'rgba(168,74,26,0.55)'; g.lineWidth = light ? 9 : 13; tiled(rnd() * W, rnd() * H, () => { g.beginPath(); g.moveTo(0, -len / 2); g.quadraticCurveTo(w, 0, 0, len / 2); g.stroke(); }); }   // ridges across the wind
			g.strokeStyle = 'rgba(120,52,20,0.35)'; g.lineWidth = 3;
			for (let i = 0; i < 9; i++) river(rnd() * H, 3, '#8a3c16', 0.25, 26, rnd() * 6);                                 // tracks of a caravan
		} else if (name === 'code') {
			// a board of circuits and lines of code: the home of the code boss
			g.strokeStyle = 'rgba(120,130,255,0.16)'; g.lineWidth = 2;
			for (let x = 0; x <= W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
			for (let y = 0; y <= H; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
			g.lineCap = 'round';
			for (let i = 0; i < 46; i++) { const len = 64 * (1 + Math.floor(rnd() * 5)), turn = rnd() < 0.5, hot = i % 4 === 0; tiled(Math.floor(rnd() * 32) * 64, Math.floor(rnd() * 16) * 64, () => { g.strokeStyle = hot ? 'rgba(237,28,36,0.7)' : 'rgba(150,160,255,0.5)'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 0); if (turn) { g.lineTo(len, 0); g.lineTo(len, 64); } else { g.lineTo(0, len); g.lineTo(64, len); } g.stroke(); g.fillStyle = hot ? '#ff5a60' : '#c9d0ff'; g.beginPath(); g.arc(0, 0, 9, 0, 6.3); g.fill(); }); }
			const words = ['{ }', '</>', '0101', 'if ( )', ';;', '=>', '[ ]', '1010', '&&', '#!'];
			g.textAlign = 'center'; g.textBaseline = 'middle';
			for (let i = 0; i < 90; i++) { const word = words[Math.floor(rnd() * words.length)], size = 26 + Math.floor(rnd() * 30), hot = i % 5 === 0, a = 0.18 + rnd() * 0.3; tiled(rnd() * W, rnd() * H, () => { g.rotate(-Math.PI / 2); g.scale(1, -1); g.font = '700 ' + size + 'px Consolas, monospace'; g.fillStyle = hot ? 'rgba(255,90,96,' + a + ')' : 'rgba(190,200,255,' + a + ')'; g.fillText(word, 0, 0); }); }
		} else {
			g.lineCap = 'round';
			for (let i = 0; i < 34; i++) { const r = 70 + rnd() * 150; tiled(rnd() * W, rnd() * H, () => { for (let k = 0; k < 4; k++) { g.strokeStyle = `rgba(132,126,214,${0.6 - k * 0.12})`; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, Math.max(8, r - k * 20), 0.3, 2.8); g.stroke(); } }); }   // mountain terraces
			river(M + 60, 26, '#3c46a8', 0.8, 90); river(M + 60, 9, '#9aa8ff', 0.8, 90);                                    // a stream under the moon
			for (let i = 0; i < 90; i++) tiled(rnd() * W, rnd() * H, () => { const r = 4 + rnd() * 6, gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 3); gr.addColorStop(0, 'rgba(255,214,130,0.95)'); gr.addColorStop(1, 'rgba(255,190,90,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 3, 0, 6.3); g.fill(); });   // lights of far houses
		}
		this.tex.update();
	}

	// ------------------------------------------------------------------ scenes
	private put(kind: Kind, x: number, z: number, scale = 1, turn = 0, lift = 0) {
		const mesh = this.free.get(kind)!.pop() ?? this.sources.get(kind)!.createInstance(kind);
		mesh.setEnabled(true); mesh.isPickable = false;
		mesh.position.set(x, kind === 'cloud' ? lift : GROUND_Y + lift, z);
		mesh.rotation.y = turn; mesh.scaling.setAll(scale);
		this.items.push({ mesh, kind, x, drift: kind === 'cloud' ? 1.7 : 1 });
		const shade = SHADOW[kind];
		if (shade) this.put('shadow', x + shade * scale * 0.3, z + shade * scale * 0.2, shade * scale, 0, 0.04);   // the sun is low behind the player's left shoulder
	}
	/** Lays the next scene at the far edge. The same scene never follows itself. */
	private addScene() {
		const L = this.look, r = this.rnd, x0 = this.frontier;
		let name = L.scenes[Math.floor(r() * L.scenes.length)];
		if (name === this.lastScene) name = L.scenes[(L.scenes.indexOf(name) + 1) % L.scenes.length];
		this.lastScene = name;
		// most things stand within reach of a phone's narrow view; the rest fill the sides of a wide screen
		const side = r() < 0.5 ? -1 : 1;
		const scatter = (kind: Kind, n: number, len: number, s0: number, s1: number, zc = 0, zw = 20) => { for (let i = 0; i < n; i++) this.put(kind, x0 + r() * len, zc + (r() - 0.5) * zw, s0 + r() * (s1 - s0), r() * 6.3); };
		const wide = (kind: Kind, n: number, len: number, s0: number, s1: number) => { for (let i = 0; i < n; i++) this.put(kind, x0 + r() * len, (r() < 0.5 ? -1 : 1) * (11 + r() * 8), s0 + r() * (s1 - s0), r() * 6.3); };
		const night = L.name === 'night' || L.name === 'code';
		const fortress = (cx: number, cz: number, lit: boolean) => {
			this.put('keep', cx, cz, 1.1, r() < 0.5 ? 0 : Math.PI / 2);
			for (const [dx, dz] of [[-4.6, -4.6], [-4.6, 4.6], [4.6, -4.6], [4.6, 4.6]]) this.put('tower', cx + dx, cz + dz, 0.9, r() * 6.3);
			this.put('wall', cx - 4.6, cz, 1.25); this.put('wall', cx + 4.6, cz, 1.25); this.put('wall', cx, cz - 4.6, 1.25, Math.PI / 2); this.put('wall', cx, cz + 4.6, 1.25, Math.PI / 2);
			if (lit) for (const [dx, dz] of [[-4.6, -4.6], [4.6, 4.6], [0, -2.4], [0, 2.4]]) this.put('lantern', cx + dx, cz + dz, 1.3, 0, 4.4);
		};
		const village = (lit: boolean) => {
			const cz = side * (1 + r() * 3);
			for (let i = 0; i < 6; i++) { const hx = x0 + 2 + (i % 3) * 3.6 + r(), hz = cz + (i < 3 ? -2 : 2.2) + r(); this.put('house', hx, hz, 0.9 + r() * 0.25, Math.floor(r() * 4) * Math.PI / 2); if (lit) this.put('lantern', hx - 1.3, hz, 0.9, 0, 1.2); }
			scatter('palm', 6, 12, 0.9, 1.3, cz, 12);
		};
		let length = 16;
		switch (name) {
			case 'grove': case 'grove2': scatter('palm', name === 'grove' ? 18 : 12, 16, 0.85, 1.5); scatter('bush', 7, 16, 0.8, 1.4); wide('palm', 8, 16, 0.9, 1.5); break;
			case 'village': village(false); scatter('rock', 3, 12, 0.6, 1); wide('palm', 5, 14, 0.9, 1.4); length = 14; break;
			case 'fields': scatter('bush', 18, 14, 0.7, 1.1); scatter('palm', 7, 14, 1, 1.4); this.put('house', x0 + 7, side * 4, 1.1); length = 14; break;
			case 'falaj': scatter('palm', 10, 12, 0.9, 1.3, -3.5 * side, 5); this.put('pool', x0 + 6, 3.4 * side, 0.7); scatter('bush', 6, 12, 0.8, 1.2); length = 13; break;
			case 'fortress': fortress(x0 + 8, side * (0.5 + r() * 2.5), false); scatter('palm', 5, 16, 1, 1.4); wide('rock', 4, 16, 0.8, 1.6); length = 18; break;
			case 'watchtower': this.put('rock', x0 + 5, 2.6 * side, 2.2); this.put('tower', x0 + 5, 2.6 * side, 1.05, 0, 0.5); scatter('palm', 6, 12, 0.9, 1.3); scatter('rock', 4, 12, 0.6, 1.2); length = 13; break;
			case 'wallLine': for (let i = -3; i <= 3; i++) if (i !== 0) this.put('wall', x0 + 6, i * 5, 1); this.put('tower', x0 + 6, -17.5, 0.9); this.put('tower', x0 + 6, 17.5, 0.9); this.put('tower', x0 + 6, -2.6, 0.8); this.put('tower', x0 + 6, 2.6, 0.8); scatter('palm', 4, 12, 0.9, 1.3); length = 13; break;
			case 'gate': this.put('keep', x0 + 6, -5.2, 0.9); this.put('keep', x0 + 6, 5.2, 0.9); this.put('wall', x0 + 6, -2.4, 0.9); this.put('wall', x0 + 6, 2.4, 0.9); for (const z of [-8.5, 8.5]) this.put('tower', x0 + 6, z, 1); scatter('palm', 5, 12, 0.9, 1.3); length = 13; break;
			case 'rocks': scatter('rock', 11, 12, 0.7, 1.9); scatter('bush', 5, 12, 0.7, 1.1); this.put('tower', x0 + 8, side * 6, 0.8); length = 12; break;
			case 'pools': case 'pools2': this.put('pool', x0 + 6, (r() - 0.5) * 3, 0.9 + r() * 0.4, r() * 3); scatter('rock', 6, 14, 0.6, 1.4, side * 5, 5); scatter('palm', name === 'pools' ? 6 : 4, 14, 0.9, 1.4, -side * 6.5, 4); length = 15; break;
			case 'banks': scatter('palm', 8, 14, 0.9, 1.4, -6.5, 4); scatter('palm', 8, 14, 0.9, 1.4, 6.5, 4); scatter('bush', 6, 14, 0.8, 1.3); length = 14; break;
			case 'boulders': scatter('rock', 9, 13, 0.7, 2.2, -6, 6); scatter('rock', 9, 13, 0.7, 2.2, 6, 6); length = 13; break;
			case 'palmBank': scatter('palm', 11, 14, 1, 1.5, side * 6.5, 5); this.put('house', x0 + 7, -side * 6, 1); scatter('rock', 4, 14, 0.6, 1.2); length = 14; break;
			case 'cliffs': for (let i = 0; i < 4; i++) { this.put('mountain', x0 + 2 + i * 3.6, -8 - r() * 3, 0.7 + r() * 0.4, r() * 6.3); this.put('mountain', x0 + 3 + i * 3.6, 8 + r() * 3, 0.7 + r() * 0.4, r() * 6.3); } scatter('rock', 4, 14, 0.7, 1.3, 0, 6); scatter('palm', 3, 14, 0.9, 1.3, -6.5, 3); scatter('palm', 3, 14, 0.9, 1.3, 6.5, 3); length = 15; break;
			case 'dunes': case 'dunes2': scatter('dune', name === 'dunes' ? 8 : 6, 16, 0.8, 1.7); scatter('bush', 3, 16, 0.6, 0.9); break;
			case 'camp': { const cz = side * (1 + r() * 2.5); for (let i = 0; i < 4; i++) this.put('tent', x0 + 3 + i * 3.2, cz + (i % 2 ? 2.4 : -1.8), 1 + r() * 0.3, r() * 6.3); this.put('lantern', x0 + 7.5, cz, 1.2, 0, 0.4); scatter('dune', 3, 14, 0.8, 1.4); scatter('palm', 3, 14, 1, 1.2, cz, 8); length = 15; break; }
			case 'bigDune': this.put('dune', x0 + 8, (r() - 0.5) * 5, 3.2, r() * 3); scatter('dune', 4, 16, 0.7, 1.2); length = 17; break;
			case 'acacia': scatter('bush', 9, 13, 1, 1.9); scatter('rock', 5, 13, 0.6, 1.1); scatter('dune', 2, 13, 0.8, 1.2); length = 13; break;
			case 'ruin': this.put('tower', x0 + 6, side * 2.5, 1); this.put('wall', x0 + 6, side * 2.5 - 4.2, 0.9); this.put('wall', x0 + 9.4, side * 2.5, 0.9, Math.PI / 2); scatter('dune', 4, 14, 0.8, 1.4); scatter('rock', 4, 12, 0.6, 1); length = 14; break;
			case 'peaks': case 'peaks2': scatter('mountain', name === 'peaks' ? 7 : 5, 16, 0.7, 1.5); scatter('rock', 5, 16, 0.8, 1.6); break;
			case 'nightFort': fortress(x0 + 8, side * (0.5 + r() * 2.5), true); scatter('palm', 5, 16, 1, 1.3); length = 18; break;
			case 'nightVillage': village(true); scatter('mountain', 2, 14, 0.6, 1, side * -9, 5); length = 14; break;
			case 'nightGrove': scatter('palm', 14, 14, 0.9, 1.4); scatter('lantern', 5, 14, 0.8, 1.1, 0, 10); length = 14; break;
			case 'lights': case 'lights2': case 'lights3': scatter('lantern', name === 'lights' ? 9 : name === 'lights2' ? 6 : 12, 14, 0.7, 1.3); length = 14; break;   // the board of code needs no land: only its lamps
			case 'ridge': for (let i = -3; i <= 3; i++) this.put('mountain', x0 + 6 + r() * 3, i * 5.2 + r() * 2, 0.8 + r() * 0.7, r() * 6.3); scatter('lantern', 4, 12, 0.7, 1); length = 14; break;
		}
		if (night) scatter('lantern', 3, length, 0.6, 0.9);
		this.frontier += length + 1 + r() * 3;
	}

	/** `move` is the time step (0 while paused); `energy` speeds the flight up in a fight and slows it for reading. */
	update(move: number, energy: number) {
		this.t += move;
		const v = SPEED * energy * (this.reduceMotion ? 0.4 : 1) * move;
		this.tex.uOffset = (this.tex.uOffset + v / TILE_X) % 1;
		this.frontier -= v;
		for (let i = this.items.length - 1; i >= 0; i--) {
			const it = this.items[i];
			it.x -= v * it.drift;
			if (it.x < NEAR - 8) {
				if (it.kind === 'cloud') { it.x = FAR + this.rnd() * 10; it.mesh.position.z = (this.rnd() - 0.5) * 26; }
				else { it.mesh.setEnabled(false); this.free.get(it.kind)!.push(it.mesh); this.items.splice(i, 1); continue; }
			}
			it.mesh.position.x = it.x;
			if (it.kind === 'lantern') it.mesh.scaling.setAll(1 + 0.15 * Math.sin(this.t * 5 + it.x));
		}
		while (this.frontier < FAR) this.addScene();
	}
}
