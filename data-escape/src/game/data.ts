// The game specification (missions.json, game-config.json), its Arabic text (content-ar.json, ui-ar.json) and the
// shape of a decision card. All player-facing text lives in those files, never in code.
import missionsJson from '../data/missions.json';
import configJson from '../data/game-config.json';
import contentJson from '../data/content-ar.json';
import uiJson from '../data/ui-ar.json';

export interface CheckpointDef {
	id: string; order: number; labelAr: string; weight: number;
	safeActionId: string; unsafeActionIds: string[]; feedbackAr: string; hintAr: string;
	missionId: string;
}
export interface MissionDef {
	id: string; order: number; titleAr: string; locationAr: string; maximumPoints: number; checkpoints: CheckpointDef[];
}
export interface CardDef {
	skin: 'message' | 'chat' | 'alert';
	appAr?: string; fromAr?: string; fromAddress?: string; time?: string; titleAr?: string; iconAr?: string;
	bodyAr?: string[]; rowsAr?: string[]; linkAr?: string; buttonsAr?: string[];
	chatAr?: { from: 'them' | 'me'; textAr: string }[];
	segments?: { textAr: string; actionId?: string }[];
}
export interface VariantDef {
	id: string; type: 'choice' | 'spot' | 'compare' | 'order';
	/** One line that sets the scene before the card: who the child is in this situation and what just happened. */
	sceneAr: string;
	card?: CardDef; cards?: CardDef[]; promptAr: string;
	options?: { actionId: string; labelAr: string }[];
	steps?: { id: string; textAr: string }[];
	consequencesAr: Record<string, string>; lensAr: string; recoverAr: string; pressureSec?: number;
}

export const config = configJson as { gameId: string; titleAr: string; assessmentVersion: string; avatarIds: string[];
	passThresholdPercent: number; recoveryCreditRate: number; name: { minCodePoints: number; maxCodePoints: number } };
type RawMission = Omit<MissionDef, 'checkpoints'> & { checkpoints: Omit<CheckpointDef, 'missionId'>[] };
export const missions: MissionDef[] = (missionsJson as unknown as { missions: RawMission[] }).missions.map(m => ({
	...m, checkpoints: m.checkpoints.map(c => ({ ...c, missionId: m.id }))
}));
export const checkpoints: CheckpointDef[] = missions.flatMap(m => m.checkpoints);
export const content = contentJson as unknown as {
	story: Record<string, string>; student: { maleNameAr: string; femaleNameAr: string };
	stages: Record<string, { introAr: string; doneAr: string }>;
	decisions: Record<string, { variants: VariantDef[] }>;
};
const uiFlat = uiJson as Record<string, string>;

/** Interface text by key, with {name} placeholders filled from `values`. */
export function ui(key: string, values?: Record<string, string | number>): string {
	const s = uiFlat[key] ?? key;
	return values ? s.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m)) : s;
}

export const variantsOf = (checkpointId: string): VariantDef[] => content.decisions[checkpointId]?.variants ?? [];

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Numbers as the Arabic text shows them (٠-٩). */
export const num = (n: number | string) => String(n).replace(/\d/g, d => AR_DIGITS[+d]).replace('.', '٫');
