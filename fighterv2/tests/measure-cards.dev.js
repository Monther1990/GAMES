// A dev-server tool, not a unit test: question cards must fit a phone without scrolling.
// In the browser console of `npm run dev`, at a phone size (375x812, 360x640, 320x568) and in each language:
//   (await import('/tests/measure-cards.dev.js')).measure()
// It opens every assessed situation, every box question and every phone call in its fullest states (asked, answered
// wrong with the note, answered right with a prize) and lists each card whose content overflows or leaves the screen.
export async function measure() {
	const g = window.__game, data = await import('/src/game/data.ts'), eco = await import('/src/sim/economy.ts');
	const bad = [], H = innerHeight, W = innerWidth, fits = { fit0: 0, fit1: 0, fit2: 0, fit3: 0, fit4: 0 };
	let worst = -999, situations = 0, boxes = 0, calls = 0;
	const check = (id, state, m, body) => {
		const r = m.getBoundingClientRect(), over = body.scrollHeight - body.clientHeight;
		worst = Math.max(worst, over);
		if (over > 1 || r.bottom > H + 1 || r.top < -1 || r.right > W + 1 || r.left < -1) bad.push({ id, state, over, top: Math.round(r.top), bottom: Math.round(r.bottom) });
	};
	const R = eco.stages[4].questionRewards;
	for (const cp of data.checkpoints) for (const v of data.variantsOf(cp.id)) {
		const unsafe = v.options.find(o => o.actionId !== cp.safeActionId).actionId;
		const open = () => { g.ui.quiz({ index: 2, rewards: R, label: cp.labelAr, variant: v, packs: ['won', 'lost', 'waiting'], options: v.options, onConfirm() {} }); return document.querySelector('.cs-quiz'); };
		let m = open(), body = m.querySelector('.cs-quiz-body');
		check(v.id, 'asked', m, body);
		g.ui.quizResult({ correct: false, picked: unsafe, safeId: cp.safeActionId, amount: 200, praise: v.praiseAr, explain: v.explainAr, rule: cp.feedbackAr, mustFix: true, last: true, onFix() {}, onNext() {} });
		check(v.id, 'wrong', m, body);
		fits[['fit4', 'fit3', 'fit2', 'fit1'].find(c => m.classList.contains(c)) ?? 'fit0']++;
		m = open(); body = m.querySelector('.cs-quiz-body');
		g.ui.quizResult({ correct: true, picked: cp.safeActionId, safeId: cp.safeActionId, amount: 200, praise: v.praiseAr, explain: v.explainAr, rule: cp.feedbackAr, mustFix: false, last: false, onFix() {}, onNext() {} });
		check(v.id, 'right', m, body);
		situations++;
	}
	// the prize with the longest words, so the fullest card is the one measured
	const ids = ['rain', 'falcon', 'mirror', 'mute', 'report', 'guards', 'armor', 'private', 'bolt', 'aware'].filter(id => data.ui('power.' + id) !== 'power.' + id);
	const longest = ids.sort((x, y) => (data.ui('power.' + y) + data.ui('power.' + y + '.desc')).length - (data.ui('power.' + x) + data.ui('power.' + x + '.desc')).length)[0];
	const prize = { id: longest, name: data.ui('power.' + longest), desc: data.ui('power.' + longest + '.desc') };
	for (const q of data.quick.questions) {
		for (const rare of [false, true]) {
			const step = rare ? data.ui('box.step', { n: 1, total: 2 }) : '';
			const open = () => {
				if (q.call) { g.ui.call({ step, rare, from: q.call.fromAr, said: q.call.sayAr, prompt: q.qAr, options: q.options, seconds: 20, onAnswer() {}, onPick() {} }); const m = document.querySelector('.cs-box'); check(q.id, 'ringing', m, m); g.ui.callTalk(8); check(q.id, 'talking', m, m); g.ui.callAsk(); return m; }
				g.ui.box({ title: data.ui(rare ? 'box.rareTitle' : 'box.title'), step, rare, prompt: q.qAr, options: q.options, seconds: 20, onPick() {} });
				return document.querySelector('.cs-box');
			};
			let m = open();
			check(q.id, 'asked', m, m);
			g.ui.boxResult({ picked: 1, right: 0, why: q.whyAr, power: null, note: rare ? data.ui('box.oneMoreWrong') : '', nextLabel: rare ? data.ui('box.nextQuestion') : '', onNext() {} });
			check(q.id, 'wrong', m, m);
			m = open();
			g.ui.boxResult({ picked: 0, right: 0, why: q.whyAr, power: prize, onNext() {} });
			check(q.id, 'won', m, m);
		}
		if (q.call) calls++; else boxes++;
	}
	g.ui.closeLayer();
	return { size: W + 'x' + H, lang: document.documentElement.lang || g.ui.root?.lang, situations, boxes, calls, worstOverflow: worst, fits, prize: longest, badCount: bad.length, bad: bad.slice(0, 30) };
}
