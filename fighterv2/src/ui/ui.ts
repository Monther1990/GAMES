// The DOM interface over the 3D view: menus, HUD, wallet, the three-question session, reward packages, summary and the
// weapon shop. Arabic, right to left, big touch targets, and every state shown with words and symbols as well as
// colour. Question cards are built to fit a phone without scrolling. All text comes from ui-ar.json and content-ar.json.
import omanMap from '../data/oman-map.json';
import { lang, setLang } from '../game/lang';
import './style.css';
import { num, omr, ui, VariantDef } from '../game/data';
import type { Settings } from '../core/storage';
import type { WeaponId } from '../sim/economy';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Escaped text with the fictional addresses (name.internal) set left to right in their own chip. */
const rich = (s: unknown) => esc(s).replace(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.internal(?:\/[a-z0-9-]+)*/gi, m => `<bdi dir="ltr" class="cs-addr">${m}</bdi>`);
const svg = (d: string, fill = false) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
export const ICON = {
	heart: svg('M12 21C5 15.500 3 12 3 8.500A4.500 4.500 0 0 1 12 6.500 4.500 4.500 0 0 1 21 8.500C21 12 19 15.500 12 21z', true),
	pause: svg('M8 5v14M16 5v14'),
	check: svg('M5 12.500 10 17.500 19 7'),
	cross: svg('M6 6l12 12M18 6 6 18'),
	lock: svg('M6 11h12v9H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3'),
	star: svg('M12 2.500l2.900 6.200 6.600.800-4.900 4.600 1.300 6.700L12 17.500l-5.900 3.300 1.300-6.700-4.900-4.600 6.600-.800z', true),
	up: svg('M12 19V5M5 12l7-7 7 7'),
	play: svg('M7 4.500v15l12-7.500z', true),
	redo: svg('M4 12a8 8 0 1 0 2.300-5.700M4 4v4.500h4.500'),
	phone: svg('M6.600 3h3.200l1.700 4.600-2.200 1.500a12 12 0 0 0 5.600 5.600l1.500-2.200 4.600 1.700v3.200a2.300 2.300 0 0 1-2.500 2.300A16.500 16.500 0 0 1 4.300 5.500 2.300 2.300 0 0 1 6.600 3z', true),
	user: svg('M12 12.200a4.300 4.300 0 1 0 0-8.600 4.300 4.300 0 0 0 0 8.600zM3.800 21a8.200 8.200 0 0 1 16.400 0z', true)
};
export const POWER_ICON: Record<string, string> = {
	rain: svg('M7 14a4 4 0 0 1 .500-8 5.500 5.500 0 0 1 10.500 1.500A3.300 3.300 0 0 1 17 14zM8 17.500l-1.200 3.500M12.500 17.500l-1.200 3.500M17 17.500l-1.200 3.500'),            // a cloud and three drops
	falcon: svg('M12 13C9 9 6 7.500 2.500 7.500c.800 4.600 3.600 7.600 7.500 8.600l2 4.400 2-4.400c3.900-1 6.700-4 7.500-8.600C18 7.500 15 9 12 13zM12 13V8.500M10.800 6 12 8.500 13.200 6'),   // wings spread, diving
	mirror: svg('M20 3.500v17M3 8.500h9.500a4 4 0 0 1 0 8H6M6 16.500l3.200-3.200M6 16.500l3.200 3.200'),                                                              // a shot meets the mirror and turns back
	mute: svg('M4 5h16v10h-9l-4 4v-4H4zM3 21 21 3'),                                                                                                  // a voice, crossed out
	report: svg('M6 21.500V3.500M6 4.500h12l-3 4 3 4H6'),                                                                                                 // a flag raised
	guards: svg('M6 9.500a2.800 2.800 0 1 0 .100 0zM18 9.500a2.800 2.800 0 1 0 .100 0zM12 20V5.500M9.300 8.200 12 5.500l2.700 2.700'),                                 // two lights, one on each side
	armor: svg('M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6zM4.500 10.500h15M6.500 15.500h11'),                                                             // a shield of three plates
	private: svg('M6 11h12v9.500H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3M12 14.500v2.500'),                                                                  // a padlock
	bolt: svg('M13.500 2 5 13.500h6L9.500 22 19 10h-6z'),                                                                                               // lightning
	heart: svg('M12 21C5 15.500 3 12 3 8.500A4.500 4.500 0 0 1 12 6.500 4.500 4.500 0 0 1 21 8.500C21 12 19 15.500 12 21z', true),
	aware: svg('M2.500 19h19M6 19a6 6 0 0 1 12 0M12 5v3.500M4.800 8.300l2.300 2.300M19.200 8.300l-2.300 2.300M2 14.500h2.500M19.500 14.500H22M12 15.800a1.200 1.200 0 1 0 .100 0z')   // the sun of awareness rising, with an eye at its heart
};
/** A small drawing for each kind of malware: used on its card and in the encyclopedia. */
export const MALWARE_ICON: Record<string, string> = {
	rumor: svg('M4 10v4h3l7 4V6l-7 4zM17 9c1.500 1.800 1.500 4.200 0 6M19.500 7c2.500 3 2.500 7 0 10'),
	clickbait: svg('M12 2.500v8M12 13.500v.100M17 13v3.500a5 5 0 0 1-10 0V15l2.500 2'),
	fakepic: svg('M3 5h8l-2 4 3 3-2 3 1 4H3zM14 5h7v14h-6l1-4-2-3 2-3zM6.500 9.500v.100'),
	chain: svg('M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8'),
	fakewall: svg('M4 4h16v16H4zM12 8a2.300 2.300 0 1 0 .100 0zM8 17c.500-2.500 2-3.500 4-3.500s3.500 1 4 3.500'),
	deepfake: svg('M5 5c4.500-2 9.500-2 14 0v6c0 4.500-3 8-7 9-4-1-7-4.500-7-9zM12 3.800V20M7.500 10.500h2M8 15c1 1 2 1.200 3 1M15 9.500v2M17 12.500v2M14.500 15v1.500'),
	trend: svg('M3 17l5-5 4 3 8-9M15 6h5v5M4 21h16'),
	vortex: svg('M12 12.500a1 1 0 0 1 1-1 2.500 2.500 0 0 1 2.500 2.500 4 4 0 0 1-4 4 5.500 5.500 0 0 1-5.500-5.500 7 7 0 0 1 7-7 8.500 8.500 0 0 1 8.500 8.500'),
	mocker: svg('M5 10l2-6 5 4 5-4 2 6M5 10a7 7 0 0 0 14 0M9 13.500v.100M15 13.500v.100M9.500 16.500c1.500 1 3.500 1 5 0M7 4v.100M17 4v.100'),
	noise: svg('M4 9.500v5h3l5 4V5.500l-5 4zM16 8l5 8M21 8l-5 8'),
	fakestar: svg('M12 2.500l2.900 6.200 6.600.800-4.900 4.600 1.300 6.700L12 17.500l-5.900 3.300 1.300-6.700-4.900-4.600 6.600-.800zM8.500 11.500h3M12.500 11.500h3'),
	tracker: svg('M12 21.500c-4.500-5-6.500-8.500-6.500-11.500a6.500 6.500 0 0 1 13 0c0 3-2 6.500-6.500 11.500zM12 7.500a2.500 2.500 0 1 0 .100 0z'),
	quizbot: svg('M5 6h14v13H5zM9.800 10.500a2.300 2.300 0 1 1 3.300 2.100c-.800.400-1.100.900-1.100 1.700M12 16.500v.100M9 6V3.500M15 6V3.500'),
	snapper: svg('M3 8h4l1.500-2.500h7L17 8h4v11H3zM12 10.500a3.200 3.200 0 1 0 .100 0zM18 5l1.500-2M20.500 6.500l2-1'),
	footprint: svg('M8 4c1.800 0 2.500 2 2.500 4S9.500 11.500 8 11.500 5.500 10 5.500 8 6.200 4 8 4zM6.500 13.500h3v2a1.500 1.500 0 0 1-3 0zM16 9c1.800 0 2.500 2 2.500 4s-1 3.500-2.500 3.500-2.500-1.500-2.500-3.500.700-4 2.500-4zM14.500 18.500h3V20a1.500 1.500 0 0 1-3 0z'),
	broker: svg('M3 8h18v11H3zM9 8V5.500h6V8M3 13h18M11 12v2.500h2V12'),
	stranger: svg('M12 2.500c-5 2.500-7.500 6.500-7.500 11.500V21h15v-7c0-5-2.500-9-7.500-11.500zM12 9a4 4.500 0 1 0 .100 0zM10.200 13h.100M13.800 13h.100M10.500 15.500c1 .600 2 .600 3 0'),
	bully: svg('M12 3l2 3 3.500-1-.500 3.500 3.500 1.500-2.500 2.500 2 3-3.500.500V20l-3.500-1.500L11 21l-1.500-3L6 18.500l.500-3.500L3 13.500 5.500 11 4 8l3.500-.500L8 4l2.500 1.500zM9 10l2 1M15 10l-2 1M9.500 15c1.500-1 3.500-1 5 0'),
	impostor: svg('M12 4.500l2 1.500 2.500-.300.900 2.300 2.100 1.400-.700 2.400.700 2.400-2.100 1.400-.900 2.300-2.500-.300-2 1.500-2-1.500-2.500.300-.900-2.300-2.100-1.400.700-2.400-.700-2.400 2.100-1.400.900-2.300 2.500.300zM9 12.500l2 2 4-4.500M7.500 4 6 1.500M16.500 4 18 1.500'),
	lure: svg('M4 10h16v10H4zM3 6.500h18V10H3zM12 6.500V20M12 6.500C10 3 7 3.500 8 5.500s3 1 4 1zM12 6.500c2-3.500 5-3 4-1s-3 1-4 1zM6 10l1.500 2L9 10M15 10l1.500 2 1.500-2'),
	puppeteer: svg('M5 4l14 4M5 8l14-4M7 5.500V14M17 5.500V14M7 14a2 2 0 1 0 .100 0zM17 14a2 2 0 1 0 .100 0zM12 6v5'),
	troll: svg('M12 9a3 5 0 1 0 .100 0zM12 9V6.500M10 5l2 1.500L14 5M9.500 11C6 8 3 9 3.500 11.500S7 14 9.300 13M14.500 11c3.500-3 6.500-2 6 .500S17 14 14.700 13M10 19l-1.500 2M14 19l1.500 2'),
	echo: svg('M8 12c1.500-1.500 6.500-1.500 8 0-1.500 1.500-6.500 1.500-8 0zM5 12c2.500-4.500 11.500-4.500 14 0-2.500 4.500-11.500 4.500-14 0zM2 12c3.500-8 16.500-8 20 0-3.500 8-16.500 8-20 0z'),
	inciter: svg('M3 11v4h3l6 4V7l-6 4zM16 16c-2-2 0-4 1-6 .500 2 3 3 3 6a3 3 0 0 1-6 0c0-1 .500-2 1-2.500'),
	swarm: svg('M12 7l4.300 2.500v5L12 17l-4.300-2.500v-5zM5 5v.100M19 5v.100M5 19v.100M19 19v.100M3 12v.100M21 12v.100'),
	stormseed: svg('M12 2l6 7-6 13-6-13zM6 9h12M13 9l-2.500 4.500h3L11 18'),
	'boss.rumorking': svg('M5 3l2.500 2L10 2.500 12.500 5 15 3v4.500H5zM4 12v4.500h3l7 4V8.500l-7 3.500zM17.500 11.500c1.500 1.800 1.500 4.200 0 6M20 9.500c2.500 3 2.500 7 0 10'),
	'boss.whirl': svg('M12 9.500a2.500 2.500 0 1 0 .100 0zM4 9a9 9 0 0 1 14-3.500M20 15a9 9 0 0 1-14 3.500M18 5.500V2.500M18 5.500h3M6 18.500v3M6 18.500H3'),
	'boss.octodata': svg('M6 11a6 6 0 0 1 12 0v3H6zM9.500 10h.100M14.500 10h.100M6 14c0 3-2 3-2.500 6M9 14c0 3-1 4-1 7M12 14v7M15 14c0 3 1 4 1 7M18 14c0 3 2 3 2.500 6'),
	'boss.maskmaster': svg('M3 4c3-1.200 6-1.200 9 0v5c0 3-2 5.500-4.500 6C5 14.500 3 12 3 9zM6 8h.100M9 8h.100M6 11c1 1 2 1 3 0M12 9.500c3-1.200 6-1.200 9 0V14c0 3-2 5.500-4.500 6-2.500-.500-4.500-3-4.500-6M15 13.500h.100M18 13.500h.100M15 17c1-1 2-1 3 0'),
	'boss.hivequeen': svg('M12 8l5 3v6l-5 3-5-3v-6zM8 5l1.500 1.500L12 3.500l2.500 3L16 5v3H8zM10 13.500h.100M14 13.500h.100M3 9l2 1.500M21 9l-2 1.500M3 19l2-1.500M21 19l-2-1.500'),
	'boss.warstorm': svg('M12 8.500a3.500 3.500 0 1 0 .100 0zM12 3a9 9 0 1 0 .100 0zM4 3l3 3-2 1 3 3M20 3l-3 3 2 1-3 3M12 11v2')
};
/** The Omani Rial symbol, drawn from the owner's file as it is. */
export const omrSvg = `<svg class="cs-omr" viewBox="${omr.viewBox.join(' ')}" aria-hidden="true"><path d="${omr.d}" fill="currentColor"/></svg>`;
/** An amount with the symbol, kept together left to right so it never flips inside Arabic text. */
/** The border of Oman (Natural Earth) and the place of each stage on the map: [longitude, latitude]. */
const OMAN = omanMap as unknown as { bbox: [number, number, number, number]; oman: number[][][] };
const STAGE_AT = [[56.75, 24.35], [58.45, 23.5], [58.75, 21.9], [57.55, 19.75], [54.15, 17.15]];
const BONUS_AT = [55.52, 20.9];                                           // (a little below and left of the middle: clear of the labels of stages 3 and 4)
/** The button that changes the language (it is written in the other language, so whoever needs it can read it). */
const LANG_BUTTON = () => `<button type="button" class="cs-lang" data-a="lang" lang="${lang === 'ar' ? 'en' : 'ar'}">${esc(ui('lang.switch'))}</button>`;
const wireLang = (m: HTMLElement) => (m.querySelector('[data-a=lang]') as HTMLElement | null)?.addEventListener('click', () => setLang(lang === 'ar' ? 'en' : 'ar'));
export const money = (n: number, cls = '') => `<bdi dir="ltr" class="cs-money ${cls}">${omrSvg}<b>${esc(num(n))}</b></bdi>`;

export interface HudState { hp: number; maxHp: number; label: string; progress: number; boss: { name: string; hp: number; guarded: boolean } | null }
export interface ModalButton { label: string; kind?: 'primary' | 'ghost'; onClick: () => void }
export type PackState = 'waiting' | 'won' | 'lost';
export interface QuizView {
	index: number; rewards: number[]; packs: PackState[]; variant: VariantDef; label: string;
	/** Set on the supporter's device: the card is only watched, and this line says so. */
	watch?: string;
	options: { actionId: string; labelAr: string }[]; onConfirm: (actionId: string) => void;
}
export interface QuizResult { correct: boolean; picked: string; safeId: string; amount: number; praise: string; explain: string; rule: string; mustFix: boolean; last: boolean; onNext: () => void; onFix?: () => void; watch?: string }
export interface WeaponCard { id: WeaponId; name: string; role: string; price: number; level: number; owned: boolean; equipped: boolean }
export interface ShopDetail {
	card: WeaponCard; stats: { key: string; now: number; next: number | null; max: number }[]; upgradeCost: number | null; missing: number;
	levelNote: string; nextNote: string;
}
export interface ShopHandlers { onSelect: (id: WeaponId) => void; onBuy: () => void; onUpgrade: () => void; onEquip: () => void; onClose: () => void }

export class Ui {
	readonly root: HTMLElement;
	onClick: () => void = () => {};
	/** The two buttons of a fight: use the emergency power, and upgrade the equipped weapon. */
	onPower: (index: number) => void = () => {}; onUpgrade: () => void = () => {}; onArms: () => void = () => {};
	private powerEl!: HTMLElement; private upgradeEl!: HTMLElement; private armsEl!: HTMLElement;
	private hud: HTMLElement; private layer: HTMLElement; private toast: HTMLElement; private promptEl: HTMLElement; private count: HTMLElement; private fx: HTMLElement;
	private walletEl: HTMLElement; private walletNum: HTMLElement; private gain: HTMLElement;
	private shown = 0; private real = 0; private gainSum = 0; private gainTimer = 0; private toastTimer = 0;
	private keys: ((a: string) => void) | null = null;

	constructor(host: HTMLElement, private base: string, private onPause: () => void) {
		this.root = document.createElement('div');
		this.root.className = 'cs-ui';
		this.root.dir = lang === 'ar' ? 'rtl' : 'ltr'; this.root.lang = lang;
		this.root.innerHTML = `<div class="cs-vig" aria-hidden="true"></div><div class="cs-fx" aria-hidden="true"></div><div class="cs-low" aria-hidden="true"></div><div class="cs-hud hidden"></div>
			<div class="cs-wallet hidden" role="status" aria-label="${esc(ui('wallet.label'))}"><span class="cs-wallet-coin">${omrSvg}</span><b></b><em class="cs-gain hidden"></em></div>
			<div class="cs-prompt hidden" role="status"></div><div class="cs-toast hidden" role="status"></div><div class="cs-count hidden" aria-live="assertive"></div>
			<div class="cs-powers"></div><button type="button" class="cs-upgrade hidden"></button><button type="button" class="cs-arms hidden"></button><div class="cs-layer"></div>`;
		host.appendChild(this.root);
		const q = (c: string) => this.root.querySelector(c) as HTMLElement;
		this.fx = q('.cs-fx'); this.hud = q('.cs-hud'); this.promptEl = q('.cs-prompt'); this.toast = q('.cs-toast'); this.count = q('.cs-count'); this.layer = q('.cs-layer');
		this.walletEl = q('.cs-wallet'); this.walletNum = q('.cs-wallet > b'); this.gain = q('.cs-gain');
		this.powerEl = q('.cs-powers'); this.upgradeEl = q('.cs-upgrade');
		this.press(this.upgradeEl, () => this.onUpgrade());
		this.armsEl = q('.cs-arms'); this.press(this.armsEl, () => this.onArms());
		this.armsEl.innerHTML = `${svg('M4 8h13l-3.500-3.500M20 16H7l3.500 3.500')}<b>${esc(ui('arms.label'))}</b>`; this.armsEl.setAttribute('aria-label', ui('arms.open'));
		this.root.addEventListener('click', e => { if ((e.target as HTMLElement).closest('button')) this.onClick(); });
		this.hud.innerHTML = `<button type="button" class="cs-icon-btn" data-a="pause" aria-label="${esc(ui('hud.pause'))}">${ICON.pause}</button>
			<div class="cs-hp" data-k="hp"></div><div class="cs-ally hidden" data-k="ally"></div><div class="cs-stage"><b data-k="label" role="status"></b><i><u data-k="bar"></u></i></div>
			<div class="cs-boss hidden" data-k="boss"><b data-k="bossName"></b><i><u data-k="bossBar"></u></i></div>`;
		this.press(this.hud.querySelector('[data-a=pause]') as HTMLElement, () => this.onPause());
	}
	/** A button of the fight. It answers the moment any finger lands on it, also while another finger is steering:
	 *  phones send a "click" only for a lone tap, so a click alone would ignore the second finger. The click that a lone
	 *  tap sends afterwards is skipped, and a click from the keyboard still works. */
	private press(el: HTMLElement, fn: () => void) {
		let at = -1e9;
		el.addEventListener('pointerdown', e => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			e.preventDefault(); e.stopPropagation();
			at = performance.now();
			this.onClick(); fn();
		});
		el.addEventListener('click', e => { if (performance.now() - at < 800) { e.stopPropagation(); return; } fn(); });
	}

	// ------------------------------------------------------------------ wallet
	/** The true balance. The number on screen catches up as coins land (or at once when none are flying). */
	setWallet(real: number, snap: boolean) {
		this.real = real;
		if (snap || this.shown > real) { this.shown = real; this.paintWallet(); }
	}
	coinArrived(value: number, big: boolean) {
		this.shown = Math.min(this.real, this.shown + value);
		this.paintWallet();
		this.walletEl.classList.remove('pulse', 'pulse-big'); void this.walletEl.offsetWidth; this.walletEl.classList.add(big ? 'pulse-big' : 'pulse');
		this.gainSum += value;
		this.gain.textContent = '+' + num(this.gainSum); this.gain.classList.remove('hidden');
		clearTimeout(this.gainTimer);
		this.gainTimer = window.setTimeout(() => { this.gain.classList.add('hidden'); this.gainSum = 0; }, 900);
	}
	private paintWallet() { this.walletNum.textContent = num(this.shown); }
	showWallet(v: boolean) { this.walletEl.classList.toggle('hidden', !v); }
	/** Where coins fly to: the middle of the wallet's coin, wherever the layout has put it. */
	walletPoint() {
		const r = (this.walletEl.querySelector('.cs-wallet-coin') as HTMLElement).getBoundingClientRect(), o = this.root.getBoundingClientRect();
		return { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top };
	}
	/** The middle of an element in the same coordinates (packages, buttons), or null. */
	pointOf(selector: string) {
		const el = this.root.querySelector(selector);
		if (!el) return null;
		const r = el.getBoundingClientRect(), o = this.root.getBoundingClientRect();
		return { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top };
	}

	// ------------------------------------------------------------------ basics
	private show(html: string, cls = ''): HTMLElement {
		this.keys = null;
		this.layer.classList.remove('clear');
		this.layer.innerHTML = `<div class="cs-modal ${cls}">${html}</div>`;
		const m = this.layer.firstElementChild as HTMLElement;
		(m.querySelector('[data-focus]') as HTMLElement | null)?.focus({ preventScroll: true });
		return m;
	}
	closeLayer() { this.keys = null; this.layer.innerHTML = ''; this.layer.classList.remove('clear'); }
	get layerOpen() { return this.layer.childElementCount > 0; }
	key(action: string): boolean { if (!this.keys) return false; this.keys(action); return true; }

	loading(p: number) {
		if (!this.layer.querySelector('.cs-loading')) this.show(`<div class="cs-logo">${esc(ui('app.title'))}</div><div class="cs-bar"><i></i></div><p>${esc(ui('loading'))}</p>`, 'cs-card cs-loading');
		(this.layer.querySelector('.cs-bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
	}
	modal(o: { cls?: string; icon?: string; title: string; lines: string[]; html?: string; cyber?: boolean; buttons: ModalButton[] }) {
		const m = this.show(`${o.cyber ? `<img class="cs-cyber" src="${this.base}assets/ui/Cyber.png" alt="">` : ''}
			<h2>${o.icon ? `<span class="cs-ico">${o.icon}</span>` : ''}${esc(o.title)}</h2>
			${o.lines.filter(Boolean).map(l => `<p>${rich(l)}</p>`).join('')}${o.html ?? ''}
			<div class="cs-actions">${o.buttons.map((b, i) => `<button type="button" class="cs-btn ${b.kind === 'ghost' ? 'ghost' : 'primary'}" data-i="${i}" ${i === 0 ? 'data-focus' : ''}>${esc(b.label)}</button>`).join('')}</div>`,
			`cs-card ${o.cls ?? ''}`);
		m.querySelectorAll<HTMLElement>('[data-i]').forEach(b => b.addEventListener('click', () => o.buttons[+b.dataset.i!].onClick()));
		// a long card on a short phone: tightened in steps until its last button is in view without scrolling
		const fit = () => { for (const step of ['t1', 't2', 't3']) { if (m.scrollHeight <= m.clientHeight + 1) break; m.classList.add(step); } };
		fit();
		m.querySelector('img')?.addEventListener('load', fit);                  // its picture changes how the lines wrap: fitted again once it is there
	}
	banner(kind: 'good' | 'bad' | 'info' | 'alarm', text: string, seconds = 2) {
		this.toast.className = `cs-toast ${kind}`;
		this.toast.innerHTML = `<b>${esc(text)}</b>`;
		clearTimeout(this.toastTimer);
		this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), seconds * 1000);
	}
	/** What a boss says as it arrives: its name and its line, in a dark red bubble near the top, gone after a moment. */
	say(name: string, line: string, seconds = 3.6) {
		if (!this.sayEl) { this.sayEl = document.createElement('p'); this.sayEl.className = 'cs-say hidden'; this.sayEl.setAttribute('role', 'status'); this.root.appendChild(this.sayEl); }
		const el = this.sayEl;
		el.innerHTML = `<small>${esc(name)}</small>${esc(line)}`;
		el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
		clearTimeout(this.sayTimer);
		this.sayTimer = window.setTimeout(() => el.classList.add('hidden'), seconds * 1000);
	}
	private sayEl: HTMLElement | null = null; private sayTimer = 0;
	prompt(text: string | null) { this.promptEl.classList.toggle('hidden', !text); if (text) this.promptEl.innerHTML = `<b>${esc(text)}</b>`; }
	countdown(text: string | null) {
		this.count.classList.toggle('hidden', text === null);
		if (text !== null) { this.count.textContent = text; this.count.classList.remove('pop'); void this.count.offsetWidth; this.count.classList.add('pop'); }
	}
	/** The warning of low health: the edge of the screen beats like a heart (1: two hearts left, 2: the last one). */
	setLow(level: 0 | 1 | 2) { const el = this.root.querySelector('.cs-low') as HTMLElement, cls = 'cs-low' + (level ? ' l' + level : ''); if (el.className !== cls) el.className = cls; }
	/** The whole screen turns to light and fades: Total Awareness has gone off. */
	nova(reduce: boolean) { this.fx.className = 'cs-fx ' + (reduce ? 'nova-soft' : 'nova'); window.setTimeout(() => { this.fx.className = 'cs-fx'; }, 1200); }
	/** A short red edge when the player is hit (a calm tint when motion is reduced). */
	hurt(reduce: boolean) { this.fx.className = 'cs-fx ' + (reduce ? 'tint' : 'hit'); window.setTimeout(() => { this.fx.className = 'cs-fx'; }, 450); }

	// ------------------------------------------------------------------ HUD
	showHud(v: boolean) { this.hud.classList.toggle('hidden', !v); }
	setHud(h: HudState) {
		const k = (n: string) => this.hud.querySelector(`[data-k=${n}]`) as HTMLElement;
		const set = (el: HTMLElement, html: string) => { if (el.dataset.v !== html) { el.dataset.v = html; el.innerHTML = html; } };
		set(k('hp'), Array.from({ length: h.maxHp }, (_, i) => `<span class="${i < h.hp ? 'on' : ''}">${ICON.heart}</span>`).join(''));
		k('hp').setAttribute('aria-label', ui('hud.health', { n: num(h.hp), max: num(h.maxHp) }));
		k('hp').classList.toggle('low', h.hp <= 2);
		set(k('label'), esc(h.label));
		k('bar').style.width = `${Math.round(h.progress * 100)}%`;
		// a boss takes the place of the stage bar (which would only repeat the stage's name), so nothing hangs over the boss itself
		k('boss').classList.toggle('hidden', !h.boss); this.hud.classList.toggle('has-boss', !!h.boss);
		if (h.boss) { set(k('bossName'), (h.boss.guarded ? `<em role="img" aria-label="${esc(ui('hud.guarded'))}">${ICON.lock}</em>` : '') + esc(h.boss.name)); k('bossBar').style.width = `${Math.max(0, h.boss.hp * 100)}%`; k('boss').classList.toggle('guarded', h.boss.guarded); }
	}
	private hudEdge = 0; private hudEdgeAt = -1e9;
	/** Where the HUD ends, in CSS pixels from the top (measured at most twice a second): what is written over the fight
	 *  stays below it. */
	hudBottom(now = performance.now()) {
		if (now - this.hudEdgeAt > 500) { this.hudEdgeAt = now; this.hudEdge = this.hud.classList.contains('hidden') ? 0 : this.hud.getBoundingClientRect().bottom; }
		return this.hudEdge;
	}
	/** A new wave: the stage bar itself lights up for a moment (it already says which wave), instead of a notice over the field. */
	waveCue() { const el = this.hud.querySelector('.cs-stage') as HTMLElement; el.classList.remove('cue'); void el.offsetWidth; el.classList.add('cue'); }

	// ------------------------------------------------------------------ profile, menu, stages, settings
	profile(o: { name: string; avatar: 'male' | 'female'; valid: (s: string) => boolean; onDone: (name: string, avatar: 'male' | 'female') => void }) {
		let avatar = o.avatar;
		const m = this.show(`<div class="cs-logo">${esc(ui('app.title'))}</div>
			<label class="cs-field"><span>${esc(ui('menu.name'))}</span><input class="cs-input" type="text" maxlength="24" autocomplete="off" enterkeyhint="done" value="${esc(o.name)}" placeholder="${esc(ui('menu.namePlaceholder'))}"></label>
			<div class="cs-avatars" role="radiogroup" aria-label="${esc(ui('menu.avatar'))}">
				${(['male', 'female'] as const).map(v => `<button type="button" class="cs-avatar" role="radio" data-v="${v}"><img src="${this.base}assets/ui/Portrait_${v === 'male' ? 'Male' : 'Female'}.png" alt=""><span>${esc(ui('menu.' + v))}</span></button>`).join('')}
			</div>
			<p class="cs-error hidden" role="alert">${esc(ui('menu.nameError'))}</p>
			<button type="button" class="cs-btn primary big" data-a="go">${esc(ui('menu.continue'))}</button>${LANG_BUTTON()}`, 'cs-card cs-menu');
		wireLang(m);
		const input = m.querySelector('.cs-input') as HTMLInputElement, error = m.querySelector('.cs-error') as HTMLElement;
		const pick = () => m.querySelectorAll<HTMLElement>('.cs-avatar').forEach(b => { const on = b.dataset.v === avatar; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
		pick();
		m.querySelectorAll<HTMLElement>('.cs-avatar').forEach(b => b.addEventListener('click', () => { avatar = b.dataset.v as 'male' | 'female'; pick(); }));
		input.addEventListener('input', () => error.classList.add('hidden'));
		(m.querySelector('[data-a=go]') as HTMLElement).addEventListener('click', () => {
			const name = input.value.trim() || ui('menu.defaultName');
			if (!o.valid(name)) { error.classList.remove('hidden'); input.focus(); return; }
			o.onDone(name, avatar);
		});
	}

	menu(o: { hasProgress: boolean; next: string; onPlay: () => void; onContinue: () => void; onWeapons: () => void; onSettings: () => void; onCodex: () => void; onCoop: () => void; friend: string; bonus?: { label: string; note: string; onClick: () => void } }) {
		const m = this.show(`<div class="cs-logo"><small>${esc(ui('menu.kicker'))}</small>${esc(ui('app.title'))}</div>
			<p class="cs-tagline">${esc(ui('menu.tagline'))}</p>
			${o.hasProgress ? `<button type="button" class="cs-btn primary big" data-a="continue" data-focus>${esc(ui('menu.resume'))}<small>${esc(o.next)}</small></button>` : ''}
			<button type="button" class="cs-btn ${o.hasProgress ? 'ghost' : 'primary'} big" data-a="play" ${o.hasProgress ? '' : 'data-focus'}>${esc(ui(o.hasProgress ? 'menu.stages' : 'menu.play'))}</button>
			${o.friend ? `<button type="button" class="cs-friend" data-a="coop">${ICON.heart}${esc(o.friend)}</button>` : `<button type="button" class="cs-btn coop big" data-a="coop">${esc(ui('coop.menu'))}</button>`}
			${o.bonus ? `<button type="button" class="cs-btn bonus big" data-a="bonus">${esc(o.bonus.label)}<small>${esc(o.bonus.note)}</small></button>` : ''}
			<div class="cs-actions two three"><button type="button" class="cs-btn ghost" data-a="weapons">${esc(ui('menu.weapons'))}</button>
				<button type="button" class="cs-btn ghost" data-a="codex">${esc(ui('codex.menu'))}</button>
				<button type="button" class="cs-btn ghost" data-a="settings">${esc(ui('menu.settings'))}</button></div>
			<p class="cs-note">${esc(ui('menu.note'))}</p>${LANG_BUTTON()}`, 'cs-card cs-menu');
		wireLang(m);
		const on = (a: string, fn: () => void) => (m.querySelector(`[data-a=${a}]`) as HTMLElement | null)?.addEventListener('click', fn);
		on('play', o.onPlay); on('continue', o.onContinue); on('weapons', o.onWeapons); on('settings', o.onSettings); on('codex', o.onCodex); on('coop', o.onCoop); if (o.bonus) on('bonus', o.bonus.onClick);
	}

	/** The stages on a real map of Oman: each is a light on the part of the country it is fought over. Tap one to play. */
	stages(o: { list: { name: string; topic: string; place?: string; open: boolean; cleared: boolean; total: number }[]; onPick: (i: number) => void; onBack: () => void; bonus?: { label: string; onClick: () => void } }) {
		const [bw, bs, be, bn] = OMAN.bbox, PW = 1880, PH = 2280;
		const xy = (lon: number, lat: number) => [(lon - bw) / (be - bw), (bn - lat) / (bn - bs)];
		const border = OMAN.oman.map(ring => 'M' + ring.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return (x * PW).toFixed(0) + ' ' + (y * PH).toFixed(0); }).join('L') + 'Z').join('');
		const pin = (at: number[], cls: string, attrs: string, inner: string) => { const [x, y] = xy(at[0], at[1]); return `<button type="button" class="cs-pin ${cls}${x < 0.42 ? ' flip' : ''}" style="left:${(x * 100).toFixed(1)}%;top:${(y * 100).toFixed(1)}%" ${attrs}>${inner}</button>`; };
		const m = this.show(`<h2>${esc(ui('stages.title'))}</h2><p class="cs-note">${esc(ui('stages.mapHint'))}</p>
			<div class="cs-map" dir="ltr"><img src="${this.base}assets/earth/oman-region.jpg" alt="" draggable="false">
				<svg viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" aria-hidden="true"><path class="glow" d="${border}"/><path class="line" d="${border}"/></svg>
				${o.list.map((s, i) => pin(STAGE_AT[i] ?? STAGE_AT[0], (s.open ? 'open' : 'locked') + (s.cleared ? ' cleared' : ''), `data-i="${i}" ${s.open ? '' : 'disabled'} aria-label="${esc(s.name)}"`,
					`<i>${s.cleared ? ICON.check : s.open ? esc(num(i + 1)) : ICON.lock}</i><span dir="auto"><b>${esc(s.name)}</b><small>${esc(s.place ?? s.topic)}</small></span>`)).join('')}
				${o.bonus ? pin(BONUS_AT, 'bonus', 'data-a="bonus"', `<i>${ICON.star}</i><span dir="auto"><b>${esc(o.bonus.label)}</b></span>`) : ''}
			</div>
			<div class="cs-actions"><button type="button" class="cs-btn ghost" data-a="back">${esc(ui('back'))}</button></div>`, 'cs-card cs-wide cs-mapcard');
		m.querySelectorAll<HTMLElement>('[data-i]').forEach(b => b.addEventListener('click', () => o.onPick(+b.dataset.i!)));
		(m.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', o.onBack);
		if (o.bonus) (m.querySelector('[data-a=bonus]') as HTMLElement).addEventListener('click', o.bonus.onClick);
	}

	settings(s: Settings, onChange: (s: Settings) => void, onClose: () => void) {
		const keys: (keyof Settings)[] = ['music', 'sfx', 'reduceMotion', 'noShake'];
		const m = this.show(`<h2>${esc(ui('settings.title'))}</h2>
			<div class="cs-switches">${keys.map(k => `<button type="button" class="cs-switch" role="switch" data-k="${k}"><span><b>${esc(ui('settings.' + k))}</b><small>${esc(ui('settings.' + k + '.help'))}</small></span><i><em></em></i><u></u></button>`).join('')}
				<div class="cs-switch choice"><span><b>${esc(ui('settings.quality'))}</b><small>${esc(ui('settings.quality.help'))}</small></span>
					<span class="cs-seg">${(['auto', 'low', 'high'] as const).map(q => `<button type="button" data-q="${q}">${esc(ui('settings.quality.' + q))}</button>`).join('')}</span></div></div>
			<div class="cs-actions"><button type="button" class="cs-btn primary" data-a="close" data-focus>${esc(ui('settings.done'))}</button></div>`, 'cs-card cs-settings');
		const paint = () => {
			m.querySelectorAll<HTMLElement>('.cs-switch[data-k]').forEach(b => { const on = !!s[b.dataset.k as keyof Settings]; b.setAttribute('aria-checked', String(on)); (b.querySelector('u') as HTMLElement).textContent = ui(on ? 'settings.on' : 'settings.off'); });
			m.querySelectorAll<HTMLElement>('[data-q]').forEach(b => { const on = b.dataset.q === s.quality; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
		};
		paint();
		m.querySelectorAll<HTMLElement>('.cs-switch[data-k]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k as 'music'; s[k] = !s[k]; paint(); onChange(s); }));
		m.querySelectorAll<HTMLElement>('[data-q]').forEach(b => b.addEventListener('click', () => { s.quality = b.dataset.q as Settings['quality']; paint(); onChange(s); }));
		(m.querySelector('[data-a=close]') as HTMLElement).addEventListener('click', onClose);
	}

	// ------------------------------------------------------------------ playing with a supporter
	/** The friend's hearts beside one's own (null: single play). */
	setAlly(a: { name: string; hp: number; maxHp: number; down: boolean; busy: boolean } | null) {
		const el = this.hud.querySelector('[data-k=ally]') as HTMLElement, key = a ? `${a.name}|${a.hp}|${a.maxHp}|${a.down}|${a.busy}` : '';
		if (el.dataset.v === key) return;
		el.dataset.v = key;
		el.className = 'cs-ally' + (a ? (a.down ? ' down' : a.busy ? ' busy' : '') : ' hidden');
		if (a) el.innerHTML = `<b>${esc(a.name)}</b>${Array.from({ length: a.maxHp }, (_, i) => `<span class="${i < a.hp ? 'on' : ''}">${ICON.heart}</span>`).join('')}`;
	}
	/** The first screen of playing together: open a room, or enter a friend's code. */
	coopStart(o: { code: string; error: string; onCreate: () => void; onJoin: (code: string) => void; onBack: () => void }) {
		const m = this.show(`<h2>${esc(ui('coop.title'))}</h2><p>${esc(ui('coop.intro'))}</p>
			<button type="button" class="cs-btn primary big" data-a="create" data-focus>${esc(ui('coop.create'))}</button>
			<label class="cs-field cs-code"><span>${esc(ui('coop.codeLabel'))}</span><span class="cs-code-row"><input class="cs-input" type="text" inputmode="latin" autocapitalize="characters" autocomplete="off" maxlength="5" dir="ltr" value="${esc(o.code)}" placeholder="${esc(ui('coop.codePlaceholder'))}"><button type="button" class="cs-btn primary" data-a="join">${esc(ui('coop.join'))}</button></span></label>
			<p class="cs-error ${o.error ? '' : 'hidden'}" role="alert">${esc(o.error)}</p>
			<div class="cs-actions"><button type="button" class="cs-btn ghost" data-a="back">${esc(ui('back'))}</button></div>`, 'cs-card cs-coop');
		const input = m.querySelector('.cs-input') as HTMLInputElement, error = m.querySelector('.cs-error') as HTMLElement;
		const lock = () => m.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
		input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); error.classList.add('hidden'); });
		const join = () => { const code = input.value.trim().toUpperCase(); if (!/^[A-Z2-9]{5}$/.test(code)) { error.textContent = ui('coop.err.code'); error.classList.remove('hidden'); input.focus(); return; } lock(); o.onJoin(code); };
		(m.querySelector('[data-a=join]') as HTMLElement).addEventListener('click', join);
		input.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
		(m.querySelector('[data-a=create]') as HTMLElement).addEventListener('click', () => { lock(); o.onCreate(); });
		(m.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', o.onBack);
	}
	/** The main player's room: the code to give the friend, and what the friend is doing. */
	coopRoom(o: { code: string; status: string; ready: boolean; startLabel?: string; onShare: () => void; onStart: () => void; onPick?: () => void; onCancel: () => void }) {
		const m = this.show(`<h2>${esc(ui('coop.roomTitle'))}</h2><p class="cs-note">${esc(ui('coop.roomCode'))}</p>
			<div class="cs-room-code" dir="ltr">${[...o.code].map(c => `<b>${esc(c)}</b>`).join('')}</div>
			<p class="cs-room-status ${o.ready ? 'ready' : ''}" role="status">${esc(o.status)}</p>
			${o.ready ? `<button type="button" class="cs-btn primary big" data-a="start" data-focus>${esc(o.startLabel ?? ui('coop.start'))}</button>${o.onPick ? `<button type="button" class="cs-btn ghost" data-a="pick">${esc(ui('coop.pick'))}</button>` : ''}` : `<button type="button" class="cs-btn primary big" data-a="share" data-focus>${esc(ui('coop.share'))}</button>`}
			<div class="cs-actions"><button type="button" class="cs-btn ghost" data-a="cancel">${esc(ui('coop.cancel'))}</button></div>`, 'cs-card cs-coop');
		const on = (a: string, fn: () => void) => (m.querySelector(`[data-a=${a}]`) as HTMLElement | null)?.addEventListener('click', fn);
		on('share', o.onShare); on('start', o.onStart); on('cancel', o.onCancel); if (o.onPick) on('pick', o.onPick);
	}
	/** After a boss falls: what each fighter did in the fight, counted up. With two fighters the harder hitter gets a star. */
	report(o: { title: string; sub: string; players: { name: string; me: boolean; damage: number; kills: number; best: boolean }[]; onNext: () => void }) {
		const two = o.players.length > 1;
		const m = this.show(`<h2>${esc(o.title)}</h2><p class="cs-note">${esc(o.sub)}</p>
			<div class="cs-report ${two ? 'two' : ''}">${o.players.map((p, i) => `<section class="cs-rep ${p.me ? 'me' : ''} ${p.best ? 'best' : ''}" style="--i:${i}">
				${two ? `<h3>${p.best ? ICON.star : ''}<span>${esc(p.name)}</span></h3>` : ''}
				<div class="cs-rep-row"><div class="cs-rep-tile dmg"><b data-count="${p.damage}">${esc(num(0))}</b><span>${esc(ui('report.damage'))}</span></div>
				<div class="cs-rep-tile kills"><b data-count="${p.kills}">${esc(num(0))}</b><span>${esc(ui('report.kills'))}</span></div></div></section>`).join('')}</div>
			<div class="cs-actions"><button type="button" class="cs-btn primary big" data-a="next" data-focus>${esc(ui('report.next'))}</button></div>`, 'cs-card cs-reportcard');
		(m.querySelector('[data-a=next]') as HTMLElement).addEventListener('click', o.onNext);
		// the numbers count up; the last value is also set by a plain timer, for when the page is not being drawn
		const cells = [...m.querySelectorAll<HTMLElement>('[data-count]')], start = performance.now();
		const paint = (k: number) => { const e = 1 - (1 - k) ** 3; for (const c of cells) c.textContent = num(Math.round(+c.dataset.count! * e)); };
		const step = () => { const k = Math.min(1, (performance.now() - start - 250) / 900); if (k > 0) paint(k); if (k < 1 && m.isConnected) requestAnimationFrame(step); };
		requestAnimationFrame(step);
		window.setTimeout(() => { if (m.isConnected) paint(1); }, 1300);
	}
	/** What the supporter sees while the main player is not fighting: a small card that says what is happening. */
	coopWait(o: { title: string; text: string; onLeave: () => void; onWeapons?: () => void }) {
		const m = this.show(`<h2>${esc(o.title)}</h2><p class="cs-room-status" role="status">${esc(o.text)}</p>
			<div class="cs-actions two">${o.onWeapons ? `<button type="button" class="cs-btn primary" data-a="weapons">${esc(ui('menu.weapons'))}</button>` : ''}<button type="button" class="cs-btn ghost" data-a="leave">${esc(ui('coop.leave'))}</button></div>`, 'cs-card cs-coop cs-waitcard');
		(m.querySelector('[data-a=leave]') as HTMLElement).addEventListener('click', o.onLeave);
		if (o.onWeapons) (m.querySelector('[data-a=weapons]') as HTMLElement).addEventListener('click', o.onWeapons);
	}

	// ------------------------------------------------------------------ what the enemies are
	/** The card of an enemy met for the first time. It sits at the bottom of the screen, and a small name tag stands
	 *  beside the enemy itself (`at`, in pixels), so neither covers what is being pointed at. */
	malware(o: { key: string; boss: boolean; name: string; what: string; guard: string; color: string; at: { x: number; y: number } | null; onOk: () => void }) {
		this.keys = null;
		const half = 76, wide = this.root.clientWidth || 360;                     // the name tag stays whole at the edges of the screen
		if (o.at) o.at.x = Math.max(half, Math.min(wide - half, o.at.x));
		const tag = o.at ? `<div class="cs-tag" style="left:${Math.round(o.at.x)}px;top:${Math.round(o.at.y)}px;--c:${esc(o.color)}"><b>${esc(o.name)}</b></div>` : '';
		this.layer.innerHTML = `${tag}<div class="cs-modal cs-card cs-malware" style="--c:${esc(o.color)}">
			<div class="cs-mal-head"><span class="cs-mal-ico">${MALWARE_ICON[o.key] ?? ICON.star}</span><span><small>${esc(ui(o.boss ? 'codex.boss' : 'codex.new'))}</small><b>${esc(o.name)}</b></span></div>
			<p>${esc(o.what)}</p><p class="cs-mal-guard"><b>${esc(ui('codex.guard'))}</b> ${esc(o.guard)}</p>
			<button type="button" class="cs-btn primary" data-a="ok" data-focus>${esc(ui('codex.ok'))}</button></div>`;
		this.layer.classList.add('clear');
		const ok = this.layer.querySelector('[data-a=ok]') as HTMLButtonElement;
		const done = () => { if (ok.disabled) return; ok.disabled = true; this.layer.classList.remove('clear'); o.onOk(); };
		ok.addEventListener('click', done);
		ok.focus({ preventScroll: true });
		this.keys = a => { if (a === 'confirm') done(); };
	}
	/** The encyclopedia: every kind met so far with what it is and how to guard against it; the rest are still hidden. */
	codex(o: { items: { key: string; name: string; what: string; guard: string; color: string; met: boolean }[]; onBack: () => void }) {
		const met = o.items.filter(i => i.met).length;
		const m = this.show(`<h2>${esc(ui('codex.title'))}</h2><p class="cs-note">${esc(ui('codex.count', { n: num(met), total: num(o.items.length) }))}</p>
			<div class="cs-codex">${o.items.map(i => `<div class="cs-codex-item ${i.met ? '' : 'unknown'}" style="--c:${esc(i.met ? i.color : '#5b648a')}"><span class="cs-mal-ico">${i.met ? MALWARE_ICON[i.key] ?? ICON.star : ICON.lock}</span>
				<span><b>${esc(i.met ? i.name : ui('codex.unknown'))}</b>${i.met ? `<small>${esc(i.what)}</small><small class="cs-mal-guard"><b>${esc(ui('codex.guard'))}</b> ${esc(i.guard)}</small>` : `<small>${esc(ui('codex.unknown'))}</small>`}</span></div>`).join('')}</div>
			<div class="cs-actions"><button type="button" class="cs-btn primary" data-a="back" data-focus>${esc(ui('back'))}</button></div>`, 'cs-card cs-wide cs-codex-card');
		(m.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', o.onBack);
	}

	// ------------------------------------------------------------------ fight buttons and the Cyber box
	/** The emergency powers in store, one button each: the first won is at the bottom and each new one pops in above
	 *  it. Any of them can be pressed. `urgent` makes them call for attention when health is low. */
	setPowers(list: { id: string; name: string }[], urgent: boolean) {
		const key = list.map(p => p.id).join(',') + '|' + urgent, was = (this.powerEl.dataset.v ?? '|').split('|')[0].split(',').filter(Boolean);
		if (this.powerEl.dataset.v === key) return;
		this.powerEl.dataset.v = key;
		const grew = list.length > was.length;                                   // one was just won: only that one makes an entrance
		this.powerEl.innerHTML = list.map((p, i) => `<button type="button" class="cs-power ${esc(p.id)} ${urgent ? 'urgent' : ''} ${grew && i === list.length - 1 ? 'new' : ''}" data-i="${i}" aria-label="${esc(ui('power.use', { name: p.name }))}">${POWER_ICON[p.id] ?? ICON.star}<b>${esc(p.name)}</b></button>`).join('');
		this.powerEl.querySelectorAll<HTMLElement>('.cs-power').forEach(b => this.press(b, () => this.onPower(+b.dataset.i!)));
	}
	/** The weapons button of a fight: change the weapon or buy one. */
	setArms(show: boolean) { const cls = 'cs-arms' + (show ? '' : ' hidden'); if (this.armsEl.className !== cls) this.armsEl.className = cls; }
	/** The quick upgrade of the equipped weapon (null hides it: no fight, or the weapon is at its highest level). */
	setUpgrade(u: { cost: number; next: number; can: boolean } | null) {
		const key = u ? `${u.cost}|${u.next}|${u.can}` : '';
		if (this.upgradeEl.dataset.v === key) return;
		this.upgradeEl.dataset.v = key;
		if (!u) { this.upgradeEl.className = 'cs-upgrade hidden'; return; }
		this.upgradeEl.className = `cs-upgrade ${u.can ? 'can' : 'off'}`;
		this.upgradeEl.innerHTML = `${ICON.up}${money(u.cost)}`;
		this.upgradeEl.setAttribute('aria-label', ui('upgrade.label', { n: num(u.next) }));
	}
	/** The quick question of a Cyber box: one tap answers, and a bar shows the time left. Practice only. The rare black
	 *  box asks two, one after the other (`step` says which). */
	box(o: { title: string; step: string; rare: boolean; heart?: boolean; prompt: string; options: string[]; seconds: number; onPick: (i: number) => void }) {
		const m = this.show(`<header class="cs-box-head"><span class="cs-box-ico">${ICON.star}</span><b>${esc(o.title)}${o.step ? `<small>${esc(o.step)}</small>` : ''}</b><em data-k="left">${esc(num(o.seconds))}</em></header>
			<div class="cs-box-timer"><i data-k="timer"></i></div>
			<p class="cs-ask">${esc(o.prompt)}</p>
			<div class="cs-options">${o.options.map((t, i) => `<button type="button" class="cs-option" data-i="${i}"><i>${esc(ui('quiz.letter' + i))}</i><span>${esc(t)}</span></button>`).join('')}</div>
			<div class="cs-result hidden" data-k="result"></div>
			<p class="cs-note" data-k="note">${esc(ui('box.practice'))}</p>
			<footer class="cs-box-foot hidden"><button type="button" class="cs-btn primary big" data-a="next">${esc(ui('box.continue'))}</button></footer>`, `cs-card cs-box ${o.rare ? 'rare' : ''} ${o.heart ? 'heart' : ''}`);
		m.querySelectorAll<HTMLButtonElement>('.cs-option').forEach(b => b.addEventListener('click', () => { if (!m.classList.contains('answered')) o.onPick(+b.dataset.i!); }));
		this.keys = a => { if (a === 'confirm') (m.querySelector('.cs-box-foot:not(.hidden) [data-a=next]') as HTMLElement | null)?.click(); };
	}
	/** A box question that arrives as a phone call. First the phone rings and the player slides to answer; then the
	 *  caller speaks while the words light up (`callTalk`); then the three actions and the clock appear (`callAsk`).
	 *  It is a `.cs-box`, so the timer and the result are the ones of every box question. Nothing scrolls. */
	call(o: { step: string; rare: boolean; heart?: boolean; from: string; said: string; prompt: string; options: string[]; seconds: number; onAnswer: () => void; onPick: (i: number) => void }) {
		const m = this.show(`<div class="cs-phone"><span class="cs-phone-ava">${ICON.user}</span>
				<span class="cs-phone-who"><small><span data-k="state">${esc(ui('call.incoming'))}</span>${o.step ? ` · ${esc(o.step)}` : ''}</small><b>${esc(o.from)}</b></span>
				<span class="cs-phone-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span><em data-k="left">${esc(num(o.seconds))}</em></div>
			<div class="cs-slide" data-k="slide" role="button" tabindex="0" aria-label="${esc(ui('call.slide'))}" data-focus><i>${ICON.phone}</i><span>${esc(ui('call.slide'))}</span></div>
			<p class="cs-said" data-k="said">${o.said.split(/\s+/).filter(Boolean).map(w => `<span>${esc(w)}</span>`).join(' ')}</p>
			<div class="cs-box-timer"><i data-k="timer"></i></div>
			<p class="cs-ask">${esc(o.prompt)}</p>
			<div class="cs-options">${o.options.map((t, i) => `<button type="button" class="cs-option" data-i="${i}"><i>${esc(ui('quiz.letter' + i))}</i><span>${esc(t)}</span></button>`).join('')}</div>
			<div class="cs-result hidden" data-k="result"></div>
			<p class="cs-note" data-k="note">${esc(ui('box.practice'))}</p>
			<footer class="cs-box-foot hidden"><button type="button" class="cs-btn primary big" data-a="next">${esc(ui('box.continue'))}</button></footer>`, `cs-card cs-box call ring ${o.rare ? 'rare' : ''} ${o.heart ? 'heart' : ''}`);
		m.querySelectorAll<HTMLButtonElement>('.cs-option').forEach(b => b.addEventListener('click', () => { if (m.classList.contains('ask') && !m.classList.contains('answered')) o.onPick(+b.dataset.i!); }));
		// the slide: the knob follows the finger along the track, in the direction of reading; most of the way answers
		const track = m.querySelector('[data-k=slide]') as HTMLElement, knob = track.querySelector('i') as HTMLElement, rtl = this.root.dir === 'rtl';
		let x = 0, max = 0, from = 0, drag = false, done = false;
		const set = (v: number) => { x = Math.max(0, Math.min(max, v)); knob.style.transform = `translateX(${rtl ? -x : x}px)`; track.style.setProperty('--k', String(max ? x / max : 0)); };
		const answer = () => { if (done) return; done = true; drag = false; track.classList.remove('drag'); o.onAnswer(); };
		track.addEventListener('pointerdown', e => {
			if (done) return;
			drag = true; max = track.clientWidth - knob.offsetWidth - 10; from = rtl ? e.clientX + x : e.clientX - x;
			try { track.setPointerCapture(e.pointerId); } catch { /* an old browser: the drag still works inside the track */ }
			track.classList.add('drag'); track.classList.remove('nudge');
		});
		track.addEventListener('pointermove', e => { if (!drag) return; set(rtl ? from - e.clientX : e.clientX - from); if (x >= max * 0.9) answer(); });
		const release = () => {
			if (!drag) return;
			drag = false; track.classList.remove('drag');
			if (x >= max * 0.6) { set(max); answer(); } else { set(0); void track.offsetWidth; track.classList.add('nudge'); }   // a tap or a short pull: the knob shows the way
		};
		track.addEventListener('pointerup', release); track.addEventListener('pointercancel', release);
		track.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) { e.preventDefault(); answer(); } });
		this.keys = a => { if (a === 'confirm') { if (m.classList.contains('ring')) answer(); else (m.querySelector('.cs-box-foot:not(.hidden) [data-a=next]') as HTMLElement | null)?.click(); } };
	}
	/** The call was answered: the caller speaks for `seconds`, and each word lights up as it is said. */
	callTalk(seconds: number) {
		const m = this.layer.querySelector('.cs-box.call') as HTMLElement | null;
		if (!m) return;
		m.classList.remove('ring'); m.classList.add('talk');
		const state = m.querySelector('[data-k=state]') as HTMLElement;
		state.textContent = ui('call.live');
		const words = [...m.querySelectorAll<HTMLElement>('.cs-said span')];
		words.forEach((w, i) => { w.style.animationDelay = `${(i / words.length * seconds * 0.94).toFixed(2)}s`; });
	}
	/** The caller has finished: what does the player do? The actions and the clock appear under the caller's words. */
	callAsk() {
		const m = this.layer.querySelector('.cs-box.call') as HTMLElement | null;
		if (!m) return;
		m.classList.remove('ring', 'talk'); m.classList.add('ask');
		(m.querySelector('[data-k=state]') as HTMLElement).textContent = ui('call.wait');
		(m.querySelector('.cs-option') as HTMLElement | null)?.focus({ preventScroll: true });
	}
	boxTimer(k: number, left: number) {
		const m = this.layer.querySelector('.cs-box') as HTMLElement | null;
		if (!m) return;
		(m.querySelector('[data-k=timer]') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, k))})`;
		const el = m.querySelector('[data-k=left]') as HTMLElement, t = num(Math.max(0, Math.ceil(left)));
		if (el.textContent !== t) el.textContent = t;
		m.classList.toggle('hurry', left <= 5);
	}
	/** After a tap or when the time runs out: the right answer, one line of why, and what was won. `note` replaces the
	 *  line shown when nothing was won (a question still to come, or one right answer out of two); `nextLabel` names
	 *  the button when another question follows. */
	boxResult(r: { picked: number | null; right: number; why: string; power: { id: string; name: string; desc: string } | null; note?: string; nextLabel?: string; onNext: () => void }) {
		const m = this.layer.querySelector('.cs-box') as HTMLElement | null;
		if (!m) return;
		m.classList.add('answered'); m.classList.remove('hurry');
		m.querySelectorAll<HTMLButtonElement>('.cs-option').forEach((b, i) => { b.disabled = true; b.classList.add(i === r.right ? 'right' : i === r.picked ? 'wrong' : 'dim'); });
		const good = r.picked === r.right, box = m.querySelector('[data-k=result]') as HTMLElement;
		box.className = `cs-result ${good ? 'good' : 'bad'}`;
		box.innerHTML = `<b>${good ? ICON.check : ICON.cross}${esc(ui(good ? 'box.right' : r.picked === null ? 'box.timeout' : 'box.wrong'))}</b><p>${rich(r.why)}</p>`
			+ (r.note && !r.power ? `<p class="cs-fixnote">${esc(r.note)}</p>` : '')
			+ (r.power ? `<div class="cs-won ${esc(r.power.id)}">${POWER_ICON[r.power.id] ?? ICON.star}<span><small>${esc(r.note || ui('box.won'))}</small><b>${esc(r.power.name)}</b><small>${esc(r.power.desc)}</small></span></div>` : r.note ? '' : `<p class="cs-fixnote">${esc(ui('box.none'))}</p>`);
		(m.querySelector('[data-k=note]') as HTMLElement).classList.add('hidden');
		const foot = m.querySelector('.cs-box-foot') as HTMLElement, next = foot.querySelector('[data-a=next]') as HTMLButtonElement;
		if (r.nextLabel) next.textContent = r.nextLabel;
		foot.classList.remove('hidden');
		next.addEventListener('click', () => { if (!next.disabled) { next.disabled = true; r.onNext(); } });
		next.focus({ preventScroll: true });
		if (m.classList.contains('call') && m.scrollHeight > m.clientHeight + 1) m.classList.add('tight');   // nothing may scroll
	}

	// ------------------------------------------------------------------ the three questions
	private packs(rewards: number[], packs: PackState[], current: number) {
		// steps run right to left: the first question is on the right
		return `<div class="cs-packs">${rewards.map((r, i) => `<div class="cs-pack p${i} ${packs[i]} ${i === current ? 'current' : ''}" data-pack="${i}">
			<i class="cs-pack-box"><u></u></i><span>${packs[i] === 'won' ? ICON.check : packs[i] === 'lost' ? ICON.cross : esc(num(i + 1))}</span>
			<em>${packs[i] === 'lost' ? esc(ui('quiz.notEarned')) : money(r)}</em></div>`).join('')}</div>`;
	}

	/** One question: a short situation, three large answers, and "confirm". Nothing scrolls. */
	quiz(v: QuizView) {
		let selected: string | null = null;
		const msg = v.variant.message;
		const m = this.show(`
			<header class="cs-quiz-head"><span class="cs-step">${esc(ui('quiz.step', { n: num(v.index + 1) }))}<b>${esc(v.label)}</b></span>${this.packs(v.rewards, v.packs, v.index)}</header>
			<div class="cs-quiz-body">
				<p class="cs-scene"><b>${esc(ui('quiz.scene'))}</b>${rich(v.variant.sceneAr)}</p>
				${msg ? `<div class="cs-msg"><b>${rich(msg.fromAr)}</b><p>${rich(msg.textAr)}</p></div>` : ''}
				<p class="cs-ask">${esc(v.variant.promptAr)}</p>
				<div class="cs-options">${v.options.map((o, i) => `<button type="button" class="cs-option" data-action="${esc(o.actionId)}" ${i === 0 ? 'data-focus' : ''}><i>${esc(ui('quiz.letter' + i))}</i><span>${esc(o.labelAr)}</span></button>`).join('')}</div>
				<div class="cs-result hidden" data-k="result"></div>
			</div>
			<footer class="cs-quiz-foot">${v.watch ? `<p class="cs-watch">${esc(v.watch)}</p>` : `<button type="button" class="cs-btn primary big" data-a="confirm" disabled>${esc(ui('quiz.confirm'))}</button>`}</footer>`, 'cs-quiz');
		if (v.watch) { m.querySelectorAll<HTMLButtonElement>('.cs-option').forEach(b => { b.disabled = true; }); this.fit(m); return; }
		const confirmBtn = m.querySelector('[data-a=confirm]') as HTMLButtonElement;
		const options = [...m.querySelectorAll<HTMLButtonElement>('.cs-option')];
		const select = (id: string) => { if (m.classList.contains('answered')) return; selected = id; options.forEach(b => b.classList.toggle('on', b.dataset.action === id)); confirmBtn.disabled = false; };
		options.forEach(b => b.addEventListener('click', () => select(b.dataset.action!)));
		const confirm = () => { if (!selected || confirmBtn.disabled || m.classList.contains('answered')) return; confirmBtn.disabled = true; v.onConfirm(selected); };
		confirmBtn.addEventListener('click', confirm);
		this.keys = a => {
			if (a === 'confirm') { const next = m.querySelector('[data-a=next]:not([disabled])') as HTMLElement | null; if (next) next.click(); else confirm(); return; }
			if (a !== 'up' && a !== 'down') return;
			const at = options.findIndex(b => b.dataset.action === selected);
			select(options[Math.max(0, Math.min(options.length - 1, at + (a === 'down' ? 1 : -1)))].dataset.action!);
		};
		this.fit(m);
	}

	/** After "confirm": mark the answers, explain, and offer "next". The answer cannot be changed any more. */
	quizResult(r: QuizResult) {
		const m = this.layer.querySelector('.cs-quiz') as HTMLElement | null;
		if (!m) return;
		m.classList.add('answered');
		const options = [...m.querySelectorAll<HTMLButtonElement>('.cs-option')];
		for (const b of options) {
			const id = b.dataset.action!;
			b.classList.remove('on');
			if (id === r.safeId) b.classList.add('right'); else if (id === r.picked) b.classList.add('wrong'); else b.classList.add('dim');
			b.disabled = !(r.mustFix && id === r.safeId);
			const mark = id === r.safeId ? ICON.check : id === r.picked ? ICON.cross : '';
			if (mark) b.insertAdjacentHTML('beforeend', `<em>${mark}${esc(ui(id === r.safeId ? 'quiz.rightMark' : 'quiz.yourPick'))}</em>`);
		}
		const box = m.querySelector('[data-k=result]') as HTMLElement;
		box.className = `cs-result ${r.correct ? 'good' : 'bad'}`;
		box.innerHTML = `<b>${r.correct ? ICON.check : ICON.cross}${esc(r.correct ? r.praise : ui('quiz.wrongTitle'))}${r.correct ? money(r.amount, 'plus') : ''}</b>
			<p>${rich(r.explain)}</p>${r.mustFix ? `<p class="cs-fixnote">${esc(ui('quiz.fix'))}</p>` : ''}`;
		(m.querySelector('.cs-ask') as HTMLElement).classList.add('hidden');
		const foot = m.querySelector('.cs-quiz-foot') as HTMLElement;
		if (r.watch) { foot.innerHTML = `<p class="cs-watch">${esc(r.watch)}</p>`; this.fit(m); return; }
		foot.innerHTML = `<button type="button" class="cs-btn primary big" data-a="next" ${r.mustFix ? 'disabled' : 'data-focus'}>${esc(ui(r.last ? 'quiz.finish' : 'quiz.next'))}</button>`;
		const next = foot.querySelector('[data-a=next]') as HTMLButtonElement;
		next.addEventListener('click', () => { if (!next.disabled) { next.disabled = true; r.onNext(); } });
		if (r.mustFix) {
			const right = options.find(b => b.dataset.action === r.safeId)!;
			right.classList.add('tap');
			right.addEventListener('click', () => { r.onFix?.(); right.classList.remove('tap'); right.disabled = true; m.querySelector('.cs-fixnote')?.remove(); next.disabled = false; next.focus({ preventScroll: true }); this.fit(m); }, { once: true });
		} else next.focus({ preventScroll: true });
		this.fit(m);
	}
	/** Marks a package as opened or missed in the header of the open question. */
	setPack(i: number, state: PackState) {
		const p = this.layer.querySelector(`[data-pack="${i}"]`) as HTMLElement | null;
		if (!p) return;
		p.classList.remove('waiting', 'won', 'lost', 'opening'); p.classList.add(state);
		if (state === 'won') { p.classList.add('opening'); (p.querySelector('span') as HTMLElement).innerHTML = ICON.check; }
		if (state === 'lost') { (p.querySelector('span') as HTMLElement).innerHTML = ICON.cross; (p.querySelector('em') as HTMLElement).textContent = ui('quiz.notEarned'); }
	}
	/** Shrinks the type a step or two when a card would need scrolling (question cards must fit a phone). */
	private fit(m: HTMLElement) {
		const body = m.querySelector('.cs-quiz-body') as HTMLElement;
		m.classList.remove('fit1', 'fit2', 'fit3', 'fit4');
		for (const cls of ['fit1', 'fit2', 'fit3', 'fit4']) { if (body.scrollHeight <= body.clientHeight + 1) break; m.classList.add(cls); }
	}

	/** The larger package after three right answers. */
	bonus(amount: number, onDone: () => void) {
		const m = this.show(`<div class="cs-bonus-lines"><i></i><i></i><i></i></div><div class="cs-bonus-pack" data-bonus><u></u></div>
			<h2>BONUS<small>${esc(ui('bonus.title'))}</small></h2><p class="cs-bonus-amount">${money(amount, 'plus')}</p>
			<div class="cs-actions"><button type="button" class="cs-btn primary big" data-a="done" data-focus>${esc(ui('bonus.next'))}</button></div>`, 'cs-card cs-bonus');
		const b = m.querySelector('[data-a=done]') as HTMLButtonElement;
		b.addEventListener('click', () => { if (!b.disabled) { b.disabled = true; onDone(); } });
	}

	summary(o: { title: string; correct: number; rows: { label: string; amount: number | null; note?: string }[]; total: number; wallet: number; note: string; buttons: ModalButton[] }) {
		const m = this.show(`<h2>${esc(o.title)}</h2>
			<p class="cs-sum-score">${esc(ui('summary.correct', { n: num(o.correct) }))}</p>
			<ul class="cs-sum">${o.rows.map(r => `<li class="${r.amount ? '' : 'none'}"><span>${esc(r.label)}</span>${r.amount ? money(r.amount) : `<em>${esc(r.note ?? ui('summary.none'))}</em>`}</li>`).join('')}
				<li class="total"><span>${esc(ui('summary.total'))}</span>${money(o.total)}</li><li class="wallet"><span>${esc(ui('summary.wallet'))}</span>${money(o.wallet)}</li></ul>
			${o.note ? `<p class="cs-note">${esc(o.note)}</p>` : ''}
			<div class="cs-actions">${o.buttons.map((b, i) => `<button type="button" class="cs-btn ${b.kind === 'ghost' ? 'ghost' : 'primary'}" data-i="${i}" ${i === 0 ? 'data-focus' : ''}>${esc(b.label)}</button>`).join('')}</div>`, 'cs-card cs-summary');
		m.querySelectorAll<HTMLElement>('[data-i]').forEach(b => b.addEventListener('click', () => o.buttons[+b.dataset.i!].onClick()));
	}

	review(o: { items: { label: string; scene: string; message?: string; picked: string; right: string; correct: boolean; explain: string }[]; onBack: () => void }) {
		const m = this.show(`<h2>${esc(ui('review.title'))}</h2><p class="cs-note">${esc(ui('review.note'))}</p>
			<div class="cs-review">${o.items.map(it => `<section class="${it.correct ? 'good' : 'bad'}"><h3>${it.correct ? ICON.check : ICON.cross}${esc(it.label)}</h3>
				<p>${rich(it.scene)}</p>${it.message ? `<p class="cs-quote">${rich(it.message)}</p>` : ''}
				${it.correct ? '' : `<p><b>${esc(ui('review.yours'))}</b> ${esc(it.picked)}</p>`}<p><b>${esc(ui('review.right'))}</b> ${esc(it.right)}</p><p class="cs-why">${rich(it.explain)}</p></section>`).join('')}</div>
			<div class="cs-actions"><button type="button" class="cs-btn primary" data-a="back" data-focus>${esc(ui('back'))}</button></div>`, 'cs-card cs-wide');
		(m.querySelector('[data-a=back]') as HTMLElement).addEventListener('click', o.onBack);
	}

	// ------------------------------------------------------------------ weapon shop
	shop(cards: WeaponCard[], detail: ShopDetail, h: ShopHandlers, celebrate: '' | 'bought' | 'upgraded' | 'equipped') {
		const c = detail.card;
		const bar = (s: ShopDetail['stats'][number]) => `<li><span>${esc(ui('shop.stat.' + s.key))}</span><i><u style="width:${Math.round(s.now / s.max * 100)}%"></u>${s.next !== null ? `<s style="width:${Math.round(s.next / s.max * 100)}%"></s>` : ''}</i>
			<b>${esc(num(Math.round(s.now * 10) / 10))}${s.next !== null ? `<em>${ICON.up}${esc(num(Math.round(s.next * 10) / 10))}</em>` : ''}</b></li>`;
		let action = '';
		if (!c.owned) action = `<button type="button" class="cs-btn primary big" data-a="buy" ${detail.missing > 0 ? 'disabled' : ''}>${esc(ui('shop.buy'))} ${money(c.price)}</button>`;
		else if (detail.upgradeCost !== null) action = `<button type="button" class="cs-btn primary big" data-a="upgrade" ${detail.missing > 0 ? 'disabled' : ''}>${esc(ui('shop.upgrade', { n: num(c.level + 1) }))} ${money(detail.upgradeCost)}</button>`;
		else action = `<p class="cs-max">${ICON.star}${esc(ui('shop.max'))}</p>`;
		const m = this.show(`
			<div class="cs-shop-list">${cards.map(w => `<button type="button" class="cs-weapon ${w.id === c.id ? 'on' : ''} ${w.owned ? 'owned' : ''}" data-w="${w.id}">
				<i class="cs-wicon ${w.id}"></i><b>${esc(w.name)}</b>
				<small>${w.equipped ? `${ICON.check}${esc(ui('shop.equipped'))}` : w.owned ? esc(ui('shop.level', { n: num(w.level) })) : money(w.price)}</small></button>`).join('')}</div>
			<div class="cs-shop-detail ${celebrate}">
				<button type="button" class="cs-btn ghost cs-shop-close" data-a="close">${ICON.cross}${esc(ui('shop.close'))}</button>
				<h2><i class="cs-wicon ${c.id}"></i>${esc(c.name)}<small>${c.owned ? esc(ui('shop.level', { n: num(c.level) })) + (c.equipped ? ' · ' + esc(ui('shop.equipped')) : ' · ' + esc(ui('shop.owned'))) : esc(ui('shop.notOwned'))}</small></h2>
				<p class="cs-role">${esc(c.role)}. ${esc(detail.levelNote)}</p>
				<ul class="cs-stats">${detail.stats.map(bar).join('')}</ul>
				${detail.nextNote ? `<p class="cs-nextnote">${ICON.up}${esc(detail.nextNote)}</p>` : ''}
				${detail.missing > 0 ? `<p class="cs-missing">${esc(ui('shop.missing'))} ${money(detail.missing)}</p>` : ''}
				<div class="cs-actions">${action}${c.owned && !c.equipped ? `<button type="button" class="cs-btn ghost" data-a="equip">${esc(ui('shop.equip'))}</button>` : ''}</div>
			</div>`, 'cs-shop');
		m.querySelectorAll<HTMLElement>('[data-w]').forEach(b => b.addEventListener('click', () => h.onSelect(b.dataset.w as WeaponId)));
		const on = (a: string, fn: () => void) => { const b = m.querySelector(`[data-a=${a}]`) as HTMLButtonElement | null; b?.addEventListener('click', () => { if (!b.disabled) { b.disabled = true; fn(); } }); };
		on('buy', h.onBuy); on('upgrade', h.onUpgrade); on('equip', h.onEquip); on('close', h.onClose);
		// the shop must fit a phone as the question cards do: it tightens in steps until nothing needs scrolling
		m.classList.remove('s1', 's2', 's3', 's4');
		for (const step of ['s1', 's2', 's3', 's4']) { if (m.scrollHeight <= m.clientHeight + 1) break; m.classList.add(step); }
	}

	dispose() { clearTimeout(this.toastTimer); clearTimeout(this.gainTimer); this.root.remove(); }
}
