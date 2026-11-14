// The game specification (missions.json, game-config.json), its text in Arabic and English (content-*.json, ui-*.json,
// quick-*.json, malware-*.json, names-en.json) and the shape of a question. All player-facing text lives in those
// files, never in code. The English files mirror the Arabic ones key for key (the field names ending in "Ar" are
// kept, so one piece of code reads both); which set is used is decided once, in lang.ts.
import missionsJson from '../data/missions.json';
import configJson from '../data/game-config.json';
import contentAr from '../data/content-ar.json';
import contentEn from '../data/content-en.json';
import uiAr from '../data/ui-ar.json';
import uiEn from '../data/ui-en.json';
import quickAr from '../data/quick-ar.json';
import quickEn from '../data/quick-en.json';
import malwareAr from '../data/malware-ar.json';
import malwareEn from '../data/malware-en.json';
import namesEn from '../data/names-en.json';
import { lang } from './lang';

const en = lang === 'en';
const contentJson = en ? contentEn : contentAr, uiJson = en ? uiEn : uiAr;
type Names = { config: { titleAr: string }; missions: Record<string, { titleAr?: string; locationAr?: string }>; checkpoints: Record<string, { labelAr?: string; feedbackAr?: string; hintAr?: string }> };
const names = namesEn as unknown as Names;
/** The quick questions of the boxes, and the kinds of malware, in the language of the page. */
export const quick = (en ? quickEn : quickAr) as typeof quickAr;
export const malware = (en ? malwareEn : malwareAr) as typeof malwareAr;
import omrJson from '../data/omr-symbol.json';

export interface CheckpointDef {
	id: string; order: number; labelAr: string; weight: number; difficulty: number;
	safeActionId: string; unsafeActionIds: string[]; feedbackAr: string; hintAr: string;
	missionId: string;
}
export interface MissionDef { id: string; order: number; titleAr: string; locationAr: string; maximumPoints: number; checkpoints: CheckpointDef[] }
/** One situation of a question slot. Two per slot, so a replay can show a different one. */
export interface VariantDef {
	id: string; sceneAr: string; message?: { fromAr: string; textAr: string }; promptAr: string;
	options: { actionId: string; labelAr: string }[]; praiseAr: string; explainAr: string;
}

export const config = { ...configJson, ...(en ? names.config : {}) } as { gameId: string; titleAr: string; assessmentVersion: string; avatarIds: string[];
	passThresholdPercent: number; recoveryCreditRate: number; name: { minCodePoints: number; maxCodePoints: number } };
type RawMission = Omit<MissionDef, 'checkpoints'> & { checkpoints: Omit<CheckpointDef, 'missionId'>[] };
export const missions: MissionDef[] = (missionsJson as unknown as { missions: RawMission[] }).missions.map(m => ({
	...m, ...(en ? names.missions[m.id] : {}), checkpoints: m.checkpoints.map(c => ({ ...c, ...(en ? names.checkpoints[c.id] : {}), missionId: m.id }))
}));
export const checkpoints: CheckpointDef[] = missions.flatMap(m => m.checkpoints);
export const content = contentJson as unknown as {
	story: Record<string, string>; sources: string[]; decisions: Record<string, { variants: VariantDef[] }>;
};
const uiFlat = uiJson as Record<string, string>;
/** The official Omani Rial symbol: path data copied unchanged from the owner's file (scripts/extract-omr.mjs). */
export const omr = omrJson as { viewBox: number[]; d: string };

/** Interface text by key, with {name} placeholders filled from `values`. */
export function ui(key: string, values?: Record<string, string | number>): string {
	const s = uiFlat[key] ?? key;
	return values ? s.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m)) : s;
}
export const variantsOf = (checkpointId: string): VariantDef[] => content.decisions[checkpointId]?.variants ?? [];

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Numbers as the text of the page shows them: ٠-٩ in Arabic, 0-9 in English. */
export const num = (n: number | string) => (en ? String(n) : String(n).replace(/\d/g, d => AR_DIGITS[+d]).replace('.', '٫'));
