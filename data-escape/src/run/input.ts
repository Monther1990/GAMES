// Input: gameplay reads named actions; keys, swipes and the optional on-screen buttons are just bindings to them.
// A swipe fires as soon as the finger has moved far enough (not on release), so the runner answers at once.
import type { Action } from './sim';

export type InputAction = Action | 'pause' | 'confirm';

const KEYS: Record<string, InputAction> = {
	ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
	ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'slide', KeyS: 'slide',
	Escape: 'pause', KeyP: 'pause', Enter: 'confirm', NumpadEnter: 'confirm'
};
const SWIPE_PX = 26;

export class Input {
	onAction: (a: InputAction) => void = () => {};
	readonly touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
	private pad: HTMLElement;
	private start: { x: number; y: number; id: number } | null = null;
	private off: (() => void)[] = [];

	constructor(host: HTMLElement, surface: HTMLElement, labels: Record<Action, string>) {
		const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
			el.addEventListener(type, fn as EventListener, opts);
			this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
		};
		on(window, 'keydown', (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement | null)?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA') return;
			const a = KEYS[e.code];
			if (!a) return;
			if (a !== 'confirm') e.preventDefault();                       // arrows and space must not scroll the host page
			if (!e.repeat) this.onAction(a);
		});
		on(surface, 'pointerdown', (e: PointerEvent) => { this.start = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
		on(surface, 'pointermove', (e: PointerEvent) => {
			const s = this.start;
			if (!s || s.id !== e.pointerId) return;
			const dx = e.clientX - s.x, dy = e.clientY - s.y;
			if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
			this.onAction(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'jump' : 'slide'));
			this.start = { x: e.clientX, y: e.clientY, id: e.pointerId };     // a long swipe can chain a second move
		});
		const end = (e: PointerEvent) => { if (this.start?.id === e.pointerId) this.start = null; };
		on(surface, 'pointerup', end); on(surface, 'pointercancel', end);

		// Optional buttons. dir=ltr keeps left on the left inside the right-to-left page.
		this.pad = document.createElement('div');
		this.pad.className = 'de-pad hidden';
		this.pad.dir = 'ltr';
		const arrows: [Action, string][] = [['left', 'M15 5 7 12l8 7'], ['right', 'M9 5l8 7-8 7'], ['jump', 'M5 15l7-8 7 8'], ['slide', 'M5 9l7 8 7-8']];
		for (const [a, d] of arrows) {
			const b = document.createElement('button');
			b.type = 'button'; b.className = `de-pad-btn de-pad-${a}`; b.setAttribute('aria-label', labels[a]);
			b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
			on(b, 'pointerdown', (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); this.onAction(a); });
			this.pad.appendChild(b);
		}
		host.appendChild(this.pad);
	}

	showButtons(visible: boolean) { this.pad.classList.toggle('hidden', !visible); }
	dispose() { for (const f of this.off) f(); this.pad.remove(); }
}
