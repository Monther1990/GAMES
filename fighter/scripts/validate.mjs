// Checks that the scoring rules (missions.json), the questions (content-ar.json), the Cyber box questions
// (quick-ar.json), the economy (economy.json), the interface text (ui-ar.json) and the assets agree, and that the
// content follows the safety rules of the series (fictional addresses only). `npm run validate`; also part of
// `npm run build`. Errors stop the build; warnings are printed.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const at = p => fileURLToPath(new URL('../' + p, import.meta.url));
const json = p => JSON.parse(readFileSync(at(p), 'utf8'));
const errors = [], warnings = [];
const err = m => errors.push(m), warn = m => warnings.push(m);
const letters = s => [...String(s ?? '')].length;

const config = json('src/data/game-config.json');
const { missions } = json('src/data/missions.json');
const content = json('src/data/content-ar.json');
const quick = json('src/data/quick-ar.json');
const eco = json('src/data/economy.json');
const uiText = json('src/data/ui-ar.json');

// ---------------------------------------------------------------- config and missions (the rules the server re-scores)
if (!/^[a-z0-9][a-z0-9-]{2,48}$/.test(config.gameId ?? '')) err(`game-config.gameId "${config.gameId}" must be lowercase letters, digits and dashes`);
if (uiText['app.title'] !== config.titleAr) err('ui-ar.json "app.title" differs from game-config.titleAr');
if (config.passThresholdPercent !== 70 || config.recoveryCreditRate !== 0.6) err('pass mark (70) and recovery rate (0.6) are fixed for the series');
if (config.timeAffectsScore !== false) err('time must never affect the score');
if (missions.length !== eco.stages.length) err(`there are ${missions.length} missions and ${eco.stages.length} stages: every stage needs its three questions`);
const cps = [], actionIds = new Map();
missions.forEach((m, i) => {
	if (m.id !== `M${i + 1}`) err(`mission ${m.id}: ids must be M1, M2, … in order`);
	if (!m.titleAr) err(`mission ${m.id}: titleAr is required`);
	if (eco.stages[i] && m.titleAr !== eco.stages[i].nameAr) warn(`mission ${m.id} is called "${m.titleAr}" but its stage is "${eco.stages[i].nameAr}"`);
	const list = m.checkpoints ?? [];
	if (list.length !== 3) err(`mission ${m.id}: exactly three questions follow a boss; found ${list.length}`);
	const sum = list.reduce((n, c) => n + c.weight, 0);
	if (sum !== m.maximumPoints) err(`mission ${m.id}: checkpoint weights add up to ${sum}, maximumPoints is ${m.maximumPoints}`);
	list.forEach((c, k) => {
		cps.push(c);
		if (c.id !== `${m.id}.C${k + 1}`) err(`checkpoint ${c.id}: expected ${m.id}.C${k + 1}`);
		if (!c.safeActionId || c.unsafeActionIds?.length !== 2) err(`checkpoint ${c.id}: one safeActionId and exactly two unsafeActionIds (three answers)`);
		if (!c.feedbackAr || !c.hintAr || !c.labelAr) err(`checkpoint ${c.id}: labelAr, feedbackAr and hintAr are required`);
		for (const a of [c.safeActionId, ...(c.unsafeActionIds ?? [])]) {
			if (!/^[a-z][a-z0-9_]+$/.test(a ?? '')) err(`checkpoint ${c.id}: action id "${a}" must be lowercase snake_case`);
			if (actionIds.has(a)) err(`action id "${a}" is used by ${actionIds.get(a)} and ${c.id}`);
			actionIds.set(a, c.id);
		}
	});
});
const total = cps.reduce((n, c) => n + c.weight, 0);
if (total !== (config.scoreMaximum ?? 100)) err(`all weights add up to ${total}; the score maximum is ${config.scoreMaximum ?? 100}`);

// ---------------------------------------------------------------- the questions after each boss
let variantCount = 0;
for (const c of cps) {
	const variants = content.decisions?.[c.id]?.variants ?? [];
	if (variants.length < 2) err(`${c.id}: at least two situations (variants) so a replay differs; found ${variants.length}`);
	const expected = [c.safeActionId, ...c.unsafeActionIds], seen = new Set();
	for (const v of variants) {
		variantCount++;
		const where = `${c.id}/${v.id}`;
		if (!v.id || seen.has(v.id)) err(`${where}: variant ids must be unique inside a checkpoint`);
		seen.add(v.id);
		for (const k of ['sceneAr', 'promptAr', 'praiseAr', 'explainAr']) if (!v[k]) err(`${where}: ${k} is required`);
		if (v.message && (!v.message.fromAr || !v.message.textAr)) err(`${where}: a message needs fromAr and textAr`);
		const ids = (v.options ?? []).map(o => o.actionId);
		if (ids.length !== 3 || !expected.every(a => ids.includes(a))) err(`${where}: options must be exactly ${expected.join(', ')}`);
		for (const o of v.options ?? []) if (letters(o.labelAr) > 64) warn(`${where}: answer "${o.actionId}" has ${letters(o.labelAr)} letters (question cards must fit a phone)`);
		if (letters(v.sceneAr) > 110) warn(`${where}: the scene has ${letters(v.sceneAr)} letters`);
		if (letters(v.message?.textAr) > 120) warn(`${where}: the message has ${letters(v.message.textAr)} letters`);
		if (letters(v.explainAr) > 150) warn(`${where}: the explanation has ${letters(v.explainAr)} letters`);
	}
}
for (const k of ['introAr', 'winAr']) if (!content.story?.[k]) err(`content-ar.json story.${k} is missing`);

// ---------------------------------------------------------------- the quick questions of the Cyber box (practice only)
if (!(quick.seconds >= 12 && quick.seconds <= 40)) err('quick-ar.json: seconds must give a child time to read (12 to 40)');
const quickIds = new Set();
for (const q of quick.questions ?? []) {
	if (!q.id || quickIds.has(q.id)) err(`quick question "${q.id}": ids must be unique`);
	quickIds.add(q.id);
	if (!(q.stage >= 0 && q.stage < eco.stages.length)) err(`quick question ${q.id}: stage must be 0 to ${eco.stages.length - 1}`);
	if (!q.qAr || !q.whyAr || q.options?.length !== 3 || new Set(q.options).size !== 3) err(`quick question ${q.id}: needs qAr, whyAr and three different options (the first is the right one)`);
	if (letters(q.qAr) > 75) warn(`quick question ${q.id}: ${letters(q.qAr)} letters is long for a timed question`);
	for (const o of q.options ?? []) if (letters(o) > 46) warn(`quick question ${q.id}: an option of ${letters(o)} letters is long for a timed question`);
}
eco.stages.forEach((s, i) => { const n = (quick.questions ?? []).filter(q => q.stage === i).length; if (n < 3) err(`stage ${i + 1} has ${n} quick questions; at least three, so boxes do not repeat at once`); });

// ---------------------------------------------------------------- economy: the approved numbers of the brief
const stageTotal = s => s.enemies.normal * 1 + s.enemies.armored * 5 + s.enemies.rare * 10 + s.bossReward + s.questionRewards.reduce((a, b) => a + b, 0) + s.bonus;
const totals = eco.stages.map(stageTotal);
if (JSON.stringify(totals) !== JSON.stringify([300, 360, 420, 480, 540])) err(`stage totals are ${totals.join(', ')}; the brief approves 300, 360, 420, 480, 540`);
const approved = { pulse: 0, scatter: 350, arc: 550, beam: 800, missile: 1100, plasma: 1450 };
for (const [id, price] of Object.entries(approved)) if (eco.weapons.find(w => w.id === id)?.price !== price) err(`weapon ${id}: the approved price is ${price}`);
for (const w of eco.weapons) {
	if (w.levels?.length !== 5) err(`weapon ${w.id}: five levels`);
	for (const n of [1, 3, 5]) if (!uiText[`weapon.${w.id}.l${n}`]) err(`ui-ar.json: "weapon.${w.id}.l${n}" is missing`);
}
if (JSON.stringify(eco.upgradeCosts ?? eco.upgrades) !== JSON.stringify([60, 140, 260, 440])) err('upgrade costs must be 60, 140, 260, 440');
for (const s of eco.stages) if (!s.placeAr || !s.boss?.nameAr || !s.topicAr) err(`stage ${s.id}: placeAr, topicAr and boss.nameAr are required`);
// the last challenge: one boss, no small enemies and no questions, so it can never change the approved totals or the score
const last = eco.bonusStage;
if (!last || last.boss?.id !== 'omcode') err('economy.json: bonusStage with the boss "omcode" is required');
else {
	if (last.enemies.normal + last.enemies.armored + last.enemies.rare !== 0 || last.bonus !== 0 || last.questionRewards.some(x => x !== 0)) err('the last challenge pays only its boss reward: no small enemies, no question packages, no bonus');
	if (last.boss.hp <= Math.max(...eco.stages.map(s => s.boss.hp))) err('the code boss must have more health than every other boss');
}
const logoFile = 'src/data/omcode-logo.json';
if (!existsSync(at(logoFile))) err(`${logoFile} is missing: run scripts/extract-logo.mjs with the company logo file`);
else { const l = json(logoFile); if (l.om?.length !== 2 || l.letters?.length !== 3 || l.open?.length !== 6 || l.close?.length !== 6) err(`${logoFile}: expected the two red letters, three other letters and two brackets of six points`); }

// ---------------------------------------------------------------- what the enemies are
const mal = json('src/data/malware-ar.json');
for (const key of mal.order) { const m = mal.items[key]; if (!m?.nameAr || !m.whatAr || !m.guardAr || !/^#[0-9a-f]{6}$/i.test(m.color ?? '')) err(`malware-ar.json: "${key}" needs nameAr, whatAr, guardAr and a color`); else if (letters(m.whatAr) > 62 || letters(m.guardAr) > 62) warn(`malware-ar.json: "${key}" has a long line (its card must stay small)`); }
if (mal.stages?.length !== eco.stages.length) err('malware-ar.json: `stages` must list the kinds of every stage');
else { const all = mal.stages.flatMap(s => [...s.small, s.rare]); if (new Set(all).size !== all.length) err('malware-ar.json: every stage must have its own kinds; one is used twice'); for (const k of all) if (!mal.items[k]) err(`malware-ar.json: the kind "${k}" has no entry`); for (const s of mal.stages) if (s.small.length !== 4) err('malware-ar.json: four small kinds per stage'); }
for (const s of [...eco.stages, eco.bonusStage]) if (!mal.items['boss.' + s.boss.id]) err(`malware-ar.json: the boss "${s.boss.id}" has no entry`);

// ---------------------------------------------------------------- safety: fictional addresses only
const texts = [];
const collect = v => { if (typeof v === 'string') texts.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
collect(content); collect(quick);
for (const t of texts) {
	for (const m of t.matchAll(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) if (!m[0].toLowerCase().endsWith('.internal') && !/^\d+(\.\d+)+$/.test(m[0])) err(`"${m[0]}" looks like a real address; use a fictional one ending in .internal`);
	if (/https?:\/\//i.test(t)) err(`a real-looking URL in: ${t.slice(0, 60)}`);
	if (/[0-9٠-٩]{7,}/.test(t)) err(`a long number that could be a real phone or account number in: ${t.slice(0, 60)}`);
}

// ---------------------------------------------------------------- interface text: every key the code asks for exists
const sources = [];
const walkDir = dir => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walkDir(p); else if (p.endsWith('.ts')) sources.push(readFileSync(p, 'utf8')); } };
walkDir(at('src'));
const used = new Set();
for (const src of sources) for (const m of src.matchAll(/\bui\(\s*'([a-zA-Z0-9_.]+)'(?!\s*\+)/g)) used.add(m[1]);
for (const k of Object.keys(uiText)) if (sources.some(src => src.includes(`'${k}'`))) used.add(k);   // keys chosen by a condition: ui(ok ? 'a' : 'b')
const powers = ['bomb', 'laser', 'freeze', 'guard', 'mega', 'aware', 'wall', 'scan', 'backup', 'update'];
const families = [
	...['music', 'sfx', 'reduceMotion', 'noShake'].flatMap(k => [`settings.${k}`, `settings.${k}.help`]), 'settings.on', 'settings.off',
	'settings.quality.auto', 'settings.quality.low', 'settings.quality.high', 'menu.male', 'menu.female', 'quiz.letter0', 'quiz.letter1', 'quiz.letter2',
	'shop.next.l2', 'shop.next.l4', 'shop.stat.power', 'shop.stat.rate', 'shop.stat.coverage',
	...eco.weapons.flatMap(w => [1, 3, 5].map(n => `weapon.${w.id}.l${n}`)), ...powers.flatMap(p => [`power.${p}`, `power.${p}.desc`])];
for (const k of new Set([...used, ...families])) if (!uiText[k]) err(`ui-ar.json: "${k}" is used by the game but missing`);
for (const k of Object.keys(uiText)) if (!used.has(k) && !families.includes(k)) warn(`ui-ar.json: "${k}" is not used`);

// ---------------------------------------------------------------- assets
for (const f of ['assets/characters.glb', 'assets/omr-symbol.svg', 'assets/omcode-logo.svg', 'assets/ui/Cyber.png', 'assets/ui/Portrait_Male.png', 'assets/ui/Portrait_Female.png', 'fonts/ReadexPro-Regular.ttf', 'fonts/ReadexPro-bold.ttf'])
	if (!existsSync(at('public/' + f))) err(`public/${f} is missing`);
if (!existsSync(at('src/data/scoring-fixtures.json'))) err('src/data/scoring-fixtures.json is missing: run "npm run fixtures"');
else if (json('src/data/scoring-fixtures.json').assessmentVersion !== json('src/data/missions.json').assessmentVersion) err('scoring fixtures are older than missions.json: run "npm run fixtures"');

// ---------------------------------------------------------------- English mirrors the Arabic, key for key
{
	const paths = (o, at = '', out = new Map()) => {
		if (Array.isArray(o)) { out.set(at + '[]', o.length); o.forEach((v, i) => paths(v, `${at}[${i}]`, out)); }
		else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) paths(v, at ? `${at}.${k}` : k, out);
		else out.set(at, o);
		return out;
	};
	const arabic = /[؀-ۿ]/, fixed = /(^|\.)(id|actionId|stage|seconds|color)$|^(sources|stages|order)(\[|$)/;
	for (const name of ['content', 'ui', 'quick', 'malware']) {
		if (!existsSync(at(`src/data/${name}-en.json`))) { err(`${name}-en.json is missing`); continue; }
		const ar = paths(json(`src/data/${name}-ar.json`)), en = paths(json(`src/data/${name}-en.json`));
		for (const [p, v] of ar) {
			if (!en.has(p)) { err(`${name}-en.json: "${p}" is missing`); continue; }
			const e = en.get(p);
			if (p.endsWith('[]') ? e !== v : fixed.test(p) && e !== v) err(`${name}-en.json: "${p}" must be the same as in Arabic`);
			else if (typeof e === 'string' && arabic.test(e) && !(name === 'ui' && p === 'lang.switch')) err(`${name}-en.json: "${p}" still has Arabic letters`);
			if (name === 'ui' && typeof v === 'string') { const holes = s => (String(s).match(/\{\w+\}/g) ?? []).sort().join(); if (holes(v) !== holes(e)) err(`ui-en.json: "${p}" has other {placeholders} than the Arabic`); }
		}
		for (const p of en.keys()) if (!ar.has(p)) err(`${name}-en.json: "${p}" does not exist in Arabic`);
	}
	if (!existsSync(at('src/data/names-en.json'))) err('names-en.json is missing');
	else {
		const n = json('src/data/names-en.json');
		for (const s of [...eco.stages, eco.bonusStage]) if (!n.stages?.[s.id]?.nameAr || !n.stages[s.id].bossNameAr) err(`names-en.json: stage ${s.id} has no English name or boss name`);
		for (const w of eco.weapons) if (!n.weapons?.[w.id]?.nameAr) err(`names-en.json: weapon ${w.id} has no English name`);
		for (const c of cps) if (!n.checkpoints?.[c.id]?.labelAr || !n.checkpoints[c.id].feedbackAr) err(`names-en.json: checkpoint ${c.id} has no English label or feedback`);
	}
}

for (const w of warnings) console.warn('warning:', w);
if (errors.length) { for (const e of errors) console.error('ERROR:', e); console.error(`\n${errors.length} error(s).`); process.exit(1); }
console.log(`valid: ${missions.length} stages, ${cps.length} assessed questions (${variantCount} situations), ${quick.questions.length} box questions, ${eco.weapons.length} weapons, ${Object.keys(uiText).length} interface texts, ${warnings.length} warning(s).`);
