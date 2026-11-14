// Shapes built in code: the small enemies of the war of ideas (rumours, fake pictures, harmful trends, data collectors,
// masked strangers, troll swarms), their six bosses, the shapes of enemy fire, and the pieces of Omani scenery (palms,
// forts, houses, rocks, dunes, tents, mountains). Each model is a handful of simple solids, coloured per vertex and
// merged into one mesh, so one material and cheap instances are enough.
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
/** Outlines for prism(), as [x, z] points (x up the screen, z across). A star or burst: `n` points reaching `outer`,
 *  with the dips between them at `inner`; the first point looks up the screen unless it is turned. */
function star(n: number, outer: number, inner: number, turn = 0): number[][] {
	return Array.from({ length: n * 2 }, (_, i) => { const a = turn + i * Math.PI / n, r = i % 2 ? inner : outer; return [Math.cos(a) * r, Math.sin(a) * r]; });
}
/** An oval of `n` points, or the part of it between two angles (0 looks up the screen, a quarter turn looks right). */
function oval(n: number, rx: number, rz: number, from = 0, to = Math.PI * 2): number[][] {
	const whole = to - from >= Math.PI * 2 - 1e-6;
	return Array.from({ length: whole ? n : n + 1 }, (_, i) => { const a = from + (to - from) * i / n; return [Math.cos(a) * rx, Math.sin(a) * rz]; });
}

export class Models {
	/** Lit, vertex-coloured: for enemies and bosses (a little self-lit so they stay readable over any ground). */
	readonly bright: StandardMaterial;
	/** Lit, vertex-coloured: for scenery, which takes the light and colour of the stage. */
	readonly land: StandardMaterial;
	/** Lit, vertex-coloured and polished: for the rare black box. */
	readonly gloss: StandardMaterial;
	/** Unlit, vertex-coloured: for enemy fire, whose colours must be the same over sand, sea and night. */
	readonly flat: StandardMaterial;
	constructor(readonly scene: Scene) {
		const mk = (name: string, glow: number) => { const m = new StandardMaterial(name, scene); m.specularColor = C(0.08, 0.08, 0.08); m.emissiveColor = C(glow, glow, glow); return m; };
		this.bright = mk('brightMat', 0.26);
		this.land = mk('landMat', 0.02);
		this.gloss = mk('glossMat', 0.03); this.gloss.specularColor = C(0.55, 0.55, 0.65); this.gloss.specularPower = 180;
		this.flat = mk('flatMat', 1); this.flat.disableLighting = true; this.flat.specularColor = C(0, 0, 0);
	}
	private sphere(d: number, seg = 8) { return CreateSphere('s', { diameter: d, segments: seg }, this.scene); }
	private box(w: number, h: number, d: number) { return CreateBox('b', { width: w, height: h, depth: d }, this.scene); }
	private cyl(d: number, h: number, tess = 8, top = d) { return CreateCylinder('c', { diameterBottom: d, diameterTop: top, height: h, tessellation: tess }, this.scene); }
	private torus(d: number, t: number, tess = 18) { return CreateTorus('t', { diameter: d, thickness: t, tessellation: tess }, this.scene); }
	private done(name: string, parts: Mesh[], mat: StandardMaterial) { const m = merge(name, parts); m.material = mat; return m; }
	/** A flat outline ([x, z] points: x up the screen, z across) raised into a solid `height` thick, centred on y = 0.
	 *  The whole outline must be visible from its middle (or from the point given): stars, bursts, ovals, shields. */
	prism(points: number[][], height: number, cx?: number, cz?: number): Mesh {
		const mx = cx ?? points.reduce((n, p) => n + p[0], 0) / points.length, mz = cz ?? points.reduce((n, p) => n + p[1], 0) / points.length, top = height / 2;
		const pos: number[] = [], nor: number[] = [], idx: number[] = [];
		const tri = (a: number[], b: number[], c: number[], n: number[]) => {   // wound the way the builders wind theirs, whatever order the outline came in
			const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
			const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2], k = pos.length / 3;
			for (const p of facing > 0 ? [a, c, b] : [a, b, c]) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); }
			idx.push(k, k + 1, k + 2);
		};
		points.forEach((p, i) => {
			const q = points[(i + 1) % points.length];
			tri([mx, top, mz], [p[0], top, p[1]], [q[0], top, q[1]], [0, 1, 0]);
			tri([mx, -top, mz], [p[0], -top, p[1]], [q[0], -top, q[1]], [0, -1, 0]);
			let nx = q[1] - p[1], nz = p[0] - q[0];
			const len = Math.hypot(nx, nz) || 1, out = nx * ((p[0] + q[0]) / 2 - mx) + nz * ((p[1] + q[1]) / 2 - mz) < 0 ? -1 : 1;
			nx *= out / len; nz *= out / len;
			tri([p[0], top, p[1]], [q[0], top, q[1]], [q[0], -top, q[1]], [nx, 0, nz]); tri([p[0], top, p[1]], [q[0], -top, q[1]], [p[0], -top, p[1]], [nx, 0, nz]);
		});
		const data = new VertexData();
		data.positions = pos; data.indices = idx; data.normals = nor; data.uvs = Array.from({ length: pos.length / 3 * 2 }, () => 0);
		const m = new Mesh('p', this.scene);
		data.applyToMesh(m);
		return m;
	}
	/** A straight stroke lying flat from one point to another (x up the screen, z across): signs, cracks, lightning. */
	private bar(x0: number, z0: number, x1: number, z1: number, wide: number, high: number, color: Color3, y = 0): Mesh {
		return part(this.box(Math.hypot(x1 - x0, z1 - z0) + wide * 0.5, high, wide), color, { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2, ry: -Math.atan2(z1 - z0, x1 - x0) });
	}
	/** Strokes through a list of [x, z] points, one after another. */
	private path(points: number[][], wide: number, high: number, color: Color3, y = 0): Mesh[] {
		return points.slice(1).map((p, i) => this.bar(points[i][0], points[i][1], p[0], p[1], wide, high, color, y));
	}
	/** A round rod between two points in space ([x, y, z]), `d` thick at its start and `top` thick at its end: strings, legs, cables. */
	private rod(a: number[], b: number[], d: number, color: Color3, sides = 5, top = d): Mesh {
		const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 0.001;
		return part(this.cyl(d, len, sides, top), color, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2, rx: Math.acos(dy / len), ry: Math.atan2(dx, dz) });
	}
	/** Two eyes that look down the screen at the player. */
	private eyes(x: number, y: number, gap: number, size: number, iris = '#101820', white = '#ffffff'): Mesh[] {
		return [-gap, gap].flatMap(z => [part(this.sphere(size, 6), hex(white), { x, y, z }), part(this.sphere(size * 0.55, 5), hex(iris), { x: x - size * 0.3, y: y + size * 0.14, z })]);
	}
	/** A cone lying flat that points away from the middle at angle `a` (spikes, teeth, crystals). */
	private spike(d: number, h: number, sides: number, color: Color3, r: number, a: number, y = 0): Mesh { return part(this.cyl(d, h, sides, 0), color, { x: Math.cos(a) * r, y, z: Math.sin(a) * r, rz: -Math.PI / 2, ry: -a }); }

	// ------------------------------------------------------------------ boxes and the bomb of Total Awareness
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

	// ------------------------------------------------------------------ stage 1, the flood of rumours
	/** The rumour: a megaphone shouting a jagged cloud of talk. */
	rumor(): Mesh {
		const horn = hex('#ff7a3c'), ink = hex('#3a1408'), parts = [
			part(this.cyl(0.2, 0.5, 12, 0.64), horn, { x: 0.24, y: 0.14, rz: Math.PI / 2 }), part(this.torus(0.64, 0.09, 14), hex('#fff1d6'), { x: -0.01, y: 0.14, rz: Math.PI / 2 }),
			part(this.cyl(0.5, 0.04, 12), ink, { x: 0, y: 0.14, rz: Math.PI / 2 }), part(this.box(0.16, 0.24, 0.26), hex('#8a3410'), { x: 0.55, y: 0.14 }),
			part(this.prism(star(8, 0.34, 0.2, 0.2), 0.1), hex('#ffe04d'), { x: -0.36, y: 0 }), part(this.prism(star(8, 0.4, 0.26, 0.2), 0.06), hex('#fff7c2'), { x: -0.36, y: -0.06 })];
		for (const z of [-0.13, 0, 0.13]) parts.push(part(this.sphere(0.1, 5), ink, { x: -0.38, y: 0.06, z }));
		parts.push(...this.eyes(0.22, 0.36, 0.12, 0.17));
		return this.done('rumor', parts, this.bright);
	}
	/** Clickbait: a fat red exclamation mark dangling from a hook. */
	clickbait(): Mesh {
		const red = hex('#ff3340'), white = hex('#ffffff'), steel = hex('#dfe8f2'), parts = [
			part(this.prism([[0.34, -0.27], [0.34, 0.27], [-0.28, 0.16], [-0.28, -0.16]], 0.06), white, { y: -0.02 }), part(this.cyl(0.44, 0.06, 12), white, { x: -0.5, y: -0.02 }),
			part(this.cyl(0.2, 0.5, 10, 0.4), red, { x: 0, y: 0.12, rz: -Math.PI / 2, sx: 0.7 }), part(this.sphere(0.4, 10), red, { x: 0.25, y: 0.12, sy: 0.7 }),
			part(this.sphere(0.32, 10), red, { x: -0.5, y: 0.1, sy: 0.7 }),
			part(this.torus(0.26, 0.06, 12), steel, { x: 0.44, y: 0.2 }), part(this.box(0.14, 0.06, 0.06), steel, { x: 0.6, y: 0.2 }), part(this.cyl(0.12, 0.16, 4, 0), steel, { x: 0.34, y: 0.2, z: 0.16, rz: -Math.PI / 2, ry: 0.6 })];
		parts.push(...this.eyes(0.12, 0.28, 0.1, 0.13));
		return this.done('clickbait', parts, this.bright);
	}
	/** A faked picture: a photo torn in two, and the two halves are not of the same thing. */
	fakepic(): Mesh {
		const frame = hex('#f7f9ff'), parts = [
			part(this.prism([[-0.36, -0.48], [0.36, -0.48], [0.36, -0.06], [0.2, 0.02], [0.07, -0.09], [-0.07, 0.02], [-0.21, -0.09], [-0.36, -0.03]], 0.1, 0, -0.28), frame, { y: 0.02 }),
			part(this.box(0.54, 0.04, 0.26), hex('#4db8ff'), { y: 0.07, z: -0.3 }), part(this.box(0.2, 0.05, 0.26), hex('#3fbf5a'), { x: -0.17, y: 0.07, z: -0.3 }), part(this.sphere(0.16, 6), hex('#ffd23a'), { x: 0.13, y: 0.09, z: -0.33, sy: 0.4 }),
			part(this.prism([[-0.36, 0.05], [-0.21, -0.01], [-0.07, 0.1], [0.07, -0.01], [0.2, 0.1], [0.36, 0.02], [0.36, 0.48], [-0.36, 0.48]], 0.1, 0, 0.3), frame, { x: 0.13, y: 0.02, z: 0.06 }),
			part(this.box(0.54, 0.04, 0.26), hex('#5a2fd0'), { x: 0.13, y: 0.07, z: 0.38 }), part(this.box(0.2, 0.05, 0.26), hex('#ff4f8a'), { x: 0.3, y: 0.07, z: 0.38 }), part(this.sphere(0.16, 6), hex('#e8f0ff'), { x: 0, y: 0.09, z: 0.42, sy: 0.4 }),
			part(this.sphere(0.17, 6), hex('#ffffff'), { x: -0.02, y: 0.12, z: -0.24 }), part(this.sphere(0.09, 5), hex('#101820'), { x: -0.07, y: 0.15, z: -0.24 }),
			part(this.sphere(0.17, 6), hex('#ffffff'), { x: 0.15, y: 0.12, z: 0.3 }), part(this.sphere(0.09, 5), hex('#e0263a'), { x: 0.1, y: 0.15, z: 0.3 })];
		return this.done('fakepic', parts, this.bright);
	}
	/** A chain message: three links, and an arrow that says "pass it on". */
	chain(): Mesh {
		const a = hex('#3ddc97'), b = hex('#1f9d6b'), gold = hex('#ffe04d'), parts = [
			part(this.torus(0.48, 0.14, 14), a, { x: -0.16, y: 0.02, z: -0.37 }), part(this.torus(0.48, 0.14, 14), a, { x: -0.16, y: 0.02, z: 0.37 }), part(this.torus(0.48, 0.14, 14), b, { x: -0.16, y: 0.08, rz: Math.PI / 2 }),
			part(this.box(0.13, 0.08, 0.44), gold, { x: 0.4, y: 0.12, z: -0.12 }), part(this.prism([[0, 0.24], [-0.2, 0], [0.2, 0]], 0.08), gold, { x: 0.4, y: 0.12, z: 0.1 })];
		return this.done('chain', parts, this.bright);
	}
	/** Rare: a deepfake. A golden mask, one side smiling and the other breaking into squares. */
	deepfake(): Mesh {
		const gold = hex('#ffd65a'), dark = hex('#2a1a02'), RX = 0.56, RZ = 0.44, half: number[][] = [];
		for (let i = 0; i <= 10; i++) half.push([Math.cos(i * Math.PI / 10) * RX, -Math.sin(i * Math.PI / 10) * RZ]);
		const parts = [part(this.prism(half, 0.2, 0, -0.16), gold, { y: 0.08 }),
			...this.path([[0.18, -0.32], [0.27, -0.21], [0.18, -0.1]], 0.07, 0.05, dark, 0.2), ...this.path([[-0.18, -0.28], [-0.3, -0.16], [-0.34, -0.03]], 0.07, 0.05, dark, 0.2),
			part(this.sphere(0.14, 6), hex('#ff8a8a'), { x: -0.02, y: 0.18, z: -0.28, sy: 0.3 })];
		const tint = ['#ffd65a', '#5af0ff', '#ffd65a', '#ff4fd8', '#ffd65a', '#5af0ff'], shift = [0.06, -0.03, 0.12, 0, 0.09, -0.02];
		for (let i = 0; i < 6; i++) { const x = RX - (i + 0.5) * RX / 3, w = RZ * Math.sqrt(Math.max(0.2, 1 - (x / RX) ** 2)); parts.push(part(this.box(RX / 3 - 0.02, 0.2, w), hex(tint[i]), { x, y: 0.08, z: w / 2 + 0.03 + shift[i] })); }
		parts.push(part(this.box(0.14, 0.06, 0.16), hex('#e0263a'), { x: 0.2, y: 0.2, z: 0.24 }), part(this.box(0.07, 0.06, 0.1), dark, { x: -0.2, y: 0.2, z: 0.12 }), part(this.box(0.07, 0.06, 0.1), dark, { x: -0.28, y: 0.2, z: 0.24 }), part(this.box(0.07, 0.06, 0.1), dark, { x: -0.2, y: 0.2, z: 0.35 }));
		return this.done('deepfake', parts, this.bright);
	}

	// ------------------------------------------------------------------ stage 2, our identity on the screen
	/** A harmful trend: a chart whose arrow climbs fast, with fire at its tail. */
	trend(): Mesh {
		const hot = hex('#ff4d6d'), parts = [
			part(this.box(0.9, 0.1, 1), hex('#1b1436'), { x: 0.04, y: 0 }), part(this.box(0.96, 0.05, 1.06), hex('#ff9ab0'), { x: 0.04, y: -0.06 }),
			...this.path([[-0.28, -0.36], [0.02, -0.14], [-0.14, 0.06], [0.24, 0.3]], 0.11, 0.08, hot, 0.08), part(this.prism([[0.42, 0.44], [0.13, 0.42], [0.33, 0.15]], 0.08), hot, { y: 0.08 })];
		for (const [x, z, k] of [[-0.42, -0.3, 1], [-0.3, -0.5, 0.8], [-0.5, -0.52, 0.65]]) { parts.push(part(this.cyl(0.26 * k, 0.5 * k, 6, 0), hex('#ff8a1f'), { x, y: 0.05 + 0.25 * k, z })); parts.push(part(this.cyl(0.14 * k, 0.3 * k, 5, 0), hex('#ffe04d'), { x: x - 0.06, y: 0.05 + 0.16 * k, z })); }
		return this.done('trend', parts, this.bright);
	}
	/** A whirl of clips: small screens going round and down a hole. */
	vortex(): Mesh {
		const tint = ['#5af0ff', '#ff6bf0', '#ffe04d', '#9a8bff'], parts = [part(this.sphere(0.34, 8), hex('#140a2e'), { y: 0.04, sy: 0.5 }), part(this.sphere(0.14, 6), hex('#ffffff'), { y: 0.12 })];
		for (let i = 0; i < 9; i++) {
			const a = i * 0.86, r = 0.2 + i * 0.043, k = 0.42 + i * 0.065, x = Math.cos(a) * r, z = Math.sin(a) * r, y = 0.02 + i * 0.012;
			parts.push(part(this.box(0.28 * k, 0.07, 0.4 * k), hex('#1b1f3a'), { x, y, z, ry: -a }), part(this.box(0.2 * k, 0.08, 0.32 * k), hex(tint[i % 4]), { x, y: y + 0.01, z, ry: -a }));
			if (i > 2) parts.push(part(this.sphere(0.1 * k, 5), hex('#ffffff'), { x, y: y + 0.05, z, sy: 0.5 }));
		}
		return this.done('vortex', parts, this.bright);
	}
	/** The mocker: a jester's head with a two-horned cap and bells. */
	mocker(): Mesh {
		const skin = hex('#f6efff'), purple = hex('#8a3df0'), yellow = hex('#ffd23a'), dark = hex('#1a0d2e'), parts = [
			part(this.prism(star(8, 0.54, 0.34), 0.08), yellow, { y: -0.08 }), part(this.prism(star(8, 0.4, 0.26, Math.PI / 8), 0.08), purple, { y: -0.02 }),
			part(this.sphere(0.56, 10), skin, { x: -0.04, y: 0.2 }),
			part(this.sphere(0.34, 8), dark, { x: -0.25, y: 0.27, sx: 0.4, sy: 0.5 }), part(this.box(0.05, 0.06, 0.22), hex('#ffffff'), { x: -0.31, y: 0.3 }), part(this.sphere(0.11, 6), hex('#ff3340'), { x: -0.27, y: 0.4 }),
			...this.eyes(-0.17, 0.44, 0.11, 0.14)];
		for (const s of [-1, 1]) { parts.push(this.rod([0.02, 0.36, s * 0.1], [0.42, 0.5, s * 0.46], 0.32, s < 0 ? purple : yellow, 6, 0.07), part(this.sphere(0.17, 6), hex('#fff1a0'), { x: 0.44, y: 0.52, z: s * 0.5 })); }
		return this.done('mocker', parts, this.bright);
	}
	/** Noise: a loudspeaker that throws static in every direction. */
	noise(): Mesh {
		const parts = [part(this.box(0.6, 0.3, 0.6), hex('#2a2f45'), { y: 0.02 }), part(this.box(0.64, 0.06, 0.64), hex('#8f9bb5'), { y: -0.14 }),
			part(this.cyl(0.42, 0.04, 14), hex('#12141f'), { y: 0.18 }), part(this.torus(0.46, 0.08, 16), hex('#c8d2e4'), { y: 0.19 }), part(this.sphere(0.2, 8), hex('#ff8a1f'), { y: 0.2 })];
		for (let i = 0; i < 8; i++) {
			const a = i * Math.PI / 4 + 0.39, c = Math.cos(a), s = Math.sin(a), k = i % 2 ? 0.09 : -0.09, color = hex(i % 2 ? '#fff27a' : '#ffffff');
			parts.push(...this.path([[c * 0.36, s * 0.36], [c * 0.47 - s * k, s * 0.47 + c * k], [c * 0.55 + s * k, s * 0.55 - c * k], [c * 0.64, s * 0.64]], 0.06, 0.06, color, 0.08));
		}
		return this.done('noise', parts, this.bright);
	}
	/** Rare: a fake star. It glitters and wears dark glasses, but it is cracked. */
	fakestar(): Mesh {
		const gold = hex('#ffd65a'), dark = hex('#2a1a02'), parts = [
			part(this.prism(star(5, 0.62, 0.27), 0.2), gold, { y: 0.06 }), part(this.prism(star(5, 0.4, 0.18), 0.05), hex('#fff1b0'), { y: 0.18 }),
			part(this.box(0.15, 0.07, 0.2), dark, { x: 0.05, y: 0.22, z: -0.13 }), part(this.box(0.15, 0.07, 0.2), dark, { x: 0.05, y: 0.22, z: 0.13 }), part(this.box(0.05, 0.06, 0.5), dark, { x: 0.1, y: 0.22 }),
			...this.path([[-0.12, -0.1], [-0.18, 0], [-0.12, 0.1]], 0.05, 0.05, dark, 0.2), ...this.path([[0.58, 0.02], [0.42, -0.05], [0.34, 0.06], [0.2, -0.02]], 0.045, 0.05, dark, 0.2),
			part(this.prism(star(4, 0.15, 0.05), 0.04), hex('#ffffff'), { x: -0.4, y: 0.28, z: -0.42 }), part(this.prism(star(4, 0.12, 0.04), 0.04), hex('#ffffff'), { x: 0.24, y: 0.28, z: 0.5 })];
		return this.done('fakestar', parts, this.bright);
	}

	// ------------------------------------------------------------------ stage 3, your digital footprint
	/** The tracker: a map pin with one eye that follows where you go. */
	tracker(): Mesh {
		const red = hex('#ff4757'), parts = [
			part(this.torus(0.52, 0.05, 16), hex('#ffc2c8'), { x: -0.4, y: -0.1 }), part(this.torus(0.3, 0.05, 14), hex('#ffffff'), { x: -0.4, y: -0.1 }),
			part(this.sphere(0.68, 12), red, { x: 0.28, y: 0.1, sy: 0.62 }), part(this.cyl(0.6, 0.58, 12, 0), red, { x: -0.17, y: 0.1, rz: Math.PI / 2, sx: 0.62 }),
			part(this.sphere(0.42, 10), hex('#ffffff'), { x: 0.26, y: 0.22, sy: 0.7 }), part(this.sphere(0.25, 8), hex('#22c8ff'), { x: 0.2, y: 0.31, sy: 0.7 }), part(this.sphere(0.13, 6), hex('#06121e'), { x: 0.16, y: 0.36, sy: 0.7 })];
		return this.done('tracker', parts, this.bright);
	}
	/** A nosy quiz: a box with a big question mark and two hands that grab. */
	quizbot(): Mesh {
		const body = hex('#7c5cff'), pale = hex('#cdc2ff'), ink = hex('#fff27a'), parts = [
			part(this.box(0.6, 0.4, 0.6), body, { y: 0.04 }), part(this.box(0.64, 0.08, 0.64), pale, { y: 0.26 }),
			...this.path([[0.07, -0.14], [0.19, -0.08], [0.21, 0.05], [0.11, 0.13], [0, 0.04], [-0.07, 0.02]], 0.08, 0.05, ink, 0.32), part(this.sphere(0.11, 6), ink, { x: -0.2, y: 0.32, z: 0.02, sy: 0.5 }),
			...this.eyes(-0.31, 0.1, 0.14, 0.16)];
		for (const s of [-1, 1]) {
			parts.push(this.rod([0, 0.08, s * 0.3], [-0.3, 0.28, s * 0.46], 0.11, pale), part(this.sphere(0.2, 6), pale, { x: -0.34, y: 0.3, z: s * 0.46 }));
			for (let j = -1; j <= 1; j++) parts.push(this.rod([-0.36, 0.3, s * 0.46], [-0.52, 0.28, s * 0.4 + j * 0.1], 0.07, pale, 4));
		}
		return this.done('quizbot', parts, this.bright);
	}
	/** The picture snatcher: a small camera drone with a flash. */
	snapper(): Mesh {
		const shell = hex('#eef2fa'), dark = hex('#2a3148'), parts = [
			part(this.box(0.4, 0.2, 0.5), shell, { y: 0.08 }), part(this.box(0.1, 0.22, 0.52), hex('#ff5a7a'), { x: 0.16, y: 0.08 }),
			part(this.cyl(0.32, 0.12, 14), dark, { x: -0.04, y: 0.22 }), part(this.torus(0.32, 0.05, 14), hex('#9aa6c2'), { x: -0.04, y: 0.28 }), part(this.sphere(0.22, 8), hex('#3fd0ff'), { x: -0.04, y: 0.27, sy: 0.5 }),
			part(this.sphere(0.08, 5), hex('#ffffff'), { x: -0.08, y: 0.32, z: -0.04 }), part(this.prism(star(4, 0.2, 0.07), 0.05), hex('#fff27a'), { x: -0.3, y: 0.22, z: 0.3 })];
		for (const u of [-1, 1]) for (const s of [-1, 1]) {
			const x = u * 0.36, z = s * 0.44;
			parts.push(this.bar(0, 0, x, z, 0.07, 0.06, dark, 0.06), part(this.cyl(0.3, 0.03, 12), hex('#cfe6ff'), { x, y: 0.16, z }), part(this.torus(0.3, 0.035, 12), hex('#5d6880'), { x, y: 0.16, z }), part(this.sphere(0.09, 5), dark, { x, y: 0.17, z }));
		}
		return this.done('snapper', parts, this.bright);
	}
	/** The footprint collector: a magnet pulling small footprints to itself. */
	footprint(): Mesh {
		const body = hex('#e83e8c'), tip = hex('#f4f7ff'), glow = hex('#7df9ff'), parts = [part(this.box(0.2, 0.2, 0.72), body, { x: 0.5, y: 0.06 }), ...this.eyes(0.46, 0.2, 0.14, 0.14)];
		for (const s of [-1, 1]) parts.push(part(this.box(0.4, 0.2, 0.2), body, { x: 0.24, y: 0.06, z: s * 0.26 }), part(this.box(0.16, 0.21, 0.21), tip, { x: -0.02, y: 0.06, z: s * 0.26 }));
		const foot = (x: number, z: number, k: number) => {
			parts.push(part(this.sphere(0.22 * k, 6), glow, { x, y: 0, z, sy: 0.3, sz: 0.62 }), part(this.sphere(0.14 * k, 6), glow, { x: x - 0.13 * k, y: 0, z, sy: 0.3 }));
			for (let j = 0; j < 4; j++) parts.push(part(this.sphere(0.06 * k, 4), glow, { x: x + 0.15 * k - Math.abs(j - 1.5) * 0.025, y: 0, z: z + (j - 1.5) * 0.055 * k, sy: 0.4 }));
		};
		foot(-0.26, -0.1, 1); foot(-0.52, 0.12, 0.85);
		return this.done('footprint', parts, this.bright);
	}
	/** Rare: the data broker. A golden briefcase with eyes, and the cards it took are falling out of it. */
	broker(): Mesh {
		const gold = hex('#f2b830'), dark = hex('#7a5210'), parts = [
			part(this.box(0.56, 0.36, 0.8), gold, { y: 0.06, z: -0.1 }), part(this.box(0.6, 0.07, 0.84), dark, { y: 0.08, z: -0.1 }),
			part(this.box(0.08, 0.12, 0.12), hex('#fff1b0'), { x: -0.29, y: 0.1, z: -0.3 }), part(this.box(0.08, 0.12, 0.12), hex('#fff1b0'), { x: -0.29, y: 0.1, z: 0.1 }),
			part(this.torus(0.32, 0.07, 12), dark, { y: 0.24, z: -0.1, rz: Math.PI / 2 }), ...this.eyes(-0.16, 0.27, 0.15, 0.2).map(m => { m.position.z -= 0.1; m.computeWorldMatrix(true); return m; })];
		for (const [x, y, z, turn, tint] of [[-0.12, -0.02, 0.46, 0.4, '#5af0ff'], [0.14, -0.08, 0.56, -0.3, '#ff7ab8'], [-0.4, -0.1, 0.34, 1, '#ffffff']] as [number, number, number, number, string][])
			parts.push(part(this.box(0.2, 0.025, 0.3), hex('#f7f9ff'), { x, y, z, ry: turn }), part(this.box(0.06, 0.03, 0.3), hex(tint === '#ffffff' ? '#9aa6c2' : tint), { x, y: y + 0.004, z, ry: turn }));
		return this.done('broker', parts, this.bright);
	}

	// ------------------------------------------------------------------ stage 4, strangers behind masks
	/** A masked stranger: a hood, and inside it a blank mask that smiles. */
	stranger(): Mesh {
		const hood = hex('#33296a'), rim = hex('#7a5fe0'), ink = hex('#1a1230'), T = 0.64, nx = -Math.sin(T), ny = Math.cos(T), vx = Math.cos(T), vy = Math.sin(T), cx = -0.15, cy = 0.3;
		const on = (v: number, lift = 0.1) => ({ x: cx + nx * lift + vx * v, y: cy + ny * lift + vy * v });   // a place on the face of the mask
		const parts = [part(this.sphere(0.88, 12), hood, { x: 0.06, y: 0.06, sy: 0.8 }), part(this.cyl(0.56, 0.5, 8, 0), hood, { x: 0.44, y: 0.26, rz: -1.1 }),
			part(this.torus(0.62, 0.11, 16), rim, { x: cx, y: cy, rz: T }), part(this.sphere(0.52, 10), hex('#f6f2e8'), { x: cx, y: cy, rz: T, sy: 0.36 })];
		for (const s of [-1, 1]) parts.push(part(this.sphere(0.11, 6), ink, { ...on(0.07), z: s * 0.11, rz: T, sy: 0.5 }));
		for (let i = -2; i <= 2; i++) parts.push(part(this.sphere(0.065, 5), ink, { ...on(-0.14 + 0.02 * i * i, 0.09 - 0.004 * i * i), z: i * 0.065 }));
		return this.done('stranger', parts, this.bright);
	}
	/** The bully: an angry speech bubble, all spikes. */
	bully(): Mesh {
		const red = hex('#ff3b30'), dark = hex('#3a0806'), parts = [
			part(this.prism(star(11, 0.6, 0.42), 0.24), red, { y: 0.06 }), part(this.prism([[-0.28, -0.3], [-0.66, -0.52], [-0.44, -0.1]], 0.24, -0.4, -0.28), red, { y: 0.06 }), part(this.prism(star(11, 0.46, 0.34), 0.04), hex('#ff7a6e'), { y: 0.19 }),
			this.bar(0.24, -0.32, 0.08, -0.07, 0.09, 0.06, dark, 0.24), this.bar(0.24, 0.32, 0.08, 0.07, 0.09, 0.06, dark, 0.24),
			...this.path([[-0.2, -0.22], [-0.12, -0.11], [-0.2, 0], [-0.12, 0.11], [-0.2, 0.22]], 0.065, 0.05, dark, 0.22), ...this.eyes(0.03, 0.22, 0.17, 0.17, '#3a0806')];
		return this.done('bully', parts, this.bright);
	}
	/** An impersonating account: a "verified" badge that is cracked and has grown horns. */
	impostor(): Mesh {
		const blue = hex('#1d9bf0'), white = hex('#ffffff'), dark = hex('#0a1a2e'), parts = [
			part(this.prism(star(10, 0.56, 0.47), 0.2), blue, { y: 0.06 }), part(this.prism(star(10, 0.6, 0.5), 0.06), hex('#bfe4ff'), { y: -0.04 }),
			this.bar(0.02, -0.26, -0.15, -0.09, 0.12, 0.07, white, 0.19), this.bar(-0.15, -0.09, 0.2, 0.24, 0.12, 0.07, white, 0.19),
			...this.path([[0.54, -0.14], [0.36, -0.04], [0.28, -0.18], [0.12, -0.08]], 0.05, 0.05, dark, 0.2), ...this.path([[-0.5, 0.22], [-0.34, 0.14], [-0.28, 0.28]], 0.05, 0.05, dark, 0.2)];
		for (const s of [-1, 1]) parts.push(this.rod([0.34, 0.1, s * 0.3], [0.62, 0.34, s * 0.42], 0.2, hex('#ff3340'), 6, 0.02));
		return this.done('impostor', parts, this.bright);
	}
	/** A gift that is a trap: a wrapped box whose lid opens on a row of teeth. */
	lure(): Mesh {
		const pink = hex('#ff4f9a'), ribbon = hex('#ffe04d'), tooth = hex('#ffffff'), T = -0.42, hx = 0.33, hy = 0.24;
		const lid = (lx: number, ly: number) => ({ x: hx + lx * Math.cos(T) - ly * Math.sin(T), y: hy + lx * Math.sin(T) + ly * Math.cos(T), rz: T });   // a place on the lid, which is hinged at the back
		const parts = [part(this.box(0.62, 0.34, 0.68), pink, { y: 0.02 }), part(this.box(0.64, 0.36, 0.14), ribbon, { y: 0.02 }), part(this.box(0.54, 0.04, 0.6), hex('#2a0a1e'), { y: 0.19 }),
			part(this.box(0.7, 0.12, 0.76), hex('#ff7ab8'), lid(-0.33, 0.06)), part(this.box(0.72, 0.13, 0.15), ribbon, lid(-0.33, 0.06)), part(this.box(0.15, 0.13, 0.78), ribbon, lid(-0.33, 0.06)),
			part(this.sphere(0.2, 6), ribbon, { ...lid(-0.33, 0.17), z: -0.11 }), part(this.sphere(0.2, 6), ribbon, { ...lid(-0.33, 0.17), z: 0.11 })];
		for (let i = 0; i < 5; i++) parts.push(part(this.cyl(0.13, 0.17, 4, 0), tooth, { x: -0.27, y: 0.27, z: -0.26 + i * 0.13 }));
		for (let i = 0; i < 4; i++) { const p = lid(-0.64, -0.02); parts.push(part(this.cyl(0.13, 0.17, 4, 0), tooth, { x: p.x, y: p.y - 0.05, z: -0.2 + i * 0.13, rz: Math.PI })); }
		for (const z of [-0.14, 0.14]) parts.push(part(this.sphere(0.13, 6), hex('#ff2b3d'), { x: -0.1, y: 0.27, z }));
		return this.done('lure', parts, this.bright);
	}
	/** Rare: the puppeteer. A golden hand-cross, its strings, and two small puppets that do as they are told. */
	puppeteer(): Mesh {
		const gold = hex('#ffd65a'), wood = hex('#b9811e'), string = hex('#fff7d6'), parts = [
			part(this.box(0.12, 0.08, 1), gold, { x: 0.22, y: 0.62 }), part(this.box(0.62, 0.08, 0.12), gold, { x: 0.14, y: 0.64 }), part(this.box(0.1, 0.08, 0.46), wood, { x: -0.1, y: 0.62 }),
			part(this.sphere(0.24, 8), hex('#ffffff'), { x: 0.2, y: 0.72, sy: 0.7 })];
		for (let j = -1; j <= 2; j++) parts.push(part(this.box(0.2, 0.07, 0.06), hex('#ffffff'), { x: 0.14, y: 0.74, z: j * 0.075 - 0.04, ry: 0.15 * j }));
		[[-1, '#ff5a7a', '#ffe0c2'], [1, '#3fa8ff', '#ffe0c2']].forEach(([side, coat, skin]) => {
			const s = side as number, z = s * 0.34, x = -0.34;
			parts.push(part(this.cyl(0.26, 0.26, 8, 0.08), hex(coat as string), { x, y: 0.06, z }), part(this.sphere(0.22, 8), hex(skin as string), { x, y: 0.27, z }), part(this.cyl(0.2, 0.14, 6, 0), hex(coat as string), { x, y: 0.42, z }),
				this.rod([x, 0.14, z - 0.08], [x - 0.1, 0.3, z - 0.24], 0.06, hex(coat as string), 4), this.rod([x, 0.14, z + 0.08], [x - 0.1, 0.02, z + 0.24], 0.06, hex(coat as string), 4),
				this.rod([0.22, 0.62, s * 0.46], [x, 0.48, z], 0.03, string, 4), this.rod([-0.1, 0.62, s * 0.2], [x - 0.1, 0.3, z - 0.24], 0.03, string, 4), this.rod([0.22, 0.62, s * 0.3], [x - 0.1, 0.04, z + 0.24], 0.03, string, 4));
			for (const e of [-0.05, 0.05]) parts.push(part(this.sphere(0.05, 4), hex('#101820'), { x: x - 0.09, y: 0.31, z: z + e }));
		});
		return this.done('puppeteer', parts, this.bright);
	}

	// ------------------------------------------------------------------ stage 5, the front of awareness
	/** An electronic fly: a wind-up insect, one of thousands that all say the same thing. */
	troll(): Mesh {
		const metal = hex('#7d8ea3'), dark = hex('#232a36'), lime = hex('#b6ff3c'), parts = [
			part(this.sphere(0.5, 8), hex('#4a586c'), { x: 0.22, y: 0.08, sx: 1.2, sy: 0.72 }), part(this.torus(0.47, 0.06, 12), lime, { x: 0.16, y: 0.08, rz: Math.PI / 2, sx: 0.72 }), part(this.torus(0.36, 0.06, 12), lime, { x: 0.36, y: 0.08, rz: Math.PI / 2, sx: 0.72 }),
			part(this.sphere(0.4, 8), metal, { x: -0.1, y: 0.1, sy: 0.8 }), part(this.sphere(0.3, 8), dark, { x: -0.36, y: 0.1 }),
			part(this.sphere(0.24, 8), hex('#ff2b3d'), { x: -0.42, y: 0.17, z: -0.13 }), part(this.sphere(0.24, 8), hex('#ff2b3d'), { x: -0.42, y: 0.17, z: 0.13 }),
			part(this.sphere(0.08, 4), hex('#ffffff'), { x: -0.48, y: 0.25, z: -0.15 }), part(this.sphere(0.08, 4), hex('#ffffff'), { x: -0.48, y: 0.25, z: 0.11 }),
			this.rod([0.14, 0.2, 0], [0.14, 0.44, 0], 0.07, hex('#ffd24a'), 5), part(this.torus(0.22, 0.06, 10), hex('#ffd24a'), { x: 0.14, y: 0.52, rx: Math.PI / 2 })];
		for (const s of [-1, 1]) {
			parts.push(part(this.prism(oval(10, 0.36, 0.17), 0.03), hex('#d6f3ff'), { x: 0.16, y: 0.3, z: s * 0.36, ry: s * -0.75 }), part(this.prism(oval(8, 0.22, 0.08), 0.03), hex('#9fd8f5'), { x: 0.18, y: 0.32, z: s * 0.38, ry: s * -0.75 }));
			for (let j = -1; j <= 1; j++) parts.push(this.rod([j * 0.16 - 0.04, 0.04, s * 0.14], [j * 0.24 - 0.06, -0.12, s * 0.46], 0.05, dark, 4));
			parts.push(this.rod([-0.44, 0.2, s * 0.05], [-0.62, 0.34, s * 0.16], 0.04, dark, 4));
		}
		return this.done('troll', parts, this.bright);
	}
	/** The echo chamber: one mouth, and rings around it that only say it again. */
	echo(): Mesh {
		const parts = [part(this.torus(1.12, 0.1, 22), hex('#5b3fd0'), { y: -0.04, sx: 0.66 }), part(this.torus(0.84, 0.11, 20), hex('#a44be8'), { y: 0.04, sx: 0.66 }), part(this.torus(0.54, 0.13, 18), hex('#ff5fa2'), { y: 0.12, sx: 0.66 }),
			part(this.cyl(0.46, 0.06, 14), hex('#2a0a1e'), { y: 0.1, sx: 0.6 }), part(this.box(0.07, 0.06, 0.3), hex('#ffffff'), { x: 0.07, y: 0.13 }), part(this.sphere(0.22, 6), hex('#ff3340'), { x: -0.06, y: 0.11, sy: 0.4, sx: 0.6 })];
		return this.done('echo', parts, this.bright);
	}
	/** The inciter: a megaphone that is on fire. */
	inciter(): Mesh {
		const coal = hex('#2b2430'), red = hex('#ff3b30'), fire = hex('#ff8a1f'), yellow = hex('#ffe04d'), parts = [
			part(this.cyl(0.22, 0.6, 12, 0.72), coal, { x: -0.02, y: 0.16, rz: Math.PI / 2 }), part(this.torus(0.72, 0.1, 14), red, { x: -0.32, y: 0.16, rz: Math.PI / 2 }),
			part(this.cyl(0.56, 0.04, 12), fire, { x: -0.31, y: 0.16, rz: Math.PI / 2 }), part(this.sphere(0.3, 8), yellow, { x: -0.3, y: 0.16, sx: 0.4 }),
			part(this.box(0.16, 0.24, 0.24), red, { x: 0.34, y: 0.14 }), ...this.eyes(-0.06, 0.42, 0.12, 0.16, '#ff3b30'),
			this.bar(0.06, -0.22, -0.02, -0.06, 0.07, 0.05, coal, 0.52), this.bar(0.06, 0.22, -0.02, 0.06, 0.07, 0.05, coal, 0.52)];
		for (const [x, z, k] of [[0.3, 0, 1], [0.48, -0.16, 0.8], [0.48, 0.16, 0.8], [0.64, 0, 0.6], [0.14, -0.2, 0.55], [0.14, 0.2, 0.55]]) {
			parts.push(this.rod([x, 0.24, z], [x + 0.16 * k, 0.24 + 0.5 * k, z], 0.26 * k, fire, 6, 0), this.rod([x - 0.03, 0.26, z], [x + 0.06 * k, 0.26 + 0.3 * k, z], 0.14 * k, yellow, 5, 0));
		}
		return this.done('inciter', parts, this.bright);
	}
	/** The swarm: one six-sided drone that carries four small ones. */
	swarm(): Mesh {
		const shell = hex('#26404a'), lime = hex('#b6ff3c'), parts = [
			part(this.cyl(0.66, 0.06, 6), lime, { y: -0.02 }), part(this.cyl(0.6, 0.2, 6), shell, { y: 0.08 }), part(this.cyl(0.36, 0.06, 6), hex('#0c1418'), { y: 0.19 }), part(this.sphere(0.22, 8), lime, { y: 0.2, sy: 0.6 })];
		for (let i = 0; i < 4; i++) {
			const a = Math.PI / 4 + i * Math.PI / 2, x = Math.cos(a) * 0.52, z = Math.sin(a) * 0.52;
			parts.push(this.bar(Math.cos(a) * 0.26, Math.sin(a) * 0.26, x, z, 0.08, 0.06, hex('#8fa3c8'), 0.06), part(this.cyl(0.34, 0.05, 6), lime, { x, y: 0.02, z }), part(this.cyl(0.3, 0.16, 6), shell, { x, y: 0.1, z }), part(this.sphere(0.12, 5), hex('#ff5a7a'), { x, y: 0.19, z }));
		}
		return this.done('swarm', parts, this.bright);
	}
	/** Rare: a storm seed. A dark crystal with lightning caught around it. */
	stormseed(): Mesh {
		const dark = hex('#4a2a9a'), pale = hex('#9a7bff'), gold = hex('#ffe04d'), parts = [
			part(this.cyl(0.58, 0.56, 6, 0), dark, { y: 0.42 }), part(this.cyl(0.02, 0.26, 6, 0.58), hex('#2e1766'), { y: 0.01 }), part(this.cyl(0.64, 0.05, 6), gold, { y: 0.14 }),
			part(this.sphere(0.16, 6), hex('#ffffff'), { x: -0.14, y: 0.34 })];
		for (let i = 0; i < 3; i++) parts.push(this.spike(0.22, 0.36, 4, pale, 0.36, 1 + i * 2.1, 0.02));
		for (const s of [-1, 1]) parts.push(this.rod([-0.3, 0.6, s * 0.3], [-0.2, 0.42, s * 0.44], 0.06, gold, 4), this.rod([-0.2, 0.42, s * 0.44], [-0.36, 0.3, s * 0.32], 0.06, gold, 4), this.rod([-0.36, 0.3, s * 0.32], [-0.26, 0.06, s * 0.5], 0.06, gold, 4),
			...this.path([[0.2, s * 0.46], [0.36, s * 0.34], [0.38, s * 0.56], [0.56, s * 0.42]], 0.06, 0.05, gold, -0.04));
		return this.done('stormseed', parts, this.bright);
	}

	// ------------------------------------------------------------------ the armoured one of every stage, and the relay tower of the hive
	/** Armoured: a fake account. A profile card with no face on it; its guard plate (below) opens and closes over it. */
	fakewall(bodyHex = '#5f7fb8', baseHex = '#3d5488', name = 'fakewall'): Mesh {
		const grey = hex('#8f9bb5'), base = hex(baseHex), parts = [
			part(this.box(0.96, 0.3, 1.12), hex(bodyHex), { y: 0.02 }), part(this.box(1.02, 0.1, 1.18), base, { y: -0.14 }), part(this.box(0.8, 0.04, 0.96), hex('#eef2fa'), { y: 0.17 }),
			part(this.cyl(0.32, 0.05, 14), grey, { x: 0.12, y: 0.2, z: -0.2 }), part(this.cyl(0.52, 0.05, 14), grey, { x: -0.2, y: 0.2, z: -0.2, sx: 0.55 }),
			part(this.box(0.08, 0.04, 0.34), base, { x: 0.2, y: 0.2, z: 0.22 }), part(this.box(0.08, 0.04, 0.34), grey, { x: 0.02, y: 0.2, z: 0.22 }), part(this.box(0.08, 0.04, 0.2), grey, { x: -0.16, y: 0.2, z: 0.15 })];
		return this.done(name, parts, this.bright);
	}
	/** The guard plate of a fake account: flat over the card while it blocks, lifted while the card can be hurt. */
	guardPlate(): Mesh {
		const outline = [[0.5, -0.52], [0.5, 0.52], [0.12, 0.54], [-0.28, 0.36], [-0.6, 0], [-0.28, -0.36], [0.12, -0.54]], dark = hex('#6b3a00'), parts = [
			part(this.prism(outline, 0.1, 0.1, 0), hex('#ffb347')), part(this.prism(outline.map(p => [p[0] * 0.74 + 0.02, p[1] * 0.74]), 0.05, 0.1, 0), hex('#ffe2ae'), { y: 0.06 }),
			this.bar(0.3, -0.2, -0.12, 0.2, 0.09, 0.05, dark, 0.09), this.bar(0.3, 0.2, -0.12, -0.2, 0.09, 0.05, dark, 0.09), part(this.sphere(0.2, 8), hex('#ffffff'), { x: 0.09, y: 0.09, sy: 0.6 })];
		return this.done('guardPlate', parts, this.bright);
	}
	/** A relay tower of the hive: a small mast that repeats what the hive sends. */
	relay(): Mesh {
		const steel = hex('#9fb0d0'), parts = [part(this.cyl(1.04, 0.12, 6), hex('#2a3148'), { y: -0.1 }), part(this.cyl(0.84, 0.05, 6), hex('#ffb020'), { y: -0.03 }),
			part(this.cyl(0.36, 0.07, 8), hex('#2a3148'), { y: 0.56 }), this.rod([0, 0.56, 0], [0, 0.98, 0], 0.08, steel), part(this.sphere(0.2, 8), hex('#ff4b5c'), { y: 1.02 }),
			part(this.torus(0.5, 0.05, 16), hex('#5af0ff'), { y: 0.78 }), part(this.torus(0.82, 0.045, 20), hex('#5af0ff'), { y: 0.9 }),
			part(this.sphere(0.34, 8), hex('#eef2fa'), { x: -0.26, y: 0.6, sx: 0.4 }), part(this.sphere(0.1, 5), hex('#ff4b5c'), { x: -0.36, y: 0.6 })];
		for (let i = 0; i < 4; i++) {
			const a = Math.PI / 4 + i * Math.PI / 2, b = a + Math.PI / 2, foot = (k: number, r: number) => [Math.cos(k) * r, 0, Math.sin(k) * r];
			parts.push(this.rod([foot(a, 0.4)[0], -0.04, foot(a, 0.4)[2]], [foot(a, 0.14)[0], 0.56, foot(a, 0.14)[2]], 0.09, steel, 4), this.rod([foot(a, 0.33)[0], 0.14, foot(a, 0.33)[2]], [foot(b, 0.22)[0], 0.38, foot(b, 0.22)[2]], 0.05, steel, 4));
		}
		return this.done('relay', parts, this.bright);
	}

	// ------------------------------------------------------------------ enemy fire: four flat signs, each a dark edge, a colour and a pale heart
	/** Loud talk: a jagged speech bubble. */
	shotTalk(): Mesh {
		const edge = hex('#2a0418'), pink = hex('#ff3d8f'), parts = [
			part(this.prism(star(9, 0.37, 0.26, 0.2), 0.03), edge), part(this.prism([[-0.16, -0.14], [-0.52, -0.36], [-0.3, 0.02]], 0.03, -0.3, -0.16), edge),
			part(this.prism(star(9, 0.3, 0.2, 0.2), 0.03), pink, { y: 0.03 }), part(this.prism([[-0.16, -0.12], [-0.43, -0.3], [-0.26, -0.02]], 0.03, -0.27, -0.14), pink, { y: 0.03 }),
			part(this.prism(oval(10, 0.13, 0.15), 0.03), hex('#fff0f6'), { y: 0.06 })];
		return this.done('talk', parts, this.flat);
	}
	/** A shout: an exclamation mark that turns as it flies. */
	shotBang(): Mesh {
		const edge = hex('#3a0a00'), fire = hex('#ff6a00'), pale = hex('#fff3b0'), parts = [
			part(this.prism([[0.43, -0.2], [0.43, 0.2], [-0.13, 0.13], [-0.13, -0.13]], 0.03), edge), part(this.prism(oval(10, 0.16, 0.16), 0.03), edge, { x: -0.29 }),
			part(this.prism([[0.37, -0.14], [0.37, 0.14], [-0.08, 0.07], [-0.08, -0.07]], 0.03), fire, { y: 0.03 }), part(this.prism(oval(10, 0.1, 0.1), 0.03), fire, { x: -0.29, y: 0.03 }),
			part(this.prism([[0.31, -0.07], [0.31, 0.07], [-0.02, 0.03], [-0.02, -0.03]], 0.03), pale, { y: 0.06 }), part(this.prism(oval(8, 0.05, 0.05), 0.03), pale, { x: -0.29, y: 0.06 })];
		return this.done('bang', parts, this.flat);
	}
	/** A glitch: a white square with its colours slipping off it. */
	shotGlitch(): Mesh {
		const edge = hex('#12001f'), parts = [
			part(this.box(0.4, 0.03, 0.4), edge), part(this.box(0.16, 0.03, 0.16), edge, { x: 0.24, z: 0.22 }), part(this.box(0.16, 0.03, 0.16), edge, { x: -0.26, z: -0.18 }),
			part(this.box(0.27, 0.03, 0.27), hex('#ff2545'), { x: 0.05, y: 0.03, z: -0.07 }), part(this.box(0.27, 0.03, 0.27), hex('#a44dff'), { x: -0.05, y: 0.035, z: 0.07 }),
			part(this.box(0.09, 0.03, 0.09), hex('#ff2545'), { x: 0.24, y: 0.03, z: 0.22 }), part(this.box(0.09, 0.03, 0.09), hex('#a44dff'), { x: -0.26, y: 0.03, z: -0.18 }),
			part(this.box(0.22, 0.03, 0.22), hex('#ffffff'), { y: 0.07 })];
		return this.done('glitch', parts, this.flat);
	}
	/** A shard of lightning, pointing the way it flies (down the screen until it is turned). */
	shotZap(): Mesh {
		const line = [[0.42, 0.1], [0.04, -0.13], [0, 0.13], [-0.44, -0.08]];
		const parts = [...this.path(line, 0.24, 0.03, hex('#3a0a4a')), ...this.path(line, 0.13, 0.03, hex('#ffe600'), 0.03), ...this.path(line, 0.05, 0.03, hex('#ffffff'), 0.06)];
		return this.done('zap', parts, this.flat);
	}

	// ------------------------------------------------------------------ bosses: a root with a few moving pieces
	boss(id: string): { root: TransformNode; moving: Record<string, TransformNode | Mesh>; tail: Mesh[] } {
		const root = new TransformNode('boss:' + id, this.scene), moving: Record<string, TransformNode | Mesh> = {}, tail: Mesh[] = [];
		const add = (name: string, parts: Mesh[], parent: TransformNode = root) => { const m = this.done(name, parts, this.bright); m.parent = parent; return m; };
		/** A piece that moves on its own: a named point that shapes hang from (the arena turns, lifts and stretches it). */
		const node = (name: string, x = 0, y = 0, z = 0, parent: TransformNode = root) => { const n = new TransformNode(name, this.scene); n.parent = parent; n.position.set(x, y, z); moving[name] = n; return n; };
		const eyes = (x: number, y: number, gap: number, size: number, color = '#ff2b3d') => {
			const out: Mesh[] = [];
			for (const s of [-1, 1]) { out.push(part(this.sphere(size, 8), hex('#fff4d6'), { x, y, z: s * gap })); out.push(part(this.sphere(size * 0.55, 6), hex(color), { x: x - size * 0.3, y: y + size * 0.12, z: s * gap })); out.push(part(this.box(size * 0.25, size * 0.2, size * 1.3), hex('#1a0d0d'), { x, y: y + size * 0.55, z: s * gap, rx: s * 0.5 })); }
			return out;
		};
		switch (id) {
			case 'rumorking': {                                                    // the king of rumours: a giant megaphone in a crown; it turns as it sweeps, and its shout goes out in waves
				const horn = node('horn'), gold = hex('#ffd24a'), wood = hex('#8a3410');
				add('kingHorn', [
					part(this.cyl(0.7, 2.3, 18, 2.5), hex('#ff7a3c'), { y: 0.5, rz: Math.PI / 2 }), part(this.torus(2.5, 0.3, 24), hex('#fff1d6'), { x: -1.15, y: 0.5, rz: Math.PI / 2 }),
					part(this.cyl(2.1, 0.1, 18), hex('#3a1408'), { x: -1.1, y: 0.5, rz: Math.PI / 2 }), part(this.sphere(1.1, 8), hex('#ff3340'), { x: -1, y: 0.1, sx: 0.5, sy: 0.5 }),
					part(this.torus(1.42, 0.16, 20), gold, { x: 0.3, y: 0.5, rz: Math.PI / 2 }), part(this.torus(0.86, 0.14, 16), gold, { x: 1, y: 0.5, rz: Math.PI / 2 }),
					part(this.box(0.5, 0.7, 0.8), wood, { x: 1.38, y: 0.5 }), part(this.box(0.34, 0.9, 0.34), wood, { x: 0.85, y: -0.25 }), ...eyes(-0.45, 1.42, 0.42, 0.5)], horn);
				const crown = node('crown', 0.42, 1.22, 0, horn), jewels: Mesh[] = [part(this.cyl(0.95, 0.3, 12), gold), part(this.torus(0.95, 0.12, 16), hex('#fff1a0'), { y: -0.15 })];
				for (let i = 0; i < 6; i++) { const x = Math.cos(i * Math.PI / 3) * 0.4, z = Math.sin(i * Math.PI / 3) * 0.4; jewels.push(part(this.cyl(0.26, 0.5, 4, 0), gold, { x, y: 0.38, z }), part(this.sphere(0.16, 6), hex(i % 2 ? '#ff3340' : '#5af0ff'), { x, y: 0.66, z })); }
				add('kingCrown', jewels, crown);
				for (let k = 0; k < 3; k++) {                                         // the waves of its shout, on the ground in front of its mouth
					const wave = node('wave' + k, -1.25, 0.25, 0, horn), r = 0.55 + k * 0.32, arc: number[][] = [];
					for (let i = -4; i <= 4; i++) arc.push([-Math.cos(i * 0.2) * r, Math.sin(i * 0.2) * r]);
					add('kingWave' + k, this.path(arc, 0.13, 0.08, hex(k % 2 ? '#fff7c2' : '#ffe04d')), wave);
				}
				break;
			}
			case 'whirl': {                                                        // the whirl of trends: water going round one eye, whose lids shut while it guards itself
				add('whirlPool', [part(this.cyl(3.4, 0.2, 26), hex('#0b2a4a'), { y: -0.25 }), part(this.torus(3.4, 0.16, 30), hex('#5af0ff'), { y: -0.15 }), part(this.cyl(2.3, 0.3, 22), hex('#0f4c75'), { y: -0.1 }), part(this.torus(2.3, 0.12, 26), hex('#ff6bf0'), { y: 0.05 })]);
				const arms = node('arms'), swirl: Mesh[] = [], tip = (k: number) => { const a = k * Math.PI * 2 / 3 + 7 * 0.42 + 0.12; return { x: Math.cos(a) * 1.74, y: 0, z: Math.sin(a) * 1.74 }; };
				for (let k = 0; k < 3; k++) for (let i = 0; i < 7; i++) {
					const a = k * Math.PI * 2 / 3 + i * 0.42, b = a + 0.42, r0 = 0.85 + i * 0.13, r1 = r0 + 0.13;
					swirl.push(this.bar(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(b) * r1, Math.sin(b) * r1, 0.34 - i * 0.035, 0.22 - i * 0.015, hex(['#5af0ff', '#9ef6ff', '#ffffff'][k]), 0.06 - i * 0.012));
				}
				swirl.push(part(this.prism(star(5, 0.27, 0.12), 0.1), hex('#ffe04d'), tip(0)), part(this.prism([[0.27, 0], [-0.17, -0.23], [-0.17, 0.23]], 0.1), hex('#ff4d6d'), tip(1)), part(this.box(0.3, 0.1, 0.4), hex('#ff6bf0'), tip(2)));
				add('whirlArms', swirl, arms);
				add('whirlEye', [part(this.sphere(1.44, 14), hex('#fff7ea'), { sy: 0.62 }), part(this.sphere(0.84, 12), hex('#ff4d6d'), { x: -0.14, y: 0.24, sy: 0.6 }), part(this.sphere(0.42, 10), hex('#1a0612'), { x: -0.22, y: 0.36, sy: 0.6 }),
					part(this.sphere(0.16, 6), hex('#ffffff'), { x: -0.34, y: 0.46, z: -0.14 })], node('eye', 0, 0.3, 0));
				const half = oval(10, 0.8, 0.8, -Math.PI / 2, Math.PI / 2);                 // half a disc; each lid grows from the rim of the eye to its middle
				for (const s of [-1, 1]) {
					const edge = (k: number) => half.map(p => [(p[0] * k - 0.8) * s, p[1] * k]);
					add('whirlLid' + s, [part(this.prism(edge(1), 0.14, -0.5 * s, 0), hex('#0f4c75')), part(this.prism(edge(0.86), 0.05, -0.5 * s, 0), hex('#1a6fa8'), { y: 0.08 }), part(this.box(0.1, 0.16, 1.56), hex('#ff6bf0'), { x: -0.8 * s, y: 0.02 })], node(s > 0 ? 'lidA' : 'lidB', 0.8 * s, 0.84, 0));
				}
				break;
			}
			case 'octodata': {                                                     // the octopus of data: a head full of what it has gathered, and eight cables that end in plugs
				const wire = ['#5af0ff', '#ff6bf0', '#ffe04d', '#b6ff3c'], rubber = hex('#2a1f5e');
				const dome: Mesh[] = [part(this.sphere(2.2, 14), hex('#4a35b0'), { y: 0.45, sy: 0.8 }), part(this.torus(2.16, 0.1, 28), hex('#5af0ff'), { y: 0.45 }), part(this.torus(1.56, 0.08, 24), hex('#ff6bf0'), { y: 1.08 }),
					part(this.sphere(0.9, 8), hex('#1a0f3a'), { x: -0.98, y: 0.3, sx: 0.4, sy: 0.5 }), ...eyes(-0.62, 1.12, 0.42, 0.52, '#5af0ff')];
				for (let i = 0; i < 7; i++) dome.push(part(this.sphere(0.2, 6), hex(wire[i % 4]), { x: 0.2 + Math.cos(i * 0.9) * 0.55, y: 1.2 - (i % 3) * 0.03, z: Math.sin(i * 0.9) * 0.6, sy: 0.5 }));
				add('octoHead', dome, node('head'));
				for (let i = 0; i < 8; i++) {
					const arm = node('arm' + i), cable: Mesh[] = [], tint = hex(wire[i % 4]);
					arm.rotation.y = -(i + 0.5) * Math.PI / 4;
					let from = [0.8, 0.2, 0];
					for (let j = 1; j <= 5; j++) {
						const to = [0.8 + j * 0.27, 0.2 - j * 0.07, Math.sin(j * 1.2 + i) * 0.13], d = 0.4 - j * 0.04;
						cable.push(this.rod(from, to, d, j % 2 ? rubber : tint, 6, d - 0.04), part(this.sphere(d - 0.03, 6), j % 2 ? rubber : tint, { x: to[0], y: to[1], z: to[2] }));
						from = to;
					}
					cable.push(part(this.box(0.3, 0.24, 0.32), hex('#dfe8f2'), { x: from[0] + 0.14, y: from[1], z: from[2] }), part(this.box(0.18, 0.06, 0.08), hex('#ffd24a'), { x: from[0] + 0.36, y: from[1], z: from[2] - 0.08 }), part(this.box(0.18, 0.06, 0.08), hex('#ffd24a'), { x: from[0] + 0.36, y: from[1], z: from[2] + 0.08 }));
					add('octoArm' + i, cable, arm);
				}
				break;
			}
			case 'maskmaster': {                                                   // the master of masks: a cloaked figure that juggles faces, and hides behind the largest of them
				const cloak = hex('#3b1d6e'), gold = hex('#ffd24a'), ink = hex('#1a0d2e'), bone = hex('#f6f2e8');
				const figure: Mesh[] = [part(this.cyl(2.3, 1.5, 16, 0.9), cloak, { y: 0.35 }), part(this.torus(2.3, 0.16, 26), gold, { y: -0.36 }), part(this.prism(star(8, 1, 0.66), 0.12), gold, { y: 1.12 }),
					part(this.sphere(0.95, 12), bone, { x: -0.06, y: 1.55 }), part(this.cyl(0.84, 0.07, 14), ink, { x: 0.22, y: 1.97 }), part(this.cyl(0.56, 0.5, 12), ink, { x: 0.24, y: 2.22 }), part(this.torus(0.58, 0.1, 14), gold, { x: 0.24, y: 2.06 })];
				for (const s of [-1, 1]) figure.push(part(this.sphere(0.18, 6), ink, { x: -0.41, y: 1.8, z: s * 0.17, sx: 0.5 }));
				for (let i = -2; i <= 2; i++) figure.push(part(this.sphere(0.1, 5), ink, { x: -0.52 + 0.02 * i * i, y: 1.6 + 0.035 * i * i, z: i * 0.09 }));
				add('maskFigure', figure);
				for (const s of [-1, 1]) {
					const glove: Mesh[] = [part(this.sphere(0.56, 10), bone, { sy: 0.8 }), part(this.cyl(0.5, 0.22, 10), gold, { x: 0.3, rz: Math.PI / 2 }), this.rod([0, 0.05, -s * 0.2], [-0.12, 0.2, -s * 0.42], 0.16, bone, 5)];
					for (let j = -1; j <= 1; j++) glove.push(this.rod([-0.14, 0.05, j * 0.16], [-0.42, 0.22, j * 0.2], 0.16, bone, 5));
					add('maskHand' + s, glove, node(s < 0 ? 'handL' : 'handR', -0.35, 0.95, s * 1.55));
				}
				const juggle = node('juggle', -0.25, 1.5, 0);
				const looks: [string, number[][]][] = [['#ffe04d', [[-0.1, -0.15], [-0.2, 0], [-0.1, 0.15]]], ['#5aa8ff', [[-0.2, -0.15], [-0.1, 0], [-0.2, 0.15]]], ['#ff5a5a', [[-0.12, -0.16], [-0.2, -0.05], [-0.12, 0.05], [-0.2, 0.16]]],
					['#f6f2e8', [[-0.16, -0.13], [-0.16, 0.13]]], ['#7be08a', [[-0.1, -0.15], [-0.2, 0], [-0.1, 0.15]]]];
				looks.forEach(([tint, mouth], k) => {                                 // five faces going round, hand to hand
					const a = k * Math.PI * 2 / 5, one = node('mask' + k, 0, Math.cos(a) * 1.5, Math.sin(a) * 1.5, juggle);
					add('maskFace' + k, [part(this.prism(oval(12, 0.47, 0.39), 0.05), ink, { y: -0.05 }), part(this.prism(oval(12, 0.42, 0.34), 0.1), hex(tint)),
						part(this.sphere(0.14, 5), ink, { x: 0.1, y: 0.06, z: -0.14, sy: 0.4 }), part(this.sphere(0.14, 5), ink, { x: 0.1, y: 0.06, z: 0.14, sy: 0.4 }), ...this.path(mouth, 0.06, 0.05, ink, 0.06)], one);
				});
				add('maskGuard', [part(this.prism(oval(18, 1.3, 1.1), 0.08), gold, { y: -0.06 }), part(this.prism(oval(18, 1.2, 1), 0.14), bone),
					...this.path([[0.36, -0.66], [0.52, -0.44], [0.36, -0.22]], 0.13, 0.08, ink, 0.09), ...this.path([[0.36, 0.66], [0.52, 0.44], [0.36, 0.22]], 0.13, 0.08, ink, 0.09),
					...this.path([[-0.3, -0.56], [-0.5, -0.3], [-0.58, 0], [-0.5, 0.3], [-0.3, 0.56]], 0.13, 0.08, ink, 0.09),
					part(this.sphere(0.34, 6), hex('#ff8a8a'), { x: 0, y: 0.07, z: -0.72, sy: 0.2 }), part(this.sphere(0.34, 6), hex('#ff8a8a'), { x: 0, y: 0.07, z: 0.72, sy: 0.2 })], node('guard', 1.1, 1.6, 0));
				break;
			}
			case 'hivequeen': {                                                    // the queen of the swarm: a hive of stacked rings; its drones circle it and its towers come out of its door
				const amber = hex('#ffb020'), deep = hex('#d87f00'), seam = hex('#3a2400'), lit = hex('#5af0ff'), gold = hex('#ffd24a');
				const hive: Mesh[] = [part(this.cyl(3.3, 0.5, 18), deep, { y: -0.15 }), part(this.cyl(3, 0.5, 18), amber, { y: 0.35 }), part(this.cyl(2.4, 0.5, 18), deep, { y: 0.85 }),
					part(this.torus(3.02, 0.1, 30), seam, { y: 0.11 }), part(this.torus(2.42, 0.1, 26), seam, { y: 0.61 }), part(this.box(0.2, 0.74, 1), hex('#1a0f00'), { x: -1.58, y: 0.08 }), ...eyes(-1.12, 0.98, 0.46, 0.46, '#5af0ff')];
				for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 + 0.31; hive.push(part(this.cyl(0.3, 0.06, 6), i % 3 ? seam : lit, { x: Math.cos(a) * 1.36, y: 0.62, z: Math.sin(a) * 1.36 })); }
				for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.39; hive.push(part(this.cyl(0.36, 0.06, 6), i % 2 ? lit : seam, { x: Math.cos(a) * 1.01, y: 1.12, z: Math.sin(a) * 1.01 })); }
				add('hiveBody', hive);
				add('hiveDoor', [part(this.box(0.1, 0.7, 0.94), amber), part(this.box(0.12, 0.1, 0.96), seam, { y: 0.16 }), part(this.box(0.12, 0.1, 0.96), seam, { y: -0.16 })], node('door', -1.7, 0.08, 0));
				const top: Mesh[] = [part(this.cyl(1.6, 0.45, 16), amber, { y: 1.32 }), part(this.torus(1.62, 0.1, 22), seam, { y: 1.11 }), part(this.sphere(1.6, 12), deep, { y: 1.55, sy: 0.5 }), part(this.torus(0.7, 0.12, 14), gold, { y: 1.92 })];
				for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; top.push(part(this.cyl(0.2, 0.36, 4, 0), gold, { x: Math.cos(a) * 0.34, y: 2.12, z: Math.sin(a) * 0.34 })); }
				for (const s of [-1, 1]) top.push(this.rod([-0.4, 1.8, s * 0.3], [-0.85, 2.3, s * 0.75], 0.08, seam, 5), part(this.sphere(0.22, 6), hex('#b6ff3c'), { x: -0.85, y: 2.32, z: s * 0.75 }));
				add('hiveCap', top, node('cap'));
				const drones = node('drones', 0, 0.9, 0), flock: Mesh[] = [];
				for (let i = 0; i < 6; i++) {
					const a = i * Math.PI / 3, x = Math.cos(a) * 2.25, z = Math.sin(a) * 2.25, y = (i % 2) * 0.3;
					flock.push(part(this.cyl(0.44, 0.16, 6), hex('#26404a'), { x, y, z }), part(this.sphere(0.2, 6), hex('#b6ff3c'), { x, y: y + 0.1, z, sy: 0.6 }),
						part(this.prism(oval(8, 0.14, 0.3), 0.03), hex('#d6f3ff'), { x: x + Math.cos(a) * 0.3, y: y + 0.12, z: z + Math.sin(a) * 0.3, ry: -a }), part(this.prism(oval(8, 0.14, 0.3), 0.03), hex('#d6f3ff'), { x: x - Math.cos(a) * 0.3, y: y + 0.12, z: z - Math.sin(a) * 0.3, ry: -a }));
				}
				add('hiveDrones', flock, drones);
				break;
			}
			default: {                                                             // the storm of the cyber war: a fortress riding a thundercloud, with one eye and two arms of lightning that shut in front of it
				const stone = hex('#3d4466'), light = hex('#6a74a0'), roof = hex('#8a5cff'), bolt = hex('#ffe600');
				const cloud: Mesh[] = [part(this.sphere(3.2, 10), hex('#2a2440'), { y: -0.2, sy: 0.3 })];
				for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; cloud.push(part(this.sphere(1.25 + (i % 3) * 0.2, 8), hex(i % 2 ? '#3b3260' : '#4a4078'), { x: Math.cos(a) * 1.5, y: -0.15, z: Math.sin(a) * 1.5, sy: 0.55 })); }
				add('stormCloud', cloud);
				const keep: Mesh[] = [part(this.cyl(2.5, 1, 6), stone, { y: 0.5 }), part(this.cyl(2.7, 0.12, 6), light, { y: 1 }), part(this.cyl(1.9, 0.5, 6), stone, { y: 1.3 }), part(this.cyl(2.05, 0.1, 6), light, { y: 1.55 })];
				for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; keep.push(part(this.box(0.34, 0.3, 0.34), light, { x: Math.cos(a) * 1.16, y: 1.2, z: Math.sin(a) * 1.16, ry: -a })); }
				for (const a of [Math.PI * 5 / 6, Math.PI * 7 / 6]) keep.push(part(this.box(0.08, 0.36, 0.28), bolt, { x: Math.cos(a) * 1.09, y: 0.45, z: Math.sin(a) * 1.09, ry: -a }));
				for (const s of [-1, 1]) keep.push(part(this.cyl(0.8, 1.9, 8), stone, { x: 0.5, y: 0.9, z: s * 1.3 }), part(this.cyl(0.9, 0.1, 8), light, { x: 0.5, y: 1.85, z: s * 1.3 }), part(this.cyl(0.95, 0.7, 8, 0), roof, { x: 0.5, y: 2.2, z: s * 1.3 }), part(this.box(0.08, 0.3, 0.16), bolt, { x: 0.1, y: 1.3, z: s * 1.3 }));
				add('stormKeep', keep);
				add('stormEye', [part(this.sphere(1.2, 12), hex('#fff4d6'), { sy: 0.8 }), part(this.sphere(0.74, 10), hex('#ff2b3d'), { x: -0.16, y: 0.2, sy: 0.7 }), part(this.sphere(0.5, 8), hex('#1a0612'), { x: -0.24, y: 0.29, sy: 0.7, sz: 0.34 }),
					part(this.torus(1.22, 0.12, 20), bolt, { y: 0.02 }), part(this.box(0.3, 0.16, 1.3), stone, { x: 0.3, y: 0.44 })], node('eye', -0.5, 1.75, 0));
				const ring = node('ring', 0, 0.15, 0), sparks: Mesh[] = [part(this.torus(4.8, 0.12, 36), roof)];
				for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a), at = (r: number, t: number) => [c * r - s * t, s * r + c * t]; sparks.push(...this.path([at(2.4, -0.3), at(2.55, -0.08), at(2.25, 0.08), at(2.4, 0.3)], 0.09, 0.09, bolt, 0.04), part(this.sphere(0.16, 5), hex('#ffffff'), { x: c * 2.4, y: 0.04, z: s * 2.4 })); }
				add('stormRing', sparks, ring);
				for (const s of [-1, 1]) {                                            // an arm of lightning, drawn from its shoulder outward; the arena swings both across the front
					const line = [[0, 0], [-0.45, 0.3], [-0.3, 0.6], [-0.85, 0.8], [-0.7, 1.1], [-1.3, 1.3]].map(p => [p[0], p[1] * s]);
					add('stormArm' + s, [...this.path(line, 0.44, 0.1, roof), ...this.path(line, 0.26, 0.1, bolt, 0.06), ...this.path(line, 0.1, 0.1, hex('#ffffff'), 0.12), part(this.sphere(0.5, 8), bolt),
						this.bar(-1.3, s * 1.3, -1.64, s * 1.26, 0.16, 0.1, bolt, 0.06), this.bar(-1.3, s * 1.3, -1.34, s * 1.64, 0.16, 0.1, bolt, 0.06)], node(s < 0 ? 'armL' : 'armR', -0.2, 0.9, s * 1.2));
				}
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
