// A dev-server tool, not a unit test: the weapon shop must fit a phone without scrolling, with every button in view.
// In the browser console of `npm run dev`, at a phone size (375x812, 360x640, 320x568) and in each language:
//   (await import('/tests/measure-shop.dev.js')).measure()
// It gives the save plenty of rials (a copy is put back at the end), opens the shop, and for every weapon looks at it
// not owned, owned but not equipped at each level (the state with the most buttons), and equipped.
export async function measure() {
	const g = window.__game, wait = ms => new Promise(r => setTimeout(r, ms));
	const kept = JSON.stringify(g.save), bad = [];
	let worst = -999, looked = 0;
	const bank = g.bank();
	bank.wallet = 999999;
	g.openShop(() => {});
	await wait(50);
	const modal = () => document.querySelector('.cs-shop');
	const check = (id, state) => {
		const m = modal(), r = m.getBoundingClientRect(), over = m.scrollHeight - m.clientHeight;
		const cut = [...m.querySelectorAll('button, .cs-max')].filter(b => { const q = b.getBoundingClientRect(); return q.bottom > innerHeight + 1 || q.top < -1 || q.right > innerWidth + 1 || q.left < -1; }).map(b => b.dataset.a || b.dataset.w || b.className);
		worst = Math.max(worst, over); looked++;
		if (over > 1 || r.bottom > innerHeight + 1 || r.top < -1 || cut.length) bad.push({ id, state, over, top: Math.round(r.top), cut, fit: m.className.replace('cs-modal cs-shop', '').trim() });
	};
	const ids = [...modal().querySelectorAll('[data-w]')].map(b => b.dataset.w);
	const press = async a => { const b = modal().querySelector(`[data-a=${a}]`); if (!b || b.disabled) return false; b.click(); await wait(20); return true; };
	for (const id of ids) {
		modal().querySelector(`[data-w=${id}]`).click(); await wait(20);
		check(id, modal().querySelector('[data-a=buy]') ? 'not owned' : 'first look');
		await press('buy');
		for (let level = 1; level <= 6; level++) {
			check(id, 'owned L' + level + (modal().querySelector('[data-a=equip]') ? ', not equipped' : ', equipped'));
			if (!(await press('upgrade'))) break;
		}
		if (await press('equip')) check(id, 'equipped, top level');
	}
	// with too few rials: the line that says how much is missing is there as well
	g.bank().wallet = 0;
	for (const id of ids) { modal().querySelector(`[data-w=${id}]`).click(); await wait(20); check(id, 'no rials'); }
	Object.assign(g.save, JSON.parse(kept)); g.flushSave?.();
	g.ui.closeLayer();
	return { size: innerWidth + 'x' + innerHeight, lang: g.ui.root?.lang, weapons: ids.length, looked, worstOverflow: worst, badCount: bad.length, bad: bad.slice(0, 14) };
}
