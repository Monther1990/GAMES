// The people in the run: the player's character (boy or girl) carrying the data package, Cyber flying beside them, and
// the other child waiting at the vault. The shared Avatar class does the walking and faces; this file only adds what a
// runner needs on top of it (lean, slide, lane roll, the package) through a parent node, without touching the models.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Avatar, CharacterKit, Cyber } from '../game/avatar';
import { laneZ } from './track';
import type { RunnerSim } from './sim';

const SAFE = new Color3(0.25, 0.95, 1), HURT = new Color3(1, 0.42, 0.16);

export class Runner {
	readonly rig: TransformNode;
	readonly avatar: Avatar;
	readonly cyber: Cyber;
	private pack: Mesh; private packMat: StandardMaterial;
	private tilt = 0; private roll = 0; private t = 0;
	private cyberPos = new Vector3();
	private wasAir = false;

	constructor(scene: Scene, kit: CharacterKit, gender: 'male' | 'female') {
		this.rig = new TransformNode('runner', scene);
		this.avatar = new Avatar(kit, gender, 'player');
		this.avatar.root.parent = this.rig;
		this.pack = CreateBox('package', { size: 0.2 }, scene);
		this.packMat = new StandardMaterial('packageMat', scene);
		this.packMat.disableLighting = true; this.packMat.emissiveColor = SAFE.clone();
		this.pack.material = this.packMat; this.pack.parent = this.rig; this.pack.isPickable = false;
		this.cyber = new Cyber(kit, 'companion', 0.85);
	}

	/** `protection` 0..1 colours the package; `still` keeps the character idle (menus, reading). */
	update(dt: number, sim: RunnerSim | null, protection: number, still: boolean, blink: boolean) {
		this.t += dt;
		const s = sim?.s ?? 0, z = sim?.z ?? 0, y = sim?.y ?? 0;
		const sliding = !!sim && sim.sliding > 0;
		const moving = !!sim && !still && sim.speed > 0.4;
		const speed01 = moving ? Math.min(1, sim!.speed / 9) : 0;
		this.avatar.update(dt * (0.95 + speed01 * 0.45), speed01, !!sim?.airborne);
		if (sim && this.wasAir && !sim.airborne) this.avatar.landed();
		this.wasAir = !!sim?.airborne;

		const wantTilt = sliding ? 1.05 : moving ? -0.07 : 0;
		this.tilt += (wantTilt - this.tilt) * Math.min(1, dt * 16);
		const dz = sim ? laneZ(sim.lane) - z : 0;
		this.roll += (Math.max(-1, Math.min(1, dz)) * 0.22 - this.roll) * Math.min(1, dt * 14);
		this.rig.position.set(s, y + (sliding ? 0.05 : 0), z);
		this.rig.rotation.set(this.roll, 0, this.tilt);
		this.avatar.root.setEnabled(!blink || Math.floor(this.t * 14) % 2 === 0);

		// the package rides on the back and shows the state of its protection
		this.pack.position.set(-0.34, 0.62 + Math.sin(this.t * 3) * 0.03, 0);
		this.pack.rotation.set(this.t * 1.3, this.t * 1.9, 0);
		const flicker = protection < 0.99 ? 0.75 + 0.25 * Math.sin(this.t * (22 - protection * 14)) : 1;
		Color3.LerpToRef(HURT, SAFE, protection, this.packMat.emissiveColor);
		this.packMat.emissiveColor.scaleToRef(flicker, this.packMat.emissiveColor);

		// Cyber flies at the left shoulder, a little behind, eyes toward the camera
		// on the left of the runner, or on the right when the runner is in the left lane (so it never leaves the screen)
		const side = sim && sim.lane === 0 ? 1 : -1;
		const target = new Vector3(s - 0.7, 1.75 + y * 0.5 + Math.sin(this.t * 2.4) * 0.07, z + side * 1.15);
		if (Vector3.DistanceSquared(this.cyberPos, target) > 36) this.cyberPos.copyFrom(target);
		Vector3.LerpToRef(this.cyberPos, target, Math.min(1, dt * 7), this.cyberPos);
		this.cyberPos.x = target.x;
		this.cyber.root.position.copyFrom(this.cyberPos);
		this.cyber.root.rotation.y = Math.PI * 0.86 + Math.sin(this.t * 1.1) * 0.12;
	}

	dispose() { this.avatar.dispose(); this.pack.dispose(false, true); this.cyber.root.dispose(false, true); this.rig.dispose(); }
}

/** The other child, waiting beside the vault and facing the runner. */
export class Friend {
	readonly avatar: Avatar;
	constructor(kit: CharacterKit, gender: 'male' | 'female', x: number, z: number) {
		this.avatar = new Avatar(kit, gender, 'friend');
		this.avatar.root.position.set(x, 0, z);
		this.avatar.heading = Math.PI;
	}
	update(dt: number) { this.avatar.update(dt, 0, false); }
	dispose() { this.avatar.dispose(); }
}
