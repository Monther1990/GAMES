// «نجمة سهيل», the strongest weapon of part 2: a golden star that is thrown, cuts through everything and comes back.
// (In part 1 this weapon threw Cyber himself inside a shield; here it is the star sailors of Oman steered by.)
// One star is a bright core with five long points and five short ones between them, all glowing: it needs no light.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

let made = 0;
/** A new star, lying flat over the field (it is seen from above), about two units from tip to tip. */
export function makeStar(scene: Scene): TransformNode {
	const n = made++, root = new TransformNode('star' + n, scene);
	const mat = (name: string, c: Color3) => { const m = new StandardMaterial(name + n, scene); m.disableLighting = true; m.emissiveColor = c; return m; };
	const gold = mat('starGold', new Color3(1, 0.8, 0.22)), pale = mat('starPale', new Color3(1, 0.97, 0.78)), white = mat('starWhite', new Color3(1, 1, 1));
	const core = CreateSphere('starCore' + n, { diameter: 0.62, segments: 10 }, scene);
	core.material = white; core.parent = root; core.scaling.y = 0.7;
	for (let i = 0; i < 10; i++) {
		const long = i % 2 === 0, len = long ? 1.05 : 0.55, a = i / 10 * Math.PI * 2;
		// a point: a cone lying on its side, its base in the core
		const p = CreateCylinder('starPoint' + n + '_' + i, { height: len, diameterBottom: long ? 0.44 : 0.3, diameterTop: 0, tessellation: 4 }, scene);
		p.material = long ? gold : pale; p.parent = root;
		p.rotation.z = -Math.PI / 2; p.rotation.y = -a;
		p.position.set(Math.cos(a) * len / 2, 0, Math.sin(a) * len / 2);
		p.scaling.z = 0.55;                                                       // flattened, like a cut star
		p.isPickable = false;
	}
	core.isPickable = false;
	return root;
}
