// A dev-server tool, not a unit test: the fixed fights the visual scorecard is judged on, and the numbers it cites.
// In the browser console of `npm run dev` (reload the page between states for clean pools):
//   const sc = await import('/tests/score.dev.js');
//   await sc.state('boss3');        // 'stage1' | 'blades5' | 'boss3': puts the game in that fight and freezes it there
//   sc.metrics();                   // pixel measures of the 3D picture (the same as the Three.js skills' canvas inspector)
//   sc.cost();                      // what is drawn: meshes, triangles, materials, CPU time of a frame
// A state stops the game's own loop (reload the page to play again). States are frozen at full resolution (the game's automatic lowering of resolution is undone for the picture).
import { fight, run } from './look.dev.js';
const g = () => window.__game;
const STATES = {
	stage1: { stage: 0, weapon: 'pulse', level: 1, want: w => w.enemies.length >= 5 },
	blades5: { stage: 4, weapon: 'disc', level: 5, want: w => w.enemies.length >= 7 },
	boss3: { stage: 2, weapon: 'arc', level: 3, boss: true, want: w => !!w.boss }
};
const sharp = () => g().engine.setHardwareScalingLevel(1 / devicePixelRatio);
export async function state(name) {
	const s = STATES[name], game = g();
	await fight(s.stage, s.weapon, s.level, 1);
	game.world.director.cratesOn = false;
	for (const e of game.world.enemies) if (e.kind === 'crate') e.dead = true;   // no box opens a question in the middle of the picture
	if (s.boss) game.world.director.startBoss();
	for (let i = 0; i < 140; i++) {
		run(0.25);
		if (game.mode === 'intro') document.querySelector('.cs-malware [data-a=ok]')?.click();
		document.querySelector('.cs-modal .cs-btn.primary')?.click();
		if (game.mode === 'fight' && i > (s.boss ? 28 : 40) && s.want(game.world)) break;
	}
	sharp();
	for (let k = 0; k < 3; k++) { game.scene.render(); await new Promise(r => setTimeout(r, 250)); run(0.04); }
	sharp(); game.scene.render();
	game.engine.stopRenderLoop();                                        // frozen here, so a screenshot taken later shows this very moment
	return { mode: game.mode, enemies: game.world.enemies.length, bullets: game.world.bullets.length, shots: game.world.shots.length };
}
export function metrics() {
	const game = g(), c = game.canvas; game.scene.render();
	const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
	const x = o.getContext('2d'); x.drawImage(c, 0, 0);
	const d = x.getImageData(0, 0, o.width, o.height).data, W = o.width, H = o.height;
	const sx = Math.max(1, Math.floor(W / 160)), sy = Math.max(1, Math.floor(H / 90)), cols = Math.floor(W / sx), rows = Math.floor(H / sy);
	const L = new Float64Array(cols * rows), B = new Map(); let n = 0;
	for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
		const i = ((gy * sy) * W + gx * sx) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
		L[gy * cols + gx] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
		const k = (r >> 4) + ',' + (gg >> 4) + ',' + (b >> 4); B.set(k, (B.get(k) || 0) + 1); n++;
	}
	const s = [...L].sort((a, b) => a - b); let e = 0, dom = 0;
	for (const v of B.values()) { const p = v / n; e -= p * Math.log2(p); dom = Math.max(dom, v); }
	let ed = 0, ch = 0;
	for (let gy = 0; gy < rows - 1; gy++) for (let gx = 0; gx < cols - 1; gx++) { const i = gy * cols + gx; if (Math.max(Math.abs(L[i] - L[i + 1]), Math.abs(L[i] - L[i + cols])) > 12) ed++; ch++; }
	return { entropy: +e.toFixed(2), edges: +(ed / ch).toFixed(3), contrast: +(s[Math.floor(n * 0.95)] - s[Math.floor(n * 0.05)]).toFixed(1), dominant: +(dom / n).toFixed(3) };
}
export function cost() {
	const game = g(), s = game.scene, t0 = performance.now();
	for (let i = 0; i < 60; i++) { game.tick(1 / 60); s.render(); }
	const ms = (performance.now() - t0) / 60, am = s.getActiveMeshes(); let v = 0;
	for (let i = 0; i < am.length; i++) v += am.data[i].getTotalIndices?.() || 0;
	return { msPerFrameCpu: +ms.toFixed(2), activeMeshes: am.length, triangles: Math.round(v / 3), meshes: s.meshes.length, materials: s.materials.length, textures: s.textures.length, lights: s.lights.length };
}
