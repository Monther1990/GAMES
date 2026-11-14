// What the game keeps on this device (localStorage): the wallet, weapons, opened stages, settings, the assessed run and
// an unfinished question session. Money is written before any animation, so a reload never loses or repeats a reward.
// Nothing here is sent anywhere. Reads and writes never throw.
import { config } from '../game/data';
import type { Bank, WeaponId } from '../sim/economy';
import { POWER_IDS } from '../sim/powers';
import type { PowerId } from '../sim/powers';
import type { LedgerEntry, CheckpointState } from '../game/assessment';

export interface Settings { music: boolean; sfx: boolean; reduceMotion: boolean; noShake: boolean; quality: 'auto' | 'low' | 'high' }
/** The assessed run (the first set of answers in each stage), kept so it survives a reload and is reported once. */
export interface SavedRun { runId: string; displayName: string; avatarId: string; states: Record<string, CheckpointState>; ledger: LedgerEntry[]; completedAt: string | null; reported: boolean }
export interface QuizAnswer { checkpointId: string; variantId: string; order: string[]; picked: string | null; correct: boolean | null; fixed: boolean }
/** The question session after a boss. Saved after every confirmed answer, with the rewards already paid in it. */
export interface SavedQuiz { attemptId: string; stage: number; assessed: boolean; index: number; answers: QuizAnswer[]; paid: [string, number][]; done: boolean;
	/** The supporter's own questions after a boss fought together: practice, paid, never part of their saved progress. */
	guest?: boolean }
export interface Save {
	v: 1; name: string; avatar: 'male' | 'female'; profileDone: boolean; tutorialDone: boolean;
	bank: Bank; unlocked: number; cleared: boolean[]; settings: Settings;
	seen: Record<string, string[]>; run: SavedRun | null; quiz: SavedQuiz | null; attempts: number;
	/** Emergency powers won from Cyber boxes and not used yet (at most three), and the box questions already met. */
	powers: PowerId[]; quickSeen: string[];
	/** The bank as it was on entering the stage being fought. A stage that is lost or abandoned returns to it; beating the boss clears it. */
	stageStart: { stage: number; bank: Bank } | null;
	/** The last challenge: whether its one-time reward was paid, and how many times the code boss was beaten. */
	codeBossPaid: boolean; codeBossWins: number;
	/** The kinds of malware already introduced (keys of malware-ar.json). */
	met: string[];
}

const KEY = `${config.gameId}:save:v1`;

export function defaults(): Save {
	let reduce = false;
	try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* not available */ }
	return { v: 1, name: '', avatar: 'male', profileDone: false, tutorialDone: false,
		bank: { wallet: 0, weapons: { pulse: 1 }, equipped: 'pulse' as WeaponId }, unlocked: 1, cleared: [false, false, false, false, false],
		settings: { music: true, sfx: true, reduceMotion: reduce, noShake: reduce, quality: 'auto' }, seen: {}, run: null, quiz: null, attempts: 0, powers: [], quickSeen: [], stageStart: null, codeBossPaid: false, codeBossWins: 0, met: [] };
}

export function loadSave(): Save {
	const d = defaults();
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		if (!raw || raw.v !== 1) return d;
		const s: Save = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings ?? {}) }, bank: { ...d.bank, ...(raw.bank ?? {}) }, seen: { ...(raw.seen ?? {}) } };
		if (!s.bank.weapons?.pulse) s.bank.weapons = { ...s.bank.weapons, pulse: 1 };
		if (!s.bank.weapons[s.bank.equipped]) s.bank.equipped = 'pulse';
		s.bank.wallet = Math.max(0, Math.floor(Number(s.bank.wallet) || 0));
		// a save from before the powers were replaced may hold ids that no longer exist: they are dropped, never used
		s.powers = (Array.isArray(raw.powers) ? raw.powers : []).filter((p: unknown): p is PowerId => (POWER_IDS as unknown[]).includes(p)).slice(0, 3);
		s.quickSeen = Array.isArray(raw.quickSeen) ? raw.quickSeen.filter((q: unknown) => typeof q === 'string') : [];
		s.codeBossPaid = raw.codeBossPaid === true; s.codeBossWins = Math.max(0, Math.floor(Number(raw.codeBossWins) || 0));
		s.met = Array.isArray(raw.met) ? raw.met.filter((k: unknown) => typeof k === 'string') : [];
		const at = raw.stageStart;
		s.stageStart = at && typeof at.bank?.wallet === 'number' && at.bank.weapons?.pulse ? { stage: Number(at.stage) || 0, bank: at.bank } : null;
		return s;
	} catch { return d; }
}

export function storeSave(s: Save) {
	try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode or full: play on without saving */ }
}
