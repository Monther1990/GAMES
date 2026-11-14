// Writes src/data/omcode-logo.json from the company's own logo file (path data unchanged), split into the pieces the
// last boss is built from: the red "OM", the letters C, D and E, and the two brackets, which move on their own.
// usage: node scripts/extract-logo.mjs <path to logo.svg>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) { console.error('usage: node scripts/extract-logo.mjs <path to logo.svg>'); process.exit(1); }
const svg = readFileSync(source, 'utf8');
const clean = d => d.replace(/\s+/g, ' ').trim();
const paths = [...svg.matchAll(/<path[^>]*style="fill:(#[0-9A-Fa-f]{6});"[^>]*\sd="([^"]+)"/g)].map(m => ({ fill: m[1].toUpperCase(), d: clean(m[2]) }));
const polygons = [...svg.matchAll(/<polygon[^>]*points="([^"]+)"/g)].map(m => clean(m[1]).split(' ').map(p => p.split(',').map(Number)).filter(p => p.length === 2 && !p.some(Number.isNaN)));
const red = paths.filter(p => p.fill === '#ED1C24').map(p => p.d), rest = paths.filter(p => p.fill !== '#ED1C24').map(p => p.d);
if (red.length !== 2 || rest.length !== 3 || polygons.length !== 2) { console.error(`unexpected logo file: ${red.length} red paths, ${rest.length} other paths, ${polygons.length} polygons`); process.exit(1); }
const left = polygons.find(p => Math.min(...p.map(q => q[0])) < 500), right = polygons.find(p => p !== left);
const out = {
	note: 'OMCode logo, from the company logo file. Path data is unchanged; only the split into pieces is ours.',
	viewBox: [55, 236, 735, 124], red: '#ED1C24', navy: '#17134A',
	om: red, letters: rest, open: left, close: right
};
writeFileSync(fileURLToPath(new URL('../src/data/omcode-logo.json', import.meta.url)), JSON.stringify(out, null, 1) + '\n');
console.log(`omcode-logo.json: ${red.length} + ${rest.length} paths, brackets of ${left.length} and ${right.length} points`);
