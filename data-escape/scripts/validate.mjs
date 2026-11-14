// Checks that the scoring rules (missions.json), the situations (content-ar.json), the interface text (ui-ar.json), the
// track settings (balance.json) and the assets agree, and that the content follows the safety rules (fictional addresses
// only, nothing that looks like a real number). `npm run validate`; also part of `npm run build`.
// Errors stop the build; warnings are printed.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const at = p => fileURLToPath(new URL('../' + p, import.meta.url));
const json = p => JSON.parse(readFileSync(at(p), 'utf8'));
const errors = [], warnings = [];
const err = m => errors.push(m), warn = m => warnings.push(m);

const config = json('src/data/game-config.json');
const { missions } = json('src/data/missions.json');
const content = json('src/data/content-ar.json');
const uiText = json('src/data/ui-ar.json');
const balance = json('src/data/balance.json');

// ---------------------------------------------------------------- config and missions (the rules the server re-scores)
if (!/^[a-z0-9][a-z0-9-]{2,48}$/.test(config.gameId ?? '')) err(`game-config.gameId "${config.gameId}" must be lowercase letters, digits and dashes`);
if (uiText['app.title'] !== config.titleAr) err('ui-ar.json "app.title" differs from game-config.titleAr');
if (config.passThresholdPercent !== 70 || config.recoveryCreditRate !== 0.6) err('pass mark (70) and recovery rate (0.6) are fixed for the series');
const cps = [];
const actionIds = new Map();
missions.forEach((m, i) => {
	if (m.id !== `M${i + 1}`) err(`mission ${m.id}: ids must be M1, M2, … in order`);
	if (!m.titleAr) err(`mission ${m.id}: titleAr is required`);
	const sum = (m.checkpoints ?? []).reduce((n, c) => n + c.weight, 0);
	if (sum !== m.maximumPoints) err(`mission ${m.id}: checkpoint weights add up to ${sum}, maximumPoints is ${m.maximumPoints}`);
	(m.checkpoints ?? []).forEach((c, k) => {
		cps.push({ ...c, missionId: m.id });
		if (c.id !== `${m.id}.C${k + 1}`) err(`checkpoint ${c.id}: expected ${m.id}.C${k + 1}`);
		if (!c.safeActionId || c.unsafeActionIds?.length !== 2) err(`checkpoint ${c.id}: one safeActionId and exactly two unsafeActionIds (three answers, one per lane)`);
		if (!c.feedbackAr || !c.hintAr || !c.labelAr) err(`checkpoint ${c.id}: labelAr, feedbackAr and hintAr are required`);
		for (const a of [c.safeActionId, ...(c.unsafeActionIds ?? [])]) {
			if (!/^[a-z][a-z0-9_]+$/.test(a ?? '')) err(`checkpoint ${c.id}: action id "${a}" must be lowercase snake_case`);
			if (actionIds.has(a)) err(`action id "${a}" is used by ${actionIds.get(a)} and ${c.id}`);
			actionIds.set(a, c.id);
		}
	});
	const spec = balance.stages?.[m.id];
	if (!spec) err(`balance.json: no stage settings for ${m.id}`);
	else if (spec.segments.length !== m.checkpoints.length + 1) err(`balance.json stage ${m.id}: ${spec.segments.length} run segments for ${m.checkpoints.length} gates (need one more segment than gates)`);
	if (!content.stages?.[m.id]?.introAr || !content.stages?.[m.id]?.doneAr) err(`content-ar.json stages.${m.id}: introAr and doneAr are required`);
});
const total = cps.reduce((n, c) => n + c.weight, 0);
if (total !== (config.scoreMaximum ?? 100)) err(`all weights add up to ${total}; the score maximum is ${config.scoreMaximum ?? 100}`);

// ---------------------------------------------------------------- situations
const SKINS = ['message', 'chat', 'alert'];
const letters = s => [...String(s ?? '')].length;
const checkCard = (where, c, needsBody = true) => {
	if (!c || !SKINS.includes(c.skin)) { err(`${where}: card.skin must be one of ${SKINS.join(', ')}`); return; }
	if (c.skin === 'chat' && !c.chatAr?.length) err(`${where}: a chat card needs chatAr`);
	if (c.skin === 'message' && !c.fromAr) err(`${where}: a message card needs fromAr`);
	if (needsBody && c.skin !== 'chat' && !c.bodyAr?.length && !c.segments?.length) err(`${where}: the card has no bodyAr`);
	for (const line of [...(c.bodyAr ?? []), ...(c.chatAr ?? []).map(b => b.textAr), ...(c.segments ?? []).map(s => s.textAr)])
		if (letters(line) > 110) warn(`${where}: a line of ${letters(line)} letters is long for children`);
};
let variantCount = 0;
for (const c of cps) {
	const variants = content.decisions?.[c.id]?.variants ?? [];
	if (variants.length < 2) err(`${c.id}: at least two situations (variants) so a replay differs; found ${variants.length}`);
	const expected = [c.safeActionId, ...c.unsafeActionIds];
	const seen = new Set();
	for (const v of variants) {
		variantCount++;
		const where = `${c.id}/${v.id}`;
		if (!v.id || seen.has(v.id)) err(`${where}: variant ids must be unique inside a checkpoint`);
		seen.add(v.id);
		if (!['choice', 'spot', 'compare', 'order'].includes(v.type)) { err(`${where}: type must be choice, spot, compare or order`); continue; }
		for (const k of ['sceneAr', 'promptAr', 'lensAr', 'recoverAr']) if (!v[k]) err(`${where}: ${k} is required`);
		if (letters(v.sceneAr) > 100) warn(`${where}: the scene line has ${letters(v.sceneAr)} letters (keep it to one short sentence or two)`);
		for (const a of c.unsafeActionIds) {
			const t = v.consequencesAr?.[a];
			if (!t) err(`${where}: consequencesAr.${a} is missing`);
			else if (!t.includes('(محاكاة)')) err(`${where}: the consequence of ${a} must be labelled (محاكاة)`);
		}
		for (const a of Object.keys(v.consequencesAr ?? {})) if (!c.unsafeActionIds.includes(a)) err(`${where}: consequencesAr.${a} is not an unsafe action of ${c.id}`);
		const sameSet = ids => ids.length === expected.length && expected.every(a => ids.includes(a));
		if (v.type === 'choice' || v.type === 'compare') {
			const ids = (v.options ?? []).map(o => o.actionId);
			if (!sameSet(ids)) err(`${where}: options must be exactly ${expected.join(', ')}`);
			for (const o of v.options ?? []) if (letters(o.labelAr) > 70) warn(`${where}: answer "${o.actionId}" has ${letters(o.labelAr)} letters (keep under 70)`);
		}
		if (v.type === 'choice') checkCard(where, v.card);
		if (v.type === 'compare') { if (v.cards?.length !== 2) err(`${where}: compare needs exactly two cards`); else v.cards.forEach((card, i) => checkCard(`${where} card ${i + 1}`, card)); }
		if (v.type === 'spot') {
			checkCard(where, v.card);
			const segs = v.card?.segments ?? [];
			if (!sameSet(segs.filter(s => s.actionId).map(s => s.actionId))) err(`${where}: the tappable segments must be exactly ${expected.join(', ')}`);
			if (segs.every(s => s.actionId)) warn(`${where}: every segment is tappable; plain lines make the message look real`);
		}
		if (v.type === 'order') {
			checkCard(where, v.card);
			if (v.steps?.length !== 3 || new Set(v.steps.map(s => s.id)).size !== 3) err(`${where}: order needs three steps with different ids, written in the right order`);
		}
		if (v.pressureSec !== undefined && !(v.pressureSec >= 5 && v.pressureSec <= 20)) err(`${where}: pressureSec must be 5 to 20`);
	}
}
for (const k of ['introCyberAr', 'vaultStudentAr', 'vaultCyberAr', 'simulatedNoteAr']) if (!content.story?.[k]) err(`content-ar.json story.${k} is missing`);
if (!content.student?.maleNameAr || !content.student?.femaleNameAr) err('content-ar.json student names are missing');

// ---------------------------------------------------------------- interface text: every key the code asks for exists
const sources = [];
const walkDir = dir => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walkDir(p); else if (p.endsWith('.ts')) sources.push(readFileSync(p, 'utf8')); } };
walkDir(at('src'));
const used = new Set();
for (const src of sources) for (const m of src.matchAll(/\bui\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
const families = ['settings.music', 'settings.sfx', 'settings.reduceMotion', 'settings.noShake', 'settings.noTimer', 'settings.touchButtons']
	.flatMap(k => [k, k + '.help']).concat(['menu.male', 'menu.female', 'pickup.shield', 'pickup.lens', 'pickup.hint', 'lesson.ready.lane', 'lesson.ready.jump',
		'lesson.ready.slide', 'lesson.left.touch', 'lesson.left.keys', 'lesson.right.touch', 'lesson.right.keys', 'lesson.jump.touch', 'lesson.jump.keys',
		'lesson.slide.touch', 'lesson.slide.keys', 'lesson.collect', 'badge.phish', 'badge.accounts', 'badge.vault', 'badge.fullShield', 'badge.collector', 'badge.steady',
		'fb.safe', 'fb.recovered', 'fb.run', 'fb.next', 'fb.fix', 'fb.continue', 'result.passed', 'result.needsPractice', 'settings.on', 'settings.off']);
for (const k of [...used, ...families]) if (!uiText[k] && !k.endsWith('.')) err(`ui-ar.json: "${k}" is used by the game but missing`);
for (const k of Object.keys(uiText)) if (!used.has(k) && !families.includes(k)) warn(`ui-ar.json: "${k}" is not used`);

// ---------------------------------------------------------------- assets
for (const f of ['assets/characters.glb', 'assets/ui/Cyber.png', 'assets/ui/Portrait_Male.png', 'assets/ui/Portrait_Female.png', 'fonts/ReadexPro-Regular.ttf', 'fonts/ReadexPro-bold.ttf',
	...['FaceBoy', 'FaceGirl', 'CyberEyes'].flatMap(w => ['Neutral', 'Happy', 'Sad', 'Surprised', 'Blink'].map(e => `assets/faces/${w}_${e}.png`))])
	if (!existsSync(at('public/' + f))) err(`public/${f} is missing`);

// ---------------------------------------------------------------- safety: fictional content only
const texts = [];
const walk = (v, path) => { if (typeof v === 'string') texts.push([path, v]); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`); };
walk(content, 'content'); walk(missions, 'missions'); walk(uiText, 'ui');
const SAFE_TLD = /\.(internal|example|test|invalid|local)$/i;
const latin = s => s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
for (const [path, raw] of texts) {
	const s = latin(raw);
	if (/https?:\/\/|www\./i.test(s)) err(`${path}: real-looking web link "${raw}" (use fictional name.internal addresses)`);
	for (const host of s.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi) ?? [])
		if (/^[a-z]{2,}$/i.test(host.split('.').pop()) && !SAFE_TLD.test(host)) err(`${path}: address "${host}" is not fictional (end it with .internal)`);
	if (/@/.test(s)) err(`${path}: looks like an e-mail address; use a fictional name.internal sender`);
	if (/(\+?\d[\d\s-]{6,}\d)/.test(s.replace(/\d{1,2}:\d{2}/g, ''))) err(`${path}: looks like a phone, card or account number: "${raw}"`);
}

for (const w of warnings) console.log('  warn ', w);
for (const e of errors) console.log('  ERROR', e);
console.log(`validate: ${missions.length} stages, ${cps.length} checkpoints, ${variantCount} situations, ${used.size} interface keys, ${errors.length} errors, ${warnings.length} warnings`);
if (errors.length) process.exit(1);
