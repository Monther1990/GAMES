// A dev-server tool, not a unit test: puts the game in a chosen fight so a weapon or a special power can be looked at.
// In the browser console of `npm run dev` (works with the page hidden: it steps the game itself):
//   const look = await import('/tests/look.dev.js');
//   await look.fight(2, 'wave', 5, 8);        // stage index, weapon id, level, seconds of fighting
//   await look.power('falcon', 0.8);          // then use a power and stop that many seconds into it
const g = () => window.__game;
export const run = s => { for (let i = 0; i < Math.round(s * 60); i++) g().tick(1 / 60); };
const settle = async () => { for (let k = 0; k < 3; k++) { g().scene.render(); await new Promise(r => setTimeout(r, 250)); run(0.04); } g().scene.render(); };
export async function fight(stage, weapon, level, seconds = 8) {
	const game = g();
	Object.assign(game.save, { profileDone: true, name: 'تجربة', tutorialDone: true, unlocked: 6 });
	game.startStage(stage); run(1);
	for (let i = 0; i < 60 && game.mode !== 'fight'; i++) { document.querySelector('.cs-modal [data-a=ok], .cs-modal .cs-btn.primary')?.click(); run(0.4); }
	const w = game.world;
	w.godMode = true; w.weapon.id = weapon; w.weapon.level = level;
	for (let i = 0; i < seconds * 4; i++) { run(0.25); if (game.mode === 'intro') document.querySelector('.cs-malware [data-a=ok]')?.click(); }
	await settle();
	return { mode: game.mode, weapon: w.weapon.id, level: w.weapon.level, shots: [...new Set(w.shots.map(s => s.kind))], enemies: w.enemies.length, bullets: w.bullets.length };
}
export async function power(id, after = 0.8) {
	const game = g(), w = game.world;
	const ids = Array.isArray(id) ? id : [id];
	for (const p of ids) w.usePower(p, 0);
	for (const e of w.events.splice(0)) game.arena.show(e, w);
	for (let i = 0; i < after * 10; i++) { run(0.1); if (game.mode === 'intro') document.querySelector('.cs-malware [data-a=ok]')?.click(); }
	await settle();
	return { mode: game.mode, enemies: w.enemies.length, bullets: w.bullets.length, hp: w.player.hp };
}
