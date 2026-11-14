// A decision at a gate: which situation variant this run shows, the order of its answers, and how an answer maps to
// one of the checkpoint's action ids (the ids the platform re-scores). Pure: no rendering.
import { shuffleForRun } from '../game/assessment';
import { CheckpointDef, VariantDef, variantsOf } from '../game/data';

export interface Choice { actionId: string; labelAr: string; lane: number }
export interface Decision {
	checkpoint: CheckpointDef; variant: VariantDef;
	/** choice / spot / compare: three answers, one per lane (left, middle, right). */
	choices: Choice[];
	/** order: the steps in the order they are shown; the authored order in `variant.steps` is the right one. */
	steps: { id: string; textAr: string }[];
	tried: string[];
	fresh: boolean;
}

function hash(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** A variant the player has not met yet when there is one; otherwise any, chosen from the run id. */
export function pickVariant(checkpointId: string, runId: string, seen: string[]): { variant: VariantDef; fresh: boolean } {
	const all = variantsOf(checkpointId);
	const unseen = all.filter(v => !seen.includes(v.id));
	const pool = unseen.length ? unseen : all;
	return { variant: pool[hash(runId + '|' + checkpointId) % pool.length], fresh: unseen.length > 0 };
}

export function buildDecision(cp: CheckpointDef, runId: string, seen: string[]): Decision {
	const { variant, fresh } = pickVariant(cp.id, runId, seen);
	let raw: { actionId: string; labelAr: string }[] = [];
	if (variant.type === 'spot') raw = (variant.card?.segments ?? []).filter(s => s.actionId).map(s => ({ actionId: s.actionId!, labelAr: s.textAr }));
	else if (variant.type !== 'order') raw = variant.options ?? [];
	// spot keeps the reading order of the message; the other types are shuffled per run
	const ordered = variant.type === 'spot' ? raw : shuffleForRun(raw, runId, cp.id);
	const steps = variant.type === 'order' ? shuffleNotSolved(variant.steps ?? [], runId, cp.id) : [];
	return { checkpoint: cp, variant, choices: ordered.map((c, lane) => ({ ...c, lane })), steps, tried: [], fresh };
}

/** The steps shuffled, but never already in the right order. */
function shuffleNotSolved<T>(steps: T[], runId: string, checkpointId: string): T[] {
	for (let i = 0; i < 6; i++) {
		const out = shuffleForRun(steps, runId + ':' + i, checkpointId);
		if (out.some((s, k) => s !== steps[k])) return out;
	}
	return steps.slice().reverse();
}

/** The action id an ordering stands for: all right is the safe action; a wrong first step and a wrong later step are
 *  the checkpoint's two unsafe actions. */
export function orderAction(cp: CheckpointDef, variant: VariantDef, order: string[]): string {
	const right = (variant.steps ?? []).map(s => s.id);
	if (order.length === right.length && order.every((id, i) => id === right[i])) return cp.safeActionId;
	return order[0] !== right[0] ? cp.unsafeActionIds[0] : cp.unsafeActionIds[1] ?? cp.unsafeActionIds[0];
}

export const isSafe = (cp: CheckpointDef, actionId: string) => actionId === cp.safeActionId;
