// A dev-server tool, not a unit test: how loud is each stage's tune? One tune much louder or quieter than the others
// would be a fault no unit test sees. In the browser console of `npm run dev`:
//   (await import('/tests/measure-tunes.dev.js')).measure()
// Each tune is rendered without being played (an offline audio context), ten seconds in a fight and ten against its
// boss, through the game's own Sound class, and its loudness (RMS, dB) and highest peak are given.
// This measures level only. Whether a tune is pleasant is for ears to judge.
export async function measure(seconds = 10) {
	const { Sound } = await import('/src/core/sound.ts');
	const { TUNES } = await import('/src/core/tunes.ts');
	const rate = 44100, rows = [];
	const render = async (n, mood, hot) => {
		const off = new OfflineAudioContext(1, rate * seconds, rate);
		const real = window.AudioContext;
		window.AudioContext = function () { return off; };
		const s = new Sound();
		try { s.unlock(); } finally { window.AudioContext = real; }
		clearInterval(s.timer);
		s.song(n); s.mood = mood; s.intensity = hot; s.applyMood(0.01);
		const tune = TUNES[n], running = mood !== 'read' && mood !== 'menu';
		const bpm = mood === 'boss' ? tune.boss : running ? tune.bpm + 18 * hot : tune.bpm - 14, sixteenth = 60 / bpm / 4;
		let step = 0;
		for (let t = 0.05; t < seconds - 0.6; t += sixteenth) { s.playStep(tune, step, t, sixteenth, running); step = (step + 1) % 64; }
		const d = (await off.startRendering()).getChannelData(0);
		let sum = 0, peak = 0;
		for (let i = rate; i < d.length - rate / 2; i++) { sum += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
		const db = x => Math.round(200 * Math.log10(Math.max(1e-9, x))) / 10;
		return { rms: db(Math.sqrt(sum / (d.length - rate * 1.5))), peak: db(peak) };
	};
	for (let n = 0; n < TUNES.length; n++) {
		const run = await render(n, 'run', 0.5), boss = await render(n, 'boss', 1), read = await render(n, 'read', 0);
		rows.push({ tune: n + 1, run: run.rms, runPeak: run.peak, boss: boss.rms, bossPeak: boss.peak, read: read.rms });
	}
	const menu = await render(0, 'menu', 0);
	const spread = k => Math.round(10 * (Math.max(...rows.map(r => r[k])) - Math.min(...rows.map(r => r[k])))) / 10;
	return { rows, menu: menu.rms, spreadRun: spread('run'), spreadBoss: spread('boss'), spreadRead: spread('read') };
}
