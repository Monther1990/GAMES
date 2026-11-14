// The player on screen: the boy or the girl standing on an energy board, with Cyber flying just ahead (Cyber is the
// one that fires). The shared Avatar class is used as it is; this file only adds the board, the lean and the small
// bright core that shows exactly where the player can be hit.
import type { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Avatar, CharacterKit, Cyber } from '../game/avatar';

const SCALE = 1.45;                                   // drawn larger than life so the character reads on a phone

/** The colour of the girl's dress in a fight (kept in the linear space the material works in). */
const GIRL_DRESS = Color3.FromHexString('#e3207f').toLinearSpace();

export class Hero {
	readonly rig: TransformNode;
	readonly avatar: Avatar;
	readonly cyber: Cyber;
	private parts: Mesh[] = [];
	private ring: Mesh; private core: Mesh;
	private t = 0; private lean = 0; private pitch = 0;

	/** A fallen player lies on the board until revived. */
	down = false;
	constructor(scene: Scene, kit: CharacterKit, gender: 'male' | 'female', tag = 'hero', ring = new Color3(0.3, 0.9, 1)) {
		this.rig = new TransformNode('hero', scene);
		const mat = (name: string, c: Color3, alpha = 1) => { const m = new StandardMaterial(name, scene); m.disableLighting = true; m.emissiveColor = c; m.alpha = alpha; return m; };
		const board = CreateCylinder('board', { diameter: 1.05, height: 0.09, tessellation: 24 }, scene);
		board.material = mat('boardMat', new Color3(0.08, 0.3, 0.5)); board.parent = this.rig; board.position.y = 0.05;
		this.ring = CreateTorus('boardRing', { diameter: 1.08, thickness: 0.07, tessellation: 28 }, scene);
		this.ring.material = mat(tag + 'RingMat', ring); this.ring.parent = this.rig; this.ring.position.y = 0.06;
		this.core = CreateSphere('core', { diameter: 0.3, segments: 8 }, scene);
		this.core.material = mat('coreMat', new Color3(1, 1, 1)); this.core.parent = this.rig; this.core.position.y = 0.16;
		this.parts.push(board, this.ring, this.core);
		this.avatar = new Avatar(kit, gender, tag);
		// the girl's dress is deep rose so the two fighters are told apart at a glance (both wore white); the colour is bright
		// enough to stand out on every land, from the green oasis to the night mountains, and is no colour of the fight
		// itself (cyan shots, gold coins, red danger). The hijab stays white and the boy keeps the white dishdasha.
		if (gender === 'female') for (const m of this.avatar.root.getChildMeshes()) { const dress = m.material as (Material & { albedoColor?: Color3 }) | null; if (dress?.albedoColor && /:Dress$/.test(dress.name)) dress.albedoColor = GIRL_DRESS.clone(); }
		this.avatar.root.parent = this.rig;
		this.avatar.root.position.y = 0.1;
		this.avatar.root.scaling.setAll(SCALE);
		this.cyber = new Cyber(kit, tag + 'Cyber', 0.95);
		this.cyber.root.parent = this.rig;
		for (const m of this.parts) m.isPickable = false;
	}

	/** vx, vz: the player's speed, for the lean. `blink` while protected after a hit. */
	update(dt: number, x: number, z: number, vx: number, vz: number, blink: boolean, firing: boolean) {
		this.t += dt;
		this.avatar.update(dt, 0, false);
		this.lean += (Math.max(-1, Math.min(1, vz / 9)) * 0.3 - this.lean) * Math.min(1, dt * 12);
		this.pitch += (Math.max(-1, Math.min(1, vx / 9)) * -0.16 - this.pitch) * Math.min(1, dt * 12);
		this.rig.position.set(x, 0.12 + Math.sin(this.t * 3) * 0.04, z);
		this.rig.rotation.set(this.lean, 0, this.pitch);
		this.avatar.root.rotation.z = this.down ? 1.35 : 0; this.avatar.root.position.y = this.down ? 0.45 : 0.1;
		const show = !blink || Math.floor(this.t * 14) % 2 === 0;
		this.avatar.root.setEnabled(show);
		this.ring.rotation.y = this.t * 2;
		this.core.scaling.setAll(1 + 0.18 * Math.sin(this.t * 10));
		// Cyber: ahead of the player, facing the enemies, with a small recoil while firing
		this.cyber.root.position.set(0.95 + (firing ? Math.sin(this.t * 38) * 0.03 : 0), 0.95 + Math.sin(this.t * 2.6) * 0.06, 0);
		this.cyber.root.rotation.y = Math.sin(this.t * 1.3) * 0.12;
	}

	dispose() { this.avatar.dispose(); this.cyber.root.dispose(false, true); for (const m of this.parts) m.dispose(false, true); this.rig.dispose(); }
}
