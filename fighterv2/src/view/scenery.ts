// The land the player defends, seen from high above: a real satellite picture of Oman (NASA Blue Marble, public domain;
// public/assets/earth/oman-wide.jpg) with the country's border drawn over it (Natural Earth, public domain;
// src/data/oman-map.json). Each of the five stages hovers over one part of the country, from Musandam in the north to
// Dhofar in the south, drifting slowly; the last fight stands over the whole map, its border glowing in the colours of
// the flag: that is the land being defended. Nothing is mirrored or repeated: every coast and mountain is where it is.
// It is never a still picture. As from a satellite, the view glides slowly over the land in a wide loop and breathes a
// little closer and farther; a deck of clouds drifts across with the wind and lays its shadow on the ground; and around
// the Earth of the menu the clouds turn at their own pace. A faint grid marks the defender's screen, and the arena
// floor dims the land a little so danger stays easy to read.
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
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import omanMap from '../data/oman-map.json';
import { C, Models } from './models';

export const GROUND_Y = -8.5;
/** Meshes of the characters carry this bit: the lights of the land leave them alone, and one steady light is theirs. */
export const CHARACTER_LAYER = 0x10000000;
// the ground plane (centred on x = LAND_AT) and the size of its picture
/** The point of the land seen in the middle of a phone screen. The fight's middle is x = 9, but the camera is tilted and
 *  the land lies well below the fight, so what shows behind that point is the land about four units further on. */
const FIELD_MID = 13.2;
const LAND_X = 120, LAND_Z = 80, LAND_AT = 14, TEX_W = 2048, TEX_H = 2048, FAR = 48, NEAR = -16;
type Kind = 'lamp' | 'cloud';
/** What a stage looks down on: the point under the middle of the field [longitude, latitude], how many degrees of
 *  latitude one tile of the picture covers, and the size of that tile in the world (along the flight, across it). */
interface Look { name: string; sky: string; center: [number, number]; span: number; tile: [number, number]; tint: string; grid: string; dim: number; cloud: number; lamps: number; drift: number; whole?: boolean; space?: boolean }
/** The look of the menu and the story: the Earth turning in space (public/assets/earth/earth.jpg, NASA Blue Marble). */
export const SPACE = 6;
const MAP = omanMap as unknown as { bbox: [number, number, number, number]; oman: number[][][]; near: Record<string, number[][][]> };
const LOOKS: Look[] = [
	{ name: 'north', sky: '#0b2f66', center: [56.6, 25.2], span: 10, tile: [48, 48], tint: 'rgba(120,190,255,0.06)', grid: 'rgba(120,220,255,0.12)', dim: 0.26, cloud: 0.2, lamps: 0, drift: 1.6 },     // Musandam and Al Batinah
	{ name: 'capital', sky: '#0b2f66', center: [58.3, 23.3], span: 10, tile: [48, 48], tint: 'rgba(255,214,150,0.07)', grid: 'rgba(255,226,150,0.11)', dim: 0.28, cloud: 0.16, lamps: 0, drift: 1.4 },  // Muscat and the Hajar mountains
	{ name: 'sands', sky: '#0b2f66', center: [58.7, 21.4], span: 10, tile: [48, 48], tint: 'rgba(255,170,90,0.10)', grid: 'rgba(255,200,120,0.11)', dim: 0.3, cloud: 0.1, lamps: 0, drift: 1.4 },      // Ash Sharqiyah sands and Masirah
	{ name: 'coast', sky: '#0b2f66', center: [57.3, 19.7], span: 10, tile: [48, 48], tint: 'rgba(120,255,220,0.05)', grid: 'rgba(140,255,230,0.11)', dim: 0.28, cloud: 0.14, lamps: 0, drift: 1.5 },   // Al Wusta and its coast
	{ name: 'south', sky: '#0a2452', center: [54.4, 17.7], span: 10, tile: [48, 48], tint: 'rgba(50,40,130,0.26)', grid: 'rgba(170,160,255,0.13)', dim: 0.16, cloud: 0.22, lamps: 0, drift: 1.4 },     // Dhofar, at dusk
	{ name: 'homeland', sky: '#061236', center: [55.9, 21.4], span: 18.7, tile: [26, 26], tint: 'rgba(8,14,70,0.42)', grid: 'rgba(120,150,255,0.10)', dim: 0.08, cloud: 0.12, lamps: 0, drift: 0.22, whole: true },  // the whole country, in the last fight
	{ name: 'space', sky: '#02040f', center: [55.9, 21.4], span: 10, tile: [48, 48], tint: 'rgba(0,0,0,0)', grid: 'rgba(0,0,0,0)', dim: 0, cloud: 0, lamps: 0, drift: 0, space: true }                             // the Earth from space
];
/** The Earth of the menu: its size and place (well below the fight; the tilted camera shows what lies that deep further
 *  along, hence the large x), and the two turns that bring Oman to face the camera with north up the screen: first
 *  about the planet's own axis to its longitude, then a lean away from the camera by (latitude - the camera's height). */
const PLANET = { size: 10.6, x: 18.1, y: GROUND_Y - 6, spin: -52 * Math.PI / 180, lean: (21 - 58) * Math.PI / 180 };
/** The area of the wide satellite picture the stages are painted from (public/assets/earth/oman-wide.jpg): west, south,
 *  east, north. It reaches well beyond Oman, so even a very wide screen never comes to its edge. */
const WIDE = [48.5, 12.5, 64.5, 30.5];
/** The flag's colours, for the border in the last fight. */
const FLAG = ['#ff3b3b', '#ffffff', '#1fbf5f'];

interface Item { mesh: InstancedMesh; kind: Kind; x: number; drift: number }
/** One bird of a passing flock: where it sits in the V, and its own beat of the wings. */
interface Bird { mesh: InstancedMesh; dx: number; dz: number; beat: number }

export class Scenery {
	reduceMotion = false;
	private ground: Mesh; private tex: DynamicTexture;
	private hemi: HemisphericLight; private key: DirectionalLight; private characters: HemisphericLight;
	private sources = new Map<Kind, Mesh>();
	private free = new Map<Kind, InstancedMesh[]>();
	private items: Item[] = [];
	private look = LOOKS[0];
	private t = 0;
	private picture: HTMLImageElement | null = null;
	private planet: Mesh; private halo: Mesh; private shell: Mesh;
	private deck: Mesh; private deckTex: DynamicTexture; private shade: Mesh; private shadeTex: DynamicTexture;
	/** A flock of birds that now and then crosses between the land and the fight: the one thing at middle height, so the
	 *  eye feels how far below the land lies. */
	private birds: Bird[] = []; private flock = { on: false, x: 0, z: 0, slope: 0, wait: 6 };
	private rnd = (() => { let a = 20261113; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

	constructor(private scene: Scene, _models: Models) {
		this.hemi = new HemisphericLight('fill', new Vector3(0.3, 1, 0), scene);
		this.key = new DirectionalLight('key', new Vector3(0.55, -1, 0.3), scene);
		this.hemi.excludeWithLayerMask = CHARACTER_LAYER; this.key.excludeWithLayerMask = CHARACTER_LAYER;
		this.hemi.diffuse = C(0.95, 0.97, 1); this.hemi.groundColor = C(0.55, 0.62, 0.8); this.hemi.intensity = 0.95;
		this.key.diffuse = C(1, 0.97, 0.92); this.key.intensity = 0.9;
		this.characters = new HemisphericLight('characters', new Vector3(-0.3, 1, 0), scene);
		this.characters.includeOnlyWithLayerMask = CHARACTER_LAYER; this.characters.intensity = 0.95;
		this.characters.diffuse = C(1, 1, 1); this.characters.groundColor = C(0.6, 0.62, 0.68);
		this.tex = new DynamicTexture('land', { width: TEX_W, height: TEX_H }, scene, true);
		this.tex.wrapU = this.tex.wrapV = 0;                                     // clamped: beyond the picture the sea goes on, nothing repeats
		this.tex.anisotropicFilteringLevel = 4;
		this.ground = CreateGround('land', { width: LAND_X, height: LAND_Z }, scene);
		this.ground.position.set(LAND_AT, GROUND_Y, 0); this.ground.isPickable = false;
		const gm = new StandardMaterial('landTexMat', scene);
		gm.disableLighting = true; gm.diffuseTexture = this.tex; gm.emissiveColor = C(1, 1, 1); gm.specularColor = C(0, 0, 0);
		this.ground.material = gm;
		const add = (kind: Kind, mesh: Mesh) => { mesh.isVisible = false; mesh.isPickable = false; this.sources.set(kind, mesh); this.free.set(kind, []); };
		const lamp = CreateSphere('lamp', { diameter: 0.5, segments: 6 }, scene);
		const lm = new StandardMaterial('lampMat', scene); lm.disableLighting = true; lm.emissiveColor = C(1, 0.82, 0.42); lamp.material = lm;
		add('lamp', lamp);
		// soft white blots for the clouds that pass between the land and the fight
		const blots = new DynamicTexture('cloudTex', { width: 128, height: 128 }, scene, true); blots.hasAlpha = true;
		const bg = blots.getContext() as unknown as CanvasRenderingContext2D;
		for (const [x, y, r] of [[52, 64, 40], [78, 60, 34], [40, 70, 26]]) { const gr = bg.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); bg.fillStyle = gr; bg.fillRect(0, 0, 128, 128); }
		blots.update();
		const cloud = CreateGround('cloud', { width: 9, height: 9 }, scene);
		const cm = new StandardMaterial('cloudMat', scene); cm.disableLighting = true; cm.opacityTexture = blots; cm.emissiveColor = C(1, 1, 1); cm.diffuseColor = C(0, 0, 0); cm.specularColor = C(0, 0, 0); cm.alpha = 0.16; cm.backFaceCulling = false;
		cloud.material = cm;
		add('cloud', cloud);
		// the Earth itself, for the menu and the story: a real picture of the whole planet on a slowly turning ball, with
		// a thin blue glow of air around it. It hangs below the fight like the land does.
		this.planet = CreateSphere('planet', { diameter: PLANET.size, segments: 48 }, scene);
		const pm = new StandardMaterial('planetMat', scene);
		const earth = new Texture(new URL('assets/earth/earth.jpg', document.baseURI).href, scene, false, false);   // not turned over: the ball's own coordinates already run north to south
		pm.disableLighting = true; pm.emissiveTexture = earth; earth.level = 1.25; pm.emissiveColor = C(0, 0, 0); pm.diffuseColor = C(0, 0, 0); pm.specularColor = C(0, 0, 0);   // the picture as it is, a little brightened (an emissive texture is added to the emissive colour, so that colour is black)
		this.planet.material = pm; this.planet.isPickable = false;
		this.planet.position.set(PLANET.x, PLANET.y, 0);
		this.planet.rotationQuaternion = new Quaternion(0, 0, 0, 1);
		this.aimPlanet(0);
		const glow = new DynamicTexture('haloTex', { width: 256, height: 256 }, scene, true); glow.hasAlpha = true;
		const hg = glow.getContext() as unknown as CanvasRenderingContext2D, gr = hg.createRadialGradient(128, 128, 84, 128, 128, 128);
		gr.addColorStop(0, 'rgba(120,190,255,0)'); gr.addColorStop(0.18, 'rgba(120,190,255,0.75)'); gr.addColorStop(1, 'rgba(120,190,255,0)');
		hg.fillStyle = gr; hg.fillRect(0, 0, 256, 256); glow.update();
		this.halo = CreateGround('halo', { width: PLANET.size * 1.55, height: PLANET.size * 1.55 }, scene);
		const hm = new StandardMaterial('haloMat', scene); hm.disableLighting = true; hm.opacityTexture = glow; hm.emissiveColor = C(0.5, 0.78, 1); hm.diffuseColor = C(0, 0, 0); hm.specularColor = C(0, 0, 0); hm.alpha = 0.9; hm.backFaceCulling = false;
		this.halo.material = hm; this.halo.isPickable = false;
		this.halo.position.set(PLANET.x + 0.35, PLANET.y - 0.5, 0);
		// the clouds of the planet: a thin shell just above the ground, turning on its own
		this.shell = CreateSphere('planetClouds', { diameter: PLANET.size * 1.018, segments: 40 }, scene);
		const sm = new StandardMaterial('planetCloudMat', scene);
		const wisps = this.cloudTexture('planetCloudTex', 1024, 512, 150, 0.9);
		sm.disableLighting = true; sm.emissiveColor = C(1, 1, 1); sm.diffuseColor = C(0, 0, 0); sm.specularColor = C(0, 0, 0); sm.opacityTexture = wisps; sm.alpha = 0.6; sm.backFaceCulling = true;
		this.shell.material = sm; this.shell.isPickable = false;
		this.shell.position.copyFrom(this.planet.position);
		this.shell.rotationQuaternion = new Quaternion(0, 0, 0, 1);
		this.planet.setEnabled(false); this.halo.setEnabled(false); this.shell.setEnabled(false);
		// the clouds over the map: one wide sheet between the land and the fight, and its shadow lying on the land
		const sheet = (name: string, y: number, color: Color3, tex: DynamicTexture) => {
			const m = CreateGround(name, { width: LAND_X, height: LAND_Z }, scene);
			const mat = new StandardMaterial(name + 'Mat', scene);
			mat.disableLighting = true; mat.emissiveColor = color; mat.diffuseColor = C(0, 0, 0); mat.specularColor = C(0, 0, 0); mat.opacityTexture = tex; mat.backFaceCulling = false;
			m.material = mat; m.isPickable = false; m.position.set(LAND_AT, y, 0);
			return m;
		};
		this.deckTex = this.cloudTexture('deckTex', 1024, 1024, 46, 1); this.deckTex.uScale = 2.4; this.deckTex.vScale = 1.6;
		this.shadeTex = this.cloudTexture('shadeTex', 512, 512, 46, 1); this.shadeTex.uScale = 2.4; this.shadeTex.vScale = 1.6;
		this.deck = sheet('cloudDeck', GROUND_Y + 3.2, C(1, 1, 1), this.deckTex);
		this.shade = sheet('cloudShade', GROUND_Y + 0.06, C(0, 0.02, 0.08), this.shadeTex);
		// the flock: one painted bird (span across the flight, wings swept back), seven copies in a V
		const bird = new DynamicTexture('birdTex', { width: 128, height: 128 }, scene, true); bird.hasAlpha = true;
		const bc = bird.getContext() as unknown as CanvasRenderingContext2D;
		bc.fillStyle = 'rgba(255,255,255,1)'; bc.beginPath();
		bc.moveTo(76, 64); bc.quadraticCurveTo(62, 40, 34, 8); bc.quadraticCurveTo(52, 38, 50, 60); bc.quadraticCurveTo(44, 64, 50, 68);
		bc.quadraticCurveTo(52, 90, 34, 120); bc.quadraticCurveTo(62, 88, 76, 64); bc.fill();
		bc.beginPath(); bc.ellipse(62, 64, 18, 5, 0, 0, 6.3); bc.fill(); bird.update();
		const one = CreateGround('bird', { width: 1, height: 1 }, scene);
		const bm = new StandardMaterial('birdMat', scene); bm.disableLighting = true; bm.emissiveColor = C(0.07, 0.09, 0.15); bm.diffuseColor = C(0, 0, 0); bm.specularColor = C(0, 0, 0); bm.opacityTexture = bird; bm.alpha = 0.8; bm.backFaceCulling = false;
		one.material = bm; one.isVisible = false; one.isPickable = false;
		for (let i = 0; i < 7; i++) { const row = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1; const mesh = one.createInstance('bird' + i); mesh.isPickable = false; mesh.setEnabled(false); this.birds.push({ mesh, dx: -row * 0.95, dz: side * row * 0.85, beat: this.rnd() * 6 }); }
		// the satellite picture arrives a moment after the first frame: until then the sea's colour is shown
		const img = new Image();
		img.onload = () => { this.picture = img; this.paint(); };
		img.src = new URL('assets/earth/oman-wide.jpg', document.baseURI).href;
		this.setStage(0);
	}
	/** How strongly the arena floor should darken the land of this stage. */
	get dim() { return this.look.dim; }

	setStage(index: number) {
		this.look = LOOKS[Math.max(0, Math.min(LOOKS.length - 1, index))];
		const L = this.look, sky = Color3.FromHexString(L.sky);
		this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
		(this.sources.get('cloud')!.material as StandardMaterial).alpha = L.cloud;
		this.tex.uScale = LAND_X / L.tile[0]; this.tex.vScale = LAND_Z / L.tile[1];
		this.planet.setEnabled(!!L.space); this.halo.setEnabled(!!L.space); this.shell.setEnabled(!!L.space);
		this.deck.setEnabled(!L.space); this.shade.setEnabled(!L.space);
		this.flock.on = false; this.flock.wait = 4 + this.rnd() * 6; for (const b of this.birds) b.mesh.setEnabled(false);
		(this.deck.material as StandardMaterial).alpha = Math.min(0.62, L.cloud * 2.6); (this.shade.material as StandardMaterial).alpha = Math.min(0.34, L.cloud * 1.5);
		this.ground.position.y = L.space ? GROUND_Y - 22 : GROUND_Y;              // in space the "ground" is only the dark behind the planet
		this.place(0);
		this.paint();
		for (const it of this.items) this.free.get(it.kind)!.push(it.mesh), it.mesh.setEnabled(false);
		this.items = [];
		for (let i = 0; i < 4; i++) this.put('cloud', NEAR + this.rnd() * (FAR - NEAR), (this.rnd() - 0.5) * 26, 0.8 + this.rnd() * 1.4, this.rnd() * 6, -2 - this.rnd() * 2);
		for (let i = 0; i < L.lamps; i++) this.put('lamp', NEAR + this.rnd() * (FAR - NEAR), (this.rnd() - 0.5) * 16, 0.5 + this.rnd() * 0.5, 0, 0.3);
	}
	/** Turns the planet: `sway` is added to the turn about its own axis. */
	private aimPlanet(sway: number, clouds = 0) {
		const a = PLANET.lean / 2, az = Math.sin(a), aw = Math.cos(a);
		// (lean about z) x (spin about y), written out: the spin is applied first
		const turn = (mesh: Mesh, spin: number) => { const b = spin / 2, by = Math.sin(b), bw = Math.cos(b); mesh.rotationQuaternion!.set(-az * by, aw * by, az * bw, aw * bw); };
		turn(this.planet, PLANET.spin + sway);
		if (this.shell) turn(this.shell, PLANET.spin + sway + clouds);
	}
	/** Puts the middle of the picture under the middle of the field (x = 11, z = 0), moved `ahead` world units. */
	private place(ahead: number, aside = 0, near = 1) {
		const L = this.look;
		// texture coordinates run 0..1 over the ground plane and are multiplied by the scale, then moved by the offset
		this.tex.uScale = LAND_X / (L.tile[0] * near); this.tex.vScale = LAND_Z / (L.tile[1] * near);
		this.tex.uOffset = 0.5 - (FIELD_MID + ahead - (LAND_AT - LAND_X / 2)) / LAND_X * this.tex.uScale;
		this.tex.vOffset = 0.5 - (0.5 + aside / LAND_Z) * this.tex.vScale;
	}
	/** A picture of clouds that joins itself at its edges: soft white blots, thick in places and absent in others. */
	private cloudTexture(name: string, w: number, h: number, count: number, strength: number) {
		const t = new DynamicTexture(name, { width: w, height: h }, this.scene, true); t.hasAlpha = true; t.wrapU = t.wrapV = 1;
		const g = t.getContext() as unknown as CanvasRenderingContext2D, r = this.rnd;
		g.clearRect(0, 0, w, h);
		for (let i = 0; i < count; i++) {
			// clouds come in families: a few big banks, each with smaller puffs around it
			const cx = r() * w, cy = r() * h, big = 30 + r() * 70, puffs = 3 + Math.floor(r() * 5);
			for (let k = 0; k < puffs; k++) {
				const x = cx + (r() - 0.5) * big * 2.4, y = cy + (r() - 0.5) * big * 1.3, rad = big * (0.35 + r() * 0.65), a = (0.1 + r() * 0.22) * strength;
				for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
					const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
					gr.addColorStop(0, 'rgba(255,255,255,' + a + ')'); gr.addColorStop(0.55, 'rgba(255,255,255,' + a * 0.55 + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
					g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rad, 0, 6.3); g.fill();
				}
			}
		}
		t.update();
		return t;
	}

	// ------------------------------------------------------------------ the ground
	// On the canvas, x runs along the flight (north is ahead) and y across it (east is to the right).
	private paint() {
		const g = this.tex.getContext() as unknown as CanvasRenderingContext2D, W = TEX_W, H = TEX_H, L = this.look, img = this.picture;
		g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
		g.fillStyle = L.sky; g.fillRect(0, 0, W, H);
		if (L.space) {                                                           // nothing but stars
			const r = this.rnd;
			for (let i = 0; i < 420; i++) { const s = r() < 0.08 ? 3.2 : r() < 0.3 ? 2 : 1.2; g.globalAlpha = 0.35 + r() * 0.65; g.fillStyle = r() < 0.2 ? '#bcd6ff' : r() < 0.1 ? '#ffe9c4' : '#ffffff'; g.beginPath(); g.arc(4 + r() * (W - 8), 4 + r() * (H - 8), s, 0, 6.3); g.fill(); }
			g.globalAlpha = 1;
			g.fillStyle = L.sky; g.fillRect(0, 0, W, 3); g.fillRect(0, H - 3, W, 3); g.fillRect(0, 0, 3, H); g.fillRect(W - 3, 0, 3, H);
			this.tex.update();
			return;
		}
		const [bw, bs, be, bn] = WIDE;
		// the window of the world this tile shows: the same number of degrees per world unit both ways
		const spanNS = L.span, spanEW = L.span * L.tile[1] / L.tile[0], latS = L.center[1] - spanNS / 2, lonW = L.center[0] - spanEW / 2;
		const at = (lon: number, lat: number): [number, number] => [W * (lat - latS) / spanNS, H * (1 - (lon - lonW) / spanEW)];   // the canvas runs the other way across: east must come out on the right of the screen
		const trace = (ring: number[][]) => { g.beginPath(); ring.forEach(([lon, lat], i) => { const [x, y] = at(lon, lat); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
		if (img) {
			const px = img.naturalWidth / (be - bw), py = img.naturalHeight / (bn - bs);
			g.save();
			g.filter = 'saturate(1.3) contrast(1.08) brightness(1.04)';
			g.setTransform(0, -H / (px * spanEW), -W / (py * spanNS), 0, W * (bn - latS) / spanNS, H * (1 - (bw - lonW) / spanEW));   // picture pixels to the canvas, north ahead
			g.drawImage(img, 0, 0);
			g.restore();
			// where the picture ends, it melts into the sea colour (the texture is clamped, so its edge colour goes on for ever)
			const [x0, y1] = at(bw, bs), [x1, y0] = at(be, bn), fade = 70;
			const melt = (ax: number, ay: number, bx: number, by: number, rx: number, ry: number, rw: number, rh: number) => { const gr = g.createLinearGradient(ax, ay, bx, by); gr.addColorStop(0, L.sky); gr.addColorStop(1, 'rgba(11,47,102,0)'); g.fillStyle = gr; g.fillRect(rx, ry, rw, rh); };
			melt(x0, 0, x0 + fade, 0, x0 - 2, 0, fade + 2, H); melt(x1, 0, x1 - fade, 0, x1 - fade, 0, fade + 2, H);
			melt(0, y0, 0, y0 + fade, 0, y0 - 2, W, fade + 2); melt(0, y1, 0, y1 - fade, 0, y1 - fade, W, fade + 2);
			g.fillStyle = L.sky;
			if (x0 > 0) g.fillRect(0, 0, x0, H);
			if (x1 < W) g.fillRect(x1, 0, W - x1, H);
			if (y0 > 0) g.fillRect(0, 0, W, y0);
			if (y1 < H) g.fillRect(0, y1, W, H - y1);
		}
		g.fillStyle = L.tint; g.fillRect(0, 0, W, H);
		g.lineJoin = 'round'; g.lineCap = 'round';
		if (L.whole) {
			// Oman itself: brighter than what surrounds it, and its border in the colours of the flag
			g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,236,190,0.2)';
			for (const ring of MAP.oman) { trace(ring); g.fill(); }
			g.restore();
			for (const [color, width, blur, alpha] of [[FLAG[2], 14, 24, 0.55], [FLAG[0], 9, 16, 0.7], [FLAG[1], 3.5, 6, 0.95]] as [string, number, number, number][]) {
				g.save(); g.strokeStyle = color; g.lineWidth = width; g.shadowColor = color; g.shadowBlur = blur; g.globalAlpha = alpha;
				for (const ring of MAP.oman) { trace(ring); g.stroke(); }
				g.restore();
			}
		} else {
			// while flying: the border as a thin line of light, so the map reads as a map
			g.save(); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.shadowColor = '#7fe9ff'; g.shadowBlur = 10; g.globalAlpha = 0.6;
			for (const ring of MAP.oman) { trace(ring); g.stroke(); }
			g.restore();
		}
		// a faint grid, as on a defender's screen
		g.strokeStyle = L.grid; g.lineWidth = 2;
		for (let x = 0; x <= W; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
		for (let y = 0; y <= H; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
		// the edge of the canvas is plain sea, so the clamped texture never drags a streak of land outward
		g.fillStyle = L.sky; g.fillRect(0, 0, W, 3); g.fillRect(0, H - 3, W, 3); g.fillRect(0, 0, 3, H); g.fillRect(W - 3, 0, 3, H);
		this.tex.update();
	}

	/** The flock: it waits, then crosses the whole view up the screen on a slant, beating its wings, and waits again. */
	private fly(move: number) {
		const f = this.flock;
		if (this.look.space || this.reduceMotion || !move) { if (f.on && (this.look.space || this.reduceMotion)) { f.on = false; for (const b of this.birds) b.mesh.setEnabled(false); } return; }
		if (!f.on) {
			f.wait -= move; if (f.wait > 0) return;
			f.on = true; f.x = NEAR - 4; f.z = (this.rnd() - 0.5) * 10; f.slope = (this.rnd() - 0.5) * 0.5;
			for (const b of this.birds) b.mesh.setEnabled(true);
		}
		f.x += 3.2 * move; f.z += 3.2 * move * f.slope;
		const y = GROUND_Y + 5;
		for (const b of this.birds) {
			const flap = 0.62 + 0.38 * Math.sin(this.t * 7 + b.beat), size = 1.25;
			b.mesh.position.set(f.x + b.dx, y, f.z + b.dz + f.slope * b.dx); b.mesh.rotation.y = -Math.atan(f.slope); b.mesh.scaling.set(size, 1, size * flap);
		}
		if (f.x > FAR + 6) { f.on = false; f.wait = 14 + this.rnd() * 16; for (const b of this.birds) b.mesh.setEnabled(false); }
	}
	private put(kind: Kind, x: number, z: number, scale = 1, turn = 0, lift = 0) {
		const mesh = this.free.get(kind)!.pop() ?? this.sources.get(kind)!.createInstance(kind);
		mesh.setEnabled(true); mesh.isPickable = false;
		mesh.position.set(x, kind === 'cloud' ? lift : GROUND_Y + lift, z);
		mesh.rotation.y = turn; mesh.scaling.setAll(scale);
		this.items.push({ mesh, kind, x, drift: kind === 'cloud' ? 1.7 : 1 });
	}

	/** `move` is the time step (0 while paused); `energy` is livelier in a fight and calmer for reading. */
	update(move: number, energy: number) {
		this.t += move * (0.5 + 0.5 * energy);
		const L = this.look, calm = this.reduceMotion ? 0.4 : 1;
		// as from a satellite passing over: the view glides in a wide slow loop (never the same line twice running) and
		// comes a little nearer and farther, so the land is always moving, yet every place stays where it really is
		const t = this.t, k = L.drift * calm;
		this.place((Math.sin(t * 0.083) * 2.6 + Math.sin(t * 0.031 + 1.3) * 1.5) * k, (Math.sin(t * 0.059 + 0.7) * 1.5 + Math.sin(t * 0.023) * 0.8) * k, 1 + 0.035 * Math.sin(t * 0.047) * Math.min(1, k));
		// the wind carries the clouds across, and their shadow follows a little behind and to the side
		const wind = t * calm;
		this.deckTex.uOffset = wind * 0.0105; this.deckTex.vOffset = wind * 0.0048;
		this.shadeTex.uOffset = wind * 0.0105 + 0.012; this.shadeTex.vOffset = wind * 0.0048 + 0.02;
		if (L.space) this.aimPlanet((Math.sin(t * 0.07) * 0.42 + Math.sin(t * 0.029) * 0.16) * calm, wind * 0.02);   // the Earth turns slowly to and fro, Arabia never far from the middle, while its clouds go round
		this.fly(move);
		const v = 1.1 * energy * calm * move;
		for (const it of this.items) {
			it.x -= v * it.drift;
			if (it.x < NEAR - 8) { it.x = FAR + this.rnd() * 10; it.mesh.position.z = (this.rnd() - 0.5) * (it.kind === 'cloud' ? 26 : 16); }
			it.mesh.position.x = it.x;
			if (it.kind === 'lamp') it.mesh.scaling.setAll(0.5 + 0.1 * Math.sin(this.t * 4 + it.x));
		}
	}
}
