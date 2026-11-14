// Money rules (pure: no rendering, no storage). Every number comes from src/data/economy.json, which is the approved
// balance table of the brief. A reward is credited once per attempt by its id, before any animation plays, so a
// repeated event, a double click or a reload can never pay it twice.
import eco from '../data/economy.json';
import namesEn from '../data/names-en.json';
import { lang } from '../game/lang';

export type WeaponId = 'pulse' | 'scatter' | 'arc' | 'disc' | 'beam' | 'wave' | 'missile' | 'plasma' | 'shield';
export type EnemyClass = 'normal' | 'armored' | 'rare';
export interface StageDef {
	id: string; nameAr: string; placeAr: string; topicAr: string; enemies: Record<EnemyClass, number>; bossReward: number;
	questionRewards: number[]; bonus: number; boss: { id: string; nameAr: string; hp: number; summons: number };
	enemyHp: number; enemyFire: number;
}
export interface WeaponDef { id: WeaponId; nameAr: string; price: number; roleAr: string; levels: Record<string, number>[] }
/** What the player owns. `weapons[id]` is the level (1..5); a missing id is not owned. */
export interface Bank { wallet: number; weapons: Partial<Record<WeaponId, number>>; equipped: WeaponId }

// In English the names of stages, bosses and weapons come from names-en.json (numbers are never touched).
type EnNames = { stages: Record<string, { nameAr?: string; topicAr?: string; placeAr?: string; bossNameAr?: string }>; weapons: Record<string, { nameAr?: string; roleAr?: string }> };
const enNames = lang === 'en' ? namesEn as unknown as EnNames : null;
const named = (s: StageDef): StageDef => { const n = enNames?.stages[s.id]; return n ? { ...s, nameAr: n.nameAr ?? s.nameAr, topicAr: n.topicAr ?? s.topicAr, placeAr: n.placeAr ?? s.placeAr, boss: { ...s.boss, nameAr: n.bossNameAr ?? s.boss.nameAr } } : s; };
export const stages = (eco.stages as StageDef[]).map(named);
/** The last challenge: one fight against the code boss after the campaign. It has no questions and is not part of the
 *  approved stage totals; its reward is paid once, on the first victory. */
export const bonusStage = named((eco as unknown as { bonusStage: StageDef }).bonusStage);
export const weapons = (eco.weapons as unknown as WeaponDef[]).map(w => { const n = enNames?.weapons[w.id]; return n ? { ...w, nameAr: n.nameAr ?? w.nameAr, roleAr: n.roleAr ?? w.roleAr } : w; });
export const upgradeCosts = eco.upgradeCosts;
export const maxLevel = eco.maxLevel;
export const enemyReward = eco.enemyReward as Record<EnemyClass, number>;
export const weaponDef = (id: WeaponId) => weapons.find(w => w.id === id)!;

export const newBank = (): Bank => ({ wallet: 0, weapons: { pulse: 1 }, equipped: 'pulse' });

/** Money from destroying every small enemy of a stage. */
export const enemyBudget = (s: StageDef) =>
	s.enemies.normal * enemyReward.normal + s.enemies.armored * enemyReward.armored + s.enemies.rare * enemyReward.rare;

/** The most a stage can pay: all enemies, the boss, three right answers and the bonus. */
export const stageTotal = (s: StageDef) => enemyBudget(s) + s.bossReward + s.questionRewards.reduce((n, x) => n + x, 0) + s.bonus;

/** What the questions of a stage pay for a given set of right answers; the bonus needs all three. */
export function quizPayout(s: StageDef, correct: boolean[]) {
	const packages = s.questionRewards.map((amount, i) => (correct[i] ? amount : 0));
	const bonus = correct.length === s.questionRewards.length && correct.every(Boolean) ? s.bonus : 0;
	return { packages, bonus, total: packages.reduce((n, x) => n + x, 0) + bonus };
}

/** Total cost to take a weapon from level 1 to the top level. */
export const fullUpgradeCost = () => upgradeCosts.reduce((n, x) => n + x, 0);
/** Cost of the next level of a weapon, or null when it is not owned or already at the top. */
export function nextUpgradeCost(bank: Bank, id: WeaponId): number | null {
	const level = bank.weapons[id];
	return level && level < maxLevel ? upgradeCosts[level - 1] : null;
}

export type ShopResult = { ok: true; spent: number } | { ok: false; reason: 'owned' | 'not_owned' | 'max_level' | 'funds'; missing?: number };

export function buyWeapon(bank: Bank, id: WeaponId): ShopResult {
	if (bank.weapons[id]) return { ok: false, reason: 'owned' };
	const price = weaponDef(id).price;
	if (bank.wallet < price) return { ok: false, reason: 'funds', missing: price - bank.wallet };
	bank.wallet -= price;
	bank.weapons[id] = 1;
	return { ok: true, spent: price };
}

/** One level at a time: levels cannot be skipped. */
export function upgradeWeapon(bank: Bank, id: WeaponId): ShopResult {
	const level = bank.weapons[id];
	if (!level) return { ok: false, reason: 'not_owned' };
	if (level >= maxLevel) return { ok: false, reason: 'max_level' };
	const cost = upgradeCosts[level - 1];
	if (bank.wallet < cost) return { ok: false, reason: 'funds', missing: cost - bank.wallet };
	bank.wallet -= cost;
	bank.weapons[id] = level + 1;
	return { ok: true, spent: cost };
}

export function equipWeapon(bank: Bank, id: WeaponId): boolean {
	if (!bank.weapons[id]) return false;
	bank.equipped = id;
	return true;
}

/** One try at a stage. Rewards are keyed by id inside the attempt: "kill:17", "boss", "q1", "q2", "q3", "bonus". */
export class Attempt {
	readonly paid = new Map<string, number>();
	constructor(readonly id: string, readonly stage: number, paid: [string, number][] = []) { for (const [k, v] of paid) this.paid.set(k, v); }
	/** Adds the money once. Returns false (and pays nothing) when this reward was already credited. */
	credit(bank: Bank, rewardId: string, amount: number): boolean {
		if (this.paid.has(rewardId) || !(amount > 0)) return false;
		this.paid.set(rewardId, amount);
		bank.wallet += amount;
		return true;
	}
	has(rewardId: string) { return this.paid.has(rewardId); }
	get total() { let n = 0; for (const v of this.paid.values()) n += v; return n; }
	sum(prefix: string) { let n = 0; for (const [k, v] of this.paid) if (k === prefix || k.startsWith(prefix + ':')) n += v; return n; }
	toJSON(): [string, number][] { return [...this.paid]; }
}
