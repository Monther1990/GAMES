// The game: it ties the combat simulation (src/sim), the 3D arena, the coins, the interface, sound and saving together
// and runs the flow menu -> stage (waves -> boss warning -> boss -> boss reward -> three questions -> bonus -> summary
// -> shop) -> next stage. Combat never runs behind the questions or the shop.
// Money: every reward is credited and saved first, by its id inside the attempt; the animation comes after.
// Knowledge score: only the decision ledger of the first set of answers in each stage (assessment.ts, re-scored by the
// platform). Money, weapons and fighting are for fun and are never a grade.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Materials/PBR/pbrMaterial';
import '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/loaders/glTF/2.0';
import { applyAction, getResult, isResolved, normalizeName, Run, RunResult, shuffleForRun, uuid } from '../game/assessment';
import { CharacterKit, Cyber } from '../game/avatar';
import { CHARACTER_LAYER } from '../view/scenery';
import { CheckpointDef, checkpoints, config, content, malware, missions, num, quick, ui, variantsOf } from '../game/data';
import { Attempt, bonusStage, buyWeapon, enemyReward, equipWeapon, maxLevel, nextUpgradeCost, quizPayout, stages, upgradeWeapon, weaponDef, WeaponId, weapons } from '../sim/economy';
import { levelStats, ratedCoverage, ratedPower } from '../sim/weapons';
import { closeBonus, Enemy, MoveInput, POWER_FROM, PowerId, POWERS, SimEvent, steer, World } from '../sim/world';
import { Link, Msg, SavedLink } from '../net/link';
import { Mirror, plainEvent, snapshot, Snapshot } from './coop';
import { ICON, ShopDetail, Ui, WeaponCard } from '../ui/ui';
import { Arena } from '../view/arena';
import { CoinFx } from '../view/coins';
import { Hero } from '../view/hero';
import { Input, InputAction } from './input';
import { Sound } from './sound';
import { loadSave, QuizAnswer, Save, SavedQuiz, storeSave } from './storage';

export interface Fun { wallet: number; stagesCleared: number; weapons: Partial<Record<WeaponId, number>> }
export interface GameOptions {
	base: string;
	/** Campaign finished: the result, the decision ledger the platform server re-scores, and the fun numbers (never a grade). */
	onComplete?: (payload: { result: RunResult; ledger: Run['ledger']; fun: Fun }) => void;
	onEvent?: (type: string, data: unknown) => void;
}
type Mode = 'loading' | 'menu' | 'card' | 'fight' | 'countdown' | 'quiz' | 'shop' | 'box' | 'intro' | 'guest';
type Peer = { name: string; avatar: 'male' | 'female'; weapon: { id: WeaponId; level: number } };
type MalwareInfo = { nameAr: string; whatAr: string; guardAr: string; color: string };
const MALWARE = malware.items as Record<string, MalwareInfo>;
type QuickQuestion = (typeof quick.questions)[number];
type Phase = 'tutorial' | 'waves' | 'warn' | 'boss' | 'down';
const STILL: MoveInput = { dx: 0, dz: 0, target: null };
/** With a friend, the supporter earns what the fight pays (enemies and the boss) into their own wallet, so they can
 *  upgrade and buy. Set "coop": { "supporterEarns": false } in game-config.json to switch it off. */
const SUPPORTER_EARNS = (config as unknown as { coop?: { supporterEarns?: boolean } }).coop?.supporterEarns !== false;
/** Where the place in a room is kept, so that a page loaded again can take it back. */
const COOP_KEY = config.gameId + ':coop';
/** Events too many to send through the server when the two devices cannot talk directly. */
const NOISY = new Set<string>(['fire', 'hit', 'bounce', 'enemyFire', 'arc']);
const HOT = new Color3(1, 0.45, 0.55), WARM = new Color3(1, 0.82, 0.4);

export class Game {
	readonly canvas: HTMLCanvasElement;
	readonly engine: Engine;
	readonly scene: Scene;
	readonly ui: Ui;
	readonly arena: Arena;
	readonly coins: CoinFx;
	save: Save = loadSave();
	world: World | null = null;
	attempt: Attempt | null = null;
	mode: Mode = 'loading';
	phase: Phase = 'waves';
	paused = false;
	stage = 0;
	run: Run | null = null;
	quiz: SavedQuiz | null = null;
	private input: Input;
	private sound = new Sound();
	private kit!: CharacterKit;
	private hero: Hero | null = null;
	private clock = 0; private timers: { at: number; fn: () => void }[] = [];
	private modeT = 0;
	private primary: (() => void) | null = null;
	private slow = 0; private trauma = 0; private shakeT = 0;
	private dragTarget: { x: number; z: number } | null = null;
	private dirty = false; private saveT = 0; private coinPitch = 0; private coinPitchT = 0;
	private tut = { step: -1, moved: 0, t: 0, lastX: 0, lastZ: 0, kills: 0 };
	private shopId: WeaponId = 'pulse'; private shopBack: () => void = () => {};
	private scaling = 1; private fpsT = 0; private fpsN = 0;
	private demo: string | null = null;
	/** The open Cyber box question: the options are shown in `order`; option 0 of the data is the right one. */
	private box: { list: QuickQuestion[]; index: number; right: number; rare: boolean; heart: boolean; order: number[]; done: boolean; beep: number; doneAt: number; together: boolean; heal: number } | null = null;
	// playing with a supporter: the connection, who is at the other end, their figure, and (on the supporter's device)
	// the picture of the main player's fight
	private link: Link | null = null; private peer: Peer | null = null;
	private hero2: Hero | null = null; private hero2Avatar: 'male' | 'female' = 'male';
	private mirror: Mirror | null = null; private guestLive = false; private guestNote = ''; private guestFightId = '';
	private closeTold = false;
	// with a friend: the supporter is busy with the report and their own questions; what to start when they are done;
	// the next fight is begun without them; (supporter) their own time after a boss; seconds left to wait for a
	// friend whose connection dropped
	private peerBusy = false; private pendingGo: (() => void) | null = null; private soloNext = false; private after = false; private awayT = 0;
	/** The supporter's fight, set aside while they visit the shop in the middle of it (they stand shielded meanwhile). */
	private shelf: { mirror: Mirror; attempt: Attempt | null; stage: number; bonus: boolean; live: boolean; gone: boolean; until: number } | null = null;
	private allyIn = { x: 2.4, z: 1.4, b: 0 }; private netT = 0; private ranSince = 0; private sentAt = 0; private inT = 0; private inviteCode = '';
	/** True while the last challenge (the code boss) is being played: one fight, no waves, no questions. */
	private bonus = false;
	/** The wave in which a new kind was last introduced: one card per wave at most, so reading never piles up. */
	private introWave = -9;
	private numberAt = new Map<number, number>(); private demoPowerAt = 0; private beatT = 0; private warnedLow = false;
	private disposers: (() => void)[] = [];

	constructor(readonly host: HTMLElement, readonly opts: GameOptions) {
		host.classList.add('cs-host');
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'cs-canvas';
		this.canvas.setAttribute('aria-label', ui('app.title'));
		host.appendChild(this.canvas);
		const overlay = document.createElement('canvas');
		overlay.className = 'cs-coins';
		overlay.setAttribute('aria-hidden', 'true');
		this.engine = new Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
		this.scene = new Scene(this.engine);
		this.scene.useRightHandedSystem = true;
		this.scene.skipPointerMovePicking = true;
		const cam = new FreeCamera('cam', new Vector3(-20, 30, 0), this.scene);
		this.arena = new Arena(this.scene, cam);
		this.ui = new Ui(host, opts.base, () => this.togglePause());
		host.appendChild(overlay);                                               // above the interface, so coins fly over the panels
		this.coins = new CoinFx(overlay, () => this.ui.walletPoint());
		this.coins.onArrive = (value, big) => {
			this.ui.coinArrived(value, big);
			this.sound.sfx('coin', this.coinPitch);
			this.coinPitch = Math.min(14, this.coinPitch + 1); this.coinPitchT = 0.5;
		};
		this.ui.onClick = () => { this.sound.unlock(); this.sound.sfx('click'); };
		this.ui.onPower = i => this.usePower(i); this.ui.onUpgrade = () => this.quickUpgrade(); this.ui.onArms = () => this.openFightShop();
		this.input = new Input(this.canvas);
		this.input.onAction = a => this.onAction(a);
		if (import.meta.env.DEV) this.demo = new URLSearchParams(location.search).get('demo');
		this.applySettings();
		this.resize();

		const on = (target: Window | Document, type: string, fn: () => void) => { target.addEventListener(type, fn); this.disposers.push(() => target.removeEventListener(type, fn)); };
		on(window, 'resize', () => this.resize());
		on(window, 'pagehide', () => { this.flushSave(); this.rememberLink(); });   // the place in the room is kept: coming back connects again
		on(window, 'blur', () => { if (this.mode === 'fight' && !this.paused) this.togglePause(); });
		on(document, 'visibilitychange', () => {
			if (document.hidden) { this.flushSave(); if ((this.mode === 'fight' || this.mode === 'countdown') && !this.paused) this.togglePause(); this.sound.suspend(true); }
			else if (!this.paused) this.sound.suspend(false);
		});
		this.engine.runRenderLoop(() => { this.tick(Math.min(this.engine.getDeltaTime() / 1000, 0.05)); this.scene.render(); });
	}

	async start() {
		this.ui.loading(0.1);
		await Promise.all([document.fonts.load('700 40px "Readex Pro"'), document.fonts.load('400 24px "Readex Pro"')]).catch(() => {});
		this.ui.loading(0.4);
		try { this.kit = await CharacterKit.load(this.scene, this.opts.base); }
		catch (e) {
			console.error(e);
			this.ui.modal({ cls: 'bad', title: ui('error.title'), lines: [ui('error.assets')], buttons: [{ label: ui('error.retry'), onClick: () => location.reload() }] });
			return;
		}
		this.ui.loading(1);
		// the Cyber Shield weapon throws shields that are Cyber's own shape
		let made = 0;
		this.arena.makeShield = () => { const root = new Cyber(this.kit, 'thrown' + made++, 2.1).root; for (const m of root.getChildMeshes()) m.layerMask |= CHARACTER_LAYER; return root; };
		this.restoreRun();
		this.returnToStageStart();                                               // the page was closed in the middle of a stage
		this.ui.setWallet(this.save.bank.wallet, true);
		const room = (new URLSearchParams(location.search).get('room') ?? '').trim().toUpperCase();
		if (/^[A-Z2-9]{5}$/.test(room)) this.inviteCode = room;
		const kept = this.inviteCode ? null : this.keptLink();
		if (!this.save.profileDone) this.showProfile();
		else if (this.inviteCode) { this.showMenu(); void this.joinRoom(this.inviteCode); }
		else if (kept) this.resumeCoop(kept);
		else if (this.save.quiz && !this.save.quiz.done) this.resumeQuiz();
		else this.showMenu();
	}

	// ------------------------------------------------------------------ small tools
	private later(seconds: number, fn: () => void) { this.timers.push({ at: this.clock + seconds, fn }); }
	private setMode(m: Mode) { this.mode = m; this.modeT = 0; this.input.reset(); this.dragTarget = null; this.tellScreen(); }
	private card(o: Parameters<Ui['modal']>[0]) { this.setMode('card'); this.primary = o.buttons[0]?.onClick ?? null; this.ui.modal(o); }
	private emit(type: string, data: unknown) { this.opts.onEvent?.(type, data); }
	private shake(amount: number) { if (!this.save.settings.noShake) this.trauma = Math.min(1, this.trauma + amount); }
	private resize() {
		this.engine.resize();
		this.arena.resize(this.canvas.clientWidth, this.canvas.clientHeight);
		this.coins.resize();
	}
	private applySettings() {
		const s = this.save.settings;
		this.sound.setMusic(s.music); this.sound.setSfx(s.sfx);
		this.arena.reduceMotion = s.reduceMotion; this.coins.reduceMotion = s.reduceMotion;
		this.host.classList.toggle('cs-reduce', s.reduceMotion);
		const coarse = matchMedia('(pointer: coarse)').matches, dpr = window.devicePixelRatio || 1;
		this.scaling = s.quality === 'low' ? 1 : 1 / Math.min(dpr, s.quality === 'high' ? 2 : coarse ? 1.5 : 2);
		this.engine.setHardwareScalingLevel(this.scaling);
	}
	private openSettings(back: () => void) { this.ui.settings(this.save.settings, () => { storeSave(this.save); this.applySettings(); }, back); }
	private flushSave() { this.dirty = false; storeSave(this.save); }
	private bank() { return this.save.bank; }
	private weaponLevel(id: WeaponId) { return this.save.bank.weapons[id] ?? 1; }

	// ------------------------------------------------------------------ the assessed run (kept across reloads)
	private restoreRun() {
		const r = this.save.run;
		if (!r) return;
		this.run = { runId: r.runId, displayName: r.displayName, avatarId: r.avatarId, variantId: 'base', passThresholdPercent: config.passThresholdPercent, recoveryCreditRate: config.recoveryCreditRate,
			states: { ...r.states }, accepted: new Map(r.ledger.map(e => [e.eventId, JSON.stringify([e.eventId, e.runId, e.checkpointId, e.actionId])])), ledger: r.ledger.slice(), completedAt: r.completedAt };
	}
	private ensureRun() {
		if (this.run) return;
		const name = normalizeName(this.save.name) ?? ui('menu.defaultName');
		this.run = { runId: uuid(), displayName: name, avatarId: this.save.avatar, variantId: 'base', passThresholdPercent: config.passThresholdPercent, recoveryCreditRate: config.recoveryCreditRate,
			states: Object.fromEntries(checkpoints.map(c => [c.id, 'unseen' as const])), accepted: new Map(), ledger: [], completedAt: null };
		this.persistRun(false);
		this.emit('game.started', { gameId: config.gameId, runId: this.run.runId });
	}
	private persistRun(reported: boolean) {
		const r = this.run!;
		this.save.run = { runId: r.runId, displayName: r.displayName, avatarId: r.avatarId, states: { ...r.states }, ledger: r.ledger.slice(), completedAt: r.completedAt, reported: reported || !!this.save.run?.reported };
	}
	private stageCheckpoints(i: number) { return missions[i].checkpoints; }
	/** The first time a stage's questions are answered they count for the knowledge score; later they are practice. */
	private stageIsAssessed(i: number) { return !!this.run && this.stageCheckpoints(i).some(c => !isResolved(this.run!.states[c.id])); }

	// ------------------------------------------------------------------ profile, menu, stage list
	private showProfile() {
		this.setMode('menu');
		this.ui.showHud(false); this.ui.showWallet(false);
		this.ui.profile({ name: this.save.name, avatar: this.save.avatar, valid: n => normalizeName(n) !== null, onDone: (name, avatar) => {
			this.sound.unlock();
			this.save.name = normalizeName(name) ?? ui('menu.defaultName'); this.save.avatar = avatar; this.save.profileDone = true;
			this.flushSave();
			this.showMenu();
			if (this.inviteCode) void this.joinRoom(this.inviteCode);                // came by an invitation link
		} });
	}

	private showMenu() {
		this.clearFight();
		this.bonus = false;
		this.returnToStageStart();                                               // a stage left in the middle is not kept
		this.setMode('menu');
		this.ui.showHud(false); this.ui.showWallet(true); this.ui.prompt(null); this.ui.countdown(null);
		this.ui.setWallet(this.bank().wallet, true);
		this.sound.music('menu', 0);
		this.stage = Math.min(stages.length, this.save.unlocked) - 1;
		this.arena.setStage(this.stage); this.arena.energy = 0.6;
		this.makeHero();
		this.attract();
		const next = Math.min(stages.length, this.save.unlocked);
		this.ui.menu({
			hasProgress: this.save.cleared.some(Boolean) || this.save.attempts > 0,
			next: ui('menu.next', { n: num(next), name: stages[next - 1].nameAr }),
			onPlay: () => (this.save.attempts > 0 ? this.showStages() : this.startStage(0)),
			onContinue: () => this.startStage(next - 1),
			onWeapons: () => this.openShop(() => this.showMenu()),
			onSettings: () => this.openSettings(() => this.showMenu()),
			onCodex: () => this.showCodex(),
			onCoop: () => this.openCoop(), friend: this.hosting ? ui('coop.chip', { name: this.peer!.name }) : '',
			bonus: this.save.cleared.every(Boolean) ? { label: ui('code.menu'), note: this.save.codeBossWins ? ui('code.menuWon', { n: num(this.save.codeBossWins) }) : ui('code.menuNote'), onClick: () => this.startBonus() } : undefined
		});
	}
	/** A live scene behind the menu: the equipped weapon at work against a stage's waves, harmless and unpaid. */
	private attract() {
		const id = this.bank().equipped;
		this.world = new World(stages[this.stage], this.stage, id, this.weaponLevel(id), { waves: true, seed: 'menu-' + this.clock });
		this.world.godMode = true;
	}
	private showStages() {
		this.ui.stages({
			list: stages.map((s, i) => ({ name: s.nameAr, topic: s.topicAr, open: i < this.save.unlocked, cleared: !!this.save.cleared[i], total: 0 })),
			onPick: i => this.startStage(i), onBack: () => this.showMenu()
		});
	}
	private makeHero() {
		if (this.hero) return;
		this.hero = new Hero(this.scene, this.kit, this.save.avatar);
		for (const m of this.hero.rig.getChildMeshes()) m.layerMask |= CHARACTER_LAYER;      // lit by their own steady light, not by the land's sun
	}
	private clearFight() {
		this.arena.spotlight = null; this.introWave = -9;
		this.timers = []; this.paused = false; this.slow = 0; this.world = null; this.mirror = null; this.guestLive = false; this.attempt = null; this.tut.step = -1; this.box = null; this.numberAt.clear(); this.closeTold = false;
		this.coins.flush(); this.arena.clear();
		this.ui.prompt(null); this.ui.countdown(null);
	}

	// ------------------------------------------------------------------ a stage
	startStage(index: number, intro = true) {
		this.sound.unlock();
		this.clearFight();
		this.returnToStageStart();                                               // starting again never keeps a stage that was not finished
		this.bonus = false;
		this.ensureRun();
		this.stage = index;
		this.save.attempts++;
		if (this.save.quiz?.done) this.save.quiz = null;
		this.flushSave();
		this.arena.setStage(index); this.arena.energy = 0.6;
		this.makeHero();
		this.ui.showHud(false); this.ui.showWallet(true);
		this.sound.music('menu', 0);
		const s = stages[index];
		const begin = () => {
			this.ui.closeLayer();
			if (!this.save.tutorialDone && !this.hosting) this.startTutorial(); else this.beginFight();
		};
		if (!intro) { begin(); return; }
		this.card({ cyber: true, title: ui('stage.title', { n: num(index + 1), name: s.nameAr }),
			lines: [index === 0 && !this.save.cleared[0] ? content.story.introAr : '', ui('stage.place', { place: s.placeAr }), ui('stage.topic', { topic: s.topicAr }), ui('stage.boss', { name: s.boss.nameAr })],
			buttons: [{ label: ui('stage.go'), onClick: begin }, { label: ui('menu.weapons'), kind: 'ghost', onClick: () => this.openShop(() => this.startStage(index)) }] });
	}

	private beginFight() {
		if (this.waitForPeer(() => this.beginFight())) return;
		const index = this.stage, id = this.bank().equipped;
		this.attempt = new Attempt(uuid(), index);
		this.save.stageStart = { stage: index, bank: JSON.parse(JSON.stringify(this.bank())) };   // a lost stage returns to this
		this.flushSave();
		this.warnedLow = false;
		this.world = new World(stages[index], index, id, this.weaponLevel(id), { waves: true, seed: this.attempt.id, crates: true });
		this.enlist(this.world);
		this.phase = 'waves';
		this.arena.clear(); this.arena.energy = 1;
		this.ui.showHud(true);
		this.startCountdown();
	}

	// ------------------------------------------------------------------ the last challenge: the code boss, after the campaign
	/** One fight against the hardest boss. No waves and no questions: it never touches the knowledge score. */
	startBonus(intro = true) {
		this.sound.unlock();
		this.clearFight();
		this.returnToStageStart();
		this.bonus = true;
		this.stage = stages.length - 1;                                          // box questions and the shop preview use the last stage
		this.arena.setStage(stages.length); this.arena.energy = 0.6;
		this.makeHero();
		this.ui.showHud(false); this.ui.showWallet(true);
		this.sound.music('menu', 0);
		const begin = () => { this.ui.closeLayer(); this.beginBonus(); };
		if (!intro) { begin(); return; }
		this.card({ cyber: true, title: ui('code.title'),
			lines: [ui('code.intro'), ui('code.brackets'), ui(this.save.codeBossPaid ? 'code.rewardDone' : 'code.reward', { amount: num(bonusStage.bossReward) }), ui('code.note')],
			buttons: [{ label: ui('stage.go'), onClick: begin }, { label: ui('menu.weapons'), kind: 'ghost', onClick: () => this.openShop(() => this.startBonus()) }, { label: ui('back'), kind: 'ghost', onClick: () => this.showMenu() }] });
	}
	private beginBonus() {
		if (this.waitForPeer(() => this.beginBonus())) return;
		const id = this.bank().equipped;
		this.save.attempts++;
		this.attempt = new Attempt(uuid(), this.stage);
		this.save.stageStart = { stage: this.stage, bank: JSON.parse(JSON.stringify(this.bank())) };
		this.flushSave();
		this.warnedLow = false;
		this.world = new World(bonusStage, stages.length, id, this.weaponLevel(id), { waves: false, seed: this.attempt.id, crates: true });
		this.enlist(this.world);
		this.phase = 'waves';
		this.arena.clear(); this.arena.energy = 1;
		this.ui.showHud(true);
		this.startCountdown(() => this.bossWarning());
	}
	private showCodeWin(first: boolean, reward: number) {
		this.setMode('card');
		this.world = null; this.arena.clear(); this.arena.energy = 0.4;
		this.ui.showHud(false);
		this.sound.sfx('win');
		this.card({ cls: 'good', cyber: true, icon: ICON.star, title: ui('code.winTitle'),
			lines: [ui('code.win'), first ? ui('code.paid', { amount: num(reward) }) : ui('code.again'), ui('code.note')],
			html: `<div class="cs-codewin"><b>${ICON.star}${ui('code.badge')}</b><img src="${this.opts.base}assets/omcode-logo.svg" alt="OMCode"></div>`,
			buttons: [{ label: ui('menu.main'), onClick: () => this.showMenu() }, { label: ui('code.replay'), kind: 'ghost', onClick: () => this.startBonus(false) }] });
	}

	private startCountdown(then?: () => void) {
		this.ui.closeLayer();
		this.setMode('countdown');
		const steps = [num(3), num(2), num(1), ui('count.go')];
		steps.forEach((text, i) => this.later(i * 0.55, () => { if (this.mode !== 'countdown') return; this.ui.countdown(text); this.tell({ t: 'count', text }); this.sound.sfx(i < 3 ? 'tick' : 'go'); }));
		this.later(steps.length * 0.55 - 0.15, () => {
			if (this.mode !== 'countdown') return;
			this.ui.countdown(null);
			this.setMode('fight');
			this.sound.music(this.phase === 'boss' ? 'boss' : 'run', 0.5);
			then?.();
		});
	}

	// ------------------------------------------------------------------ first-run practice: move, dodge, shoot and collect
	private startTutorial() {
		this.world = new World(stages[0], 0, 'pulse', 1, { waves: false, seed: 'tutorial' });
		this.world.firing = false;
		this.attempt = null;
		this.phase = 'tutorial';
		this.tut = { step: 0, moved: 0, t: 0, lastX: this.world.player.x, lastZ: this.world.player.z, kills: 0 };
		this.arena.energy = 0.8;
		this.ui.showHud(true);
		this.setMode('fight');
		this.sound.music('run', 0.2);
	}
	private runTutorial(dt: number) {
		const w = this.world!, t = this.tut, p = w.player;
		t.t += dt;
		if (t.step === 0) {
			this.ui.prompt(ui(this.input.touch ? 'tut.move.touch' : 'tut.move.keys'));
			t.moved += Math.hypot(p.x - t.lastX, p.z - t.lastZ); t.lastX = p.x; t.lastZ = p.z;
			if (t.moved > 5) { t.step = 1; t.t = 0; }
		} else if (t.step === 1) {
			this.ui.prompt(ui('tut.dodge'));
			if (t.t > 0.8 && Math.floor(t.t / 1.3) !== Math.floor((t.t - dt) / 1.3) && t.t < 6.2) w.fan(17, (w.rnd() - 0.5) * 4, 3, 0.5, 4.2, w.aim(17, 0));
			if (t.t > 8) {
				t.step = 2; t.t = 0; w.firing = true; w.bullets = [];
				for (const z of [-2.2, 0, 2.2]) { const e = w.director.spawn({ kind: 'normal', index: -1, at: 0, sx: 22, sz: z, hx: 13.5, hz: z, pattern: 0, shooter: false }); e.stay = 999; }
			}
		} else if (t.step === 2) {
			this.ui.prompt(ui('tut.shoot'));
			if (t.kills >= 3) { t.step = 3; t.t = 0; }
		} else if (t.step === 3) {
			this.ui.prompt(ui('tut.done'));
			if (t.t > 2) { this.ui.prompt(null); this.save.tutorialDone = true; this.flushSave(); t.step = -1; this.beginFight(); }
		}
	}

	// ------------------------------------------------------------------ what happens in a fight
	private onSimEvent(e: SimEvent) {
		const w = this.world!;
		this.arena.show(e, w);
		switch (e.type) {
			case 'fire': this.sound.sfx(e.weapon); break;
			case 'hit': this.sound.sfx(e.blocked ? 'block' : 'hit'); if (e.weapon === 'shield') this.shake(0.1); break;
			case 'bounce': this.sound.sfx('hit'); break;
			case 'explode': this.sound.sfx('boom'); if (e.weapon === 'plasma' || e.weapon === 'shield') this.shake(0.14); break;
			case 'zone': this.sound.sfx('zone'); this.shake(0.2); break;
			case 'wave': this.sound.sfx('wave'); if (e.index > 0) this.ui.banner('info', ui('fight.wave', { n: num(e.index + 1), total: num(e.total) }), 1.2); break;
			case 'kill': this.damageNumber(e.enemy, true); this.onKill(e.enemy, e.by === 0); break;
			case 'crateIn': this.sound.sfx('crate'); if (e.rare) this.sound.sfx('bonus'); this.ui.banner('good', ui(e.rare ? 'box.rareIncoming' : e.heart ? 'box.heartIncoming' : 'box.incoming'), e.rare ? 3.2 : 2.6); break;
			case 'crate':
				this.sound.sfx('boom');
				if (e.by === 1 && w.ally) { w.setBusy(1, true); this.tell({ t: 'box', rare: e.rare, heart: e.heart }); this.ui.banner('info', ui('coop.boxFriend'), 2.4); }   // the supporter opened it: the question is theirs
				else this.openBox(e.rare, e.heart);
				break;
			case 'allyHit': this.sound.sfx('hurt'); break;
			case 'down': this.sound.sfx('lost'); this.shake(0.5); this.ui.banner('alarm', ui(e.who === 0 ? 'coop.down.me' : 'coop.down.friend'), 3); break;
			case 'revive': this.sound.sfx('right'); this.sound.sfx('power'); this.ui.banner('good', ui(e.by === 0 ? 'coop.revived' : 'coop.revivedMe'), 2.2); break;
			case 'revived': {                                                        // a stored backup was spent to bring the player back
				if (e.who === 1) { this.allyIn.b = Math.max(0, this.allyIn.b - 1); this.tell({ t: 'backupUsed' }); this.sound.sfx('power'); break; }   // the supporter's own backup
				const i = this.save.powers.indexOf('backup'); if (i >= 0) this.save.powers.splice(i, 1);
				this.flushSave();
				this.sound.sfx('power'); this.sound.sfx('right'); this.shake(0.6); this.slow = 0.8;
				this.ui.banner('good', ui('power.backup.saved'), 2.4);
				break;
			}
			case 'nova': this.ui.nova(this.save.settings.reduceMotion); this.sound.sfx('bigBoom'); this.sound.sfx('bossDown'); this.sound.sfx('power'); this.shake(1); this.slow = 1.4; this.later(0.35, () => this.shake(0.8)); this.later(0.8, () => { this.sound.sfx('bigBoom'); this.shake(0.6); }); break;
			case 'power': this.sound.sfx('power'); if (e.power === 'bomb' || e.power === 'mega') this.sound.sfx('bigBoom'); this.shake(e.power === 'mega' ? 1 : e.power === 'bomb' ? 0.8 : 0.35); if (e.power === 'mega') this.slow = 0.7; break;
			case 'playerHit':
				this.sound.sfx('hurt'); this.shake(0.6); this.ui.hurt(this.save.settings.reduceMotion);
				this.hero?.avatar.setExpression('Surprised', 1);
				if (this.phase === 'tutorial') { w.player.hp = w.player.maxHp; this.ui.banner('info', ui('tut.hit'), 1.6); }
				break;
			case 'playerDead': this.lost(); break;
			case 'wavesDone': this.bossWarning(); break;
			case 'bossPhase': this.sound.sfx('phase'); this.shake(0.4); this.ui.banner('alarm', ui('fight.phase', { n: num(e.phase + 1) }), 1.6); break;
			case 'bossDead': this.damageNumber(e.enemy, true); this.bossDown(e.enemy); break;
		}
	}

	/** A small enemy destroyed: the money is credited and saved first, then the coins are shown. */
	private onKill(e: Enemy, mine = true) {
		this.sound.sfx('boom');
		const at = this.arena.toScreen(e.x, 0.5, e.z);
		if (this.phase === 'tutorial') { this.tut.kills++; this.coins.spawn(at.x, at.y, 1, 'small', 1); return; }
		if (!mine) return;                                                       // the friend's kill pays the friend
		if (e.kind === 'boss' || e.kind === 'turret' || e.kind === 'crate' || e.index < 0 || !this.attempt) return;
		const amount = enemyReward[e.kind];
		if (!this.attempt.credit(this.bank(), 'kill:' + e.index, amount)) return;
		this.dirty = true;
		this.ui.setWallet(this.bank().wallet, false);
		this.coins.spawn(at.x, at.y, amount, e.kind === 'rare' ? 'big' : 'small', e.kind === 'normal' ? 1 : e.kind === 'armored' ? 3 : 5);
		if (e.kind === 'rare') this.ui.banner('good', ui('fight.rare'), 1.2);
	}

	private bossWarning() {
		if (this.phase !== 'waves') return;
		this.phase = 'warn';
		const w = this.world!;
		this.flushSave();
		this.sound.music('boss', 1); this.sound.sfx('alarm');
		this.arena.energy = 1.6;
		this.ui.banner('alarm', ui('fight.bossWarning', { name: w.stage.boss.nameAr }), 2.6);
		this.later(2.8, () => { if (this.world !== w || this.phase !== 'warn') return; w.director.startBoss(); this.phase = 'boss'; });
	}

	/** The boss falls: danger is already cleared, the reward is paid and saved, then the celebration plays. */
	private bossDown(boss: Enemy) {
		const w = this.world!, s = w.stage, at = this.arena.toScreen(boss.x, 0.6, boss.z);
		if (this.mode === 'box') { this.box = null; this.ui.closeLayer(); if (w.ally) w.setBusy(0, false); this.setMode('fight'); }      // the boss fell while a box was open
		this.phase = 'down';
		this.save.stageStart = null;                                             // from here the money of this stage is kept for good
		const bonus = this.bonus, first = bonus && !this.save.codeBossPaid, st = w.stats, both = !!w.ally, onBoss = st[0].boss + st[1].boss;
		// with a friend the boss's reward is divided by the damage each did to it (the code boss pays the main player only)
		const reward = bonus ? (first ? s.bossReward : 0) : both && onBoss > 0 ? Math.round(s.bossReward * st[0].boss / onBoss) : s.bossReward, theirs = both && !bonus ? s.bossReward - reward : 0;
		if (bonus) { this.save.codeBossWins++; if (first) { this.save.codeBossPaid = true; this.bank().wallet += reward; } }   // paid once, ever
		else this.attempt?.credit(this.bank(), 'boss', reward);
		const count = (i: number) => [Math.round(st[i].damage * 10), st[i].kills];
		const rows = [{ name: this.save.name, me: true, damage: count(0)[0], kills: count(0)[1] }];
		if (both) { rows.push({ name: this.peer?.name ?? '', me: false, damage: count(1)[0], kills: count(1)[1] }); if (this.hosting) { this.peerBusy = true; this.tell({ t: 'report', stats: [count(0), count(1)], reward: theirs }); } }
		this.flushSave();
		this.slow = 1.1;
		this.sound.sfx('bigBoom'); this.sound.sfx('bossDown'); this.shake(1);
		this.sound.music('menu', 0);
		this.hero?.avatar.play('celebrate'); this.hero?.cyber.setExpression('Happy');
		// it comes apart in several bursts, not one
		for (let i = 1; i <= 4; i++) this.later(i * 0.22, () => this.arena.burst(boss.x + (Math.random() - 0.5) * 2.4, 0.8, boss.z + (Math.random() - 0.5) * 2.4, i % 2 ? HOT : WARM, 26));
		this.later(1.1, () => {
			if (!reward) return;
			this.ui.setWallet(this.bank().wallet, false);
			this.ui.banner('good', ui('fight.bossReward', { amount: num(reward) }), 2.4);
			this.coins.spawn(at.x, at.y, reward, 'huge', 16);
		});
		this.later(3.6, () => { if (this.world !== w) return; this.showReport(rows, s.boss.nameAr, () => { if (bonus) this.showCodeWin(first, reward); else this.openQuiz(); }); });
	}
	/** The count of the fight, shown when the boss has fallen: total damage and kills of each fighter. */
	private showReport(rows: { name: string; me: boolean; damage: number; kills: number }[], bossName: string, next: () => void) {
		const best = rows.length > 1 ? (rows[0].damage >= rows[1].damage ? 0 : 1) : -1;
		this.setMode('card');
		this.ui.showHud(false); this.ui.prompt(null);
		this.sound.sfx('bonus');
		const go = () => { this.primary = null; next(); };
		this.primary = go;
		this.ui.report({ title: ui('report.title'), sub: ui('report.sub', { name: bossName }), players: rows.map((r, i) => ({ ...r, best: i === best })), onNext: go });
	}

	private lost() {
		const w = this.world!, lostAmount = this.attempt?.total ?? 0, index = this.stage;
		const undone = this.returnToStageStart();
		this.setMode('card');
		this.flushSave();
		this.sound.sfx('lost'); this.sound.music('menu', 0);
		this.hero?.avatar.play('sad');
		this.ui.prompt(null);
		const show = () => this.card({ cls: 'bad', cyber: true, icon: ICON.heart, title: ui('lost.title'), lines: [ui('lost.text'), ui('lost.kept', { amount: num(this.bank().wallet), lost: num(lostAmount) }), undone ? ui('lost.upgrades') : ''], buttons: [
			{ label: ui('lost.retry'), onClick: () => (this.bonus ? this.startBonus(false) : this.startStage(index, false)) },
			{ label: ui('menu.weapons'), kind: 'ghost', onClick: () => this.openShop(show) },
			{ label: ui('menu.main'), kind: 'ghost', onClick: () => this.showMenu() }] });
		this.later(0.9, () => { if (this.world === w) show(); });
	}

	/** A stage that was lost or left before its boss fell: the bank is again what it was on entering it (money collected
	 *  in the attempt is gone, and upgrades bought during it are undone with their price returned). Powers that were used
	 *  stay used. Returns true when weapons changed back. */
	private returnToStageStart(): boolean {
		const at = this.save.stageStart;
		if (!at) return false;
		const undone = JSON.stringify(at.bank.weapons) !== JSON.stringify(this.bank().weapons);
		this.coins.flush();
		this.save.bank = at.bank; this.save.stageStart = null;
		this.flushSave();
		this.ui.setWallet(this.bank().wallet, true);
		return undone;
	}

	// ------------------------------------------------------------------ what the enemies are
	private malwareKey(e: Enemy) { if (e.kind === 'boss') return 'boss.' + this.world!.stage.boss.id; return this.arena.kindOf(e); }
	/** Looks for an enemy of a kind not introduced yet, standing in view. Small kinds wait their turn (one per wave). */
	private findNewMalware(w: World): Enemy | null {
		if (this.phase === 'tutorial' || this.phase === 'down') return null;
		for (const e of w.enemies) {
			if (e.dead || e.mode !== 'hold' || e.kind === 'crate' || e.kind === 'turret' || e.x > 18 || e.age < 0.35) continue;
			const key = this.malwareKey(e);
			if (!MALWARE[key] || this.save.met.includes(key)) continue;
			if (e.kind !== 'boss' && w.director.wave === this.introWave) continue;
			return e;
		}
		return null;
	}
	/** The fight waits while the card of a new enemy is read. The enemy stays in view with its name beside it. */
	private introduce(e: Enemy) {
		const w = this.world!, key = this.malwareKey(e), info = MALWARE[key];
		if (e.kind !== 'boss') this.introWave = w.director.wave;
		this.save.met.push(key);
		this.flushSave();
		this.setMode('intro');
		this.ui.prompt(null);
		this.arena.spotlight = e;
		this.sound.sfx('equip');
		const top = this.arena.toScreen(e.x + e.r + 0.55, 0.6, e.z);            // above the enemy, clear of its shape
		this.ui.malware({ key, boss: e.kind === 'boss', name: info.nameAr, what: info.whatAr, guard: info.guardAr, color: info.color, at: top,
			onOk: () => { this.arena.spotlight = null; this.ui.closeLayer(); if (this.world === w) { w.player.invuln = Math.max(w.player.invuln, 0.9); this.setMode('fight'); } } });
	}
	private showCodex() {
		this.ui.codex({ onBack: () => this.showMenu(), items: malware.order.map(key => ({ key, name: MALWARE[key].nameAr, what: MALWARE[key].whatAr, guard: MALWARE[key].guardAr, color: MALWARE[key].color, met: this.save.met.includes(key) })) });
	}

	// ------------------------------------------------------------------ damage numbers, the Cyber box, emergency powers, quick upgrade
	/** Shows the damage an enemy has taken since its last number (ten points for each unit of damage). */
	private damageNumber(e: Enemy, final = false) {
		const took = e.took ?? 0;
		if (took < 0.05) return;
		if (!final && this.clock - (this.numberAt.get(e.id) ?? -1) < (e.kind === 'boss' ? 0.3 : 0.22)) return;
		this.numberAt.set(e.id, this.clock); e.took = 0;
		const at = this.arena.toScreen(e.x + e.r * 0.5, 0.8, e.z + (Math.random() - 0.5) * e.r), n = Math.max(1, Math.round(took * 10));
		this.coins.text(at.x, at.y, num(n), n >= 80 ? 'big' : n >= 30 ? 'mid' : 'small');
	}
	/** A Cyber box was opened: the fight stops and a quick, timed question decides whether it holds a power. The rare
	 *  black box asks two: both right gives Total Awareness, one right gives an ordinary power.
	 *  These questions are practice: they never touch the decision ledger or the knowledge score. */
	private openBox(rare = false, heart = false) {
		const guest = !!this.mirror, w = this.world, together = guest || !!w?.ally;
		if (guest ? this.mode !== 'guest' : this.mode !== 'fight' || this.phase === 'down' || this.phase === 'tutorial') { if (guest) this.tell({ t: 'boxDone', heal: 0 }); return; }
		const need = rare ? 2 : 1, mine = quick.questions.filter(q => q.stage === this.stage), fresh = mine.filter(q => !this.save.quickSeen.includes(q.id));
		const pool = (fresh.length >= need ? fresh : mine.length >= need ? mine : quick.questions).slice();
		const list: QuickQuestion[] = [];
		for (let n = need; n > 0 && pool.length; n--) list.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
		this.box = { list, index: 0, right: 0, rare, heart, order: [], done: false, beep: 5, doneAt: 0, together, heal: 0 };
		this.ui.prompt(null); this.ui.countdown(null);
		this.sound.sfx('package'); if (!together) this.sound.music('read');      // with a friend the fight goes on behind the question
		this.askBox();
	}
	private askBox() {
		const b = this.box!, q = b.list[b.index], order = [0, 1, 2];
		for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
		b.order = order; b.done = false; b.beep = 5;
		// with a friend the fight does not wait: whoever answers stands shielded until the answer or the end of the time
		if (this.mirror) this.tell({ t: 'boxBusy' }); else if (b.together) this.world?.setBusy(0, true);
		this.setMode('box');                                                     // the clock of the question starts again
		this.ui.box({ title: ui(b.rare ? 'box.rareTitle' : b.heart ? 'box.heartTitle' : 'box.title'), heart: b.heart, step: b.list.length > 1 ? ui('box.step', { n: num(b.index + 1), total: num(b.list.length) }) : '', rare: b.rare,
			prompt: q.qAr, options: order.map(i => q.options[i]), seconds: quick.seconds, onPick: i => this.answerBox(i) });
	}
	/** `shown` is the position tapped on screen, or null when the time ran out. */
	private answerBox(shown: number | null) {
		const b = this.box;
		if (!b || b.done || this.mode !== 'box') return;
		b.done = true; b.doneAt = this.clock;
		const q = b.list[b.index], correct = shown !== null && b.order[shown] === 0, last = b.index === b.list.length - 1;
		if (correct) b.right++;
		if (!this.save.quickSeen.includes(q.id)) this.save.quickSeen.push(q.id);
		let power: { id: string; name: string; desc: string } | null = null, note = '';
		if (!last) note = ui(correct ? 'box.oneMore' : 'box.oneMoreWrong');
		else if (b.heart) {                                                      // a right answer gives one heart or two, by chance
			if (correct) { const want = Math.random() < 0.5 ? 1 : 2, n = this.mirror ? (b.heal = want) : this.world?.heal(want) ?? 0; power = { id: 'heart', name: ui(n >= 2 ? 'box.hearts2' : 'box.hearts1'), desc: ui('box.heartsDesc') }; note = ui('box.heartWon'); }
			else note = ui('box.heartNone');
		} else {
			let id: PowerId | null = null;
			if (b.rare && b.right === b.list.length) { id = 'aware'; this.save.powers.push(id); if (this.save.powers.length > 3) this.save.powers.shift(); }
			else if (b.right > 0) id = this.grantPower();
			if (id) power = { id, name: ui('power.' + id), desc: ui('power.' + id + '.desc') };
			if (b.rare && b.right === 1) note = ui('box.rareHalf'); else if (b.rare && b.right === 0) note = ui('box.rareNone');
		}
		this.sound.sfx(correct ? 'right' : 'wrong');
		if (power) { this.sound.sfx('bonus'); this.hero?.avatar.play('happy'); }
		this.flushSave();
		this.ui.boxResult({ picked: shown, right: b.order.indexOf(0), why: q.whyAr, power, note, nextLabel: last ? '' : ui('box.nextQuestion'),
			onNext: () => { if (this.box !== b) return; if (!last) { b.index++; this.askBox(); } else this.closeBox(); } });
	}
	/** The box is finished. Alone, the fight returns after a countdown; with a friend it never stopped, so the shield
	 *  simply comes off. */
	private closeBox() {
		const b = this.box, w = this.world;
		this.box = null;
		if (this.mirror) { this.tell({ t: 'boxDone', heal: b?.heal ?? 0 }); this.ui.closeLayer(); this.setMode('guest'); if (this.guestNote) this.guestWait(this.guestNote); return; }
		if (w?.ally) { w.setBusy(0, false); this.ui.closeLayer(); this.setMode('fight'); return; }
		this.startCountdown();
	}
	/** One more power in the store (three at most; the oldest makes room). Stronger ones appear in later stages. */
	private grantPower(): PowerId {
		const allowed = POWERS.filter(p => this.stage >= (POWER_FROM[p] ?? 0));
		const fresh = allowed.filter(p => !this.save.powers.includes(p)), pool = fresh.length ? fresh : allowed;
		const id = pool[Math.floor(Math.random() * pool.length)];
		this.save.powers.push(id);
		if (this.save.powers.length > 3) this.save.powers.shift();
		return id;
	}
	/** The emergency button: uses the first stored power. It is spent and saved before anything is shown. */
	usePower(index = 0) {
		if (this.mirror) {                                                       // the supporter: the power is spent here and happens in the main player's fight
			const me = this.mirror.ally.body, own = this.save.powers[index];
			if (this.mode !== 'guest' || !this.guestLive || !own || me.down || me.busy) return;
			if (own === 'backup') { this.ui.banner('info', ui('power.backup.auto'), 2); return; }
			this.save.powers.splice(index, 1);
			this.flushSave();
			this.tell({ t: 'power', id: own });
			this.ui.banner('good', ui('power.used', { name: ui('power.' + own) }), 1.6);
			return;
		}
		const w = this.world;
		if (!w || this.mode !== 'fight' || this.paused || w.over || this.phase === 'tutorial' || this.phase === 'down' || !this.save.powers[index]) return;
		if (this.save.powers[index] === 'backup') { this.ui.banner('info', ui('power.backup.auto'), 2); return; }   // it is kept for the moment health runs out
		const id = this.save.powers.splice(index, 1)[0];
		this.flushSave();
		w.usePower(id);
		this.ui.banner('good', ui('power.used', { name: ui('power.' + id) }), 1.6);
		if (id === 'aware') this.later(World.NOVA_DELAY * 0.5, () => this.sound.sfx('fall'));   // the whistle of the falling bomb
	}
	/** The upgrade button of a fight: one level for the equipped weapon, paid from the wallet, in effect at once. */
	quickUpgrade() {
		const w = this.world, guest = this.mirror;
		if (!w || (guest ? this.mode !== 'guest' || !this.guestLive : this.mode !== 'fight' || this.paused || w.over || this.phase === 'tutorial')) return;
		const id = this.bank().equipped, r = upgradeWeapon(this.bank(), id);
		if (!r.ok) { this.sound.sfx('deny'); if ('missing' in r && r.missing) this.ui.banner('info', ui('upgrade.need', { amount: num(r.missing) }), 1.4); return; }
		this.flushSave();
		const level = this.weaponLevel(id), me = guest ? guest.ally.body : w.player;
		if (guest) { guest.ally.weapon.level = level; this.tellGun(); }          // the supporter's weapon lives in the main player's fight
		else w.setWeaponLevel(level);
		this.ui.setWallet(this.bank().wallet, true);
		this.sound.sfx('upgrade');
		this.ui.banner('good', ui('upgrade.done', { n: num(level) }), 1.6);
		this.arena.burst(me.x, 1, me.z, WARM, 34);
	}

	/** The weapons button of a fight: the fight waits while the shop is open (change the weapon, buy one, upgrade), then
	 *  goes on after a countdown with whatever is equipped now. */
	openFightShop() {
		if (this.mirror) { this.guestFightShop(); return; }
		const w = this.world;
		if (!w || this.mode !== 'fight' || this.paused || w.over || this.phase === 'tutorial' || this.phase === 'down' || w.ally) return;
		const kept = { attempt: this.attempt, phase: this.phase, timers: this.timers, stage: this.stage };
		this.flushSave();
		this.openShop(() => {
			this.world = w; this.attempt = kept.attempt; this.phase = kept.phase; this.timers = kept.timers; this.stage = kept.stage;
			const id = this.bank().equipped;
			if (w.weapon.id !== id) { w.weapon.id = id; w.weapon.queue = []; w.weapon.cool = 0.4; w.beam.on = false; }
			w.setWeaponLevel(this.weaponLevel(id));
			this.arena.clear(); this.arena.energy = kept.phase === 'boss' || kept.phase === 'warn' ? 1.6 : 1;
			this.ui.showHud(true);
			this.startCountdown();
		});
	}

	// ------------------------------------------------------------------ the three questions
	private openQuiz() {
		const index = this.stage, cps = this.stageCheckpoints(index), attempt = this.attempt ?? (this.attempt = new Attempt(uuid(), index)), guest = this.link?.role === 'guest';
		const answers: QuizAnswer[] = cps.map(cp => {
			const all = variantsOf(cp.id), seen = this.save.seen[cp.id] ?? [];
			const fresh = all.filter(v => !seen.includes(v.id)), pool = fresh.length ? fresh : all;
			const variant = pool[Math.floor(Math.random() * pool.length)];
			return { checkpointId: cp.id, variantId: variant.id, order: shuffleForRun(variant.options.map(o => o.actionId), attempt.id, cp.id), picked: null, correct: null, fixed: false };
		});
		// the supporter's questions are their own (other situations, their own rials) and are practice: they never
		// enter a decision ledger, and nothing of them is kept as progress
		this.quiz = { attemptId: attempt.id, stage: index, assessed: guest ? false : this.stageIsAssessed(index), index: 0, answers, paid: attempt.toJSON(), done: false, guest };
		if (!guest) this.save.quiz = this.quiz;
		this.flushSave();
		this.enterQuiz();
	}
	/** After a reload in the middle of the questions: continue the same session; nothing already paid is paid again. */
	private resumeQuiz() {
		this.quiz = this.save.quiz!;
		this.stage = this.quiz.stage;
		this.attempt = new Attempt(this.quiz.attemptId, this.stage, this.quiz.paid);
		this.arena.setStage(this.stage);
		this.makeHero();
		this.enterQuiz();
	}
	private enterQuiz() {
		this.world = null;
		this.arena.clear(); this.arena.energy = 0.25;
		this.ui.showHud(false); this.ui.showWallet(true); this.ui.prompt(null);
		this.ui.setWallet(this.bank().wallet, this.coins.flying === 0);
		this.sound.music('read');
		this.showQuestion();
	}
	private showQuestion() {
		const q = this.quiz!, s = stages[q.stage];
		if (q.index >= q.answers.length) { this.finishQuiz(); return; }
		const a = q.answers[q.index], cp = checkpoints.find(c => c.id === a.checkpointId)!, variant = variantsOf(cp.id).find(v => v.id === a.variantId)!;
		this.setMode('quiz');
		this.ui.quiz({ index: q.index, rewards: s.questionRewards, label: cp.labelAr, variant,
			packs: q.answers.map(x => (x.correct === null ? 'waiting' : x.correct ? 'won' : 'lost')),
			options: a.order.map(id => variant.options.find(o => o.actionId === id)!),
			onConfirm: id => this.confirmAnswer(id) });
		if (a.picked !== null) this.showAnswerResult(false);                      // reloaded after confirming: show the stored result
	}

	/** One confirmed answer. It cannot be changed, and its package cannot be opened twice. */
	confirmAnswer(actionId: string) {
		const q = this.quiz!, a = q.answers[q.index];
		if (!a || a.picked !== null || this.mode !== 'quiz') return;
		const cp = checkpoints.find(c => c.id === a.checkpointId)!, s = stages[q.stage];
		a.picked = actionId; a.correct = actionId === cp.safeActionId;
		if (q.assessed) this.record(cp, actionId);
		if (a.correct) this.attempt!.credit(this.bank(), 'q' + (q.index + 1), s.questionRewards[q.index]);
		const seen = this.save.seen[cp.id] ?? (this.save.seen[cp.id] = []);
		if (!seen.includes(a.variantId)) seen.push(a.variantId);
		q.paid = this.attempt!.toJSON();
		this.flushSave();                                                        // before any animation
		this.showAnswerResult(true);
	}
	private record(cp: CheckpointDef, actionId: string) {
		const run = this.run!;
		const r = applyAction(run, { eventId: uuid(), runId: run.runId, checkpointId: cp.id, actionId });
		if (!r.accepted) { console.warn('decision refused', r.reason); return; }
		this.persistRun(false);
		this.emit('game.decision', { gameId: config.gameId, checkpointId: cp.id, actionId, safe: actionId === cp.safeActionId });
	}
	private showAnswerResult(animate: boolean) {
		const q = this.quiz!, i = q.index, a = q.answers[i], s = stages[q.stage];
		const cp = checkpoints.find(c => c.id === a.checkpointId)!, variant = variantsOf(cp.id).find(v => v.id === a.variantId)!;
		const amount = s.questionRewards[i];
		this.ui.setPack(i, a.correct ? 'won' : 'lost');
		if (animate) {
			if (a.correct) {
				this.sound.sfx('right'); this.sound.sfx('package');
				this.hero?.avatar.play('happy');
				this.ui.setWallet(this.bank().wallet, false);
				const from = this.ui.pointOf(`[data-pack="${i}"] .cs-pack-box`);
				if (from) this.later(0.35, () => this.coins.spawn(from.x, from.y, amount, i === 2 ? 'huge' : 'big', 8 + i * 3));
			} else this.sound.sfx('wrong');
		}
		const mustFix = q.assessed && !a.correct && !a.fixed;
		this.ui.quizResult({ correct: !!a.correct, picked: a.picked!, safeId: cp.safeActionId, amount, praise: variant.praiseAr, explain: variant.explainAr, rule: cp.feedbackAr,
			mustFix, last: i === q.answers.length - 1,
			onFix: () => { a.fixed = true; this.record(cp, cp.safeActionId); this.flushSave(); this.sound.sfx('equip'); },
			onNext: () => { q.index++; this.flushSave(); this.showQuestion(); } });
	}

	private finishQuiz() {
		const q = this.quiz!, s = stages[q.stage], pay = quizPayout(s, q.answers.map(a => !!a.correct));
		const first = !q.done;
		q.done = true;
		if (!q.guest) { this.save.cleared[q.stage] = true; this.save.unlocked = Math.max(this.save.unlocked, Math.min(stages.length, q.stage + 2)); }
		const bonusNow = pay.bonus > 0 && this.attempt!.credit(this.bank(), 'bonus', pay.bonus);
		q.paid = this.attempt!.toJSON();
		this.flushSave();
		if (first && !q.guest) this.reportIfComplete();
		if (!bonusNow) { this.showSummary(); return; }
		// all three right: a celebration of its own, different from the boss reward and the packages
		this.setMode('card');
		this.sound.sfx('bonus');
		this.hero?.avatar.play('celebrate');
		this.ui.setWallet(this.bank().wallet, false);
		this.primary = () => this.showSummary();
		this.ui.bonus(pay.bonus, () => this.showSummary());
		this.later(0.9, () => { const from = this.ui.pointOf('[data-bonus]'); if (from) this.coins.spawn(from.x, from.y, pay.bonus, 'huge', 22); });
	}

	/** Shows what this attempt earned. It only reads the record: opening it again never adds money. */
	private showSummary() {
		const q = this.quiz!, s = stages[q.stage], at = this.attempt ?? (this.attempt = new Attempt(q.attemptId, q.stage, q.paid));
		const correct = q.answers.filter(a => a.correct).length, last = q.stage === stages.length - 1;
		this.setMode('card');
		this.sound.music('menu', 0);
		this.ui.setWallet(this.bank().wallet, this.coins.flying === 0);
		const buttons = q.guest ? [
			{ label: ui('coop.quizDone'), onClick: () => this.guestAfterQuiz() },
			{ label: ui('summary.review'), kind: 'ghost' as const, onClick: () => this.showReview() }] : [
			last ? { label: ui('summary.final'), onClick: () => this.showFinal() } : { label: ui('summary.next'), onClick: () => this.startStage(q.stage + 1) },
			{ label: ui('summary.upgrade'), kind: 'ghost' as const, onClick: () => this.openShop(() => this.showSummary()) },
			{ label: ui('summary.review'), kind: 'ghost' as const, onClick: () => this.showReview() },
			{ label: ui('menu.main'), kind: 'ghost' as const, onClick: () => this.showMenu() }];
		this.primary = buttons[0].onClick;
		this.ui.summary({ title: ui('summary.title', { name: s.nameAr }), correct,
			rows: [
				{ label: ui('summary.enemies'), amount: at.sum('kill') },
				{ label: ui('summary.boss'), amount: at.paid.get('boss') ?? 0 },
				...q.answers.map((a, i) => ({ label: ui('summary.question', { n: num(i + 1) }), amount: at.paid.get('q' + (i + 1)) ?? 0, note: ui('quiz.notEarned') })),
				{ label: 'BONUS', amount: at.paid.get('bonus') ?? 0, note: ui('summary.noBonus') }],
			total: at.total, wallet: this.bank().wallet,
			note: correct === 3 ? ui('summary.perfect') : ui('summary.encourage'), buttons });
	}
	private showReview() {
		const q = this.quiz!;
		this.ui.review({ onBack: () => this.showSummary(), items: q.answers.map(a => {
			const cp = checkpoints.find(c => c.id === a.checkpointId)!, v = variantsOf(cp.id).find(x => x.id === a.variantId)!;
			const label = (id: string | null) => v.options.find(o => o.actionId === id)?.labelAr ?? '';
			return { label: cp.labelAr, scene: v.sceneAr, message: v.message ? `${v.message.fromAr}: ${v.message.textAr}` : undefined, picked: label(a.picked), right: label(cp.safeActionId), correct: !!a.correct, explain: v.explainAr + ' ' + cp.feedbackAr };
		}) });
	}

	private reportIfComplete() {
		const run = this.run;
		if (!run || !run.completedAt || this.save.run?.reported) return;
		this.persistRun(true);
		this.flushSave();
		const fun: Fun = { wallet: this.bank().wallet, stagesCleared: this.save.cleared.filter(Boolean).length, weapons: { ...this.bank().weapons } };
		this.opts.onComplete?.({ result: getResult(run), ledger: run.ledger, fun });
	}
	private showFinal() {
		const r = this.run ? getResult(this.run) : null;
		this.sound.sfx('win');
		this.card({ cls: 'good', cyber: true, icon: ICON.star, title: ui('final.title'),
			lines: [content.story.winAr, r ? ui('final.score', { earned: num(r.earnedPoints), max: num(r.maximumPoints) }) : '', r ? ui(r.passed ? 'final.passed' : 'final.practice') : '', content.story.simulatedNoteAr],
			buttons: [{ label: ui('code.menu'), onClick: () => this.startBonus() }, { label: ui('menu.main'), kind: 'ghost', onClick: () => this.showMenu() }, { label: ui('summary.upgrade'), kind: 'ghost', onClick: () => this.openShop(() => this.showFinal()) }] });
	}

	// ------------------------------------------------------------------ weapon shop
	private openShop(back: () => void) {
		this.shopBack = back;
		this.shopId = this.bank().equipped;
		const attempt = this.attempt;
		this.clearFight();
		this.attempt = attempt;                                                  // the screen behind the shop (a summary, a fight) still needs its attempt when the shop closes
		this.setMode('shop');
		this.ui.showHud(false); this.ui.showWallet(true);
		this.ui.setWallet(this.bank().wallet, true);
		this.arena.energy = 0.25;
		this.sound.music('menu', 0);
		this.makeHero();
		this.renderShop('');
	}
	/** A harmless range above the shop panel: the selected weapon firing at practice targets. */
	private buildPreview() {
		const id = this.shopId, level = this.weaponLevel(id);
		const w = new World(stages[this.stage], this.stage, id, level, { waves: false, seed: 'shop' });
		w.godMode = true;
		w.bounds.minX = w.bounds.maxX = 14.7; w.player.x = 14.7; w.player.z = 0;
		this.world = w;
		this.arena.clear();
	}
	private renderShop(celebrate: '' | 'bought' | 'upgraded' | 'equipped') {
		const bank = this.bank(), id = this.shopId, def = weaponDef(id), level = bank.weapons[id] ?? 0, shown = Math.max(1, level);
		this.buildPreview();
		const cards: WeaponCard[] = weapons.map(w => ({ id: w.id, name: w.nameAr, role: w.roleAr, price: w.price, level: bank.weapons[w.id] ?? 0, owned: !!bank.weapons[w.id], equipped: bank.equipped === w.id }));
		const cost = nextUpgradeCost(bank, id);
		const nextLevel = level && level < maxLevel ? level + 1 : null;
		const rate = (l: number) => (id === 'beam' ? 10 : levelStats(id, l).rate);
		const stat = (key: string, f: (l: number) => number, max: number) => ({ key, now: f(shown), next: nextLevel ? f(nextLevel) : null, max });
		const missing = !level ? Math.max(0, def.price - bank.wallet) : cost !== null ? Math.max(0, cost - bank.wallet) : 0;
		const tier = (l: number) => (l >= 5 ? 5 : l >= 3 ? 3 : 1);
		const detail: ShopDetail = { card: cards.find(c => c.id === id)!, upgradeCost: cost, missing,
			stats: [stat('power', l => ratedPower(id, l), 26), stat('rate', rate, 10), stat('coverage', l => ratedCoverage(id, l), 6)],
			levelNote: ui(`weapon.${id}.l${tier(shown)}`),
			nextNote: nextLevel ? ui('shop.next', { n: num(nextLevel) }) + ' ' + (nextLevel === 3 || nextLevel === 5 ? ui(`weapon.${id}.l${nextLevel}`) : ui('shop.next.l' + nextLevel)) : '' };
		this.ui.shop(cards, detail, {
			onSelect: w => { this.shopId = w; this.renderShop(''); },
			onBuy: () => { const r = buyWeapon(bank, id); if (r.ok) { this.flushSave(); this.sound.sfx('buy'); this.ui.setWallet(bank.wallet, true); this.renderShop('bought'); } else { this.sound.sfx('deny'); this.renderShop(''); } },
			onUpgrade: () => { const r = upgradeWeapon(bank, id); if (r.ok) { this.flushSave(); this.sound.sfx('upgrade'); this.ui.setWallet(bank.wallet, true); this.renderShop('upgraded'); } else { this.sound.sfx('deny'); this.renderShop(''); } },
			onEquip: () => { if (equipWeapon(bank, id)) { this.flushSave(); this.sound.sfx('equip'); this.ui.banner('good', ui('shop.equippedNow', { name: def.nameAr }), 1.6); } this.renderShop('equipped'); },
			onClose: () => { this.world = null; this.arena.clear(); this.shopBack(); }
		}, celebrate);
	}
	private runPreview() {
		const w = this.world!;
		const alive = w.enemies.filter(e => !e.dead).length;
		if (alive < 3 && w.t % 0.5 < 0.05) {
			const used = new Set(w.enemies.filter(e => !e.dead).map(e => Math.round(e.hz * 10)));
			for (const z of [-2.3, 0, 2.3]) if (!used.has(Math.round(z * 10))) { const e = w.director.spawn({ kind: 'normal', index: -1, at: 0, sx: 22, sz: z, hx: 18.6 + Math.abs(z) * 0.2, hz: z, pattern: 0, shooter: false }); e.stay = 999; e.hp = e.maxHp = 16; break; }
		}
	}

	// ------------------------------------------------------------------ playing with a supporter
	// The main player's device runs the fight and owns the money, the progress and the knowledge score. The supporter's
	// device shows that fight, moves the supporter itself, and answers only the box questions the supporter opens.
	/** True on the main player's device while a supporter is connected. */
	private get hosting() { return !!this.link && this.link.role === 'host' && this.link.ready && !!this.peer; }
	private get api() { return this.opts.base + 'server/coop.php'; }
	private tell(m: Msg, lossy = false) { if (this.link?.ready) this.link.send(m, lossy); }

	private openCoop(error = '', code = this.inviteCode) {
		if (this.link?.role === 'host') { this.showRoom(); return; }
		this.setMode('card');
		this.ui.coopStart({ code, error, onCreate: () => void this.createRoom(), onJoin: c => void this.joinRoom(c), onBack: () => { this.forgetInvite(); this.showMenu(); } });
	}
	private forgetInvite() {
		this.inviteCode = '';
		try { const u = new URL(location.href); if (u.searchParams.has('room')) { u.searchParams.delete('room'); history.replaceState(null, '', u.toString()); } } catch { /* the address stays as it is */ }
	}
	private async createRoom() {
		let link: Link;
		try { link = await Link.create(this.api); } catch (e) { this.openCoop(ui(String((e as Error).message) === 'slow_down' ? 'coop.err.slow' : 'coop.err.net')); return; }
		this.link = link;
		this.wireLink(link);
		this.rememberLink();
		this.showRoom();
	}
	private showRoom() {
		const link = this.link!, ready = this.hosting;
		this.setMode('card');
		const next = Math.min(stages.length, this.save.unlocked);
		this.ui.coopRoom({ code: link.room, ready, status: ready ? ui('coop.joined', { name: this.peer!.name }) : ui(link.mode === 'waiting' ? 'coop.waiting' : 'coop.connecting'),
			startLabel: ui('coop.startStage', { n: num(next) }),
			// one press and both are in the fight; another stage can still be picked from the menu
			onShare: () => void this.shareInvite(), onStart: () => this.startStage(next - 1, false), onPick: () => this.showMenu(), onCancel: () => { this.endCoop(); this.showMenu(); } });
	}
	/** The invitation is a short code (and a link that carries it), passed on by the phone's own share sheet. No address
	 *  of anyone is asked for or kept. */
	private async shareInvite() {
		const link = this.link!, url = location.origin + location.pathname + '?room=' + link.room, text = ui('coop.shareText', { code: link.room });
		try { if (navigator.share) { await navigator.share({ title: ui('app.title'), text, url }); return; } } catch { return; }      // the share sheet was closed
		try { await navigator.clipboard.writeText(text + '\n' + url); this.ui.banner('good', ui('coop.copied'), 1.8); }
		catch { if (this.copyOld(text + '\n' + url)) this.ui.banner('good', ui('coop.copied'), 1.8); else this.ui.banner('info', ui('coop.shareManual'), 3); }   // a plain http address: the older way of copying, or the code on screen
	}
	private async joinRoom(code: string) {
		let link: Link;
		try { link = await Link.join(this.api, code); }
		catch (e) {
			const why = String((e as Error).message);
			this.forgetInvite();
			this.openCoop(ui(why === 'no_room' ? 'coop.err.no_room' : why === 'full' ? 'coop.err.full' : why === 'slow_down' ? 'coop.err.slow' : 'coop.err.net'), code);
			return;
		}
		this.inviteCode = '';
		this.clearFight();
		this.link = link;
		this.wireLink(link);
		this.rememberLink();
		this.ui.showHud(false); this.ui.showWallet(true); this.ui.setWallet(this.bank().wallet, true);
		this.setMode('card');
		this.guestWait(ui('coop.guest.connecting'));
	}
	private guestWait(text: string) {
		this.guestNote = text;
		// between two fights the supporter may visit the weapon shop with their own money
		this.ui.coopWait({ title: ui(this.mirror ? 'coop.wait.title' : 'coop.guest.title'), text, onLeave: () => this.askLeave(), onWeapons: this.mirror ? undefined : () => this.guestShop() });
	}
	private guestShop() {
		const note = this.guestNote;
		this.openShop(() => { this.ui.showHud(false); this.setMode('card'); this.tellGun(); this.guestWait(this.guestNote || note); });
		this.guestNote = note;
	}
	/** The supporter opens the weapon shop in the middle of a fight. The fight goes on without them: they stand shielded
	 *  and do not fire, for half a minute at most, so nobody hides in the shop while the friend fights alone. */
	private guestFightShop() {
		const m = this.mirror!, me = m.ally.body;
		if (this.mode !== 'guest' || !this.guestLive || me.down || me.busy) return;
		this.shelf = { mirror: m, attempt: this.attempt, stage: this.stage, bonus: this.bonus, live: true, gone: false, until: this.clock + 30 };
		this.tell({ t: 'shopBusy' });
		this.flushSave();
		this.openShop(() => this.closeGuestShop(false, true));
		this.ui.banner('info', ui('coop.shopShield'), 3);
	}
	/** Back from the shop to the fight that was set aside, or, when that fight ended meanwhile, to the waiting card. */
	private closeGuestShop(gone: boolean, closed = false) {
		const k = this.shelf;
		if (!k) return;
		this.shelf = null;
		this.world = null; this.arena.clear(); this.ui.closeLayer();
		this.tellGun();
		if (gone) {                                                              // lost, left or won while shopping
			if (!this.after) this.attempt = null;                                  // after a boss the count of the fight is still needed
			this.returnToStageStart();                                             // nothing to return when the boss fell (the money is kept then)
			this.tellGun();
			this.ui.showHud(false);
			this.setMode('card');
			if (closed && !this.after) this.guestWait(this.guestNote || ui('coop.wait.card'));
			return;
		}
		const gun = this.bank().equipped;
		this.mirror = k.mirror; this.world = k.mirror as unknown as World; this.attempt = k.attempt; this.stage = k.stage; this.bonus = k.bonus; this.phase = 'waves';
		k.mirror.ally.weapon.id = gun; k.mirror.ally.weapon.level = this.weaponLevel(gun);
		this.arena.clear(); this.arena.energy = 1;
		this.ui.showHud(true);
		this.guestLive = k.live;
		this.setMode('guest');
		this.tell({ t: 'boxDone', heal: 0 });                                   // the shield comes off
		this.sound.music('run', 0.5);
		if (!k.live && this.guestNote) this.guestWait(this.guestNote); else this.guestNote = '';
	}
	/** What the fight pays while the supporter is in the shop: counted without pictures. */
	private shelfEvent(e: SimEvent) {
		const at = this.attempt;
		if (e.type === 'kill') {
			const n = e.enemy;
			if (at && e.by === 1 && n.index >= 0 && (n.kind === 'normal' || n.kind === 'armored' || n.kind === 'rare') && at.credit(this.bank(), 'kill:' + n.index, enemyReward[n.kind])) { this.dirty = true; this.ui.setWallet(this.bank().wallet, true); }
		}
	}
	/** Tells the main player's device which weapon the supporter holds now, and at which level. */
	private tellGun() { if (this.link?.role !== 'guest') return; const gun = this.bank().equipped; this.tell({ t: 'gun', id: gun, level: this.weaponLevel(gun) }); }
	/** Copying where the browser's clipboard is not offered (a plain http address on the local network). */
	private copyOld(text: string) {
		try {
			const t = document.createElement('textarea');
			t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
			document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
			const ok = document.execCommand('copy');
			t.remove();
			return ok;
		} catch { return false; }
	}
	/** Says once in a fight that standing near the enemy makes the weapon hit harder. */
	private hintClose(list: Enemy[], me: { x: number; z: number; down: boolean; busy: boolean }) {
		if (this.closeTold || me.down || me.busy) return;
		for (const e of list) {
			if (e.dead || e.kind === 'crate' || e.mode === 'enter' || closeBonus(Math.max(0, Math.hypot(e.x - me.x, e.z - me.z) - e.r)) < 1.3) continue;
			this.closeTold = true;
			this.ui.banner('good', ui('fight.close'), 1.8);
			return;
		}
	}
	private askLeave() {
		this.ui.modal({ title: ui('coop.leaveTitle'), lines: [ui('coop.leaveText')], buttons: [
			{ label: ui('coop.stay'), onClick: () => { if (this.guestNote) this.guestWait(this.guestNote); else this.ui.closeLayer(); } },
			{ label: ui('coop.leave'), kind: 'ghost', onClick: () => { this.endCoop(); this.showMenu(); } }] });
	}
	private wireLink(link: Link) {
		link.onMessage = m => { if (this.link !== link) return; try { this.onNet(m); } catch (e) { console.error(e); } };
		link.onMode = mode => {
			if (this.link !== link) return;
			this.rememberLink();
			if (mode === 'relay') this.ui.banner('info', ui('coop.slow'), 3);
			if (mode === 'direct' || mode === 'relay') { const back = !!this.peer; this.sayHello(back); if (back) this.peerBack(); }
			if (link.role === 'host' && document.querySelector('.cs-room-code')) this.showRoom();
		};
		link.onPeer = (present, forGood) => { if (this.link !== link || present) return; if (forGood) this.peerLeft(); else this.peerAway(); };
	}
	// ---- coming back after the browser was left or the page loaded again
	private rememberLink() {
		try { const l = this.link; if (l && l.mode !== 'closed') localStorage.setItem(COOP_KEY, JSON.stringify({ ...l.saved, at: Date.now() })); else localStorage.removeItem(COOP_KEY); } catch { /* no storage: coming back after a reload is not possible, nothing else changes */ }
	}
	private keptLink(): SavedLink | null {
		try {
			const s = JSON.parse(localStorage.getItem(COOP_KEY) ?? 'null') as (SavedLink & { at?: number }) | null;
			if (s && (s.role === 'host' || s.role === 'guest') && /^[A-Z2-9]{5}$/.test(String(s.room)) && /^[a-f0-9]{16,64}$/.test(String(s.token)) && Date.now() - Number(s.at) < 10 * 60000) return { room: s.room, token: s.token, role: s.role };
			localStorage.removeItem(COOP_KEY);
		} catch { /* nothing kept */ }
		return null;
	}
	/** The page was loaded again while playing together: the same place in the same room, and the connection is made again. */
	private resumeCoop(kept: SavedLink) {
		const link = Link.resume(this.api, kept);
		this.link = link;
		this.wireLink(link);
		if (kept.role === 'host') { if (this.save.quiz && !this.save.quiz.done) this.resumeQuiz(); else this.showMenu(); return; }
		this.showMenu();
		this.ui.showHud(false);
		this.setMode('card');
		this.guestWait(ui('coop.reconnecting'));
	}
	/** The friend's connection dropped (they may have left the browser for a moment). In a fight the supporter stands
	 *  shielded while the main player waits; the supporter's device keeps the fight and says it is connecting again. */
	private peerAway() {
		if (this.link?.role === 'host') {
			const w = this.mirror ? null : this.world;
			if (w?.ally && !w.over) { w.setBusy(1, true); this.awayT = 38; this.ui.banner('info', ui('coop.away'), 3); }
			if (document.querySelector('.cs-room-code')) this.showRoom();
			return;
		}
		this.guestLive = false;
		if (this.shelf) this.shelf.live = false;
		if (!this.after && this.mode !== 'shop' && this.mode !== 'quiz' && !this.box) this.guestWait(ui('coop.reconnecting')); else this.ui.banner('info', ui('coop.reconnecting'), 3);
	}
	/** The connection is back. The main player's device says again what is on, and the fight goes on. */
	private peerBack() {
		if (this.link?.role !== 'host') return;
		const w = this.mirror ? null : this.world;
		if (this.awayT > 0 && w?.ally) { w.setBusy(1, false); this.ui.banner('good', ui('coop.back'), 2.2); }
		this.awayT = 0;
		if (this.peerBusy) return;
		const go = this.pendingGo;
		if (go) { this.pendingGo = null; this.ui.closeLayer(); go(); } else if (!this.joinNow()) this.tellScreen();
	}
	/** The supporter finished the report and their questions (or came back fresh): what waited for them goes on. */
	private peerReady() {
		this.peerBusy = false;
		const go = this.pendingGo;
		this.pendingGo = null;
		if (go) { this.ui.closeLayer(); go(); } else if (!this.joinNow()) this.tellScreen();
	}
	/** The supporter is free and the main player is already fighting alone (they began without waiting, or the
	 *  supporter came into the room in the middle): the supporter steps into that fight now. */
	private joinNow(): boolean {
		const w = this.mirror ? null : this.world;
		if (!this.hosting || this.peerBusy || !w || w.ally || w.over) return false;
		if (!(this.mode === 'fight' || this.mode === 'box' || this.mode === 'countdown') || this.phase === 'tutorial' || this.phase === 'down') return false;
		const p = this.peer!;
		w.joinAlly(p.weapon.id, p.weapon.level);
		this.allyIn = { x: w.ally!.body.x, z: w.ally!.body.z, b: 0 };
		this.netT = 0;
		this.second(p.avatar);
		this.ui.banner('good', ui('coop.joinedFight', { name: p.name }), 2.4);
		this.sound.sfx('right');
		this.tellScreen();
		return true;
	}
	/** A fight for two starts when both are free: while the supporter still answers, the main player waits (or starts alone). */
	private waitForPeer(go: () => void): boolean {
		// with a supporter in the room, a fight is for two: it waits while they still answer, and also while their
		// connection is away for a moment (before, that moment silently began the fight alone)
		const paired = this.link?.role === 'host' && !!this.peer, away = paired && !this.link!.ready;
		if (!paired || this.soloNext || (!this.peerBusy && !away)) return false;
		this.pendingGo = go;
		this.setMode('card');
		this.primary = null;
		this.ui.modal({ cyber: true, title: ui('coop.waitPeer.title'), lines: [ui(away ? 'coop.waitPeer.away' : 'coop.waitPeer.text', { name: this.peer!.name })],
			buttons: [{ label: ui('coop.waitPeer.skip'), kind: 'ghost', onClick: () => { this.pendingGo = null; this.soloNext = true; this.ui.closeLayer(); go(); } }] });   // they begin alone, and the supporter steps in as soon as they are free
		return true;
	}
	/** The supporter's own questions after the report, then back to waiting for the main player. */
	private guestQuizStart(bonus: boolean) {
		const at = this.attempt;
		this.clearFight();
		this.guestFightId = '';
		this.attempt = at;
		if (bonus || !this.link) { this.guestAfterQuiz(); return; }
		this.openQuiz();
	}
	private guestAfterQuiz() {
		this.quiz = null; this.after = false; this.attempt = null;
		if (this.link?.role !== 'guest') { this.showMenu(); return; }             // the main player left meanwhile
		this.ui.showHud(false);
		this.setMode('card');
		this.tell({ t: 'ready' });
		this.guestWait(this.guestNote || ui('coop.wait.card'));
	}
	/** Each side introduces itself when the connection opens. `got` says whether the other's introduction has arrived
	 *  already: if not, the other answers with its own once more, so one lost greeting never leaves a side waiting. */
	private sayHello(got: boolean) {
		const gun = this.bank().equipped;
		this.tell({ t: 'hello', got, name: this.save.name, avatar: this.save.avatar, weapon: { id: gun, level: this.weaponLevel(gun) } });
	}
	private peerLeft() {
		const link = this.link;
		if (!link) return;
		if (link.role === 'host' && link.mode !== 'closed') {                   // the supporter left for good; the room stays open
			const had = !!this.peer;
			this.peer = null; this.awayT = 0;
			(this.mirror ? null : this.world)?.dropAlly();
			this.ui.setAlly(null);
			if (had) this.ui.banner('info', ui('coop.left'), 2.6);
			if (document.querySelector('.cs-room-code')) this.showRoom(); else if (document.querySelector('.cs-friend')) this.showMenu();
			this.peerBusy = false;
			const go = this.pendingGo; this.pendingGo = null;
			if (go) { this.ui.closeLayer(); go(); }
			return;
		}
		const guest = link.role === 'guest', inQuiz = this.after && !!this.quiz;
		this.endCoop();
		if (!guest) { if (document.querySelector('.cs-room-code') || document.querySelector('.cs-friend')) this.showMenu(); return; }
		if (!inQuiz) { this.after = false; this.showMenu(); }                     // their own questions may still be finished
		this.ui.banner('info', ui('coop.hostLeft'), 2.6);
	}
	private endCoop() {
		const link = this.link;
		this.link = null; this.peer = null;
		link?.close();
		this.forgetInvite();
		if (this.mirror) { this.mirror = null; this.world = null; this.box = null; }
		else this.world?.dropAlly();
		this.guestLive = false; this.guestNote = ''; this.guestFightId = ''; this.shelf = null;
		this.peerBusy = false; this.pendingGo = null; this.awayT = 0;
		try { localStorage.removeItem(COOP_KEY); } catch { /* nothing kept */ }
		this.ui.setAlly(null);
	}
	/** Tells the supporter's device what to show now: the fight, or a line about what the main player is doing. */
	private tellScreen() {
		if (!this.hosting) return;
		const w = this.world, m = this.mode;
		if (m === 'fight' || m === 'box' || m === 'countdown') {
			if (!w?.ally) { this.tell({ t: 'wait', key: this.phase === 'tutorial' ? 'coop.wait.card' : 'coop.wait.fight' }); return; }   // a fight begun alone: the friend enters the next one
			this.tell({ t: 'stage', index: this.stage, bonus: this.bonus, id: this.attempt?.id ?? '' });
			if (this.paused) this.tell({ t: 'wait', key: 'coop.wait.pause' });
			else if (m !== 'countdown') this.tell({ t: 'go' });
			return;
		}
		if (m === 'quiz' || m === 'loading' || m === 'guest') return;             // the question itself is sent
		this.tell({ t: 'wait', key: m === 'shop' ? 'coop.wait.shop' : m === 'menu' ? 'coop.wait.menu' : w?.over ? 'coop.wait.lost' : 'coop.wait.card' });
	}
	/** Two play: the supporter enters the fight that was just made, and their figure appears beside the main player. */
	private enlist(w: World) {
		if (!this.hosting || this.soloNext) { this.soloNext = false; return; }
		const p = this.peer!;
		w.addAlly(p.weapon.id, p.weapon.level);
		this.allyIn = { x: w.ally!.body.x, z: w.ally!.body.z, b: 0 };
		this.netT = 0;
		this.second(p.avatar);
	}
	private second(avatar: 'male' | 'female') {
		if (this.hero2 && this.hero2Avatar !== avatar) { this.hero2.dispose(); this.hero2 = null; }
		if (this.hero2) return;
		this.hero2 = new Hero(this.scene, this.kit, avatar, 'friend', new Color3(1, 0.8, 0.25));
		this.hero2Avatar = avatar;
		for (const m of this.hero2.rig.getChildMeshes()) m.layerMask |= CHARACTER_LAYER;
	}
	/** The main player's device sends what just happened and, about fifteen times a second, the whole picture. Through
	 *  the server (the slow way) the small events are left out and the picture goes less often. */
	private sendFight(w: World, events: SimEvent[], dt: number) {
		const direct = this.link!.mode === 'direct';
		const list = events.filter(e => e.type !== 'playerDead' && (direct || !NOISY.has(e.type))).map(plainEvent);
		if (list.length) this.tell({ t: 'ev', l: list });
		// how fast the fight really ran since the last picture, against the clock (slow motion, or a device that cannot
		// keep up): the supporter's device carries every flying thing forward at that pace
		const pace = this.slow > 0 && !this.save.settings.reduceMotion ? 0.35 : 1, nowS = performance.now() / 1000;
		this.ranSince += dt * pace;
		this.netT -= dt;
		if (this.netT <= 0) {
			const real = nowS - this.sentAt, rate = this.sentAt > 0 && real > 0.02 && real < 1 ? Math.max(0.2, Math.min(1.5, this.ranSince / real)) : pace;
			this.sentAt = nowS; this.ranSince = 0;
			this.netT = direct ? 0.066 : 0.2; this.tell(snapshot(w, nowS, Math.abs(rate - 1) < 0.02 ? 1 : rate) as unknown as Msg, true);
		}
	}

	private onNet(m: Msg) {
		const host = this.link?.role === 'host', w = this.mirror ? null : this.world;
		switch (m.t) {
			case 'hello': {
				const gun = m.weapon as { id?: WeaponId; level?: number } | undefined, known = !!gun && weapons.some(x => x.id === gun.id), first = !this.peer;
				this.peer = { name: (normalizeName(String(m.name ?? '')) ?? ui('menu.defaultName')).slice(0, 24), avatar: m.avatar === 'female' ? 'female' : 'male',
					weapon: known ? { id: gun!.id!, level: Math.max(1, Math.min(maxLevel, Number(gun!.level) | 0)) } : { id: 'pulse', level: 1 } };
				if (!m.got) this.sayHello(true);
				if (host && !first && !m.got) this.peerReady();                         // the supporter's page was loaded again: whatever they were doing is gone
				if (!first) break;
				if (host) {
					this.sound.sfx('right');
					if (document.querySelector('.cs-room-code')) this.showRoom();
					else { this.ui.banner('good', ui('coop.joined', { name: this.peer.name }), 2.4); if (document.querySelector('.cs-btn.coop')) this.showMenu(); else if (!this.joinNow()) this.tellScreen(); }
				} else if (!this.mirror) this.guestWait(ui('coop.guest.lobby', { name: this.peer.name }));
				break;
			}
			// ---- what the supporter sends to the main player
			case 'gun': {                                                            // the supporter upgraded, bought or changed weapon
				if (!host || !this.peer || !weapons.some(x => x.id === m.id)) break;
				this.peer.weapon = { id: m.id as WeaponId, level: Math.max(1, Math.min(maxLevel, Number(m.level) | 0)) };
				w?.setAllyWeapon(this.peer.weapon.id, this.peer.weapon.level);
				break;
			}
			case 'in': if (host) { this.allyIn.x = Number(m.x) || 0; this.allyIn.z = Number(m.z) || 0; this.allyIn.b = Math.max(0, Math.min(3, Number(m.b) | 0)); } break;
			case 'power': if (host && w?.ally && (this.mode === 'fight' || this.mode === 'box') && !this.paused && m.id !== 'backup' && (POWERS.includes(m.id as PowerId) || m.id === 'aware')) w.usePower(m.id as PowerId, 1); break;
			case 'ready': if (host) this.peerReady(); break;                         // the supporter finished the report and their questions
			case 'report': {                                                         // the boss fell: the supporter's share, the count of the fight, then their own questions
				const st = m.stats as number[][] | undefined;
				if (host || !Array.isArray(st) || st.length < 2 || this.after) break;
				this.after = true;
				const reward = Math.max(0, Math.min(2000, Number(m.reward) | 0)), bonus = this.bonus, stageDef = bonus ? bonusStage : stages[this.stage];
				const paid = reward > 0 && !!this.attempt?.credit(this.bank(), 'boss', reward);
				this.save.stageStart = null;                                           // the money of this fight is kept for good
				this.flushSave();
				this.closeGuestShop(true);
				this.ui.setWallet(this.bank().wallet, !paid);
				if (paid) this.later(1.1, () => { this.ui.banner('good', ui('fight.bossReward', { amount: num(reward) }), 2.4); const c = this.canvas.getBoundingClientRect(); this.coins.spawn(c.left + c.width / 2, c.top + c.height * 0.3, reward, 'huge', 16); });
				const n = (v: unknown) => Math.max(0, Number(v) | 0);
				const rows = [{ name: this.save.name, me: true, damage: n(st[1][0]), kills: n(st[1][1]) }, { name: this.peer?.name ?? '', me: false, damage: n(st[0][0]), kills: n(st[0][1]) }];
				this.later(3.6, () => this.showReport(rows, stageDef.boss.nameAr, () => this.guestQuizStart(bonus)));
				break;
			}
			case 'boxBusy': if (host && w?.ally) w.setBusy(1, true); break;
			case 'shopBusy': if (host && w?.ally && !w.ally.body.down) { w.setBusy(1, true); this.ui.banner('info', ui('coop.shopFriend'), 2.4); } break;
			case 'boxDone': if (host && w?.ally) { w.setBusy(1, false); const n = Math.max(0, Math.min(2, Number(m.heal) | 0)); if (n) w.heal(n, 1); } break;
			// ---- what the main player sends to the supporter
			case 'stage': if (!host && !this.after) { if (this.guestFightId !== String(m.id ?? '')) this.closeGuestShop(true); this.guestFight(Number(m.index) | 0, !!m.bonus, String(m.id ?? '')); } break;
			case 's': if (!host) (this.mirror ?? this.shelf?.mirror)?.apply(m as unknown as Snapshot); break;
			case 'ev':
				if (host || !Array.isArray(m.l)) break;
				if (this.mirror) for (const e of m.l as SimEvent[]) this.guestEvent(e);
				else if (this.shelf) for (const e of m.l as SimEvent[]) this.shelfEvent(e);   // in the shop: the money of the fight is still counted
				break;
			case 'go':
				if (!host && this.shelf) this.shelf.live = true;
				if (host || !this.mirror) break;
				this.guestLive = true; this.ui.countdown(null);
				if (this.guestNote) { this.guestNote = ''; if (!this.box) this.ui.closeLayer(); }
				break;
			case 'count':
				if (!host && this.shelf) this.shelf.live = false;
				if (host || !this.mirror) break;
				this.guestLive = false;
				if (this.guestNote) { this.guestNote = ''; if (!this.box) this.ui.closeLayer(); }
				this.ui.countdown(typeof m.text === 'string' ? m.text.slice(0, 12) : null); this.sound.sfx('tick');
				break;
			case 'wait': {
				const key = String(m.key);
				if (host || !/^coop\.wait\.[a-z]+$/.test(key)) break;
				if (this.after) { if (key !== 'coop.wait.pause') this.guestNote = ui(key); break; }   // busy with the report or their own questions
				this.guestLive = false; this.ui.countdown(null);
				if (this.shelf) { if (key === 'coop.wait.pause') { this.shelf.live = false; this.guestNote = ui(key); break; } this.closeGuestShop(true); }   // the fight ended while they were shopping
				if (this.mode === 'shop') { if (key !== 'coop.wait.pause') this.guestNote = ui(key); break; }   // in the shop between fights: the line waits for them
				if (key !== 'coop.wait.pause') this.guestIdle();                        // the fight is over, or has not begun
				this.guestNote = ui(key);
				if (!this.box) this.guestWait(this.guestNote);
				break;
			}
			case 'quiz': if (!host) { this.closeGuestShop(true); this.guestQuiz(m); } break;
			case 'quizResult': {
				const r = m.r as { correct: boolean; picked: string; safeId: string; amount: number; praise: string; explain: string; rule: string } | undefined;
				if (!host && r && document.querySelector('.cs-quiz')) { this.ui.setPack(Number(m.index) | 0, r.correct ? 'won' : 'lost'); this.ui.quizResult({ ...r, mustFix: false, last: false, onNext: () => {}, watch: ui('coop.wait.quiz') }); this.sound.sfx(r.correct ? 'right' : 'wrong'); }
				break;
			}
			case 'box': if (!host && this.mirror) this.openBox(!!m.rare, !!m.heart); break;
			case 'backupUsed': if (!host) { const i = this.save.powers.indexOf('backup'); if (i >= 0) this.save.powers.splice(i, 1); this.flushSave(); this.sound.sfx('power'); this.ui.banner('good', ui('power.backup.saved'), 2.4); } break;
		}
	}
	/** The supporter's device starts showing a fight of the main player. */
	private guestFight(index: number, bonus: boolean, id: string) {
		if ((this.mirror || this.shelf) && this.guestFightId === id) return;   // the same fight (perhaps set aside for the shop)
		const fromShop = this.mode === 'shop';
		this.clearFight();
		this.returnToStageStart();
		this.guestFightId = id;
		this.bonus = bonus;
		this.stage = Math.max(0, Math.min(stages.length - 1, index));
		this.arena.setStage(bonus ? stages.length : this.stage); this.arena.energy = 1;
		this.makeHero();
		this.second(this.peer?.avatar ?? 'male');
		const gun = this.bank().equipped;
		this.mirror = new Mirror(bonus ? bonusStage : stages[this.stage], bonus ? stages.length : this.stage, { id: gun, level: this.weaponLevel(gun) });
		this.world = this.mirror as unknown as World;
		this.phase = 'waves'; this.guestLive = false; this.guestNote = ''; this.inT = 0;
		// the supporter earns into their own wallet by the main player's rules: a fight that is lost or left gives the
		// money back, and what was bought during it is undone and refunded
		this.attempt = SUPPORTER_EARNS && !bonus ? new Attempt(id || uuid(), this.stage) : null;
		this.save.stageStart = { stage: this.stage, bank: JSON.parse(JSON.stringify(this.bank())) };
		this.flushSave();
		this.setMode('guest');
		this.ui.closeLayer(); this.ui.showHud(true); this.ui.showWallet(true); this.ui.setWallet(this.bank().wallet, true);
		this.tellGun();
		if (fromShop) this.ui.banner('info', ui('coop.fightStarted'), 2);
		this.sound.music('run', 0.5);
	}
	/** The supporter's device between two fights: nothing to draw but the land and a line about the main player. */
	private guestIdle() {
		if (!this.mirror && this.mode === 'card') return;
		this.clearFight();
		this.guestFightId = '';
		this.returnToStageStart();                                               // a fight that was not won keeps nothing
		this.tellGun();
		this.ui.showHud(false);
		this.setMode('card');
		this.sound.music('menu', 0);
	}
	/** The supporter watches the main player's question: the same card, not to be answered, so both learn from it. */
	private guestQuiz(m: Msg) {
		const cp = checkpoints.find(c => c.id === m.cp), variant = cp && variantsOf(cp.id).find(v => v.id === m.variant), stage = stages[Number(m.stage) | 0], order = Array.isArray(m.order) ? m.order as string[] : [];
		if (!cp || !variant || !stage) return;
		const options = order.map(id => variant.options.find(o => o.actionId === id)).filter((o): o is typeof variant.options[number] => !!o);
		if (options.length !== variant.options.length || this.mode === 'shop') return;
		this.guestIdle();
		this.guestNote = '';
		this.sound.music('read');
		this.ui.quiz({ index: Number(m.index) | 0, rewards: stage.questionRewards, label: cp.labelAr, variant, packs: (Array.isArray(m.packs) ? m.packs : []) as ('waiting' | 'won' | 'lost')[], options, onConfirm: () => {}, watch: ui('coop.wait.quiz') });
	}
	/** One frame on the supporter's device: their own figure moves here at once, the rest glides between two pictures,
	 *  and the main player's device is told where the supporter stands. */
	private guestStep(dt: number) {
		const m = this.mirror!, me = m.ally.body;
		if (!this.guestLive) return;
		if (this.mode === 'guest') steer(me, this.move(), dt, m.bounds); else { me.vx = 0; me.vz = 0; }
		m.advance(dt);
		for (const e of m.enemies) this.damageNumber(e);                         // the same numbers the main player sees
		if (this.mode === 'guest') this.hintClose(m.enemies, me);
		this.inT -= dt;
		if (this.inT <= 0) { this.inT = 0.033; this.tell({ t: 'in', x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, b: this.save.powers.filter(x => x === 'backup').length }, true); }
	}
	/** What happened in the fight, as told by the main player's device: pictures and sound on the supporter's. */
	private guestEvent(e: SimEvent) {
		const m = this.mirror!;
		this.arena.show(e, m as unknown as World);
		switch (e.type) {
			case 'fire': this.sound.sfx(e.weapon); break;
			case 'hit': this.sound.sfx(e.blocked ? 'block' : 'hit'); break;
			case 'explode': this.sound.sfx('boom'); break;
			case 'kill': {                                                           // the last number over it, and the rials when the kill was the supporter's
				const seen = m.enemies.find(x => x.id === e.enemy.id);
				if (seen) { seen.took = (seen.took ?? 0) + Math.max(0, seen.hp); this.damageNumber(seen, true); }
				this.onKill(e.enemy, e.by === 1);
				break;
			}
			case 'allyHit': this.sound.sfx('hurt'); this.shake(0.6); this.ui.hurt(this.save.settings.reduceMotion); break;      // on this device, that is me
			case 'playerHit': this.sound.sfx('hurt'); break;
			case 'down': this.sound.sfx('lost'); this.shake(0.5); this.ui.banner('alarm', ui(e.who === 1 ? 'coop.down.me' : 'coop.down.friend'), 3); break;
			case 'revive': this.sound.sfx('right'); this.sound.sfx('power'); this.ui.banner('good', ui(e.by === 1 ? 'coop.revived' : 'coop.revivedMe'), 2.2); break;
			case 'power': this.sound.sfx('power'); if (e.power === 'bomb' || e.power === 'mega') this.sound.sfx('bigBoom'); this.shake(0.4); break;
			case 'nova': this.ui.nova(this.save.settings.reduceMotion); this.sound.sfx('bigBoom'); this.shake(1); break;
			case 'wavesDone': this.sound.music('boss', 1); this.sound.sfx('alarm'); this.arena.energy = 1.6; this.ui.banner('alarm', ui('fight.bossWarning', { name: m.stage.boss.nameAr }), 2.6); break;
			case 'bossPhase': this.sound.sfx('phase'); this.shake(0.4); this.ui.banner('alarm', ui('fight.phase', { n: num(e.phase + 1) }), 1.6); break;
			case 'bossDead': {
				this.sound.sfx('bigBoom'); this.sound.sfx('bossDown'); this.shake(1); this.sound.music('menu', 0); this.ui.banner('good', ui('coop.thanks'), 3);
				const boss = m.enemies.find(x => x.id === e.enemy.id);
				if (boss) { boss.took = (boss.took ?? 0) + Math.max(0, boss.hp); this.damageNumber(boss, true); }
				break;                                                                 // the share of the reward comes with the report
			}
			case 'crateIn': this.sound.sfx('crate'); this.ui.banner('good', ui(e.rare ? 'box.rareIncoming' : e.heart ? 'box.heartIncoming' : 'box.incoming'), 2.6); break;
			case 'crate': this.sound.sfx('boom'); if (e.by === 0) this.ui.banner('info', ui('coop.boxFriend'), 2.4); break;
			case 'wave': this.sound.sfx('wave'); if (e.index > 0) this.ui.banner('info', ui('fight.wave', { n: num(e.index + 1), total: num(e.total) }), 1.2); break;
			case 'zone': this.sound.sfx('zone'); this.shake(0.2); break;
		}
	}

	// ------------------------------------------------------------------ input and pause
	private onAction(a: InputAction) {
		this.sound.unlock();
		if (a === 'pause') { this.togglePause(); return; }
		if (this.paused) return;
		if (this.mode === 'quiz' || this.mode === 'box' || this.mode === 'intro') { this.ui.key(a); return; }
		if (this.mode === 'guest') { if (a === 'power' || a === 'confirm') this.usePower(); else if (a === 'upgrade') this.quickUpgrade(); else if (a === 'arms') this.openFightShop(); return; }
		if (this.mode === 'fight') { if (a === 'power' || a === 'confirm') this.usePower(); else if (a === 'upgrade') this.quickUpgrade(); else if (a === 'arms') this.openFightShop(); return; }
		if (a === 'confirm' && this.mode === 'card') { const p = this.primary; this.primary = null; p?.(); }
	}
	togglePause() {
		if (this.link?.role === 'guest') { if (!this.box && this.mode !== 'shop' && this.mode !== 'quiz' && !this.after) this.askLeave(); return; }   // the supporter cannot stop the main player's fight: the button offers to leave
		if (this.paused) {
			this.paused = false;
			this.ui.closeLayer();
			this.sound.suspend(false);
			if (this.mode === 'fight') this.startCountdown();                      // always a countdown before fighting again
			return;
		}
		if (this.mode !== 'fight' && this.mode !== 'countdown') return;
		this.paused = true;
		this.flushSave();
		this.ui.countdown(null); this.ui.prompt(null);
		this.sound.suspend(true);
		this.tell({ t: 'wait', key: 'coop.wait.pause' });
		const show = () => this.ui.modal({ title: ui('pause.title'), lines: [ui('pause.text')], buttons: [
			{ label: ui('pause.resume'), onClick: () => this.togglePause() },
			{ label: ui('menu.settings'), kind: 'ghost', onClick: () => this.openSettings(show) },
			{ label: ui('menu.main'), kind: 'ghost', onClick: () => { this.sound.suspend(false); this.showMenu(); } }] });
		show();
	}
	private move(): MoveInput {
		const w = this.world!;
		const drag = this.input.takeDrag();
		if (this.input.dragging || drag.dx || drag.dy) {
			const d = this.arena.dragToWorld(drag.dx, drag.dy), p = this.mirror ? this.mirror.ally.body : w.player, t = this.dragTarget ?? { x: p.x, z: p.z };
			this.dragTarget = { x: Math.max(w.bounds.minX, Math.min(w.bounds.maxX, t.x + d.dx)), z: Math.max(-w.bounds.halfWidth, Math.min(w.bounds.halfWidth, t.z + d.dz)) };
			if (!this.input.dragging) { const out = { dx: 0, dz: 0, target: this.dragTarget }; this.dragTarget = null; return out; }
			return { dx: 0, dz: 0, target: this.dragTarget };
		}
		this.dragTarget = null;
		const k = this.input.direction();
		return { dx: k.dx, dz: k.dz, target: null };
	}
	/** Menu, shop and demo: lines up under the lowest enemy. */
	private bot(w: World): MoveInput {
		const list = w.targets();
		if (!list.length) return STILL;
		const t = list.find(e => e.kind === 'crate' && e.mode !== 'enter') ?? list.find(e => e.kind === 'turret') ?? (w.boss && w.boss.mode !== 'enter' ? w.boss : list.reduce((a, b) => (a.x < b.x ? a : b)));
		return { dx: 0, dz: 0, target: { x: w.player.x, z: Math.max(-w.bounds.halfWidth, Math.min(w.bounds.halfWidth, t.z)) } };
	}

	// ------------------------------------------------------------------ the frame
	/** Advances the game by dt seconds. The render loop calls it; tests call it in fixed steps through simulate(). */
	tick(dt: number) {
		this.sound.song(this.bonus ? stages.length : this.stage);                 // every stage has its own tune
		if (!this.paused) {
			this.clock += dt; this.modeT += dt;
			for (let i = 0; i < this.timers.length; i++) if (this.timers[i].at <= this.clock) { const t = this.timers.splice(i--, 1)[0]; t.fn(); }
			if (this.demo) this.playDemo();
			const w = this.world;
			if (this.mirror) this.guestStep(dt);
			else if (w && (this.mode === 'fight' || (this.mode === 'box' && w.ally))) {   // with a friend the fight goes on while a box question is read
				if (this.phase === 'tutorial') this.runTutorial(dt);
				this.slow = Math.max(0, this.slow - dt);
				w.backups = this.attempt ? this.save.powers.filter(x => x === 'backup').length : 0;
				const ally = w.ally;
				if (ally) {                                                          // the supporter stands where their own device says (smoothed between two messages)
					const b = ally.body, k = Math.min(1, dt * 22);
					if (this.awayT > 0 && (this.awayT -= dt) <= 0) { w.dropAlly(); this.ui.setAlly(null); this.ui.banner('info', ui('coop.left'), 2.6); }   // waited long enough: alone from here
					w.moveAlly(b.x + (this.allyIn.x - b.x) * k, b.z + (this.allyIn.z - b.z) * k, dt);
					ally.backups = this.allyIn.b;
					for (const who of [0, 1]) { const q = who ? b : w.player; if (q.busy && q.invuln <= 0.05) w.setBusy(who, false); }   // nobody stays in a question for ever
				}
				w.step(dt * (this.slow > 0 && !this.save.settings.reduceMotion ? 0.35 : 1), this.mode === 'box' ? STILL : this.demo ? this.bot(w) : this.move());
				const events = w.events.splice(0);
				if (ally && this.hosting) this.sendFight(w, events, dt);
				for (const e of events) this.onSimEvent(e);
				for (const e of w.enemies) this.damageNumber(e);
				if (this.phase !== 'tutorial' && this.mode === 'fight') this.hintClose(w.enemies, w.player);
				if (this.mode === 'fight' && !w.ally) { const fresh = this.findNewMalware(w); if (fresh) this.introduce(fresh); }   // with a friend nothing stops the fight
				this.watchFrameRate(dt);
			} else if (w && (this.mode === 'menu' || this.mode === 'shop')) {
				if (this.mode === 'shop') this.runPreview();
				w.step(dt, this.mode === 'shop' ? STILL : this.bot(w));
				for (const e of w.events.splice(0)) { this.arena.show(e, w); if (e.type === 'wavesDone' && this.mode === 'menu') this.later(1, () => { if (this.mode === 'menu' && this.world === w) this.attract(); }); }
			}
			const b = this.box;
			if (this.mode === 'box' && b && !b.done) {                               // the box question runs on the game clock, so a hidden tab does not eat its time
				const left = quick.seconds - this.modeT;
				this.ui.boxTimer(left / quick.seconds, left);
				if (left <= b.beep && left > 0) { b.beep--; this.sound.sfx('tick'); }
				if (left <= 0) this.answerBox(null);
			} else if (this.shelf && this.mode === 'shop' && this.clock > this.shelf.until) { this.closeGuestShop(false); this.ui.banner('info', ui('coop.shopTime'), 2.4); }
			else if (this.mode === 'box' && b && b.together && this.clock - b.doneAt > 8) (document.querySelector('.cs-box [data-a=next]') as HTMLElement | null)?.click();   // the friend is fighting alone: the result does not wait for ever
			if (this.dirty) { this.saveT += dt; if (this.saveT > 1) { this.saveT = 0; this.flushSave(); } }
			this.coinPitchT -= dt; if (this.coinPitchT <= 0) this.coinPitch = 0;
		}
		this.draw(dt);
	}
	/** Dev and tests: run the game for some seconds in fixed steps, then draw one frame. */
	simulate(seconds: number, step = 1 / 60) { for (let t = 0; t < seconds; t += step) this.tick(step); this.scene.render(); }

	private watchFrameRate(dt: number) {
		this.fpsT += dt; this.fpsN++;
		if (this.fpsT < 2.5) return;
		const fps = this.fpsN / this.fpsT;
		this.fpsT = 0; this.fpsN = 0;
		if (fps >= 42 || this.demo || this.save.settings.quality !== 'auto') return;
		if (!this.arena.reduceMotion) { this.arena.reduceMotion = true; return; }                                  // first fewer particles, then fewer pixels
		if (this.scaling < 2.2) { this.scaling *= 1.25; this.engine.setHardwareScalingLevel(this.scaling); }
	}

	private draw(dt: number) {
		const w = this.world, guest = !!this.mirror, friend = w?.ally?.body;
		// on the supporter's device "me" is the second fighter, and the friend is the main player
		const p = guest ? friend : w?.player, other = guest ? w?.player : friend;
		const moving = this.mode === 'fight' || (guest && this.guestLive && this.mode !== 'card') || (this.mode === 'box' && !!friend);   // the fight is running now
		const blink = (q: { invuln: number; bubble: number }) => q.invuln > 0 && q.bubble <= 0 && !this.save.settings.reduceMotion && moving;
		if (this.hero) {
			const show = !!w || this.mode === 'quiz' || this.mode === 'card' || this.mode === 'box';
			this.hero.rig.setEnabled(show);
			this.hero.down = !!p?.down;
			if (p) this.hero.update(dt, p.x, p.z, p.vx, p.vz, blink(p), !!w?.firing && this.mode !== 'card' && !p.down && !p.busy);
			else this.hero.update(dt, 2.4, 0, 0, 0, false, false);
			this.hero.cyber.root.setEnabled(!this.arena.courierOut);              // Cyber is away carrying the bomb of Total Awareness
		}
		if (this.hero2) {
			this.hero2.rig.setEnabled(!!other && !!friend);
			if (other && friend) { this.hero2.down = other.down; this.hero2.update(dt, other.x, other.z, other.vx, other.vz, blink(other), !!w?.firing && this.mode !== 'card' && !other.down && !other.busy); }
		}
		this.arena.sync(w, dt, this.paused || this.mode === 'card' || this.mode === 'countdown' || this.mode === 'quiz' || this.mode === 'intro' || (this.mode === 'box' && !friend) || (guest && !this.guestLive));
		const shown = !!w && (moving || this.mode === 'countdown' || (guest && this.mode === 'guest'));
		const fighting = shown && this.phase !== 'tutorial' && this.phase !== 'down', store = this.save.powers;
		this.ui.setAlly(shown && other && friend && this.peer ? { name: this.peer.name, hp: other.hp, maxHp: other.maxHp, down: other.down, busy: other.busy } : null);
		// low health: the screen beats, and the last heart is announced once and has a heartbeat
		const low = fighting && !w!.over ? (p!.hp <= 1 ? 2 : p!.hp <= 2 ? 1 : 0) : 0;
		this.ui.setLow(low);
		if (low === 2 && moving && !this.paused) {
			if (!this.warnedLow) { this.warnedLow = true; this.ui.banner('alarm', ui(store.length ? 'low.onePower' : 'low.one'), 2.2); }
			this.beatT -= dt; if (this.beatT <= 0) { this.beatT = 0.9; this.sound.sfx('beat'); }
		} else if (low < 2) this.warnedLow = false;
		this.ui.setPowers(fighting ? store.map(id => ({ id, name: ui('power.' + id) })) : [], fighting && p!.hp <= 2);
		const cost = fighting ? nextUpgradeCost(this.bank(), this.bank().equipped) : null;
		this.ui.setArms(fighting && (!friend || guest));                          // the main player's fight never waits for a shop; the supporter shops shielded while it goes on
		this.ui.setUpgrade(cost !== null ? { cost, next: this.weaponLevel(this.bank().equipped) + 1, can: this.bank().wallet >= cost } : null);
		this.coins.update(dt);
		if (this.coins.flying === 0) this.ui.setWallet(this.bank().wallet, true);
		// screen shake: decays in real time, moves the picture only
		this.trauma = Math.max(0, this.trauma - dt * 1.6); this.shakeT += dt * 30;
		const k = this.trauma * this.trauma, a = this.arena, ox = 0.3 * k * Math.sin(this.shakeT * 1.7), oy = 0.24 * k * Math.sin(this.shakeT * 2.3);
		a.cam.orthoLeft = -a.halfW + ox; a.cam.orthoRight = a.halfW + ox; a.cam.orthoTop = a.halfH + oy; a.cam.orthoBottom = -a.halfH + oy;

		if (w && p && shown) {
			const d = w.director, boss = w.boss;
			const label = this.phase === 'tutorial' ? ui('tut.title') : boss || this.bonus || this.phase === 'warn' || this.phase === 'down' ? w.stage.nameAr : ui('hud.wave', { n: num(Math.max(1, d.wave + 1)), total: num(d.waveCount) });
			this.ui.setHud({ hp: p!.hp, maxHp: p!.maxHp, label, progress: this.phase === 'tutorial' ? (this.tut.step + 1) / 4 : boss || this.phase !== 'waves' ? 1 : Math.max(0, d.wave) / d.waveCount,
				boss: boss && boss.mode !== 'enter' ? { name: w.stage.boss.nameAr, hp: boss.hp / boss.maxHp, guarded: boss.guard < 1 } : null });
		}
	}

	/** Dev only (?demo=good|mixed): plays by itself so a whole campaign can be watched or stepped in tests. */
	private playDemo() {
		if (this.mode === 'loading' || !this.kit) return;
		if (this.mode === 'menu' && this.modeT > 0.4) {
			if (!this.save.profileDone) { this.save.name = 'تجربة'; this.save.avatar = 'female'; this.save.profileDone = true; }
			this.save.tutorialDone = true;
			this.startStage(Math.min(stages.length, this.save.unlocked) - 1);
			return;
		}
		if (this.world && this.mode === 'fight') this.world.godMode = this.demo !== 'hurt';
		if (this.world?.boss && this.mode === 'fight' && this.save.powers.length && this.clock - this.demoPowerAt > 5) { this.demoPowerAt = this.clock; this.usePower(); }
		if (this.mode === 'intro' && this.modeT > 0.3) { (document.querySelector('.cs-malware [data-a=ok]') as HTMLElement | null)?.click(); return; }
		if (this.mode === 'box' && this.box) {
			if (!this.box.done) { if (this.modeT > 0.8) this.answerBox(this.demo === 'mixed' ? 0 : this.box.order.indexOf(0)); }
			else if (this.clock - this.box.doneAt > 1) (document.querySelector('.cs-box [data-a=next]') as HTMLElement | null)?.click();
			return;
		}
		if (this.mode === 'card' && this.modeT > 0.5) { const fn = this.primary; this.primary = null; fn?.(); }
		else if (this.mode === 'quiz' && this.modeT > 0.4 && this.quiz) {
			const q = this.quiz, a = q.answers[q.index];
			if (!a) return;
			const cp = checkpoints.find(c => c.id === a.checkpointId)!;
			if (a.picked === null) { this.modeT = 0; this.confirmAnswer(this.demo === 'mixed' && q.index === 1 ? cp.unsafeActionIds[0] : cp.safeActionId); }
			else {
				this.modeT = 0;
				const fix = document.querySelector('.cs-option.tap') as HTMLElement | null;
				if (fix) fix.click(); else (document.querySelector('[data-a=next]') as HTMLElement | null)?.click();
			}
		}
	}

	dispose() {
		this.flushSave();
		for (const d of this.disposers) d();
		this.link?.close();
		this.input.dispose(); this.sound.dispose(); this.ui.dispose(); this.arena.dispose(); this.hero?.dispose(); this.hero2?.dispose();
		this.engine.dispose(); this.host.innerHTML = '';
	}
}
