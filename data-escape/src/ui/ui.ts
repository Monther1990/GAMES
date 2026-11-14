// The DOM interface over the 3D view: menu, settings, HUD, decision cards, feedback, pause and results. Arabic, right to
// left, big touch targets. Every state is shown with words and symbols as well as colour. All text comes from ui-ar.json
// and content-ar.json.
import './style.css';
import { CardDef, num, ui } from '../game/data';
import { Decision, orderAction } from '../run/decision';
import type { Settings } from '../run/storage';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Escaped text with the fictional addresses (name.internal) set left to right in their own chip, so they read correctly inside Arabic. */
const rich = (s: unknown) => esc(s).replace(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.internal(?:\/[a-z0-9-]+)*/gi, m => `<bdi dir="ltr" class="de-addr">${m}</bdi>`);
const svg = (d: string, fill = false) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
const ICON = {
	bolt: svg('M13 2 4 14h7l-1 8 9-12h-7z', true),
	shield: svg('M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z', true),
	data: svg('M12 2 21 12 12 22 3 12z', true),
	pause: svg('M8 5v14M16 5v14'),
	hint: svg('M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.800 1-2.5A6 6 0 0 0 12 3z'),
	lens: svg('M10.500 17a6.500 6.500 0 1 0 0-13 6.500 6.500 0 0 0 0 13zM15.500 15.500 21 21'),
	check: svg('M5 12.500 10 17.500 19 7'),
	warn: svg('M12 3 2 20h20zM12 10v4M12 17.500v.010'),
	redo: svg('M4 12a8 8 0 1 0 2.300-5.700M4 4v4.500h4.500'),
	star: svg('M12 2.500l2.900 6.200 6.600.800-4.900 4.600 1.300 6.700L12 17.500l-5.900 3.300 1.300-6.700-4.900-4.600 6.600-.800z', true),
	vault: svg('M4 4h16v16H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 6v3M12 15v3'),
	close: svg('M6 6l12 12M18 6 6 18')
};
const badge = (lane: number) => `<i class="de-badge l${lane}" aria-hidden="true"></i>`;

export interface HudState { remaining: number; progress: number; energy: number; energyMax: number; protection: number; protectionMax: number;
	bits: number; shields: number; hints: number; lenses: number; stage: string }
export interface GateHandlers { onSelect: (lane: number | null) => void; onConfirm: (actionId: string) => void; onHint: () => string | null; onLens: () => string | null }
export interface GateView { decision: Decision; index: number; total: number; hints: number; lenses: number; secondChance: boolean; noTimer: boolean }
export interface ModalButton { label: string; kind?: 'primary' | 'ghost'; onClick: () => void }
export interface ResultsView {
	earned: number; max: number; passed: boolean; runScore: number; stars: number; starReasons: { text: string; on: boolean }[];
	mastered: string[]; review: string[]; badges: { title: string; isNew: boolean }[]; note: string;
	onReview: (() => void) | null; onReplay: () => void; onMenu: () => void;
}

export class Ui {
	readonly root: HTMLElement;
	onClick: () => void = () => {};
	private hud: HTMLElement; private layer: HTMLElement; private toast: HTMLElement; private promptEl: HTMLElement; private count: HTMLElement; private fx: HTMLElement;
	private toastTimer = 0; private pressureTimer = 0;
	private gateKeys: ((a: string) => void) | null = null;

	constructor(host: HTMLElement, private base: string, private onPause: () => void) {
		this.root = document.createElement('div');
		this.root.className = 'de-ui';
		this.root.dir = 'rtl'; this.root.lang = 'ar';
		this.root.innerHTML = `<div class="de-fx" aria-hidden="true"></div><div class="de-hud hidden"></div><div class="de-prompt hidden" role="status"></div>
			<div class="de-toast hidden" role="status"></div><div class="de-count hidden" aria-live="assertive"></div><div class="de-layer"></div>`;
		host.appendChild(this.root);
		const q = (c: string) => this.root.querySelector(c) as HTMLElement;
		this.fx = q('.de-fx'); this.hud = q('.de-hud'); this.promptEl = q('.de-prompt'); this.toast = q('.de-toast'); this.count = q('.de-count'); this.layer = q('.de-layer');
		this.root.addEventListener('click', e => { if ((e.target as HTMLElement).closest('button')) this.onClick(); });
		this.buildHud();
	}

	// ------------------------------------------------------------------ basics
	private show(html: string, cls = ''): HTMLElement {
		this.clearPressure();
		this.gateKeys = null;
		this.layer.innerHTML = `<div class="de-modal ${cls}">${html}</div>`;
		const m = this.layer.firstElementChild as HTMLElement;
		(m.querySelector('[data-focus]') as HTMLElement | null)?.focus({ preventScroll: true });
		return m;
	}
	closeLayer() { this.clearPressure(); this.gateKeys = null; this.layer.innerHTML = ''; }
	get layerOpen() { return this.layer.childElementCount > 0; }
	/** Arrow keys and Enter while a decision card is open. Returns true when the key was used. */
	key(action: string): boolean { if (!this.gateKeys) return false; this.gateKeys(action); return true; }

	loading(p: number) {
		if (!this.layer.querySelector('.de-loading')) this.show(`<div class="de-logo">${esc(ui('app.title'))}</div><div class="de-bar"><i></i></div><p>${esc(ui('loading'))}</p>`, 'de-loading');
		(this.layer.querySelector('.de-bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
	}

	modal(o: { cls?: string; icon?: string; title: string; lines: string[]; cyber?: boolean; buttons: ModalButton[] }) {
		const m = this.show(`${o.cyber ? `<img class="de-cyber" src="${this.base}assets/ui/Cyber.png" alt="">` : ''}
			<h2>${o.icon ? `<span class="de-ico">${o.icon}</span>` : ''}${esc(o.title)}</h2>
			${o.lines.filter(Boolean).map(l => `<p>${rich(l)}</p>`).join('')}
			<div class="de-actions">${o.buttons.map((b, i) => `<button type="button" class="de-btn ${b.kind === 'ghost' ? 'ghost' : 'primary'}" data-i="${i}" ${i === 0 ? 'data-focus' : ''}>${esc(b.label)}</button>`).join('')}</div>`,
			`de-card ${o.cls ?? ''}`);
		m.querySelectorAll<HTMLElement>('[data-i]').forEach(b => b.addEventListener('click', () => o.buttons[+b.dataset.i!].onClick()));
	}

	banner(kind: 'good' | 'bad' | 'info', text: string, seconds = 2.2) {
		const icon = kind === 'good' ? ICON.check : kind === 'bad' ? ICON.warn : ICON.data;
		this.toast.className = `de-toast ${kind}`;
		this.toast.innerHTML = `<span class="de-ico">${icon}</span><b>${esc(text)}</b>`;
		clearTimeout(this.toastTimer);
		this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), seconds * 1000);
	}
	prompt(text: string | null, hintIcon = '') {
		this.promptEl.classList.toggle('hidden', !text);
		if (text) this.promptEl.innerHTML = `${hintIcon ? `<span class="de-arrow">${hintIcon}</span>` : ''}<b>${esc(text)}</b>`;
	}
	countdown(text: string | null) {
		this.count.classList.toggle('hidden', text === null);
		if (text !== null) { this.count.textContent = text; this.count.classList.remove('pop'); void this.count.offsetWidth; this.count.classList.add('pop'); }
	}
	/** Short screen disturbance when the package's protection is damaged (a calm tint when motion is reduced). */
	glitch(reduce: boolean) {
		this.fx.className = 'de-fx ' + (reduce ? 'tint' : 'glitch');
		window.setTimeout(() => { this.fx.className = 'de-fx'; }, 650);
	}

	// ------------------------------------------------------------------ HUD
	private buildHud() {
		this.hud.innerHTML = `
			<div class="de-top">
				<button type="button" class="de-icon-btn" data-a="pause" aria-label="${esc(ui('hud.pause'))}">${ICON.pause}</button>
				<div class="de-track"><div class="de-track-bar"><i></i><span class="de-dot"></span></div><span class="de-vault">${ICON.vault}</span><em data-k="remaining"></em></div>
			</div>
			<div class="de-stats">
				<div class="de-stat energy"><span class="de-ico">${ICON.bolt}</span><b>${esc(ui('hud.energy'))}</b><span class="de-pips" data-k="energy"></span></div>
				<div class="de-stat protection"><span class="de-ico">${ICON.shield}</span><b>${esc(ui('hud.protection'))}</b><span class="de-pips" data-k="protection"></span></div>
				<div class="de-stat bits"><span class="de-ico">${ICON.data}</span><b data-k="bits"></b></div>
				<div class="de-tools" data-k="tools"></div>
			</div>`;
		(this.hud.querySelector('[data-a=pause]') as HTMLElement).addEventListener('click', () => this.onPause());
	}
	showHud(v: boolean) { this.hud.classList.toggle('hidden', !v); }
	setHud(h: HudState) {
		const k = (n: string) => this.hud.querySelector(`[data-k=${n}]`) as HTMLElement;
		const pips = (n: number, max: number) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
		const set = (el: HTMLElement, html: string) => { if (el.dataset.v !== html) { el.dataset.v = html; el.innerHTML = html; } };
		set(k('remaining'), esc(ui('hud.remaining', { m: num(Math.max(0, Math.round(h.remaining / 10) * 10)) })));
		const pct = `${Math.round(h.progress * 1000) / 10}%`;
		(this.hud.querySelector('.de-track-bar i') as HTMLElement).style.width = pct;
		(this.hud.querySelector('.de-dot') as HTMLElement).style.insetInlineStart = pct;
		set(k('energy'), pips(h.energy, h.energyMax));
		set(k('protection'), pips(h.protection, h.protectionMax));
		k('energy').setAttribute('aria-label', `${h.energy}/${h.energyMax}`);
		k('protection').setAttribute('aria-label', `${h.protection}/${h.protectionMax}`);
		set(k('bits'), esc(num(h.bits)));
		const chip = (n: number, icon: string, label: string) => n > 0 ? `<span class="de-chip" title="${esc(label)}">${icon}<b>${esc(num(n))}</b></span>` : '';
		set(k('tools'), chip(h.shields, ICON.shield, ui('tool.shield')) + chip(h.hints, ICON.hint, ui('tool.hint')) + chip(h.lenses, ICON.lens, ui('tool.lens')));
	}

	// ------------------------------------------------------------------ menu and settings
	menu(o: { name: string; avatar: 'male' | 'female'; best: string | null; badges: string[]; valid: (s: string) => boolean;
		onPlay: (name: string, avatar: 'male' | 'female') => void; onTraining: (name: string, avatar: 'male' | 'female') => void; onSettings: () => void }) {
		let avatar = o.avatar;
		const m = this.show(`
			<div class="de-logo"><small>${esc(ui('menu.kicker'))}</small>${esc(ui('app.title'))}</div>
			<p class="de-tag">${esc(ui('menu.tagline'))}</p>
			<label class="de-field"><span>${esc(ui('menu.name'))}</span><input class="de-input" type="text" maxlength="24" autocomplete="off" enterkeyhint="done" value="${esc(o.name)}" placeholder="${esc(ui('menu.namePlaceholder'))}"></label>
			<div class="de-avatars" role="radiogroup" aria-label="${esc(ui('menu.avatar'))}">
				${(['male', 'female'] as const).map(v => `<button type="button" class="de-avatar" role="radio" data-v="${v}"><img src="${this.base}assets/ui/Portrait_${v === 'male' ? 'Male' : 'Female'}.png" alt=""><span>${esc(ui('menu.' + v))}</span></button>`).join('')}
			</div>
			<p class="de-error hidden" role="alert">${esc(ui('menu.nameError'))}</p>
			<button type="button" class="de-btn primary big" data-a="play">${esc(ui('menu.play'))}</button>
			<div class="de-actions two"><button type="button" class="de-btn ghost" data-a="training">${esc(ui('menu.training'))}</button>
				<button type="button" class="de-btn ghost" data-a="settings">${esc(ui('menu.settings'))}</button></div>
			${o.best ? `<p class="de-best">${ICON.star}<span>${esc(o.best)}</span></p>` : ''}
			${o.badges.length ? `<div class="de-badges">${o.badges.map(b => `<span>${ICON.star}${esc(b)}</span>`).join('')}</div>` : ''}
			<p class="de-note">${esc(ui('menu.note'))}</p>`, 'de-card de-menu');
		const input = m.querySelector('.de-input') as HTMLInputElement, error = m.querySelector('.de-error') as HTMLElement;
		const pick = () => m.querySelectorAll<HTMLElement>('.de-avatar').forEach(b => { const on = b.dataset.v === avatar; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
		pick();
		m.querySelectorAll<HTMLElement>('.de-avatar').forEach(b => b.addEventListener('click', () => { avatar = b.dataset.v as 'male' | 'female'; pick(); }));
		const go = (fn: (n: string, a: 'male' | 'female') => void) => {
			const name = input.value.trim() || ui('menu.defaultName');
			if (!o.valid(name)) { error.classList.remove('hidden'); input.focus(); return; }
			fn(name, avatar);
		};
		input.addEventListener('input', () => error.classList.add('hidden'));
		(m.querySelector('[data-a=play]') as HTMLElement).addEventListener('click', () => go(o.onPlay));
		(m.querySelector('[data-a=training]') as HTMLElement).addEventListener('click', () => go(o.onTraining));
		(m.querySelector('[data-a=settings]') as HTMLElement).addEventListener('click', o.onSettings);
	}

	settings(s: Settings, onChange: (s: Settings) => void, onClose: () => void) {
		const keys: (keyof Settings)[] = ['music', 'sfx', 'reduceMotion', 'noShake', 'noTimer', 'touchButtons'];
		const m = this.show(`<h2>${esc(ui('settings.title'))}</h2>
			<div class="de-switches">${keys.map(k => `<button type="button" class="de-switch" role="switch" data-k="${k}"><span><b>${esc(ui('settings.' + k))}</b><small>${esc(ui('settings.' + k + '.help'))}</small></span><i><em></em></i><u></u></button>`).join('')}</div>
			<div class="de-actions"><button type="button" class="de-btn primary" data-a="close" data-focus>${esc(ui('settings.done'))}</button></div>`, 'de-card de-settings');
		const paint = () => m.querySelectorAll<HTMLElement>('.de-switch').forEach(b => {
			const on = s[b.dataset.k as keyof Settings];
			b.setAttribute('aria-checked', String(on));
			(b.querySelector('u') as HTMLElement).textContent = ui(on ? 'settings.on' : 'settings.off');
		});
		paint();
		m.querySelectorAll<HTMLElement>('.de-switch').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k as keyof Settings; s[k] = !s[k]; paint(); onChange(s); }));
		(m.querySelector('[data-a=close]') as HTMLElement).addEventListener('click', onClose);
	}

	// ------------------------------------------------------------------ decision card
	private cardHtml(c: CardDef, d: Decision, selected: string | null): string {
		const head = (extra = '') => `<div class="de-msg-head"><b>${esc(c.fromAr ?? c.appAr ?? '')}</b>${c.fromAddress ? `<span dir="ltr">${esc(c.fromAddress)}</span>` : ''}${c.time ? `<em>${esc(c.time)}</em>` : ''}${extra}</div>`;
		const label = c.titleAr && d.variant.type === 'compare' ? `<div class="de-msg-label">${esc(c.titleAr)}</div>` : '';
		if (c.skin === 'chat') return `${label}<div class="de-msg chat"><div class="de-msg-app">${esc(c.appAr ?? '')}</div>${head()}
			${(c.chatAr ?? []).map(b => `<div class="de-bubble ${b.from}"><span>${rich(b.textAr)}</span></div>`).join('')}</div>`;
		if (c.skin === 'alert') return `${label}<div class="de-msg alert"><div class="de-msg-app">${c.iconAr ? `<span>${esc(c.iconAr)}</span>` : ''}${esc(c.appAr ?? '')}</div>
			${c.titleAr && d.variant.type !== 'compare' ? `<b class="de-alert-title">${esc(c.titleAr)}</b>` : ''}${(c.bodyAr ?? []).map(p => `<p>${esc(p)}</p>`).join('')}
			${c.rowsAr?.length ? `<ul>${c.rowsAr.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
			${c.buttonsAr?.length ? `<div class="de-fake">${c.buttonsAr.map(b => `<span>${esc(b)}</span>`).join('')}</div>` : ''}</div>`;
		const body = c.segments
			? c.segments.map(sg => {
				if (!sg.actionId) return `<p>${esc(sg.textAr)}</p>`;
				const ch = d.choices.find(x => x.actionId === sg.actionId)!;
				const tried = d.tried.includes(sg.actionId);
				return `<button type="button" class="de-seg ${selected === sg.actionId ? 'on' : ''} ${tried ? 'tried' : ''}" data-action="${esc(sg.actionId)}" data-lane="${ch.lane}" ${tried ? 'disabled' : ''}>${badge(ch.lane)}<span>${esc(sg.textAr)}</span></button>`;
			}).join('')
			: (c.bodyAr ?? []).map(p => `<p>${rich(p)}</p>`).join('');
		return `${label}<div class="de-msg"><div class="de-msg-app">${esc(c.appAr ?? '')}</div>${head()}${body}${c.linkAr ? `<span class="de-link" dir="ltr">${esc(c.linkAr)}</span>` : ''}</div>`;
	}

	gate(v: GateView, h: GateHandlers) {
		const d = v.decision, type = d.variant.type;
		let selected: string | null = null;
		let order: string[] = [];
		// Phones: the card never scrolls. It has two pages, the message and then the answers; "spot" is answered inside
		// the message, so it stays on one page.
		const paged = type !== 'spot';
		let revealed = !paged || v.secondChance;
		let hints = v.hints, lenses = v.lenses;
		const cards = d.variant.cards ?? (d.variant.card ? [d.variant.card] : []);
		const m = this.show(`
			<header class="de-gate-head">
				<span class="de-step">${v.secondChance ? `<i class="de-second">${ICON.redo}${esc(ui('gate.second'))}</i>` : esc(ui('gate.step', { n: num(v.index + 1), total: num(v.total) }))}<b>${esc(d.checkpoint.labelAr)}</b></span>
				<span class="de-gate-tools">
					<button type="button" class="de-tool" data-a="lens" aria-label="${esc(ui('tool.lens'))}">${ICON.lens}<b></b></button>
					<button type="button" class="de-tool" data-a="hint" aria-label="${esc(ui('tool.hint'))}">${ICON.hint}<b></b></button>
				</span>
			</header>
			<div class="de-scroll">
				<p class="de-scene"><b>${esc(ui('gate.scene'))}</b>${rich(d.variant.sceneAr)}</p>
				<div class="de-read" data-k="read">
					<div class="de-cards ${cards.length > 1 ? 'two' : ''}" data-k="cards"></div>
					${d.variant.pressureSec ? `<div class="de-pressure" data-k="pressure"></div>` : ''}
				</div>
				<div class="de-reveal lens hidden" data-k="lens"></div>
				<div class="de-reveal hint hidden" data-k="hint"></div>
				<div class="de-answers" data-k="answers"><p class="de-ask">${esc(d.variant.promptAr)}</p><div data-k="options"></div></div>
			</div>
			<footer class="de-gate-foot">
				<button type="button" class="de-btn primary big" data-a="reveal" data-focus>${esc(ui('gate.showOptions'))}</button>
				<button type="button" class="de-btn ghost" data-a="back">${esc(ui('gate.showMessage'))}</button>
				<button type="button" class="de-btn primary big" data-a="confirm" disabled>${esc(ui('gate.confirm'))}</button>
			</footer>`, 'de-gate');
		const k = (n: string) => m.querySelector(`[data-k=${n}]`) as HTMLElement;
		const a = (n: string) => m.querySelector(`[data-a=${n}]`) as HTMLButtonElement;
		const confirmBtn = a('confirm');

		const paint = () => {
			k('cards').innerHTML = cards.map(c => `<div class="de-cardwrap">${this.cardHtml(c, d, selected)}</div>`).join('');
			if (type === 'order') {
				k('options').innerHTML = `<div class="de-steps">${d.steps.map(s => {
					const at = order.indexOf(s.id);
					return `<button type="button" class="de-option step ${at >= 0 ? 'on' : ''}" data-step="${esc(s.id)}"><i class="de-num">${at >= 0 ? esc(num(at + 1)) : ''}</i><span>${esc(s.textAr)}</span></button>`;
				}).join('')}</div><p class="de-small">${esc(ui('gate.orderHelp'))}</p>`;
			} else if (type !== 'spot') {
				k('options').innerHTML = d.choices.map(c => {
					const tried = d.tried.includes(c.actionId);
					return `<button type="button" class="de-option ${selected === c.actionId ? 'on' : ''} ${tried ? 'tried' : ''}" data-action="${esc(c.actionId)}" data-lane="${c.lane}" ${tried ? 'disabled' : ''}>${badge(c.lane)}<span>${esc(c.labelAr)}</span>${tried ? `<em>${esc(ui('gate.tried'))}</em>` : ''}</button>`;
				}).join('');
			} else k('options').innerHTML = '';
			confirmBtn.disabled = type === 'order' ? order.length !== d.steps.length : !selected;
			const tool = (name: 'hint' | 'lens', n: number) => { const b = a(name); (b.querySelector('b') as HTMLElement).textContent = num(n); b.disabled = n <= 0 && !k(name).innerHTML; b.classList.toggle('on', !k(name).classList.contains('hidden')); };
			tool('hint', hints); tool('lens', lenses);
			layout();
		};
		// Which page is showing, then shrink the type a step or two if the card would still need scrolling.
		const layout = () => {
			k('read').classList.toggle('hidden', paged && revealed);
			k('answers').classList.toggle('hidden', paged && !revealed);
			a('reveal').classList.toggle('hidden', revealed);
			a('back').classList.toggle('hidden', !paged || !revealed);
			confirmBtn.classList.toggle('hidden', !revealed);
			const sc = m.querySelector('.de-scroll') as HTMLElement;
			// fit1, fit2: tighter type. fit3 (very small phones): the hint or lens text floats over the card instead of pushing it.
			m.classList.remove('fit1', 'fit2', 'fit3');
			for (const cls of ['fit1', 'fit2', 'fit3']) { if (sc.scrollHeight <= sc.clientHeight + 1) break; m.classList.add(cls); }
		};
		const select = (actionId: string) => {
			const c = d.choices.find(x => x.actionId === actionId);
			if (!c || d.tried.includes(actionId)) return;
			selected = actionId; h.onSelect(c.lane); paint();
		};
		const reveal = (yes = true) => { revealed = yes; layout(); };
		const confirm = () => {
			if (confirmBtn.disabled) return;
			h.onConfirm(type === 'order' ? orderAction(d.checkpoint, d.variant, order) : selected!);
		};
		m.addEventListener('click', e => {
			const t = e.target as HTMLElement;
			const act = t.closest<HTMLElement>('[data-action]');
			if (act) { select(act.dataset.action!); return; }
			const tip = t.closest<HTMLElement>('.de-reveal');
			if (tip) { tip.classList.add('hidden'); paint(); return; }               // tap the hint or lens text to put it away
			const step = t.closest<HTMLElement>('[data-step]');
			if (step) { const id = step.dataset.step!; const at = order.indexOf(id); order = at >= 0 ? order.slice(0, at) : [...order, id]; paint(); return; }
			const b = t.closest<HTMLElement>('[data-a]');
			if (!b) return;
			if (b.dataset.a === 'reveal') reveal();
			else if (b.dataset.a === 'back') reveal(false);
			else if (b.dataset.a === 'confirm') confirm();
			else if (b.dataset.a === 'hint' || b.dataset.a === 'lens') {
				const name = b.dataset.a;
				const box = k(name), other = k(name === 'hint' ? 'lens' : 'hint');
				if (!box.classList.contains('hidden')) return;
				if (!box.innerHTML) {                                            // first use spends one; later taps only show it again
					const text = name === 'hint' ? h.onHint() : h.onLens();
					if (!text) return;
					if (name === 'hint') hints--; else lenses--;
					box.innerHTML = `<span class="de-ico">${name === 'hint' ? ICON.hint : ICON.lens}</span><p>${rich(text)}</p>`;
				}
				box.classList.remove('hidden'); other.classList.add('hidden');
				paint();
			}
		});
		this.gateKeys = action => {
			if (action === 'confirm') { if (!revealed) reveal(); else confirm(); return; }
			if (type === 'order' || !revealed || (action !== 'left' && action !== 'right')) return;
			const open = d.choices.filter(c => !d.tried.includes(c.actionId));
			if (!open.length) return;
			const at = open.findIndex(c => c.actionId === selected);
			const next = at < 0 ? (action === 'left' ? 0 : open.length - 1) : Math.max(0, Math.min(open.length - 1, at + (action === 'left' ? -1 : 1)));
			select(open[next].actionId);
		};
		paint();
		// The sender's countdown is only pressure: nothing happens when it ends, and the card says so.
		if (d.variant.pressureSec) {
			const box = k('pressure');
			if (v.noTimer) box.innerHTML = `<p>${esc(ui('gate.pressureOff'))}</p>`;
			else {
				let left = d.variant.pressureSec;
				const draw = () => { box.innerHTML = left > 0
					? `<div class="de-pressure-bar"><i style="width:${left / d.variant.pressureSec! * 100}%"></i></div><p>${esc(ui('gate.pressure', { n: num(left) }))}</p>`
					: `<p class="done">${esc(ui('gate.pressureDone'))}</p>`; };
				draw();
				this.pressureTimer = window.setInterval(() => { left--; draw(); if (left <= 0) this.clearPressure(); }, 1000);
			}
		}
	}
	private clearPressure() { if (this.pressureTimer) { clearInterval(this.pressureTimer); this.pressureTimer = 0; } }

	// ------------------------------------------------------------------ results
	results(r: ResultsView) {
		const list = (items: string[], icon: string, cls: string) => items.map(t => `<li class="${cls}"><span class="de-ico">${icon}</span>${esc(t)}</li>`).join('');
		const m = this.show(`
			<h2>${esc(ui('result.title'))}</h2>
			<div class="de-score ${r.passed ? 'good' : 'warn'}">
				<small>${esc(ui('result.knowledge'))}</small>
				<b>${esc(ui('result.points', { earned: num(r.earned), max: num(r.max) }))}</b>
				<span><span class="de-ico">${r.passed ? ICON.check : ICON.redo}</span>${esc(ui(r.passed ? 'result.passed' : 'result.needsPractice'))}</span>
			</div>
			<div class="de-run">
				<div><small>${esc(ui('result.runScore'))}</small><b>${esc(num(r.runScore))}</b></div>
				<div class="de-stars" aria-label="${esc(ui('result.stars', { n: num(r.stars) }))}">${[0, 1, 2].map(i => `<span class="${i < r.stars ? 'on' : ''}">${ICON.star}</span>`).join('')}</div>
			</div>
			<ul class="de-reasons">${r.starReasons.map(s => `<li class="${s.on ? 'on' : ''}">${s.on ? ICON.check : ICON.close}<span>${esc(s.text)}</span></li>`).join('')}</ul>
			${r.mastered.length ? `<h3>${esc(ui('result.mastered'))}</h3><ul class="de-list">${list(r.mastered, ICON.check, 'good')}</ul>` : ''}
			${r.review.length ? `<h3>${esc(ui('result.review'))}</h3><ul class="de-list">${list(r.review, ICON.redo, 'warn')}</ul>` : ''}
			${r.badges.length ? `<h3>${esc(ui('result.badges'))}</h3><div class="de-badges">${r.badges.map(b => `<span class="${b.isNew ? 'new' : ''}">${ICON.star}${esc(b.title)}${b.isNew ? `<em>${esc(ui('result.new'))}</em>` : ''}</span>`).join('')}</div>` : ''}
			<div class="de-actions">
				${r.onReview ? `<button type="button" class="de-btn primary" data-a="review" data-focus>${esc(ui('result.reviewBtn'))}</button>` : ''}
				<button type="button" class="de-btn ${r.onReview ? 'ghost' : 'primary'}" data-a="replay" ${r.onReview ? '' : 'data-focus'}>${esc(ui('result.replay'))}</button>
				<button type="button" class="de-btn ghost" data-a="menu">${esc(ui('result.menu'))}</button>
			</div>
			<p class="de-note">${esc(r.note)}</p>`, 'de-card de-results');
		const on = (n: string, fn: (() => void) | null) => (m.querySelector(`[data-a=${n}]`) as HTMLElement | null)?.addEventListener('click', () => fn?.());
		on('review', r.onReview); on('replay', r.onReplay); on('menu', r.onMenu);
	}

	static readonly icons = ICON;
	dispose() { this.clearPressure(); clearTimeout(this.toastTimer); this.root.remove(); }
}
