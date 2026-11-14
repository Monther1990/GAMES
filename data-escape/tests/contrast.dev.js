// A dev-server tool, not a unit test: can every word on the screen be read? After the interface moved to the light
// look of the platform (cream, navy, gold), a colour left over from the dark one - pale text meant for a dark panel -
// would be nearly invisible. In the browser console of `npm run dev`, with any screen open:
//   (await import('/tests/contrast.dev.js')).audit()
// Every element that shows text of its own is measured: its colour against the surface under it (surfaces that let the
// one below show through are laid over each other). It lists what falls under 3 to 1 (large or bold type) or 4.5 to 1
// (small type). Text over a picture, a gradient or the fight itself cannot be measured and is listed apart.
const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
/** The surface under an element: its own and its ancestors' backgrounds laid over each other; null when a picture, a gradient or the fight is under it. */
function surface(el) {
	const layers = [];
	for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
		const s = getComputedStyle(e);
		if (s.backgroundImage && s.backgroundImage !== 'none') return null;
		if (e.classList.contains('cs-ui') || e.classList.contains('de-ui') || e.tagName === 'CANVAS') return null;   // nothing solid between this text and the fight
		const c = parse(s.backgroundColor);
		if (c && c.a > 0) { layers.push(c); if (c.a >= 0.97) break; }
	}
	if (!layers.length || layers[layers.length - 1].a < 0.9) return null;
	let base = { ...layers.pop(), a: 1 };
	while (layers.length) base = over(layers.pop(), base);
	return base;
}
export function audit(root = document.querySelector('.cs-ui, .de-ui')) {
	const bad = [], unmeasured = [];
	let looked = 0;
	for (const el of root.querySelectorAll('*')) {
		const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
		if (!own) continue;
		const s = getComputedStyle(el), r = el.getBoundingClientRect();
		if (s.visibility === 'hidden' || s.display === 'none' || r.width < 2 || r.height < 2 || +s.opacity === 0) continue;
		let seen = 1; for (let e = el; e && e !== root; e = e.parentElement) seen *= +getComputedStyle(e).opacity;
		const color = parse(s.color), under = surface(el), who = (el.className && String(el.className).split(' ').slice(0, 2).join('.')) || el.tagName.toLowerCase();
		const parent = el.parentElement ? String(el.parentElement.className).split(' ').slice(0, 2).join('.') : '';
		if (!color) continue;
		looked++;
		if (!under) { unmeasured.push(parent + ' > ' + who); continue; }
		const shown = over({ ...color, a: color.a * seen }, under), a = lum(shown), b = lum(under), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
		const size = parseFloat(s.fontSize), big = size >= 18.5 || (size >= 14 && +s.fontWeight >= 700);
		if (ratio < (big ? 3 : 4.5)) bad.push({ el: parent + ' > ' + who, text: own.slice(0, 28), ratio: Math.round(ratio * 10) / 10, size, color: s.color, dimmed: seen < 1 ? Math.round(seen * 100) / 100 : undefined });
	}
	const once = new Map();
	for (const b of bad) { const k = b.el + b.color + (b.dimmed ?? ''), had = once.get(k); if (had) had.times++; else once.set(k, { ...b, times: 1 }); }
	return { looked, bad: [...once.values()], unmeasured: [...new Set(unmeasured)].slice(0, 12) };
}
