// Builds the public site: the page where a player picks a game, and the built files of the two games.
//     node build.mjs               builds both games first (their own checks and tests of data run)
//     node build.mjs --skip-build  only gathers what is already built
// Result: portal/dist, the only folder Apache serves for game.omcode.net. Nothing but built files goes into it:
// no source, no notes, no rooms opened while developing.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const games = [
	{ folder: 'fighter', as: 'cyber-shield' },
	{ folder: 'fighterv2', as: 'cyber-shield-2' },
	{ folder: 'data-escape', as: 'data-escape' }
];
const skip = process.argv.includes('--skip-build');

for (const g of games) {
	const dir = join(here, '..', g.folder);
	if (!skip) { console.log(`\n== building ${g.folder}`); execSync('npm run build', { cwd: dir, stdio: 'inherit' }); }
	if (!existsSync(join(dir, 'dist', 'index.html'))) throw new Error(`${g.folder}/dist is missing: run without --skip-build`);
}

const dist = join(here, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, 'src'), dist, { recursive: true });
mkdirSync(join(dist, 'fonts'), { recursive: true });
for (const f of ['ReadexPro-Regular.ttf', 'ReadexPro-bold.ttf', 'OFL.txt']) cpSync(join(here, '..', 'fighter', 'public', 'fonts', f), join(dist, 'fonts', f));
for (const g of games) cpSync(join(here, '..', g.folder, 'dist'), join(dist, g.as), { recursive: true });
rmSync(join(dist, 'cyber-shield', 'server', 'rooms'), { recursive: true, force: true });
// part 2 plays together through part 1's room file next door (the site allows one PHP file only), so its own is not published
rmSync(join(dist, 'cyber-shield-2', 'server'), { recursive: true, force: true });

// the page names its own files with a mark of their content, so a changed style or picture is never served from an
// old copy kept by a browser or by Cloudflare
for (const page of [join(dist, 'index.html'), join(dist, 'en.html')]) writeFileSync(page, readFileSync(page, 'utf8').replace(/(href|src)="\.\/(style\.css|covers\/[^"?]+)"/g, (all, attr, file) => {
	const mark = createHash('sha256').update(readFileSync(join(dist, file))).digest('hex').slice(0, 10);
	return attr + '="./' + file + '?v=' + mark + '"';
}));

// folders the server writes to, outside the web folder
for (const d of ['logs', join('data', 'rooms')]) mkdirSync(join(here, d), { recursive: true });

// a last look: nothing that is not a built file may be in the site
const bad = /\.(php|phtml|phar|map|md|ts|env|ini|log|zip|7z|sql|bak)$/i, found = [];
const walk = dir => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (bad.test(n) || n.startsWith('.')) found.push(p.slice(dist.length + 1).replaceAll('\\', '/')); } };
walk(dist);
const allowed = ['cyber-shield/server/coop.php'];
const extra = found.filter(f => !allowed.includes(f));
if (extra.length) throw new Error('files that must not be public:\n  ' + extra.join('\n  '));
if (!found.includes(allowed[0])) throw new Error('the room API (cyber-shield/server/coop.php) is missing');
console.log(`\nportal/dist is ready: ${games.map(g => g.as).join(', ')} and the picking page`);
