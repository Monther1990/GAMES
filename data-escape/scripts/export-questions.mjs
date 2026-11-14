// Writes QUESTIONS_AR.md: every situation as the child reads it (scene, message, question, answers, feedback), so the
// wording can be reviewed without playing all 18. Regenerate after editing the content: npm run questions
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL('../' + p, import.meta.url));
const json = p => JSON.parse(readFileSync(at(p), 'utf8'));
const { missions } = json('src/data/missions.json');
const content = json('src/data/content-ar.json');
const TYPES = { choice: 'اختيار التصرف', spot: 'تحديد السطر', compare: 'مقارنة رسالتين', order: 'ترتيب الخطوات' };

const cardText = c => {
	const lines = [];
	const from = [c.fromAr ?? c.appAr, c.fromAddress].filter(Boolean).join(' · ');
	if (c.titleAr) lines.push(`**${c.titleAr}**`);
	if (from) lines.push(`من: ${from}`);
	for (const b of c.bodyAr ?? []) lines.push(b);
	for (const s of c.segments ?? []) lines.push(s.textAr);
	for (const b of c.chatAr ?? []) lines.push(`${b.from === 'me' ? 'أنت' : c.fromAr}: ${b.textAr}`);
	for (const r of c.rowsAr ?? []) lines.push(r);
	if (c.linkAr) lines.push(`الرابط: ${c.linkAr}`);
	if (c.buttonsAr?.length) lines.push(`الأزرار: ${c.buttonsAr.join(' / ')}`);
	return lines.map(l => `> ${l}`).join('  \n');
};

const out = ['# هروب البيانات: كل المواقف كما يقرؤها الطفل', '',
	'ملف مولَّد من `src/data/content-ar.json` و`src/data/missions.json` (`npm run questions`). عدّل النص هناك لا هنا.',
	'العلامة ✅ هي الإجابة الآمنة. ترتيب الإجابات يتغير في كل جولة.', ''];
for (const m of missions) {
	out.push(`## ${m.titleAr}`, '');
	for (const cp of m.checkpoints) {
		out.push(`### ${cp.id} · ${cp.labelAr} (${cp.weight} نقطة)`, '');
		content.decisions[cp.id].variants.forEach((v, i) => {
			out.push(`**الموقف ${i === 0 ? 'أ' : 'ب'}** · ${TYPES[v.type]}`, '', `الموقف: ${v.sceneAr}`, '');
			for (const c of v.cards ?? [v.card]) out.push(cardText(c), '');
			out.push(`السؤال: **${v.promptAr}**`, '');
			if (v.type === 'order') v.steps.forEach((s, k) => out.push(`${k + 1}. ${s.textAr}`));
			else {
				const options = v.type === 'spot' ? v.card.segments.filter(s => s.actionId).map(s => ({ actionId: s.actionId, labelAr: s.textAr })) : v.options;
				for (const o of options) out.push(`- ${o.actionId === cp.safeActionId ? '✅' : '❌'} ${o.labelAr}${v.consequencesAr[o.actionId] ? `  \n  ← ${v.consequencesAr[o.actionId]}` : ''}`);
			}
			if (v.type === 'order') for (const [a, t] of Object.entries(v.consequencesAr)) out.push('', `❌ ${a === cp.unsafeActionIds[0] ? 'إذا بدأ بخطوة خاطئة' : 'إذا أخطأ في الخطوة الثانية أو الثالثة'}: ${t}`);
			out.push('', `العدسة: ${v.lensAr}`, '', `بعد التصحيح: ${v.recoverAr}`, '');
		});
		out.push(`القاعدة التي تظهر بعد كل إجابة: ${cp.feedbackAr}`, '', `التلميح: ${cp.hintAr}`, '', '---', '');
	}
}
writeFileSync(at('QUESTIONS_AR.md'), out.join('\n'));
console.log(`QUESTIONS_AR.md: ${missions.flatMap(x => x.checkpoints).length} decisions, ${Object.values(content.decisions).flatMap(d => d.variants).length} situations`);
