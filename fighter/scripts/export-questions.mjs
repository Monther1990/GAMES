// Writes QUESTIONS_AR.md: every question as the child reads it (the assessed ones after each boss, then the quick ones
// of the Cyber box), so the wording can be reviewed without playing. Regenerate after editing: npm run questions
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL('../' + p, import.meta.url));
const json = p => JSON.parse(readFileSync(at(p), 'utf8'));
const { missions } = json('src/data/missions.json');
const content = json('src/data/content-ar.json');
const quick = json('src/data/quick-ar.json');
const eco = json('src/data/economy.json');

const out = ['# درع السيبر: كل الأسئلة كما يقرؤها الطفل', '',
	'ملف مولَّد من `src/data/content-ar.json` و`src/data/missions.json` و`src/data/quick-ar.json` (`npm run questions`). عدّل النص هناك لا هنا.',
	'العلامة ✅ هي الإجابة الآمنة. ترتيب الإجابات يتغير في كل جولة.', '',
	'## أولًا: أسئلة التقييم (ثلاثة بعد كل زعيم)', ''];
missions.forEach((m, i) => {
	out.push(`### المرحلة ${i + 1}: ${m.titleAr} · ${eco.stages[i].topicAr}`, '');
	m.checkpoints.forEach((cp, k) => {
		out.push(`#### ${cp.id} · ${cp.labelAr} (${cp.weight} نقاط، حزمة ${eco.stages[i].questionRewards[k]} ريالًا)`, '');
		content.decisions[cp.id].variants.forEach((v, n) => {
			out.push(`**الموقف ${n === 0 ? 'أ' : 'ب'}:** ${v.sceneAr}`, '');
			if (v.message) out.push(`> من: ${v.message.fromAr}  `, `> ${v.message.textAr}`, '');
			out.push(`السؤال: **${v.promptAr}**`, '');
			for (const o of v.options) out.push(`- ${o.actionId === cp.safeActionId ? '✅' : '❌'} ${o.labelAr}`);
			out.push('', `عند الصواب: «${v.praiseAr}». الشرح: ${v.explainAr}`, '');
		});
		out.push(`القاعدة: ${cp.feedbackAr}`, '');
	});
});
out.push('## ثانيًا: أسئلة صندوق سايبر السريعة (تدريبية، لا تدخل في التقييم)', '',
	`لكل سؤال ${quick.seconds} ثانية. الإجابة الصحيحة تعطي قوة خاصة للطوارئ.`, '');
eco.stages.forEach((s, i) => {
	out.push(`### المرحلة ${i + 1}: ${s.nameAr}`, '');
	for (const q of quick.questions.filter(x => x.stage === i)) {
		out.push(`**${q.qAr}**`, '');
		q.options.forEach((o, k) => out.push(`- ${k === 0 ? '✅' : '❌'} ${o}`));
		out.push('', `السبب: ${q.whyAr}`, '');
	}
});
writeFileSync(at('QUESTIONS_AR.md'), out.join('\n') + '\n');
console.log(`QUESTIONS_AR.md: ${missions.reduce((n, m) => n + m.checkpoints.length, 0)} assessed questions, ${quick.questions.length} box questions`);
