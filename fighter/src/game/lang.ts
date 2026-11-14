// The language of the game: Arabic (the first language of the series) or English. It is decided once, when the page
// loads: `?lang=ar|en` in the address, else what the player chose before, else Arabic. Changing it loads the page again,
// so every text file is read in one language only and nothing has to be redrawn half-way.
// This file touches the browser only when there is one: the money rules that import it also run in Node tests.
export type Lang = 'ar' | 'en';
const KEY = 'cyber-shield:lang';

function read(): Lang {
	try {
		if (typeof location !== 'undefined') {
			const q = new URLSearchParams(location.search).get('lang');
			if (q === 'ar' || q === 'en') { try { localStorage.setItem(KEY, q); } catch { /* not kept */ } return q; }
		}
		if (typeof localStorage !== 'undefined') { const s = localStorage.getItem(KEY); if (s === 'ar' || s === 'en') return s; }
	} catch { /* no storage: Arabic */ }
	return 'ar';
}

export const lang: Lang = read();
export const rtl = lang === 'ar';

/** Keeps the choice and loads the page again in that language. */
export function setLang(next: Lang) {
	try { localStorage.setItem(KEY, next); } catch { /* the address carries it instead */ }
	const u = new URL(location.href);
	u.searchParams.set('lang', next);
	location.replace(u.toString());
}
