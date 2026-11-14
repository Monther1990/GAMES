// Input: the game reads a movement direction (keyboard) or a point to move to (touch drag), and a few named actions.
// On a phone the character follows the finger directly: where the finger moves, the character moves by the same amount,
// so the finger never has to cover it. Firing is automatic.
export type InputAction = 'pause' | 'confirm' | 'left' | 'right' | 'up' | 'down' | 'power' | 'upgrade' | 'arms';

const MOVE: Record<string, [number, number]> = {
	ArrowLeft: [0, -1], KeyA: [0, -1], ArrowRight: [0, 1], KeyD: [0, 1], ArrowUp: [1, 0], KeyW: [1, 0], ArrowDown: [-1, 0], KeyS: [-1, 0]
};
const ACTION: Record<string, InputAction> = { Escape: 'pause', KeyP: 'pause', Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm',
	ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyE: 'power', KeyX: 'power', KeyU: 'upgrade', KeyB: 'arms' };

export class Input {
	onAction: (a: InputAction) => void = () => {};
	/** Screen movement of the dragging finger since the last read, in CSS pixels (x right, y down). */
	dragDx = 0; dragDy = 0; dragging = false;
	readonly touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
	private keys = new Set<string>();
	private last: { x: number; y: number; id: number } | null = null;
	/** Every finger now on the field and where it is: when the one that steers lifts, another still down takes over. */
	private fingers = new Map<number, { x: number; y: number }>();
	private off: (() => void)[] = [];

	constructor(surface: HTMLElement) {
		const on = (el: HTMLElement | Window, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
			el.addEventListener(type, fn as EventListener, opts);
			this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
		};
		on(window, 'keydown', (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement | null)?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA') return;
			if (MOVE[e.code]) { this.keys.add(e.code); e.preventDefault(); }
			const a = ACTION[e.code];
			if (!a) return;
			if (e.code === 'Space') e.preventDefault();
			if (!e.repeat) this.onAction(a);
		});
		on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
		on(window, 'blur', () => { this.keys.clear(); this.last = null; this.dragging = false; this.fingers.clear(); });
		on(surface, 'pointerdown', (e: PointerEvent) => {
			try { surface.setPointerCapture(e.pointerId); } catch { /* not supported */ }
			// a touch the browser calls the only one: whatever finger was remembered is gone (its lifting was never reported)
			if (e.isPrimary && e.pointerType !== 'mouse' && this.last && this.last.id !== e.pointerId) { this.last = null; this.fingers.clear(); }
			this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (this.last && e.pointerType !== 'mouse') return;                  // the first finger steers; a second one on the field changes nothing while the first is down
			this.last = { x: e.clientX, y: e.clientY, id: e.pointerId }; this.dragging = true; });
		on(surface, 'pointermove', (e: PointerEvent) => {
			const at = this.fingers.get(e.pointerId);
			if (at) { at.x = e.clientX; at.y = e.clientY; }
			const l = this.last;
			if (!l || l.id !== e.pointerId) return;
			this.dragDx += e.clientX - l.x; this.dragDy += e.clientY - l.y;
			l.x = e.clientX; l.y = e.clientY;
		});
		const end = (e: PointerEvent) => {
			this.fingers.delete(e.pointerId);
			if (this.last?.id !== e.pointerId) return;
			// the steering finger lifted: one still on the field takes over from where it is now (so nothing jumps)
			const next = [...this.fingers.entries()].pop();
			if (next) this.last = { x: next[1].x, y: next[1].y, id: next[0] }; else { this.last = null; this.dragging = false; }
		};
		on(surface, 'pointerup', end); on(surface, 'pointercancel', end); on(surface, 'lostpointercapture', end);   // never left waiting for a finger that is gone
	}

	/** Keyboard direction: dx up the screen, dz to the right, each -1..1. */
	direction(): { dx: number; dz: number } {
		let dx = 0, dz = 0;
		for (const k of this.keys) { dx += MOVE[k][0]; dz += MOVE[k][1]; }
		return { dx: Math.max(-1, Math.min(1, dx)), dz: Math.max(-1, Math.min(1, dz)) };
	}
	takeDrag(): { dx: number; dy: number } { const d = { dx: this.dragDx, dy: this.dragDy }; this.dragDx = 0; this.dragDy = 0; return d; }
	reset() { this.keys.clear(); this.dragDx = 0; this.dragDy = 0; }
	dispose() { for (const f of this.off) f(); }
}
