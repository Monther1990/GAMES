// Entry point. Two ways to use the game on the platform:
//  1) iframe (recommended): host the built folder and point an <iframe> at index.html?parentOrigin=<platform origin>.
//     Progress and the finished result are posted to that exact origin only (never "*").
//  2) direct: import { mountGame } and mount it into an element of the page.
import { Game, GameOptions } from './run/game';
import { config } from './game/data';

export interface MountOptions extends Partial<GameOptions> {}

export function mountGame(container: HTMLElement, options: MountOptions = {}) {
	const base = options.base ?? new URL('./', document.baseURI).href;
	const game = new Game(container, { base, onComplete: options.onComplete, onEvent: options.onEvent });
	void game.start();
	if (import.meta.env.DEV) (window as any).__game = game;   // dev-server inspection only
	return { destroy: () => game.dispose() };
}

// Standalone page (index.html): mount into #game and report to the embedding page when one is configured.
const el = document.getElementById('game');
if (el) {
	const params = new URLSearchParams(location.search);
	const parentOrigin = params.get('parentOrigin');
	const toParent = (type: string, data: unknown) => {
		if (parentOrigin && window.parent !== window) window.parent.postMessage({ type, protocolVersion: 1, gameId: config.gameId, data }, parentOrigin);
	};
	mountGame(el, {
		onComplete: payload => toParent('game.completed', payload),
		onEvent: (type, data) => toParent(type, data)
	});
}
