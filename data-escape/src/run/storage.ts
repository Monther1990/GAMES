// What the game keeps on this device (localStorage): settings, the last name and avatar, best results, badges, and which
// situations the player has already met. Nothing here is sent anywhere. Reads and writes never throw.
import { config } from '../game/data';

export interface Settings { music: boolean; sfx: boolean; reduceMotion: boolean; noShake: boolean; noTimer: boolean; touchButtons: boolean }
export interface Best { knowledge: number; runScore: number; stars: number }
export interface Save {
	v: 1; name: string; avatar: 'male' | 'female'; settings: Settings; tutorialDone: boolean;
	best: Best | null; badges: string[]; seen: Record<string, string[]>; plays: number;
}

const KEY = `${config.gameId}:save:v1`;

function defaults(): Save {
	let reduce = false;
	try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* not available */ }
	return { v: 1, name: '', avatar: 'male', tutorialDone: false, best: null, badges: [], seen: {}, plays: 0,
		settings: { music: true, sfx: true, reduceMotion: reduce, noShake: reduce, noTimer: false, touchButtons: false } };
}

export function loadSave(): Save {
	const d = defaults();
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		if (!raw || raw.v !== 1) return d;
		return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings ?? {}) }, seen: { ...(raw.seen ?? {}) }, badges: [...(raw.badges ?? [])] };
	} catch { return d; }
}

export function storeSave(s: Save) {
	try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode or full: play on without saving */ }
}
