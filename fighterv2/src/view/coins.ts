// Rial coins flying to the wallet, drawn on a 2D canvas over the game. The money itself is already in the bank when a
// coin appears: this layer only shows it arriving, so an interrupted animation can never lose or repeat a reward.
// Each coin carries the official Omani Rial symbol (path data unchanged) on a metal disc; the disc spins, the symbol's
// geometry is never distorted on its own.
import { omr } from '../game/data';

export type CoinSize = 'small' | 'big' | 'huge';
interface Coin { x: number; y: number; vx: number; vy: number; sx: number; sy: number; cx: number; cy: number; t: number; pop: number; hang: number; fly: number; value: number; size: CoinSize; spin: number }
const RADIUS: Record<CoinSize, number> = { small: 9, big: 14, huge: 21 };
const MAX = 150;
export type TextSize = 'small' | 'mid' | 'big';
interface FloatText { x: number; y: number; t: number; text: string; size: TextSize; drift: number }
const TEXT: Record<TextSize, { px: number; color: string }> = { small: { px: 15, color: '#ffffff' }, mid: { px: 19, color: '#ffe27a' }, big: { px: 25, color: '#ffb02e' } };

export class CoinFx {
	reduceMotion = false;
	/** Called as each coin lands, with the part of the reward it carries. */
	onArrive: (value: number, big: boolean) => void = () => {};
	private g: CanvasRenderingContext2D;
	private coins: Coin[] = [];
	private texts: FloatText[] = [];
	private font = '';
	private sprites = new Map<CoinSize, HTMLCanvasElement>();
	private dpr = 1; private w = 1; private h = 1;

	constructor(readonly canvas: HTMLCanvasElement, private target: () => { x: number; y: number }) {
		this.g = canvas.getContext('2d')!;
		this.resize();
	}
	get flying() { return this.coins.length; }

	resize() {
		this.dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.w = this.canvas.clientWidth || 1; this.h = this.canvas.clientHeight || 1;
		this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
		this.sprites.clear();
	}

	/** One coin picture per size: rim, face, highlight and the symbol. */
	private sprite(size: CoinSize): HTMLCanvasElement {
		let c = this.sprites.get(size);
		if (c) return c;
		const r = RADIUS[size] * this.dpr, d = Math.ceil(r * 2 + 4);
		c = document.createElement('canvas'); c.width = d; c.height = d;
		const g = c.getContext('2d')!, m = d / 2;
		const rim = g.createLinearGradient(0, 0, d, d); rim.addColorStop(0, '#fff3b0'); rim.addColorStop(0.5, '#d99a1c'); rim.addColorStop(1, '#8a5a08');
		g.fillStyle = rim; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fill();
		const face = g.createRadialGradient(m - r * 0.35, m - r * 0.4, r * 0.1, m, m, r); face.addColorStop(0, '#fff1a8'); face.addColorStop(0.55, '#f5c33a'); face.addColorStop(1, '#c98a14');
		g.fillStyle = face; g.beginPath(); g.arc(m, m, r * 0.82, 0, Math.PI * 2); g.fill();
		// the symbol, scaled as a whole to fit the face
		const [vx, vy, vw, vh] = omr.viewBox, k = r * 1.12 / Math.max(vw, vh);
		g.save(); g.translate(m - vw * k / 2, m - vh * k / 2); g.scale(k, k); g.translate(-vx, -vy);
		g.fillStyle = '#6b3d05'; g.fill(new Path2D(omr.d)); g.restore();
		g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = Math.max(1, r * 0.09); g.beginPath(); g.arc(m, m, r * 0.9, Math.PI * 1.1, Math.PI * 1.55); g.stroke();
		this.sprites.set(size, c);
		return c;
	}

	/** A number that rises from a point and fades: the damage a hit has done. */
	text(x: number, y: number, text: string, size: TextSize) {
		if (this.texts.length > (this.reduceMotion ? 10 : 36)) this.texts.shift();
		this.texts.push({ x, y, t: 0, text, size, drift: (Math.random() - 0.5) * 26 });
	}
	private drawTexts(dt: number) {
		const g = this.g;
		if (!this.font) this.font = getComputedStyle(this.canvas).fontFamily || 'sans-serif';
		g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
		for (let i = this.texts.length - 1; i >= 0; i--) {
			const f = this.texts[i], life = 0.62;
			f.t += dt;
			if (f.t >= life) { this.texts.splice(i, 1); continue; }
			const k = f.t / life, s = TEXT[f.size], pop = k < 0.18 ? 0.6 + k / 0.18 * 0.6 : 1.2 - Math.min(0.2, (k - 0.18) * 0.6);
			g.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
			g.font = `700 ${Math.round(s.px * pop)}px ${this.font}`;
			const x = f.x + f.drift * k, y = f.y - 34 * (1 - (1 - k) * (1 - k));
			g.lineWidth = 4; g.strokeStyle = 'rgba(10,14,40,0.85)'; g.strokeText(f.text, x, y);
			g.fillStyle = s.color; g.fillText(f.text, x, y);
		}
		g.globalAlpha = 1;
	}

	/** Shows `amount` rials leaving a point of the screen. The number of coins only illustrates the amount. */
	spawn(x: number, y: number, amount: number, size: CoinSize, count: number) {
		if (amount <= 0) return;
		if (this.reduceMotion) { this.onArrive(amount, size !== 'small'); return; }
		count = Math.max(1, Math.min(count, amount));
		while (this.coins.length + count > MAX && this.coins.length) this.land(this.coins.shift()!);   // a crowd: the oldest land at once
		const each = Math.floor(amount / count);
		for (let i = 0; i < count; i++) {
			const a = Math.random() * Math.PI * 2, v = (size === 'small' ? 70 : 150) + Math.random() * (size === 'small' ? 90 : 190);
			const sz: CoinSize = size === 'huge' && i >= 4 ? 'big' : size;                    // a boss gives a few very large coins among large ones
			this.coins.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, sx: 0, sy: 0, cx: 0, cy: 0, t: -i * (size === 'small' ? 0.02 : 0.035),
				pop: 0.1 + Math.random() * 0.1, hang: 0.05 + Math.random() * 0.12, fly: 0.35 + Math.random() * 0.25, value: each + (i === 0 ? amount - each * count : 0), size: sz, spin: Math.random() * 6 });
		}
	}

	private land(c: Coin) { this.onArrive(c.value, c.size !== 'small'); }

	update(dt: number) {
		const g = this.g;
		g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		g.clearRect(0, 0, this.w, this.h);
		if (this.texts.length) this.drawTexts(dt);
		if (!this.coins.length) return;
		const goal = this.target();                                                // read every frame, so it follows a resized screen
		for (let i = this.coins.length - 1; i >= 0; i--) {
			const c = this.coins[i];
			c.t += dt; c.spin += dt * 9;
			if (c.t < 0) continue;
			let x = c.x, y = c.y, scale = 1;
			if (c.t < c.pop) { c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 0.9; c.vy *= 0.9; x = c.x; y = c.y; scale = 0.5 + 0.6 * (c.t / c.pop); }
			else if (c.t < c.pop + c.hang) { x = c.x; y = c.y + Math.sin((c.t - c.pop) / c.hang * Math.PI) * -5; scale = 1.1; }
			else {
				if (!c.sx) { c.sx = c.x; c.sy = c.y; c.cx = (c.x + goal.x) / 2 + (Math.random() - 0.5) * 160; c.cy = Math.min(c.y, goal.y) - 40 - Math.random() * 80; }
				const k = Math.min(1, (c.t - c.pop - c.hang) / c.fly), e = k * k * (3 - 2 * k), u = 1 - e;
				x = u * u * c.sx + 2 * u * e * c.cx + e * e * goal.x; y = u * u * c.sy + 2 * u * e * c.cy + e * e * goal.y;
				scale = 1.1 - 0.45 * e;
				if (k >= 1) { this.land(c); this.coins.splice(i, 1); continue; }
			}
			const img = this.sprite(c.size), d = img.width / this.dpr * scale, flip = Math.abs(Math.cos(c.spin));
			g.drawImage(img, x - d * Math.max(0.25, flip) / 2, y - d / 2, d * Math.max(0.25, flip), d);
			if (flip > 0.96) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(x - d * 0.2, y - d * 0.22, d * 0.07, 0, Math.PI * 2); g.fill(); }
		}
	}

	/** Lands every coin at once (leaving a screen, or the player pressed "skip"). */
	flush() { this.texts = []; for (const c of this.coins.splice(0)) this.land(c); this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, this.canvas.width, this.canvas.height); }
}
