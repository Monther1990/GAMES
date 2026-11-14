// The game: it ties the simulation (sim.ts), the city (city.ts), the characters, the interface, sound and saving
// together, and runs the flow menu -> stage -> run <-> decision gate -> ... -> vault -> results.
// Everything timed uses the game clock (later()), so a pause, slow motion or a fixed-step test behaves the same.
// Knowledge score = the decision ledger only (assessment.ts, re-scored by the platform). Running is for fun.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Materials/PBR/pbrMaterial';
import '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/loaders/glTF/2.0';
import balance from '../data/balance.json';
import { applyAction, createRun, getResult, normalizeName, Run, RunResult, uuid } from '../game/assessment';
import { CharacterKit } from '../game/avatar';
import { CheckpointDef, checkpoints, config, content, missions, num, ui } from '../game/data';
import { Ui } from '../ui/ui';
import { Friend, Runner } from './actors';
import { City, LANE_COLORS, PortalState } from './city';
import { buildDecision, Decision } from './decision';
import { Input, InputAction } from './input';
import { autopilot, RunnerSim, SimEvent } from './sim';
import { Sound } from './sound';
import { loadSave, Save, storeSave } from './storage';
import { buildRun, buildStage, laneZ, Row, StageTrack } from './track';

export interface Fun { stars: number; runScore: number; bits: number; bitsTotal: number; hits: number; falls: number; seconds: number }
export interface GameOptions {
	base: string;
	/** Finished run: the result, the decision ledger the platform server re-scores, and the fun numbers (never a grade). */
	onComplete?: (payload: { result: RunResult; ledger: Run['ledger']; fun: Fun }) => void;
	onEvent?: (type: string, data: unknown) => void;
}
type Mode = 'loading' | 'menu' | 'card' | 'wait' | 'run' | 'gate' | 'countdown' | 'finale' | 'results';
type Kind = 'play' | 'training' | 'review';
interface Session {
	kind: Kind; run: Run | null; seed: string; name: string; avatar: 'male' | 'female';
	tracks: StageTrack[]; stage: number; gate: number; protection: number;
	totals: { metres: number; bits: number; bitsSeen: number; cleared: number; hits: number; falls: number; bonus: number; cleanStages: number };
	decision: Decision | null; review: CheckpointDef[]; reviewTotal: number; seconds: number;
}
const GREEN = new Color3(0.22, 1, 0.52), RED = new Color3(1, 0.25, 0.28), GOLD = new Color3(1, 0.84, 0.26), BLUE = new Color3(0.35, 0.8, 1);
const TRAINING_SPEC = { speed: [8, 9], segments: [178, 96], difficulty: [0.1, 0.25], gapSeconds: [1.7, 1.5] };

export class Game {
	readonly canvas: HTMLCanvasElement;
	readonly engine: Engine;
	readonly scene: Scene;
	readonly ui: Ui;
	private cam: FreeCamera;
	private city: City;
	private input: Input;
	private sound = new Sound();
	private save: Save = loadSave();
	private kit!: CharacterKit;
	private runner: Runner | null = null;
	private friend: Friend | null = null;
	sim: RunnerSim | null = null;
	session: Session | null = null;
	mode: Mode = 'loading';
	paused = false;
	private clock = 0; private timers: { at: number; fn: () => void }[] = [];
	private modeT = 0;
	private primary: (() => void) | null = null;
	private timeScale = 1; private freeze = 0;
	private lessonsDone = new Set<Row>(); private lessonGoodUntil = 0;
	private trauma = 0; private shakeT = 0;
	private camPos = new Vector3(-6, 3, 0); private camLook = new Vector3(6, 1, 0);
	private menuS = 0; private snapCamera = false;
	private scaling = 1; private fpsT = 0; private fpsN = 0;
	private resultsView: (() => void) | null = null;
	private demo: string | null = null;
	private disposers: (() => void)[] = [];

	constructor(readonly host: HTMLElement, readonly opts: GameOptions) {
		host.classList.add('de-host');
		this.canvas = document.createElement('canvas');
		this.canvas.setAttribute('aria-label', ui('app.title'));
		host.appendChild(this.canvas);
		this.engine = new Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
		const coarse = matchMedia('(pointer: coarse)').matches;
		this.scaling = 1 / Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
		this.engine.setHardwareScalingLevel(this.scaling);
		this.scene = new Scene(this.engine);
		this.scene.useRightHandedSystem = true;
		this.scene.skipPointerMovePicking = true;
		this.scene.autoClear = true;
		this.cam = new FreeCamera('cam', this.camPos.clone(), this.scene);
		this.cam.minZ = 0.3; this.cam.maxZ = 460;
		this.city = new City(this.scene);
		this.ui = new Ui(host, opts.base, () => this.togglePause());
		this.ui.onClick = () => { this.sound.unlock(); this.sound.sfx('click'); };
		this.input = new Input(host, this.canvas, { left: ui('pad.left'), right: ui('pad.right'), jump: ui('pad.jump'), slide: ui('pad.slide') });
		this.input.onAction = a => this.onAction(a);
		if (import.meta.env.DEV) this.demo = new URLSearchParams(location.search).get('demo');
		this.applySettings();

		const on = (target: Window | Document, type: string, fn: () => void) => { target.addEventListener(type, fn); this.disposers.push(() => target.removeEventListener(type, fn)); };
		on(window, 'resize', () => this.engine.resize());
		on(document, 'visibilitychange', () => {
			if (document.hidden) { if ((this.mode === 'run' || this.mode === 'countdown') && !this.paused) this.togglePause(); this.sound.suspend(true); }
			else if (!this.paused) this.sound.suspend(false);
		});
		this.engine.runRenderLoop(() => { this.tick(Math.min(this.engine.getDeltaTime() / 1000, 0.05)); this.scene.render(); });
	}

	async start() {
		this.ui.loading(0.1);
		await Promise.all([document.fonts.load('700 40px "Readex Pro"'), document.fonts.load('400 24px "Readex Pro"')]).catch(() => {});
		this.ui.loading(0.35);
		this.kit = await CharacterKit.load(this.scene, this.opts.base);
		this.ui.loading(1);
		this.showMenu();
	}

	// ------------------------------------------------------------------ small tools
	private later(seconds: number, fn: () => void) { this.timers.push({ at: this.clock + seconds, fn }); }
	private setMode(m: Mode) { this.mode = m; this.modeT = 0; }
	private emit(type: string, data: unknown) { if (this.session?.kind === 'play') this.opts.onEvent?.(type, data); }
	private card(o: Parameters<Ui['modal']>[0]) { this.setMode('card'); this.primary = o.buttons[0]?.onClick ?? null; this.ui.modal(o); }
	private applySettings() {
		const s = this.save.settings;
		this.sound.setMusic(s.music); this.sound.setSfx(s.sfx);
		this.city.reduceMotion = s.reduceMotion;
		this.input.showButtons(s.touchButtons && (this.mode === 'run' || this.mode === 'countdown'));
		this.host.classList.toggle('de-reduce', s.reduceMotion);
	}
	private openSettings(back: () => void) {
		this.ui.settings(this.save.settings, () => { storeSave(this.save); this.applySettings(); }, back);
	}
	private shake(amount: number) { if (!this.save.settings.noShake) this.trauma = Math.min(1, this.trauma + amount); }

	// ------------------------------------------------------------------ menu
	private showMenu() {
		this.clearSession();
		this.setMode('menu');
		this.ui.showHud(false); this.input.showButtons(false);
		this.sound.music('menu', 0);
		const b = this.save.best;
		this.ui.menu({
			name: this.save.name, avatar: this.save.avatar,
			best: b ? ui('menu.best', { points: num(b.knowledge), stars: num(b.stars) }) : null,
			badges: this.save.badges.map(id => ui('badge.' + id)),
			valid: n => normalizeName(n) !== null,
			onPlay: (n, a) => this.begin('play', n, a),
			onTraining: (n, a) => this.begin('training', n, a),
			onSettings: () => this.openSettings(() => this.showMenu())
		});
	}
	private clearSession() {
		this.runner?.dispose(); this.runner = null;
		this.friend?.dispose(); this.friend = null;
		this.sim = null; this.session = null; this.timers = []; this.paused = false; this.timeScale = 1;
		this.ui.prompt(null); this.ui.countdown(null);
	}

	begin(kind: 'play' | 'training', name: string, avatar: 'male' | 'female') {
		this.sound.unlock();
		const clean = normalizeName(name) ?? ui('menu.defaultName');
		this.clearSession();
		this.save.name = clean; this.save.avatar = avatar;
		let run: Run | null = null, tracks: StageTrack[];
		if (kind === 'play') {
			run = createRun(clean, avatar);
			tracks = buildRun(run.runId, missions, true);
			this.save.plays++;
		} else {
			const cp = checkpoints[Math.floor(Math.random() * 3)];             // one of the first stage's situations
			tracks = [buildStage({ missionId: 'M1', index: 0, start: 0, spec: TRAINING_SPEC, checkpointIds: [cp.id], seed: 'training-' + Date.now(), lessons: true })];
		}
		storeSave(this.save);
		this.session = { kind, run, seed: run?.runId ?? uuid(), name: clean, avatar, tracks, stage: 0, gate: 0, protection: balance.protectionMax,
			totals: { metres: 0, bits: 0, bitsSeen: 0, cleared: 0, hits: 0, falls: 0, bonus: 0, cleanStages: 0 }, decision: null, review: [], reviewTotal: 0, seconds: 0 };
		this.lessonsDone.clear();
		this.runner = new Runner(this.scene, this.kit, avatar);
		this.snapCamera = true;
		this.city.setRun(tracks);
		if (run) this.emit('game.started', { gameId: config.gameId, runId: run.runId });
		this.enterStage(0);
	}

	// ------------------------------------------------------------------ stages
	private enterStage(index: number) {
		const se = this.session!;
		const track = se.tracks[index];
		const prev = this.sim;
		se.stage = index; se.gate = 0; se.decision = null;
		this.sim = new RunnerSim(track);
		this.sim.harmless = se.kind === 'training';
		if (prev) { this.sim.hints = prev.hints; this.sim.lenses = prev.lenses; this.sim.shields = prev.shields; }
		else { this.sim.hints = 1; this.sim.lenses = 1; }
		this.city.enterStage(track);
		this.friend?.dispose(); this.friend = null;
		if (se.kind === 'play' && index === se.tracks.length - 1)
			this.friend = new Friend(this.kit, se.avatar === 'male' ? 'female' : 'male', track.end + 3.2, 1.5);
		this.ui.showHud(true);
		this.sound.music('menu', 0);
		const m = missions.find(x => x.id === track.missionId)!;
		if (se.kind === 'training') {
			this.card({ cyber: true, title: ui('training.title'), lines: [ui('training.intro')], buttons: [{ label: ui('stage.go'), onClick: () => this.startCountdown() }] });
		} else {
			const lines = index === 0 ? [content.story.introCyberAr, content.stages[m.id].introAr] : [content.stages[m.id].introAr];
			this.card({ cyber: true, title: ui('stage.title', { n: num(index + 1), title: m.titleAr }), lines, buttons: [{ label: ui('stage.go'), onClick: () => this.startCountdown() }] });
		}
	}

	private startCountdown(then?: () => void) {
		this.ui.closeLayer();
		this.setMode('countdown');
		this.applySettings();
		const steps = [num(3), num(2), num(1), ui('count.go')];
		steps.forEach((text, i) => this.later(i * 0.62, () => {
			if (this.mode !== 'countdown') return;
			this.ui.countdown(text);
			this.sound.sfx(i < 3 ? 'tick' : 'go');
		}));
		this.later(steps.length * 0.62 - 0.2, () => {
			if (this.mode !== 'countdown') return;
			this.ui.countdown(null);
			this.setMode('run');
			this.sound.music('run');
			then?.();
		});
	}

	private stageDone() {
		const se = this.session!, sim = this.sim!, track = sim.track;
		const t = se.totals;
		t.metres += track.end - track.start; t.bits += sim.bits; t.bitsSeen += sim.bitsSeen; t.cleared += sim.cleared; t.hits += sim.hits; t.falls += sim.falls;
		if (sim.hits === 0) t.cleanStages++;
		const stageBits = sim.bits;
		sim.bits = 0;                                                       // now counted in the totals (the HUD adds both)
		this.input.showButtons(false);
		this.ui.prompt(null);
		this.save.tutorialDone = true;
		storeSave(this.save);
		if (se.kind === 'training') {
			this.sound.sfx('stage'); this.sound.music('menu', 0);
			this.runner?.avatar.play('celebrate');
			this.card({ cyber: true, title: ui('training.doneTitle'), lines: [ui('training.done')], buttons: [
				{ label: ui('menu.play'), onClick: () => this.begin('play', se.name, se.avatar) },
				{ label: ui('result.menu'), kind: 'ghost', onClick: () => this.showMenu() }] });
			return;
		}
		if (se.stage === se.tracks.length - 1) { this.finale(); return; }
		const m = missions.find(x => x.id === track.missionId)!;
		this.sound.sfx('stage'); this.sound.music('menu', 0);
		this.runner?.avatar.play('celebrate');
		this.city.burst(sim.s + 3, 2.5, 0, GOLD, 50);
		this.card({ cyber: true, icon: Ui.icons.check, title: ui('stage.done', { title: m.titleAr }),
			lines: [content.stages[m.id].doneAr, ui('stage.summary', { bits: num(stageBits), hits: num(sim.hits) })],
			buttons: [{ label: ui('stage.next'), onClick: () => this.enterStage(se.stage + 1) }] });
	}

	// ------------------------------------------------------------------ gates
	private openGate() {
		const se = this.session!, sim = this.sim!;
		const gate = sim.track.gates[se.gate];
		const cp = checkpoints.find(c => c.id === gate.checkpointId)!;
		if (!se.decision || se.decision.checkpoint.id !== cp.id) se.decision = buildDecision(cp, se.seed, this.save.seen[cp.id] ?? []);
		this.sound.sfx('gate'); this.sound.music('read');
		this.input.showButtons(false);
		this.ui.prompt(null);
		if (this.runner) this.runner.avatar.phoneOut = true;
		this.showGate();
	}

	private portalStates(selected: number | null): PortalState[] {
		const d = this.session!.decision!;
		if (d.variant.type === 'order') return ['open', 'open', 'open'];
		return [0, 1, 2].map(lane => {
			const c = d.choices.find(x => x.lane === lane);
			return !c || d.tried.includes(c.actionId) ? 'dim' : lane === selected ? 'selected' : 'open';
		});
	}

	private showGate() {
		const se = this.session!, d = se.decision!, sim = this.sim;
		this.setMode('gate');
		this.primary = null;
		this.ui.showHud(false);                                            // the card needs the room; the HUD returns with the result
		if (se.kind !== 'review') this.city.setPortals(se.gate, this.portalStates(null));
		const review = se.kind === 'review';
		const total = review ? se.reviewTotal : sim!.track.gates.length;
		this.ui.gate({ decision: d, index: review ? se.reviewTotal - se.review.length - 1 : se.gate, total, hints: sim?.hints ?? 1, lenses: sim?.lenses ?? 1,
			secondChance: d.tried.length > 0, noTimer: this.save.settings.noTimer }, {
			onSelect: lane => {
				if (lane === null || se.kind === 'review') return;
				sim!.setLane(lane);
				this.city.setPortals(se.gate, this.portalStates(lane));
			},
			onConfirm: actionId => this.answer(actionId),
			onHint: () => { if (!sim || sim.hints <= 0) return null; sim.hints--; this.sound.sfx('lens'); return d.checkpoint.hintAr; },
			onLens: () => { if (!sim || sim.lenses <= 0) return null; sim.lenses--; this.sound.sfx('lens'); return d.variant.lensAr; }
		});
	}

	/** One answer at a gate. Assessed runs go through the scoring engine; practice and review are judged the same way without a ledger. */
	answer(actionId: string) {
		const se = this.session!, d = se.decision!;
		if (this.mode !== 'gate') return;
		const cp = d.checkpoint;
		const safe = actionId === cp.safeActionId;
		const recovered = d.tried.length > 0;
		if (se.run && se.kind === 'play') {                                  // review after the run is practice: the ledger is closed
			const r = applyAction(se.run, { eventId: uuid(), runId: se.run.runId, checkpointId: cp.id, actionId });
			if (!r.accepted) { console.warn('decision refused', r.reason); return; }
			this.emit('game.decision', { gameId: config.gameId, checkpointId: cp.id, actionId, safe });
		}
		this.ui.closeLayer();
		this.setMode('wait');
		const lane = d.choices.find(c => c.actionId === actionId)?.lane ?? 1;
		const order = d.variant.type === 'order';
		const gate = this.sim && se.kind !== 'review' ? this.sim.track.gates[se.gate] : null;
		const at = gate ? [gate.s, 1.6, laneZ(order ? 1 : lane)] as const : null;
		let gained = false, bonus = 0;
		if (safe) {
			if (gate) this.city.setPortals(se.gate, [0, 1, 2].map(l => (order || l === lane ? 'safe' : 'dim')));
			if (at) this.city.burst(at[0], at[1], at[2], GREEN, 46);
			this.sound.sfx(recovered ? 'recovered' : 'safe');
			this.runner?.avatar.play('happy'); this.runner?.cyber.setExpression('Happy');
			this.ui.banner('good', ui(recovered ? 'fb.recovered' : 'fb.safe'), 1.6);
			if (!recovered && se.kind === 'play' && se.protection < balance.protectionMax) { se.protection++; gained = true; }
			if (se.kind === 'play') {
				if (!recovered && d.fresh && this.save.plays > 1) { bonus = balance.points.newSituation; se.totals.bonus += bonus; }
				const seen = this.save.seen[cp.id] ?? (this.save.seen[cp.id] = []);
				if (!seen.includes(d.variant.id)) seen.push(d.variant.id);
				storeSave(this.save);
			}
		} else {
			d.tried.push(actionId);
			if (gate) { const st = this.portalStates(null); if (!order) st[lane] = 'unsafe'; else st.fill('unsafe'); this.city.setPortals(se.gate, st); }
			if (at) this.city.burst(at[0], at[1], at[2], RED, 40);
			this.sound.sfx('unsafe');
			this.runner?.avatar.play('sad'); this.runner?.cyber.setExpression('Sad');
			this.ui.banner('bad', ui('fb.unsafe'), 1.6);
			this.ui.glitch(this.save.settings.reduceMotion);
			this.shake(0.5);
			if (se.kind === 'play') se.protection = Math.max(0, se.protection - 1);       // practice and review cost nothing
		}
		this.later(0.95, () => this.showFeedback(actionId, safe, recovered, gained, bonus));
	}

	private showFeedback(actionId: string, safe: boolean, recovered: boolean, gained: boolean, bonus: number) {
		const se = this.session!, d = se.decision!, cp = d.checkpoint;
		this.ui.showHud(se.kind !== 'review');
		if (safe) {
			this.card({ cls: 'good', icon: recovered ? Ui.icons.redo : Ui.icons.check, title: ui(recovered ? 'fb.recovered' : 'fb.safe'),
				lines: [cp.feedbackAr, recovered ? d.variant.recoverAr : '', bonus ? ui('fb.bonus', { n: num(bonus) }) : '', gained ? ui('fb.protectionUp') : ''],
				buttons: [{ label: ui(se.kind === 'review' ? 'fb.next' : 'fb.run'), onClick: () => this.afterGate() }] });
			return;
		}
		const out = se.kind === 'play' && se.protection <= 0;
		this.card({ cls: 'bad', icon: Ui.icons.warn, title: ui('fb.unsafe'),
			lines: [d.variant.consequencesAr[actionId] ?? '', cp.feedbackAr, se.kind === 'play' ? ui('fb.protectionDown') : ''],
			buttons: [{ label: ui(out ? 'fb.continue' : 'fb.fix'), onClick: () => (out ? this.protectionOut() : this.showGate()) }] });
	}

	private protectionOut() {
		const se = this.session!, sim = this.sim!;
		this.card({ cls: 'bad', cyber: true, icon: Ui.icons.shield, title: ui('fail.protection.title'), lines: [ui('fail.protection.text')],
			buttons: [{ label: ui('fail.retry'), onClick: () => {
				se.protection = balance.protectionMax;
				this.city.setPortals(se.gate, ['idle', 'idle', 'idle']);
				if (this.runner) this.runner.avatar.phoneOut = false;
				sim.respawn(sim.track.segmentStarts[se.gate]);
				this.startCountdown();
			} }] });
	}

	private afterGate() {
		const se = this.session!;
		se.decision = null;
		if (se.kind === 'review') { this.nextReview(); return; }
		const sim = this.sim!;
		if (this.runner) this.runner.avatar.phoneOut = false;
		se.gate++;
		const next = sim.track.gates[se.gate];
		this.startCountdown(() => sim.resume(next?.stopS ?? sim.track.end));
	}

	// ------------------------------------------------------------------ review of the situations that needed a second try
	private startReview(list: CheckpointDef[]) {
		const se = this.session!;
		se.kind = 'review'; se.review = list.slice(); se.reviewTotal = list.length;
		this.nextReview();
	}
	private nextReview() {
		const se = this.session!;
		const cp = se.review.shift();
		if (!cp) {
			this.card({ cyber: true, icon: Ui.icons.check, title: ui('review.doneTitle'), lines: [ui('review.done')], buttons: [{ label: ui('review.back'), onClick: () => this.resultsView?.() }] });
			return;
		}
		se.decision = buildDecision(cp, uuid(), []);                          // any situation of the same skill
		this.sound.music('read');
		this.showGate();
	}

	// ------------------------------------------------------------------ the vault and the results
	private finale() {
		const se = this.session!, sim = this.sim!;
		this.setMode('finale');
		this.ui.showHud(false);
		sim.setLane(1);                                                     // walk to the middle, in front of the vault door
		this.city.openVault();
		this.sound.music('win', 1); this.sound.sfx('win');
		this.runner?.avatar.play('celebrate'); this.runner?.cyber.setExpression('Happy');
		this.friend?.avatar.play('celebrate');
		this.ui.banner('good', content.story.vaultCyberAr, 4);
		for (let i = 0; i < 6; i++) this.later(0.3 + i * 0.55, () => this.city.burst(sim.s + 4 + Math.random() * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 6, i % 2 ? GOLD : BLUE, 46));
		this.later(2.2, () => { this.friend?.avatar.play('happy'); this.runner?.avatar.play('happy'); });
		this.later(4.4, () => this.showResults());
		se.seconds = Math.round(se.seconds);
	}

	private showResults() {
		const se = this.session!, run = se.run!;
		const result = getResult(run);
		const t = se.totals;
		const ratio = t.bitsSeen ? t.bits / t.bitsSeen : 0;
		const runScore = Math.round(t.metres * balance.points.perMetre + t.bits * balance.points.bit + t.cleared * balance.points.cleared + t.bonus);
		const starReasons = [
			{ text: ui('star.finish'), on: true },
			{ text: ui('star.bits', { n: num(Math.round(balance.stars.bitsRatio * 100)) }), on: ratio >= balance.stars.bitsRatio },
			{ text: ui('star.hits', { n: num(balance.stars.maxHits) }), on: t.hits <= balance.stars.maxHits }
		];
		const stars = starReasons.filter(s => s.on).length;
		const state = (id: string) => run.states[id];
		const pristine = (ids: string[]) => ids.every(id => state(id) === 'resolved_pristine');
		const earned: string[] = [];
		missions.forEach((m, i) => { if (pristine(m.checkpoints.map(c => c.id))) earned.push(['phish', 'accounts', 'vault'][i] ?? m.id); });
		if (pristine(checkpoints.map(c => c.id))) earned.push('fullShield');
		if (ratio >= 0.8) earned.push('collector');
		if (t.cleanStages > 0) earned.push('steady');
		const fresh = earned.filter(b => !this.save.badges.includes(b));
		this.save.badges.push(...fresh);
		const best = this.save.best;
		if (!best || result.earnedPoints > best.knowledge || (result.earnedPoints === best.knowledge && runScore > best.runScore))
			this.save.best = { knowledge: result.earnedPoints, runScore, stars };
		storeSave(this.save);
		const fun: Fun = { stars, runScore, bits: t.bits, bitsTotal: t.bitsSeen, hits: t.hits, falls: t.falls, seconds: se.seconds };
		this.opts.onComplete?.({ result, ledger: run.ledger, fun });
		const needReview = checkpoints.filter(c => state(c.id) === 'resolved_recovered');
		this.sound.music('menu', 0);
		this.resultsView = () => {
			this.setMode('results');
			this.ui.results({
				earned: result.earnedPoints, max: result.maximumPoints, passed: result.passed, runScore, stars, starReasons,
				mastered: checkpoints.filter(c => state(c.id) === 'resolved_pristine').map(c => c.labelAr),
				review: needReview.map(c => c.labelAr),
				badges: earned.map(id => ({ title: ui('badge.' + id), isNew: fresh.includes(id) })),
				note: content.story.simulatedNoteAr,
				onReview: needReview.length ? () => this.startReview(needReview) : null,
				onReplay: () => this.begin('play', se.name, se.avatar),
				onMenu: () => this.showMenu()
			});
		};
		this.resultsView();
	}

	// ------------------------------------------------------------------ input and pause
	private onAction(a: InputAction) {
		this.sound.unlock();
		if (a === 'pause') { this.togglePause(); return; }
		if (this.paused) return;
		if (this.mode === 'gate') { this.ui.key(a); return; }
		if (a === 'confirm') { if (this.mode === 'card') this.primary?.(); return; }
		if (this.mode === 'run' && this.sim) this.sim.input(a);
	}

	togglePause() {
		if (this.paused) {
			this.paused = false;
			this.ui.closeLayer();
			this.sound.suspend(false);
			// always a countdown before running again; one that was interrupted simply goes on
			if (this.mode === 'run') this.startCountdown(); else this.applySettings();
			return;
		}
		if (this.mode !== 'run' && this.mode !== 'countdown') return;
		this.paused = true;
		this.ui.countdown(null); this.ui.prompt(null);
		this.input.showButtons(false);
		this.sound.suspend(true);
		const show = () => this.ui.modal({ title: ui('pause.title'), lines: [ui('pause.text')], buttons: [
			{ label: ui('pause.resume'), onClick: () => this.togglePause() },
			{ label: ui('menu.settings'), kind: 'ghost', onClick: () => this.openSettings(show) },
			{ label: ui('pause.quit'), kind: 'ghost', onClick: () => { this.sound.suspend(false); this.showMenu(); } }] });
		show();
	}

	// ------------------------------------------------------------------ the frame
	/** Advances the game by dt seconds. The render loop calls it; tests call it in fixed steps through simulate(). */
	tick(dt: number) {
		const realDt = dt;
		if (!this.paused) {
			this.clock += dt; this.modeT += dt;
			if (this.session && this.mode !== 'results' && this.mode !== 'finale') this.session.seconds += dt;
			for (let i = 0; i < this.timers.length; i++) if (this.timers[i].at <= this.clock) { const t = this.timers.splice(i--, 1)[0]; t.fn(); }
			if (this.demo) this.playDemo();
			const sim = this.sim;
			if (sim && this.mode === 'run') {
				if (this.freeze > 0) this.freeze -= realDt;
				else {
					const target = this.lessons(sim);
					this.timeScale += (target - this.timeScale) * Math.min(1, realDt * 9);
					sim.step(dt * this.timeScale);
					for (const e of sim.events.splice(0)) this.onSimEvent(e, sim);
				}
				this.sound.music('run', (sim.speed - 8) / 6);
				this.watchFrameRate(realDt);
			} else if (sim && (this.mode === 'gate' || this.mode === 'finale')) sim.idle(dt);
		}
		this.draw(realDt);
	}

	/** Dev and tests: run the game for some seconds in fixed steps, then draw one frame. */
	simulate(seconds: number, step = 1 / 60) { for (let t = 0; t < seconds; t += step) this.tick(step); this.scene.render(); }

	private onSimEvent(e: SimEvent, sim: RunnerSim) {
		switch (e.type) {
			case 'jump': this.sound.sfx('jump'); break;
			case 'slide': this.sound.sfx('slide'); break;
			case 'land': this.sound.sfx('land'); break;
			case 'edge': this.sound.sfx('edge'); break;
			case 'collect':
				if (e.kind === 'bit') { this.sound.sfx('collect', e.streak); this.city.burst(e.pickup.s, e.pickup.y, laneZ(e.pickup.lane), GOLD, 5); }
				else { this.sound.sfx('power'); this.city.burst(e.pickup.s, e.pickup.y, laneZ(e.pickup.lane), BLUE, 26); this.ui.banner('info', ui('pickup.' + e.kind), 1.8); }
				break;
			case 'hit':
				this.sound.sfx('hit'); this.shake(0.55);
				if (!this.save.settings.reduceMotion) this.freeze = 0.07;
				this.city.burst(e.obstacle.s, 1, laneZ(e.obstacle.lane), RED, 30);
				this.runner?.avatar.setExpression('Surprised', 1);
				this.ui.banner('bad', ui('run.hit'), 1.3);
				break;
			case 'shieldBlock':
				this.sound.sfx('shield'); this.city.burst(e.obstacle.s, 1, laneZ(e.obstacle.lane), BLUE, 30);
				this.ui.banner('info', ui('run.shield'), 1.4);
				break;
			case 'bump':
				this.sound.sfx('edge'); this.city.burst(e.obstacle.s, 1, laneZ(e.obstacle.lane), LANE_COLORS[2], 14);
				this.ui.banner('info', ui('run.bump'), 1.4);
				break;
			case 'energyOut':
				this.setMode('wait');
				this.ui.prompt(null); this.input.showButtons(false);
				this.sound.music('menu', 0);
				this.runner?.avatar.play('sad');
				this.later(0.7, () => this.card({ cls: 'bad', cyber: true, icon: Ui.icons.bolt, title: ui('fail.energy.title'), lines: [ui('fail.energy.text')],
					buttons: [{ label: ui('fail.retry'), onClick: () => { sim.respawn(sim.track.segmentStarts.filter(x => x <= sim.s + 0.01).pop() ?? sim.track.start); this.startCountdown(); } }] }));
				break;
			case 'stop':
				if (this.mode !== 'run') break;
				if (sim.s >= sim.track.end - 0.01) this.stageDone(); else this.openGate();
				break;
		}
	}

	/** First-run lessons: a prompt at the moment each move is needed, with time slowed until the player does it. */
	private lessons(sim: RunnerSim): number {
		const se = this.session!;
		if (this.save.tutorialDone && se.kind !== 'training') return 1;
		const row = sim.track.rows.find(r => r.lesson && !this.lessonsDone.has(r));
		if (!row) { if (this.clock > this.lessonGoodUntil) this.ui.prompt(null); return 1; }
		const dist = row.s - sim.s;
		const lesson = row.lesson!;
		const done = dist < -1 || (lesson === 'lane' && row.cells[sim.lane] !== 'block' && dist < 30) || (lesson === 'jump' && sim.airborne && dist < 5)
			|| (lesson === 'slide' && sim.sliding > 0 && dist < 5) || (lesson === 'collect' && dist < 0);
		if (done) {
			this.lessonsDone.add(row);
			if (dist >= -1 && lesson !== 'collect') { this.ui.prompt(ui('lesson.good')); this.lessonGoodUntil = this.clock + 0.9; }
			return 1;
		}
		if (this.clock < this.lessonGoodUntil) return 1;
		const how = this.input.touch ? 'touch' : 'keys';
		const arrows: Record<string, string> = { lane: sim.lane > row.pathLane ? '◀' : '▶', jump: '▲', slide: '▼', collect: '◆' };
		const actNow = lesson === 'lane' ? dist < sim.speed * 1.5 : lesson === 'collect' ? dist < 16 : dist < sim.speed * 0.5;
		if (actNow) {
			const key = lesson === 'lane' ? (sim.lane > row.pathLane ? 'lesson.left.' : 'lesson.right.') + how : lesson === 'collect' ? 'lesson.collect' : `lesson.${lesson}.${how}`;
			this.ui.prompt(ui(key), arrows[lesson]);
			return lesson === 'collect' ? 1 : lesson === 'lane' ? 0.3 : 0.16;
		}
		if (dist < 20 && lesson !== 'collect') this.ui.prompt(ui('lesson.ready.' + lesson));
		else this.ui.prompt(null);
		return 1;
	}

	private watchFrameRate(realDt: number) {
		this.fpsT += realDt; this.fpsN++;
		if (this.fpsT < 2.5) return;
		const fps = this.fpsN / this.fpsT;
		this.fpsT = 0; this.fpsN = 0;
		if (fps >= 42 || this.demo) return;
		if (this.scaling < 2.2) { this.scaling *= 1.25; this.engine.setHardwareScalingLevel(this.scaling); }
	}

	private draw(realDt: number) {
		const se = this.session, sim = this.sim;
		if (this.mode === 'menu' || this.mode === 'loading') this.menuS += realDt * 5;
		const s = sim ? sim.s : this.menuS, z = sim ? sim.z : 0, y = sim ? sim.y : 0;
		const last = se?.tracks[se.tracks.length - 1];
		const overall = se && last && se.kind !== 'training' ? Math.min(1, s / last.end) : 0;
		const still = this.mode !== 'run' && this.mode !== 'countdown';
		this.runner?.update(realDt, sim, se ? se.protection / balance.protectionMax : 1, still || this.paused, !!sim && sim.invulnerable > 0 && !this.save.settings.reduceMotion && this.mode === 'run');
		this.friend?.update(realDt);
		this.city.update(this.paused ? 0 : realDt, sim?.track ?? null, s, z, overall);

		// camera: behind the runner; closer to the gate while deciding; beside the vault at the end
		const portrait = this.engine.getAspectRatio(this.cam) < 1;
		let back = portrait ? 7.8 : 5.6, up = portrait ? 4.4 : 3.0, ahead = portrait ? 5 : 7, fov = portrait ? 1.22 : 0.92;
		const want = new Vector3(s - back, up + y * 0.25, z * 0.55), look = new Vector3(s + ahead, 1.1, z * 0.35);
		const review = se?.kind === 'review';
		if (!review && (this.mode === 'gate' || (this.mode === 'wait' && sim?.stopped) || (this.mode === 'card' && sim?.stopped && sim.s < sim.track.end - 1))) {
			want.set(s - back, up * 1.12, z * 0.3); look.set(s + balance.gateStandoff - 1, 1.0, 0);
		} else if (this.mode === 'finale' || this.mode === 'results' || review) {
			if (portrait) { want.set(s - 9, 3.1, z * 0.5 + 0.3); look.set(s + 6, 2.5, 0.5); }
			else { want.set(s - 5.6, 2.6, -3.4); look.set(s + 5, 2.3, 0.4); }
		}
		const speed01 = sim && this.mode === 'run' ? Math.max(0, Math.min(1, (sim.speed - 8) / 6)) : 0;
		if (!this.save.settings.reduceMotion) fov += 0.07 * speed01;
		const k = this.snapCamera ? 1 : Math.min(1, realDt * (this.mode === 'run' ? 9 : 3.2));
		this.snapCamera = false;
		Vector3.LerpToRef(this.camPos, want, k, this.camPos);
		Vector3.LerpToRef(this.camLook, look, k, this.camLook);
		if (this.mode === 'run' || this.mode === 'countdown' || this.mode === 'menu') { this.camPos.x = want.x; this.camLook.x = look.x; }
		this.trauma = Math.max(0, this.trauma - realDt * 1.5);
		this.shakeT += realDt * 30;
		const shake = this.trauma * this.trauma;
		this.cam.position.set(this.camPos.x, this.camPos.y + 0.22 * shake * Math.sin(this.shakeT * 2.3), this.camPos.z + 0.3 * shake * Math.sin(this.shakeT * 1.7));
		this.cam.setTarget(this.camLook);
		this.cam.fov += (fov - this.cam.fov) * Math.min(1, realDt * 4);

		if (sim && se && this.mode !== 'finale' && this.mode !== 'results') {
			const end = last ? last.end : sim.track.end;
			this.ui.setHud({ remaining: end - sim.s, progress: Math.min(1, sim.s / end), energy: sim.energy, energyMax: balance.energyMax, protection: se.protection,
				protectionMax: balance.protectionMax, bits: se.totals.bits + sim.bits, shields: sim.shields, hints: sim.hints, lenses: sim.lenses, stage: sim.track.missionId });
		}
	}

	/** Dev only (?demo=good|mixed|poor): plays by itself so a whole run can be watched or stepped in tests. */
	private playDemo() {
		const se = this.session;
		if (this.mode === 'menu' && this.modeT > 0.4 && this.kit) { this.begin('play', 'تجربة', 'female'); return; }
		if (!se) return;
		if (this.mode === 'run' && this.sim) autopilot(this.sim, this.demo === 'poor' ? 0.82 : this.demo === 'mixed' ? 0.94 : 1);
		else if (this.mode === 'card' && this.modeT > 0.5) { const p = this.primary; this.primary = null; p?.(); }
		else if (this.mode === 'gate' && this.modeT > 0.6 && se.decision) {
			const cp = se.decision.checkpoint, n = checkpoints.indexOf(cp);
			const wrongFirst = this.demo === 'poor' || (this.demo === 'mixed' && n % 3 === 1);
			this.answer(wrongFirst && !se.decision.tried.length ? cp.unsafeActionIds[n % cp.unsafeActionIds.length] : cp.safeActionId);
		}
	}

	dispose() {
		for (const d of this.disposers) d();
		this.input.dispose(); this.sound.dispose(); this.ui.dispose(); this.city.dispose();
		this.engine.dispose(); this.host.innerHTML = '';
	}
}
