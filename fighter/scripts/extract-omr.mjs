// Extracts the Omani Rial symbol (medium weight) from the owner's sheet "The Omani Rial symbol (PDF).svg" without
// changing its geometry: the path data is copied as is and only a tight viewBox is computed around it.
// Writes src/data/omr-symbol.json (for the game) and public/assets/omr-symbol.svg (a standalone copy).
//   node scripts/extract-omr.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL('../' + p, import.meta.url));
const sheet = readFileSync(at('The Omani Rial symbol (PDF).svg'), 'utf8');
const paths = [...sheet.matchAll(/<path class="(st\d)" d="([^"]*)"/g)].map(m => ({ cls: m[1], d: m[2] }));
// The sheet shows three weights (light, medium, bold) in red on white and again in white on red. Medium is the one
// whose path starts near x = 1342 in the top row.
const medium = paths.find(p => p.cls === 'st0' && /^M13\d\d/.test(p.d));
if (!medium) throw new Error('medium-weight symbol not found in the sheet');

/** Bounding box from every end point and control point (control points always enclose the curve). */
function bounds(d) {
	const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
	let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	const see = (px, py) => { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); };
	const num = () => parseFloat(tokens[i++]);
	const pairs = { m: 1, l: 1, t: 1, c: 3, s: 2, q: 2 };
	while (i < tokens.length) {
		if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
		const rel = cmd === cmd.toLowerCase(), c = cmd.toLowerCase();
		if (c === 'z') { x = sx; y = sy; continue; }
		if (c === 'h') { x = (rel ? x : 0) + num(); see(x, y); continue; }
		if (c === 'v') { y = (rel ? y : 0) + num(); see(x, y); continue; }
		if (!(c in pairs)) throw new Error('unsupported path command ' + cmd);
		let ex = x, ey = y;
		for (let k = 0; k < pairs[c]; k++) { ex = (rel ? x : 0) + num(); ey = (rel ? y : 0) + num(); see(ex, ey); }
		x = ex; y = ey;
		if (c === 'm') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
	}
	return [x0, y0, x1 - x0, y1 - y0];
}

const [bx, by, bw, bh] = bounds(medium.d);
const pad = Math.max(bw, bh) * 0.02;
const viewBox = [bx - pad, by - pad, bw + pad * 2, bh + pad * 2].map(n => Math.round(n * 100) / 100);
writeFileSync(at('src/data/omr-symbol.json'), JSON.stringify({
	source: 'The Omani Rial symbol (PDF).svg (medium weight, path data unchanged)', viewBox, d: medium.d }, null, 1) + '\n');
writeFileSync(at('public/assets/omr-symbol.svg'),
	`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}"><path fill="#d12a19" d="${medium.d}"/></svg>\n`);
console.log('omr symbol: viewBox', viewBox.join(' '), '| aspect', (viewBox[2] / viewBox[3]).toFixed(3), '| path', medium.d.length, 'chars');
