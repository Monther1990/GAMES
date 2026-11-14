// Shapes built in code: the small malware (virus, worm, bug, spy eye, ransom lock, skull), the five bosses, and the
// pieces of Omani scenery (palms, forts, houses, rocks, dunes, tents, mountains). Each model is a handful of simple
// solids, coloured per vertex and merged into one mesh, so one material and cheap instances are enough.
// Axes: x is up the screen (enemies face -x, toward the player), y is height, z is across.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import logo from '../data/omcode-logo.json';

/** The logo's middle in its own units, and how large one of its units is on the boss (the wordmark is 4.88 wide). */
export const LOGO = { cx: logo.viewBox[0] + logo.viewBox[2] / 2, cy: logo.viewBox[1] + logo.viewBox[3] / 2, unit: 4.88 / logo.viewBox[2], length: 5, height: 1.25 };

export const C = (r: number, g: number, b: number) => new Color3(r, g, b);
const hex = (h: string) => Color3.FromHexString(h);
interface Place { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number }

/** Colours every vertex of a solid and puts it in place, ready to be merged. */
function part(m: Mesh, color: Color3, p: Place = {}): Mesh {
	const n = m.getTotalVertices(), data = new Float32Array(n * 4);
	for (let i = 0; i < n; i++) { data[i * 4] = color.r; data[i * 4 + 1] = color.g; data[i * 4 + 2] = color.b; data[i * 4 + 3] = 1; }
	m.setVerticesData(VertexBuffer.ColorKind, data);
	m.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
	m.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
	m.scaling.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
	m.computeWorldMatrix(true);
	return m;
}
function merge(name: string, parts: Mesh[]): Mesh {
	const m = Mesh.MergeMeshes(parts, true, true)!;
	m.name = name; m.isPickable = false;
	return m;
}

export class Models {
	/** Lit, vertex-coloured: for malware and bosses (a little self-lit so they stay readable over any ground). */
	readonly bright: StandardMaterial;
	/** Lit, vertex-coloured: for scenery, which takes the light and colour of the stage. */
	readonly land: StandardMaterial;
	/** Lit, vertex-coloured and polished: for the rare black box. */
	readonly gloss: StandardMaterial;
	constructor(readonly scene: Scene) {
		const mk = (name: string, glow: number) => { const m = new StandardMaterial(name, scene); m.specularColor = C(0.08, 0.08, 0.08); m.emissiveColor = C(glow, glow, glow); return m; };
		this.bright = mk('brightMat', 0.26);
		this.land = mk('landMat', 0.02);
		this.gloss = mk('glossMat', 0.03); this.gloss.specularColor = C(0.55, 0.55, 0.65); this.gloss.specularPower = 180;
	}
	private sphere(d: number, seg = 8) { return CreateSphere('s', { diameter: d, segments: seg }, this.scene); }
	private box(w: number, h: number, d: number) { return CreateBox('b', { width: w, height: h, depth: d }, this.scene); }
	private cyl(d: number, h: number, tess = 8, top = d) { return CreateCylinder('c', { diameterBottom: d, diameterTop: top, height: h, tessellation: tess }, this.scene); }
	private torus(d: number, t: number, tess = 18) { return CreateTorus('t', { diameter: d, thickness: t, tessellation: tess }, this.scene); }
	private done(name: string, parts: Mesh[], mat: StandardMaterial) { const m = merge(name, parts); m.material = mat; return m; }

	// ------------------------------------------------------------------ small malware
	/** The classic virus: a ball covered in knobbed spikes. */
	virus(bodyHex = '#d53df0', tipHex = '#ffb0ff', name = 'virus'): Mesh {
		const body = hex(bodyHex), tip = hex(tipHex), parts = [part(this.sphere(0.62, 10), body, { y: 0.1 })];
		const spike = (yaw: number, pitch: number) => {
			const dx = Math.cos(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.sin(yaw) * Math.cos(pitch);
			parts.push(part(this.cyl(0.07, 0.26, 5), body, { x: dx * 0.4, y: 0.1 + dy * 0.4, z: dz * 0.4, rz: Math.PI / 2 - pitch, ry: -yaw }));
			parts.push(part(this.sphere(0.14, 5), tip, { x: dx * 0.55, y: 0.1 + dy * 0.55, z: dz * 0.55 }));
		};
		for (let i = 0; i < 8; i++) spike(i * Math.PI / 4, 0);
		for (let i = 0; i < 4; i++) spike(i * Math.PI / 2 + 0.4, 0.9);
		return this.done(name, parts, this.bright);
	}
	/** A worm: a chain of segments with a head that looks toward the player. */
	worm(aHex = '#7be03c', bHex = '#3f9a22', name = 'worm'): Mesh {
		const a = hex(aHex), b = hex(bHex), parts: Mesh[] = [];
		for (let i = 0; i < 5; i++) parts.push(part(this.sphere(0.46 - i * 0.055, 8), i % 2 ? b : a, { x: -0.42 + i * 0.27, y: 0.05, z: Math.sin(i * 1.3) * 0.12 }));
		for (const z of [-0.11, 0.11]) { parts.push(part(this.sphere(0.13, 5), hex('#ffffff'), { x: -0.58, y: 0.2, z })); parts.push(part(this.sphere(0.07, 5), hex('#101820'), { x: -0.63, y: 0.22, z })); }
		return this.done(name, parts, this.bright);
	}
	/** A bug: a spotted beetle with six legs and feelers. */
	bug(shellHex = '#e2452f', spotHex = '#ffd640', name = 'bug'): Mesh {
		const shell = hex(shellHex), dark = hex('#2a1512'), parts = [
			part(this.sphere(0.72, 10), shell, { y: 0.08, sx: 1, sy: 0.55, sz: 0.82 }),
			part(this.sphere(0.34, 8), dark, { x: -0.38, y: 0.06 }),
			part(this.box(0.72, 0.03, 0.03), dark, { y: 0.28 })];
		for (const s of [-1, 1]) {
			for (let i = 0; i < 3; i++) parts.push(part(this.box(0.05, 0.05, 0.36), dark, { x: -0.2 + i * 0.22, y: -0.02, z: s * 0.4, rx: s * 0.5 }));
			parts.push(part(this.box(0.3, 0.03, 0.03), dark, { x: -0.6, y: 0.14, z: s * 0.1, ry: s * 0.5 }));
			parts.push(part(this.sphere(0.12, 5), hex(spotHex), { x: 0.05, y: 0.27, z: s * 0.17 }));
		}
		return this.done(name, parts, this.bright);
	}
	/** Spyware: an eye that watches, with two small aerials. */
	eye(): Mesh {
		const parts = [
			part(this.sphere(0.68, 10), hex('#eef6ff'), { y: 0.08 }),
			part(this.sphere(0.4, 8), hex('#22c8ff'), { x: -0.2, y: 0.24 }),
			part(this.sphere(0.2, 6), hex('#06121e'), { x: -0.3, y: 0.34 })];
		for (const s of [-1, 1]) { parts.push(part(this.cyl(0.04, 0.34, 4), hex('#ff5a7a'), { x: 0.16, y: 0.42, z: s * 0.2, rx: s * 0.4 })); parts.push(part(this.sphere(0.1, 5), hex('#ff5a7a'), { x: 0.16, y: 0.6, z: s * 0.27 })); }
		return this.done('eye', parts, this.bright);
	}
	/** A logic bomb: a black ball with a lit fuse and an angry look. */
	bomb(): Mesh {
		const parts = [
			part(this.sphere(0.7, 10), hex('#2b2f3d'), { y: 0.08 }),
			part(this.sphere(0.2, 6), hex('#8a93ad'), { x: -0.12, y: 0.3, z: -0.14, sy: 0.5 }),
			part(this.cyl(0.24, 0.14, 8), hex('#9aa3bd'), { y: 0.44 }),
			part(this.cyl(0.06, 0.34, 4), hex('#d9c9a0'), { x: 0.08, y: 0.62, rz: -0.5 }),
			part(this.sphere(0.2, 5), hex('#ffd23a'), { x: 0.18, y: 0.8 }), part(this.sphere(0.11, 5), hex('#ff5a1f'), { x: 0.18, y: 0.86 })];
		for (const z of [-0.15, 0.15]) { parts.push(part(this.sphere(0.15, 6), hex('#ff3340'), { x: -0.27, y: 0.2, z })); parts.push(part(this.box(0.05, 0.05, 0.2), hex('#0b0d14'), { x: -0.29, y: 0.31, z, rx: z > 0 ? 0.5 : -0.5 })); }
		return this.done('bomb', parts, this.bright);
	}
	/** A keylogger: a small keyboard with eyes that records what is typed. */
	keylog(): Mesh {
		const body = hex('#123b40'), key = hex('#45e6d0'), parts = [part(this.box(0.72, 0.2, 0.98), body, { y: 0.02 }), part(this.box(0.78, 0.06, 1.04), hex('#0c6f66'), { y: -0.1 })];
		for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) parts.push(part(this.box(0.15, 0.09, 0.17), (r + c) % 3 === 0 ? hex('#d6fff7') : key, { x: 0.2 - r * 0.21, y: 0.16, z: -0.33 + c * 0.22 }));
		for (const z of [-0.2, 0.2]) { parts.push(part(this.sphere(0.2, 6), hex('#ffffff'), { x: -0.36, y: 0.2, z })); parts.push(part(this.sphere(0.1, 5), hex('#06121e'), { x: -0.43, y: 0.22, z })); }
		parts.push(part(this.box(0.4, 0.04, 0.05), hex('#0c6f66'), { x: 0.55, y: 0, ry: 0.5 }), part(this.box(0.3, 0.04, 0.05), hex('#0c6f66'), { x: 0.82, y: 0, z: -0.14, ry: -0.6 }));   // its cable
		return this.done('keylog', parts, this.bright);
	}
	/** A bot of a botnet: a small robot head with an aerial. */
	bot(): Mesh {
		const metal = hex('#9aa8c6'), dark = hex('#1a2238'), parts = [
			part(this.box(0.62, 0.5, 0.66), metal, { y: 0.08 }), part(this.box(0.66, 0.1, 0.7), hex('#6d7a99'), { y: -0.16 }),
			part(this.box(0.1, 0.2, 0.52), dark, { x: -0.29, y: 0.13 }), part(this.box(0.42, 0.04, 0.52), dark, { x: -0.1, y: 0.34 }),
			part(this.cyl(0.05, 0.3, 4), hex('#dfe6f5'), { x: 0.12, y: 0.48 }), part(this.sphere(0.14, 5), hex('#ff4b5c'), { x: 0.12, y: 0.66 })];
		for (const z of [-0.14, 0.14]) { parts.push(part(this.sphere(0.14, 6), hex('#ff3340'), { x: -0.3, y: 0.18, z })); parts.push(part(this.box(0.2, 0.12, 0.08), hex('#6d7a99'), { y: 0.05, z: z * 2.7 })); }
		return this.done('bot', parts, this.bright);
	}
	/** The heart box: a heart seen from above, to be opened when hearts are missing. */
	heartBox(): Mesh {
		const red = hex('#ff3d63'), parts = [part(this.sphere(0.62, 10), red, { x: 0.16, y: 0.1, z: -0.24, sy: 0.6 }), part(this.sphere(0.62, 10), red, { x: 0.16, y: 0.1, z: 0.24, sy: 0.6 }),
			part(this.cyl(0.98, 0.78, 14, 0), red, { x: -0.24, y: 0.1, rz: Math.PI / 2, sx: 0.6 }), part(this.sphere(0.2, 6), hex('#ffffff'), { x: 0.24, y: 0.27, z: -0.28, sy: 0.4 }),
			part(this.box(0.34, 0.05, 0.1), hex('#ffffff'), { y: 0.3 }), part(this.box(0.1, 0.05, 0.34), hex('#ffffff'), { y: 0.3 })];
		return this.done('crateHeart', parts, this.bright);
	}
	/** The bomb of Total Awareness: polished black with a gold band and a core of light. */
	awareBomb(): Mesh {
		const parts = [part(this.sphere(0.95, 14), hex('#08080e')), part(this.torus(0.98, 0.09, 22), hex('#ffd24a')), part(this.torus(0.98, 0.07, 22), hex('#ffd24a'), { rx: Math.PI / 2 }),
			part(this.sphere(0.34, 8), hex('#c9a2ff'), { y: 0.42 }), part(this.cyl(0.5, 0.55, 4, 0), hex('#ffd24a'), { x: 0.62, rz: -Math.PI / 2 }),
			part(this.box(0.3, 0.012, 0.06), hex('#ffffff'), { x: -0.1, y: 0.46, z: -0.2, ry: 0.6 })];
		return this.done('awareBomb', parts, this.gloss);
	}
	/** The Cyber box: a bright chest that holds an emergency power. */
	crate(bodyHex = '#1fb6e8', gemHex = '#ffffff', name = 'crate', glossy = false): Mesh {
		// the rare box is black all over, lid included, with only fine gold lines; the ordinary one wears broad gold bands
		const body = hex(bodyHex), gold = hex('#ffd24a'), band = glossy ? 0.07 : 0.2, parts = [
			part(this.box(0.95, 0.7, 0.95), body, { y: 0.1 }), part(this.box(1.03, 0.14, 1.03), glossy ? body : gold, { y: 0.48 }),
			part(this.box(1.06, 0.035, 1.06), gold, { y: 0.4 }), part(this.box(1.06, 0.035, 1.06), gold, { y: 0.56 }),
			part(this.box(band, 0.74, 1), gold, { y: 0.1 }), part(this.box(1, 0.74, band), gold, { y: 0.1 }),
			...(glossy ? [part(this.box(0.5, 0.012, 0.07), hex('#ffffff'), { x: 0.22, y: 0.556, z: -0.26, ry: 0.6 }), part(this.box(0.22, 0.012, 0.05), hex('#ffffff'), { x: 0.3, y: 0.556, z: -0.02, ry: 0.6 })] : []),   // the shine of a polished lid
			part(this.sphere(0.42, 8), hex(gemHex), { y: 0.7, sy: 0.7 }), part(this.cyl(0.5, 0.5, 4, 0), glossy ? hex(gemHex) : hex('#fff3a0'), { y: 1.08 })];
		return this.done(name, parts, glossy ? this.gloss : this.bright);
	}
	// ------------------------------------------------------------------ the kinds of the later stages: each stage has its own four
	/** A cone lying flat that points away from the middle at angle `a` (spikes, teeth, crystals). */
	private spike(d: number, h: number, sides: number, color: Color3, r: number, a: number, y = 0): Mesh { return part(this.cyl(d, h, sides, 0), color, { x: Math.cos(a) * r, y, z: Math.sin(a) * r, rz: -Math.PI / 2, ry: -a }); }
	/** Spam: a small envelope that shouts. */
	spam(): Mesh {
		const parts = [part(this.box(0.62, 0.16, 0.9), hex('#f6e6b8'), { y: 0.05 }), part(this.box(0.5, 0.02, 0.05), hex('#c9a45c'), { x: 0.1, y: 0.14, z: -0.2, ry: 0.75 }), part(this.box(0.5, 0.02, 0.05), hex('#c9a45c'), { x: 0.1, y: 0.14, z: 0.2, ry: -0.75 }),
			part(this.box(0.24, 0.03, 0.1), hex('#e0263a'), { x: 0.14, y: 0.16 }), part(this.sphere(0.11, 5), hex('#e0263a'), { x: -0.08, y: 0.15 })];
		for (const z of [-0.24, 0.24]) parts.push(part(this.sphere(0.13, 5), hex('#1a0d0d'), { x: -0.27, y: 0.13, z }));
		return this.done('spam', parts, this.bright);
	}
	/** Phishing bait: a tempting little fish with the hook showing. */
	bait(): Mesh {
		const parts = [part(this.sphere(0.6, 10), hex('#ff9a3c'), { y: 0.06, sx: 1.45, sy: 0.62 }), part(this.cyl(0.5, 0.42, 3, 0), hex('#ffd08a'), { x: 0.62, y: 0.06, rz: Math.PI / 2 }),
			part(this.box(0.3, 0.03, 0.5), hex('#ffd08a'), { x: 0.05, y: 0.2 }), part(this.torus(0.36, 0.07, 14), hex('#e8eef8'), { x: -0.62, y: 0.12 }), part(this.box(0.3, 0.05, 0.05), hex('#e8eef8'), { x: -0.5, y: 0.3, rz: 0.6 })];
		for (const z of [-0.17, 0.17]) { parts.push(part(this.sphere(0.14, 5), hex('#ffffff'), { x: -0.32, y: 0.2, z })); parts.push(part(this.sphere(0.07, 5), hex('#101820'), { x: -0.37, y: 0.22, z })); }
		return this.done('bait', parts, this.bright);
	}
	/** A password cracker: a skeleton key with teeth and a stare. */
	cracker(): Mesh {
		const steel = hex('#9fb6ff'), parts = [part(this.torus(0.52, 0.14, 16), steel, { x: 0.3, y: 0.1 }), part(this.box(0.72, 0.13, 0.14), steel, { x: -0.24, y: 0.1 }),
			part(this.box(0.13, 0.13, 0.24), steel, { x: -0.52, y: 0.1, z: 0.16 }), part(this.box(0.13, 0.13, 0.18), steel, { x: -0.3, y: 0.1, z: 0.14 }), part(this.sphere(0.22, 6), hex('#ff3340'), { x: 0.3, y: 0.12, sy: 0.6 })];
		return this.done('cracker', parts, this.bright);
	}
	/** A fake app: a friendly icon wearing a mask. */
	fakeapp(): Mesh {
		const parts = [part(this.box(0.78, 0.2, 0.78), hex('#35c46a'), { y: 0.04 }), part(this.box(0.54, 0.03, 0.54), hex('#e9fff0'), { y: 0.15 }), part(this.box(0.2, 0.05, 0.8), hex('#12161f'), { x: -0.14, y: 0.17 }),
			part(this.sphere(0.2, 6), hex('#ff3340'), { x: 0.3, y: 0.16, z: 0.3, sy: 0.5 })];
		for (const z of [-0.18, 0.18]) parts.push(part(this.sphere(0.1, 5), hex('#ffffff'), { x: -0.14, y: 0.2, z }));
		return this.done('fakeapp', parts, this.bright);
	}
	/** Adware: windows that keep popping up. */
	adware(): Mesh {
		const parts = [part(this.box(0.52, 0.05, 0.74), hex('#9aa6c2'), { x: 0.16, y: -0.06, z: 0.2 }), part(this.box(0.66, 0.08, 0.96), hex('#ffffff'), { y: 0.03 }), part(this.box(0.15, 0.09, 0.96), hex('#2f7df0'), { x: 0.26, y: 0.035 }),
			part(this.box(0.11, 0.1, 0.11), hex('#ff3340'), { x: 0.26, y: 0.04, z: 0.38 }), part(this.box(0.26, 0.03, 0.1), hex('#ffb300'), { x: -0.02, y: 0.08 }), part(this.sphere(0.11, 5), hex('#ffb300'), { x: -0.25, y: 0.08 })];
		return this.done('adware', parts, this.bright);
	}
	/** Scareware: a false warning sign. */
	scare(): Mesh {
		const parts = [part(this.cyl(1.16, 0.08, 3), hex('#e0263a'), { y: 0 }), part(this.cyl(0.98, 0.14, 3), hex('#ffd23a'), { y: 0.04 }), part(this.box(0.28, 0.03, 0.1), hex('#12161f'), { x: 0.05, y: 0.12 }), part(this.sphere(0.11, 5), hex('#12161f'), { x: -0.2, y: 0.12 })];
		return this.done('scare', parts, this.bright);
	}
	/** A backdoor: a door left ajar, with eyes in the gap. */
	door(): Mesh {
		const parts = [part(this.box(0.92, 0.1, 0.74), hex('#2a1d52'), { y: -0.02 }), part(this.box(0.8, 0.14, 0.5), hex('#8a5fe0'), { y: 0.05, z: -0.08 }), part(this.box(0.3, 0.03, 0.34), hex('#b79cff'), { x: 0.2, y: 0.13, z: -0.08 }),
			part(this.box(0.3, 0.03, 0.34), hex('#b79cff'), { x: -0.2, y: 0.13, z: -0.08 }), part(this.sphere(0.12, 6), hex('#ffd24a'), { y: 0.14, z: 0.12 })];
		for (const x of [-0.14, 0.14]) parts.push(part(this.sphere(0.1, 5), hex('#ff3340'), { x, y: 0.06, z: 0.28 }));
		return this.done('door', parts, this.bright);
	}
	/** A booby-trapped file: a page with fangs. */
	doc(): Mesh {
		const parts = [part(this.box(0.74, 0.07, 0.56), hex('#f4f7ff'), { y: 0.03 }), part(this.box(0.2, 0.08, 0.2), hex('#9aa6c2'), { x: 0.28, y: 0.035, z: 0.19, ry: 0.78 })];
		for (let i = 0; i < 3; i++) parts.push(part(this.box(0.04, 0.02, 0.36), hex('#7a86a8'), { x: 0.16 - i * 0.15, y: 0.075, z: -0.04 }));
		for (let i = 0; i < 3; i++) parts.push(part(this.cyl(0.14, 0.22, 4, 0), hex('#ffffff'), { x: -0.44, y: 0.02, z: -0.16 + i * 0.16, rz: Math.PI / 2 }));
		for (const z of [-0.14, 0.14]) parts.push(part(this.sphere(0.1, 5), hex('#e0263a'), { x: -0.24, y: 0.09, z }));
		return this.done('doc', parts, this.bright);
	}
	/** A rogue network: a router with horns sending its waves. */
	wifi(): Mesh {
		const pink = hex('#ff7a8a'), parts = [part(this.box(0.36, 0.18, 0.7), hex('#2a3148'), { x: 0.34, y: 0.04 }), part(this.cyl(0.06, 0.4, 5), hex('#c8d2e4'), { x: 0.36, y: 0.3, z: -0.26 }), part(this.cyl(0.06, 0.4, 5), hex('#c8d2e4'), { x: 0.36, y: 0.3, z: 0.26 }),
			part(this.box(0.07, 0.05, 0.9), pink, { x: 0.02, y: 0.02 }), part(this.box(0.07, 0.05, 0.62), pink, { x: -0.2, y: 0.02 }), part(this.box(0.07, 0.05, 0.34), pink, { x: -0.42, y: 0.02 }), part(this.sphere(0.13, 5), pink, { x: -0.62, y: 0.02 })];
		for (const z of [-0.12, 0.12]) parts.push(part(this.sphere(0.09, 5), hex('#ff3340'), { x: 0.2, y: 0.12, z }));
		return this.done('wifi', parts, this.bright);
	}
	/** A polymorphic virus: a cluster of crystals of many colours. */
	poly(): Mesh {
		const colors = ['#5af0ff', '#ff6bf0', '#ffe04d'], parts = [part(this.sphere(0.4, 8), hex('#ffffff'), { y: 0.06 })];
		for (let i = 0; i < 6; i++) parts.push(this.spike(0.3, 0.5, 4, hex(colors[i % 3]), 0.36, i * Math.PI / 3, 0.06));
		parts.push(part(this.cyl(0.26, 0.4, 4, 0), hex('#5af0ff'), { y: 0.36 }));
		return this.done('poly', parts, this.bright);
	}
	/** A dropper: a small drone carrying a package it should not. */
	dropper(): Mesh {
		const parts = [part(this.box(0.46, 0.16, 0.46), hex('#8f9bb5'), { x: 0.1, y: 0.06 }), part(this.box(0.3, 0.26, 0.3), hex('#e0263a'), { x: -0.4, y: 0 }), part(this.box(0.32, 0.05, 0.08), hex('#12161f'), { x: -0.4, y: 0.14 }),
			part(this.sphere(0.14, 5), hex('#ffe04d'), { x: -0.1, y: 0.16 })];
		for (const x of [-0.24, 0.44]) for (const z of [-0.4, 0.4]) { parts.push(part(this.cyl(0.34, 0.03, 10), hex('#e6ecf8'), { x, y: 0.16, z })); parts.push(part(this.box(0.06, 0.05, 0.4), hex('#5d6880'), { x, y: 0.1, z: z * 0.5 })); }
		return this.done('dropper', parts, this.bright);
	}
	/** A data thief: a magnet pulling a file to itself. */
	thief(): Mesh {
		const red = hex('#e0263a'), tip = hex('#e6ecf8'), parts = [part(this.box(0.2, 0.18, 0.76), red, { x: 0.36, y: 0.05 }), part(this.box(0.26, 0.04, 0.2), hex('#ffffff'), { x: -0.74, y: 0.05 }), part(this.sphere(0.1, 5), hex('#5af0ff'), { x: -0.52, y: 0.07 })];
		for (const z of [-0.28, 0.28]) { parts.push(part(this.box(0.5, 0.18, 0.2), red, { x: 0.06, y: 0.05, z })); parts.push(part(this.box(0.18, 0.19, 0.21), tip, { x: -0.27, y: 0.05, z })); }
		return this.done('thief', parts, this.bright);
	}
	/** A fake account: someone behind a mask, with horns. */
	fakeacct(): Mesh {
		const parts = [part(this.sphere(0.86, 10), hex('#8a5fe0'), { x: 0.14, y: -0.04, sy: 0.34 }), part(this.sphere(0.46, 8), hex('#c59cff'), { x: -0.12, y: 0.2 }), part(this.box(0.12, 0.08, 0.46), hex('#12161f'), { x: -0.26, y: 0.27 })];
		for (const z of [-0.12, 0.12]) { parts.push(part(this.sphere(0.08, 5), hex('#ffffff'), { x: -0.3, y: 0.3, z })); parts.push(part(this.cyl(0.14, 0.24, 4, 0), hex('#ff3340'), { x: -0.06, y: 0.48, z: z * 1.5 })); }
		return this.done('fakeacct', parts, this.bright);
	}
	// ------------------------------------------------------------------ the rare one of each stage, all golden
	/** An identity thief: a golden mask. */
	idthief(): Mesh {
		const gold = hex('#ffd65a'), dark = hex('#2a1a02'), parts = [part(this.sphere(0.84, 10), gold, { y: 0.1, sx: 1.1, sy: 0.4 }), part(this.box(0.08, 0.06, 0.4), dark, { x: -0.3, y: 0.2 }), part(this.box(0.1, 0.1, 0.9), hex('#e0263a'), { x: 0.1, y: 0.02 })];
		for (const z of [-0.2, 0.2]) parts.push(part(this.sphere(0.24, 6), dark, { x: 0, y: 0.24, z, sy: 0.4, sx: 0.7 }));
		return this.done('idthief', parts, this.bright);
	}
	/** A zero-day: a golden ring of spikes around a core of light. */
	zeroday(): Mesh {
		const gold = hex('#ffd65a'), parts = [part(this.torus(0.78, 0.2, 20), gold, { y: 0.1 }), part(this.sphere(0.26, 8), hex('#ffffff'), { y: 0.12 })];
		for (let i = 0; i < 8; i++) parts.push(this.spike(0.2, 0.3, 4, hex('#ff9a1f'), 0.52, i * Math.PI / 4, 0.1));
		return this.done('zeroday', parts, this.bright);
	}
	/** A wiper: a golden saw that erases whatever it touches. */
	wiper(): Mesh {
		const gold = hex('#ffcf5e'), parts = [part(this.cyl(0.8, 0.1, 18), gold, { y: 0.08 }), part(this.sphere(0.3, 8), hex('#2a1a02'), { y: 0.1, sy: 0.5 }), part(this.sphere(0.13, 5), hex('#ff3340'), { y: 0.18 })];
		for (let i = 0; i < 10; i++) parts.push(this.spike(0.24, 0.24, 3, hex('#fff1b0'), 0.45, i * Math.PI / 5, 0.08));
		return this.done('wiper', parts, this.bright);
	}
	/** A cryptominer: a golden chip with a pickaxe. */
	miner(): Mesh {
		const gold = hex('#f2b830'), dark = hex('#8a6410'), parts = [part(this.box(0.62, 0.16, 0.62), gold, { y: 0.05 }), part(this.box(0.36, 0.03, 0.36), dark, { y: 0.14 }),
			part(this.box(0.56, 0.05, 0.07), hex('#7a4a1c'), { y: 0.2, ry: 0.78 }), part(this.box(0.08, 0.07, 0.42), hex('#e6ecf8'), { x: -0.19, y: 0.21, z: -0.19, ry: 0.78 })];
		for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) { parts.push(part(this.box(0.08, 0.05, 0.16), dark, { x: i * 0.2, y: 0, z: s * 0.38 })); parts.push(part(this.box(0.16, 0.05, 0.08), dark, { x: s * 0.38, y: 0, z: i * 0.2 })); }
		return this.done('miner', parts, this.bright);
	}
	/** Armoured: a ransom padlock. Its shackle is the plate that opens and closes. */
	lock(bodyHex = '#5f7fb8', baseHex = '#3d5488', name = 'lock'): Mesh {
		const steel = hex(bodyHex), parts = [
			part(this.box(0.9, 0.5, 1.1), steel, { y: 0.1 }),
			part(this.box(0.94, 0.12, 1.14), hex(baseHex), { y: -0.12 }),
			part(this.sphere(0.24, 6), hex('#0a1020'), { x: -0.05, y: 0.33, sy: 0.4 }),
			part(this.box(0.3, 0.05, 0.1), hex('#0a1020'), { x: 0.14, y: 0.34 })];
		return this.done(name, parts, this.bright);
	}
	shackle(): Mesh {
		return this.done('shackle', [part(this.torus(0.74, 0.16, 16), hex('#ffb347'), { rz: Math.PI / 3 })], this.bright);
	}
	/** Rare: a golden skull, the old sign of dangerous software. */
	skull(): Mesh {
		const gold = hex('#ffd65a'), dark = hex('#2a1a02'), parts = [
			part(this.sphere(0.7, 10), gold, { y: 0.14, sx: 1, sy: 0.9, sz: 0.95 }),
			part(this.box(0.3, 0.26, 0.42), gold, { x: -0.22, y: -0.08 }),
			part(this.box(0.06, 0.1, 0.34), dark, { x: -0.38, y: -0.1 })];
		for (const s of [-1, 1]) parts.push(part(this.sphere(0.2, 6), dark, { x: -0.25, y: 0.24, z: s * 0.15 }));
		parts.push(part(this.sphere(0.08, 5), dark, { x: -0.36, y: 0.1 }));
		return this.done('skull', parts, this.bright);
	}
	/** An egg pod of the great worm. */
	pod(): Mesh {
		const parts = [part(this.sphere(1.1, 10), hex('#9ad23a'), { y: 0.2, sy: 0.8 })];
		for (let i = 0; i < 6; i++) parts.push(part(this.cyl(0.14, 0.4, 5, 0), hex('#e8ff8a'), { x: Math.cos(i * 1.05) * 0.5, y: 0.5, z: Math.sin(i * 1.05) * 0.5, rz: -Math.cos(i * 1.05) * 0.7, rx: Math.sin(i * 1.05) * 0.7 }));
		return this.done('pod', parts, this.bright);
	}

	/** A flat outline (points in the logo's units) raised into a solid, centred on its own middle. `quads` are the convex
	 *  pieces of its top face. Used for the two brackets of the logo, with their true shape. */
	prism(points: number[][], quads: number[][], height: number, name: string): Mesh {
		const mx = points.reduce((n, p) => n + p[0], 0) / points.length, my = points.reduce((n, p) => n + p[1], 0) / points.length;
		const P = points.map(p => [-(p[1] - my) * LOGO.unit, (p[0] - mx) * LOGO.unit]);    // up the screen is +x, to the right is +z
		const pos: number[] = [], idx: number[] = [];
		const quad = (list: number[][]) => { const n = pos.length / 3; for (const v of list) pos.push(v[0], v[1], v[2]); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); };
		for (const q of quads) quad(q.map(i => [P[i][0], height, P[i][1]]));
		for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; quad([[a[0], height, a[1]], [b[0], height, b[1]], [b[0], 0, b[1]], [a[0], 0, a[1]]]); }
		const normals: number[] = [];
		VertexData.ComputeNormals(pos, idx, normals);
		const data = new VertexData();
		data.positions = pos; data.indices = idx; data.normals = normals; data.colors = Array.from({ length: pos.length / 3 * 4 }, () => 1);
		const m = new Mesh(name, this.scene);
		data.applyToMesh(m);
		m.isPickable = false;
		return m;
	}

	// ------------------------------------------------------------------ bosses: a root with a few moving pieces
	boss(id: string): { root: TransformNode; moving: Record<string, TransformNode | Mesh>; tail: Mesh[] } {
		const root = new TransformNode('boss:' + id, this.scene), moving: Record<string, TransformNode | Mesh> = {}, tail: Mesh[] = [];
		const add = (name: string, parts: Mesh[], parent: TransformNode = root) => { const m = this.done(name, parts, this.bright); m.parent = parent; return m; };
		const eyes = (x: number, y: number, gap: number, size: number, color = '#ff2b3d') => {
			const out: Mesh[] = [];
			for (const s of [-1, 1]) { out.push(part(this.sphere(size, 8), hex('#fff4d6'), { x, y, z: s * gap })); out.push(part(this.sphere(size * 0.55, 6), hex(color), { x: x - size * 0.3, y: y + size * 0.12, z: s * gap })); out.push(part(this.box(size * 0.25, size * 0.2, size * 1.3), hex('#1a0d0d'), { x, y: y + size * 0.55, z: s * gap, rx: s * 0.5 })); }
			return out;
		};
		switch (id) {
			case 'angler': {                                                       // a hacked message with a mouth: the envelope's flap is its jaw
				const paper = hex('#f3e3b6'), edge = hex('#c9a45c'), teeth: Mesh[] = [];
				add('envelope', [part(this.box(2.3, 0.5, 3.3), paper), part(this.box(2.34, 0.12, 3.34), edge, { y: -0.2 }), part(this.box(0.9, 0.06, 2.9), hex('#b02a3a'), { x: -0.75, y: 0.27 }), ...eyes(0.25, 0.42, 0.75, 0.46)]);
				for (let i = 0; i < 7; i++) teeth.push(part(this.cyl(0.24, 0.42, 4, 0), hex('#ffffff'), { x: -1.02, y: 0.1, z: -1.2 + i * 0.4, rz: -Math.PI / 2 }));
				add('teeth', teeth);
				const jaw = new TransformNode('jaw', this.scene); jaw.parent = root; jaw.position.set(-0.1, 0.3, 0);
				const flap = add('flap', [part(this.cyl(3.4, 0.1, 3), edge, { x: -0.55, ry: Math.PI / 6, sx: 0.62 }), part(this.sphere(0.5, 8), hex('#d12a19'), { x: -0.5, y: 0.1, sy: 0.4 })], jaw);
				flap.position.y = 0.02;
				moving.jaw = jaw;
				// the hook of the phisher, swinging on its line
				const line = new TransformNode('line', this.scene); line.parent = root; line.position.set(-1.2, 0.2, 0);
				add('hook', [part(this.cyl(0.05, 1.4, 4), hex('#dfe8f2'), { x: -0.7, rz: Math.PI / 2 }), part(this.torus(0.5, 0.09, 12), hex('#dfe8f2'), { x: -1.5, rx: Math.PI / 2 })], line);
				moving.line = line;
				break;
			}
			case 'warden': {                                                       // the ransom lock: closed it shrugs off shots, open it can be hurt
				const gold = hex('#e9b541');
				add('lockBody', [part(this.box(2.3, 1, 2.9), gold), part(this.box(2.36, 0.2, 2.96), hex('#9c6f14'), { y: -0.45 }), part(this.sphere(0.7, 10), hex('#1a0d0d'), { x: -0.2, y: 0.5, sy: 0.3 }), part(this.box(0.7, 0.08, 0.26), hex('#1a0d0d'), { x: 0.35, y: 0.52 }), ...eyes(-0.75, 0.62, 0.8, 0.4)]);
				const bar = new TransformNode('bar', this.scene); bar.parent = root; bar.position.set(0.3, 0.3, 0);
				add('shackleBig', [part(this.torus(2.1, 0.36, 22), hex('#dfe7f5'), { rz: Math.PI / 3 })], bar);
				moving.bar = bar;
				const chain = new TransformNode('chain', this.scene); chain.parent = root;
				add('chains', [0, 1, 2, 3, 4, 5].map(i => part(this.torus(0.5, 0.11, 10), hex('#8fa3c8'), { x: Math.cos(i * 1.047) * 2.2, y: 0.1, z: Math.sin(i * 1.047) * 2.2, rx: i % 2 ? 0 : Math.PI / 2 })), chain);
				moving.chain = chain;
				break;
			}
			case 'factory': {                                                      // the great worm: a head with jaws and a long body that follows it
				const a = hex('#59c832'), b = hex('#2f7d1c');
				add('wormHead', [part(this.sphere(2, 12), a, { sy: 0.8 }), ...eyes(-0.6, 0.55, 0.5, 0.42, '#ffb300'),
					part(this.cyl(0.4, 1, 5, 0), hex('#f3ffe0'), { x: -1, y: -0.1, z: -0.45, rz: Math.PI / 2, ry: 0.5 }), part(this.cyl(0.4, 1, 5, 0), hex('#f3ffe0'), { x: -1, y: -0.1, z: 0.45, rz: Math.PI / 2, ry: -0.5 })]);
				for (let i = 0; i < 8; i++) {
					const d = 1.75 - i * 0.15, seg = add('wormSeg' + i, [part(this.sphere(d, 10), i % 2 ? a : b, { sy: 0.78 }), part(this.cyl(0.24, 0.5, 4, 0), hex('#f3ffe0'), { y: d * 0.36 })]);
					seg.parent = null;
					tail.push(seg);
				}
				break;
			}
			case 'core': {                                                         // the mother virus: a huge spiked ball with an angry face
				const body = hex('#9a35e8'), tip = hex('#ff8cf0'), parts = [part(this.sphere(2.3, 14), body)];
				for (let i = 0; i < 12; i++) {
					const yaw = i * Math.PI / 6, pitch = i % 3 === 0 ? 0.7 : 0;
					const dx = Math.cos(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.sin(yaw) * Math.cos(pitch);
					parts.push(part(this.cyl(0.24, 0.8, 6), body, { x: dx * 1.45, y: dy * 1.45, z: dz * 1.45, rz: Math.PI / 2 - pitch, ry: -yaw }));
					parts.push(part(this.sphere(0.46, 6), tip, { x: dx * 1.92, y: dy * 1.92, z: dz * 1.92 }));
				}
				const ball = new TransformNode('ball', this.scene); ball.parent = root;
				add('virusBody', parts, ball);
				moving.ball = ball;
				add('virusFace', [...eyes(-0.55, 1, 0.5, 0.44, '#00ffd0'), part(this.box(0.2, 0.1, 0.9), hex('#1a0d0d'), { x: -0.95, y: 0.72 })]);
				const ring = new TransformNode('ring', this.scene); ring.parent = root;
				add('virusRing', [part(this.torus(4.3, 0.14, 30), hex('#00ffd0')), part(this.torus(3.7, 0.1, 30), hex('#ff8cf0'), { rx: 0.5 })], ring);
				moving.ring = ring;
				break;
			}
			case 'omcode': {                                                       // the code boss: a dark craft that carries the company's wordmark; its two brackets fly out as a shield
				const navy = hex(logo.navy), red = hex(logo.red);
				add('codeHull', [part(this.sphere(3.8, 14), navy, { sy: 0.42 }), part(this.sphere(3, 12), hex('#2a2580'), { y: 0.3, sy: 0.3 }),
					part(this.box(1.62, 0.1, 5.76), red, { x: -0.35, y: 0.78 }), part(this.box(1.5, 0.24, 5.64), navy, { x: -0.35, y: 0.9 }),
					part(this.cyl(0.5, 0.5, 6, 0), red, { x: 1.5, y: 0.55, z: -0.9, rz: -0.5 }), part(this.cyl(0.5, 0.5, 6, 0), red, { x: 1.5, y: 0.55, z: 0.9, rz: -0.5 }),
					...eyes(0.95, 1.02, 0.62, 0.52)]);
				const ring = new TransformNode('ring', this.scene); ring.parent = root;
				add('codeRing', [part(this.torus(4.3, 0.14, 30), red), ...[0, 1, 2, 3, 4, 5].map(i => part(this.box(0.3, 0.3, 0.3), hex('#ffffff'), { x: Math.cos(i * 1.047) * 2.15, z: Math.sin(i * 1.047) * 2.15, ry: i }))], ring);
				moving.ring = ring;
				const two = new StandardMaterial('bracketMat', this.scene);
				two.backFaceCulling = false; two.twoSidedLighting = true; two.specularColor = C(0.1, 0.1, 0.1); two.emissiveColor = C(0.62, 0.62, 0.66);
				for (const [key, points, quads] of [['open', logo.open, [[0, 1, 2, 3], [0, 3, 4, 5]]], ['close', logo.close, [[0, 1, 2, 5], [2, 3, 4, 5]]]] as [string, number[][], number[][]][]) {
					const node = new TransformNode(key, this.scene); node.parent = root;
					const m = this.prism(points, quads, 0.18, key + 'Bracket'); m.material = two; m.parent = node;
					const mx = points.reduce((n, p) => n + p[0], 0) / points.length;
					node.metadata = { homeZ: (mx - LOGO.cx) * LOGO.unit };
					node.position.set(-0.35, 1.04, node.metadata.homeZ);
					moving[key] = node;
				}
				break;
			}
			default: {                                                             // the Trojan horse: a wooden horse on wheels that hides attackers
				const wood = hex('#a56a30'), pale = hex('#c98a48'), darkWood = hex('#5a3514'), gold = hex('#f7c648');
				const body: Mesh[] = [
					part(this.box(3.5, 0.24, 2.3), darkWood, { y: -0.45 }),                                                   // the cart
					part(this.box(2.5, 1.15, 1.35), wood, { x: 0.25, y: 0.95 }), part(this.box(2.54, 0.12, 1.39), pale, { x: 0.25, y: 1.5 }),
					part(this.box(0.16, 1.19, 1.39), gold, { x: -0.45, y: 0.95 }), part(this.box(0.16, 1.19, 1.39), gold, { x: 1.0, y: 0.95 }),
					part(this.box(0.85, 1.7, 0.78), wood, { x: -1.2, y: 1.9, rz: 0.5 }),                                    // neck
					part(this.box(1.55, 0.72, 0.8), pale, { x: -2.2, y: 2.62, rz: -0.32 }), part(this.box(0.4, 0.5, 0.7), darkWood, { x: -2.86, y: 2.34, rz: -0.32 }),   // head and muzzle
					part(this.box(0.9, 0.12, 0.84), gold, { x: -2.0, y: 2.98, rz: -0.32 }),                                // bridle
					part(this.box(0.16, 1.2, 0.2), gold, { x: 1.62, y: 1.25, rz: -0.75 }), part(this.sphere(0.36, 6), gold, { x: 2.05, y: 0.75 })];   // tail
				for (const z of [-1, 1]) {
					body.push(part(this.box(0.34, 0.95, 0.34), darkWood, { x: -0.6, y: 0.05, z: z * 0.5 }), part(this.box(0.34, 0.95, 0.34), darkWood, { x: 1.1, y: 0.05, z: z * 0.5 }));
					body.push(part(this.cyl(0.34, 0.6, 4, 0), wood, { x: -1.62, y: 3.2, z: z * 0.26 }));                   // ears
					body.push(part(this.sphere(0.34, 8), hex('#ff2b3d'), { x: -2.25, y: 2.86, z: z * 0.43 }), part(this.sphere(0.16, 6), hex('#ffe9a8'), { x: -2.34, y: 2.94, z: z * 0.5 }));   // burning eyes
				}
				for (let i = 0; i < 5; i++) body.push(part(this.cyl(0.36, 0.55, 4, 0), gold, { x: -0.78 - i * 0.2, y: 1.75 + i * 0.36, rz: -0.9 }));   // mane
				add('horse', body);
				const wheels = new TransformNode('wheels', this.scene); wheels.parent = root;
				add('wheelSet', [-1, 1].flatMap(z => [-1, 1].flatMap(k => [part(this.cyl(1, 0.22, 14), gold, { x: k * 1.15, y: -0.5, z: z * 1.22, rx: Math.PI / 2 }), part(this.cyl(0.36, 0.26, 8), darkWood, { x: k * 1.15, y: -0.5, z: z * 1.22, rx: Math.PI / 2 })])), wheels);
				const hatch = new TransformNode('hatch', this.scene); hatch.parent = root; hatch.position.set(-0.2, 1.58, 0);
				add('hatchDoor', [part(this.box(1.1, 0.1, 1.2), gold, { x: 0.55 }), part(this.box(0.9, 0.12, 1), darkWood, { x: 0.55, y: -0.04 })], hatch);
				moving.hatch = hatch;
			}
		}
		return { root, moving, tail };
	}

	// ------------------------------------------------------------------ Omani scenery
	palm(): Mesh {
		const parts = [part(this.cyl(0.26, 2.6, 6, 0.18), hex('#8a6b3f'), { y: 1.3, rz: 0.08 })];
		for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; parts.push(part(this.box(1.5, 0.05, 0.36), i % 2 ? hex('#2f9a3c') : hex('#54c456'), { x: Math.cos(a) * 0.7 + 0.2, y: 2.55, z: Math.sin(a) * 0.7, ry: -a, rz: -0.38 })); parts.push(part(this.box(0.7, 0.05, 0.26), hex('#237a30'), { x: Math.cos(a) * 1.55 + 0.2, y: 2.18, z: Math.sin(a) * 1.55, ry: -a, rz: -0.95 })); }
		parts.push(part(this.sphere(0.36, 5), hex('#c98a1e'), { x: 0.2, y: 2.4 }));
		return this.done('palm', parts, this.land);
	}
	/** A round fort tower with battlements and the flag of Oman. */
	tower(): Mesh {
		const stone = hex('#d6b983'), dark = hex('#a98a58'), parts = [part(this.cyl(2.7, 3.6, 14, 2.3), stone, { y: 1.8 }), part(this.cyl(2.6, 0.3, 14), hex('#e9d3a2'), { y: 3.5 }), part(this.cyl(1.75, 0.06, 14), hex('#8f7044'), { y: 3.68 })];
		for (let i = 0; i < 8; i++) parts.push(part(this.box(0.36, 0.5, 0.5), stone, { x: Math.cos(i * 0.785) * 1.02, y: 3.85, z: Math.sin(i * 0.785) * 1.02, ry: -i * 0.785 }));
		parts.push(part(this.cyl(0.07, 1.9, 4), hex('#f0f0f0'), { y: 4.6 }));
		parts.push(part(this.box(0.04, 0.5, 0.24), hex('#d12a19'), { y: 5.25, z: 0.14 }));                     // red band at the hoist
		parts.push(part(this.box(0.04, 0.17, 0.6), hex('#ffffff'), { y: 5.42, z: 0.56 }), part(this.box(0.04, 0.17, 0.6), hex('#d12a19'), { y: 5.25, z: 0.56 }), part(this.box(0.04, 0.17, 0.6), hex('#1f8a3a'), { y: 5.08, z: 0.56 }));
		return this.done('tower', parts, this.land);
	}
	wall(): Mesh {
		const stone = hex('#cfb07a'), parts = [part(this.box(0.8, 1.9, 5), stone, { y: 0.95 }), part(this.box(0.4, 0.05, 5), hex('#9a7b4c'), { y: 1.92 })];
		for (let i = 0; i < 6; i++) parts.push(part(this.box(0.74, 0.4, 0.45), stone, { y: 2.1, z: -2.2 + i * 0.88 }));
		return this.done('wall', parts, this.land);
	}
	keep(): Mesh {
		const stone = hex('#dcc08c'), dark = hex('#7a5a30'), parts = [part(this.box(3.6, 2.8, 3.6), stone, { y: 1.4 }), part(this.box(3.1, 0.06, 3.1), hex('#a8875a'), { y: 2.82 }), part(this.box(1.2, 0.5, 1.2), hex('#efe0b8'), { y: 3.05 }), part(this.box(0.1, 1.3, 0.9), dark, { x: -1.82, y: 0.65 })];
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(this.box(0.9, 0.7, 0.9), stone, { x: sx * 1.4, y: 3.1, z: sz * 1.4 }));
		for (let i = 0; i < 3; i++) parts.push(part(this.box(0.06, 0.4, 0.3), dark, { x: -1.82, y: 2, z: -1 + i }));
		return this.done('keep', parts, this.land);
	}
	house(): Mesh {
		const white = hex('#fbf4e2'), parts = [part(this.box(2, 1.5, 2.4), white, { y: 0.75 }), part(this.box(2.1, 0.16, 2.5), hex('#e2c99a'), { y: 1.55 }), part(this.box(1.6, 0.05, 2), hex('#c9a878'), { y: 1.64 }),
			part(this.sphere(1.1, 8), white, { x: 0.2, y: 1.6, sy: 0.7 }), part(this.box(0.06, 0.9, 0.5), hex('#6b4a25'), { x: -1.02, y: 0.45 }), part(this.box(0.06, 0.36, 0.36), hex('#3e6b8a'), { x: -1.02, y: 1, z: 0.75 })];
		return this.done('house', parts, this.land);
	}
	rock(): Mesh {
		return this.done('rock', [part(this.sphere(1.6, 5), hex('#9a8c74'), { y: 0.35, sy: 0.6 }), part(this.sphere(1, 4), hex('#c2b499'), { x: 0.6, y: 0.3, z: 0.4, sy: 0.7 }), part(this.sphere(0.7, 4), hex('#84775f'), { x: -0.6, y: 0.2, z: -0.5, sy: 0.6 })], this.land);
	}
	bush(): Mesh {
		return this.done('bush', [part(this.sphere(1, 5), hex('#4f9a3f'), { y: 0.3, sy: 0.6 }), part(this.sphere(0.7, 5), hex('#6bb552'), { x: 0.35, y: 0.35, z: 0.3, sy: 0.6 })], this.land);
	}
	dune(): Mesh {
		return this.done('dune', [part(this.sphere(2, 8), hex('#f6b060'), { sx: 3, sy: 0.5, sz: 1.5 }), part(this.sphere(2, 8), hex('#d07a36'), { x: 1.2, z: 0.6, sx: 2.2, sy: 0.38, sz: 1.2 })], this.land);
	}
	tent(): Mesh {
		const parts = [part(this.cyl(2.6, 1.7, 6, 0), hex('#efe3c8'), { y: 0.85 }), part(this.cyl(2.7, 0.2, 6), hex('#a3402e'), { y: 0.12 }), part(this.box(0.1, 0.9, 0.5), hex('#3a2616'), { x: -1.05, y: 0.45 })];
		return this.done('tent', parts, this.land);
	}
	mountain(): Mesh {
		return this.done('mountain', [part(this.cyl(6, 5.2, 6, 0), hex('#8c7f70'), { y: 2.6 }), part(this.cyl(3.4, 3.2, 5, 0), hex('#a89a86'), { x: 1.6, y: 1.6, z: 1.2 }), part(this.cyl(1.5, 1.1, 6, 0), hex('#e9dfcf'), { y: 4.7 })], this.land);
	}
	/** A pool of wadi water (flat, bright). */
	pool(): Mesh {
		return this.done('pool', [part(this.cyl(5, 0.06, 20), hex('#2fc4c9'), { y: 0.04, sx: 1.3 }), part(this.cyl(3.4, 0.07, 18), hex('#7fe6e4'), { y: 0.05, x: 0.3, sx: 1.2 })], this.land);
	}
}
