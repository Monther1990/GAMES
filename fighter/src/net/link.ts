// The connection between the main player and the supporter. A room on the PHP server (public/server/coop.php) lets the
// two find each other by a short code and exchange connection details; after that the game talks straight from one
// browser to the other (WebRTC data channel). If that direct connection cannot be made in a few seconds, the same room
// carries the game instead: slower, but it works wherever the server can be reached.
//
// A connection that drops (the phone slept, the browser was left for a moment, the page was loaded again) is not the
// end: each side keeps its place in the room, the supporter asks to be connected again, and the game goes on. Only
// leaving on purpose, or staying away too long, ends it.
// Nothing personal is sent: a nickname, the chosen character and game state only.
import { config } from '../game/data';

export type Msg = { t: string } & Record<string, unknown>;
export type LinkMode = 'waiting' | 'connecting' | 'direct' | 'relay' | 'closed';
/** What is kept so that a page loaded again can take its place in the room back. */
export interface SavedLink { room: string; token: string; role: 'host' | 'guest' }
type Coop = { stunUrls?: string[]; directTimeoutMs?: number };
const settings: Coop = (config as unknown as { coop?: Coop }).coop ?? {};
/** How long the supporter keeps trying to come back before giving up. */
const GIVE_UP_MS = 75000;

export class Link {
	mode: LinkMode = 'waiting';
	/** A game message from the other player. */
	onMessage: (m: Msg) => void = () => {};
	/** The other player arrived (true) or is not there (false). `forGood`: they left, or the room is closed; otherwise
	 *  the connection only dropped and is being made again. */
	onPeer: (present: boolean, forGood: boolean) => void = () => {};
	onMode: (mode: LinkMode) => void = () => {};
	private pc: RTCPeerConnection | null = null;
	private dc: RTCDataChannel | null = null;
	private outbox: Msg[] = [];
	private timer = 0; private fallback = 0; private busy = false; private misses = 0;
	/** When the connection dropped (0: it is fine), when the supporter last asked to be connected again, and whether
	 *  the other side has gone quiet while the room carries the game. */
	private lostAt = 0; private askedAt = 0; private quiet = false;

	private constructor(private api: string, readonly role: 'host' | 'guest', readonly room: string, private token: string) {
		this.loop();
	}
	static async create(api: string): Promise<Link> {
		const r = await call(api, 'create');
		return new Link(api, 'host', r.room as string, r.token as string);
	}
	static async join(api: string, room: string): Promise<Link> {
		const code = room.trim().toUpperCase();
		const r = await call(api, 'join', { room: code });
		const link = new Link(api, 'guest', code, r.token as string);
		link.setMode('connecting');
		return link;
	}
	/** Takes a place in a room back after the page was loaded again. If the room is gone, onPeer(false, true) says so. */
	static resume(api: string, s: SavedLink): Link {
		const link = new Link(api, s.role, s.room, s.token);
		if (s.role === 'guest') { link.mode = 'connecting'; link.lostAt = Date.now(); }
		return link;
	}
	get saved(): SavedLink { return { room: this.room, token: this.token, role: this.role }; }
	/** True when game messages can be exchanged (directly or through the room). */
	get ready() { return (this.mode === 'direct' || this.mode === 'relay') && !this.quiet; }

	/** Sends a game message. Over the room it is batched; `lossy` messages (state that the next one replaces) are then
	 *  thinned so the queue never grows. */
	send(m: Msg, lossy = false) {
		if (this.mode === 'direct' && this.dc?.readyState === 'open') { try { this.dc.send(JSON.stringify(m)); } catch { /* the channel is closing */ } return; }
		if (this.mode !== 'relay') return;
		if (lossy) { const i = this.outbox.findIndex(o => o.t === m.t); if (i >= 0) { this.outbox[i] = m; return; } }
		this.outbox.push(m);
	}
	/** Ends the connection. `leave` tells the room (the supporter's place is freed; the main player's room is closed). */
	close(leave = true) {
		if (this.mode === 'closed') return;
		this.teardown();
		this.setMode('closed');
		clearTimeout(this.timer);
		if (leave) void call(this.api, 'leave', { room: this.room, token: this.token }, undefined, 'POST', true).catch(() => {});   // keepalive: it still goes out while the page is closing
	}

	private setMode(m: LinkMode) { if (this.mode === m) return; this.mode = m; this.onMode(m); }
	private signal(m: Msg) { void call(this.api, 'send', { room: this.room, token: this.token }, { msgs: [m] }).catch(() => {}); }
	private teardown() {
		const dc = this.dc, pc = this.pc;
		this.dc = null; this.pc = null; this.outbox = [];
		clearTimeout(this.fallback);
		try { dc?.close(); pc?.close(); } catch { /* already closed */ }
	}
	/** The connection dropped without anyone leaving: it is made again as soon as both are back. */
	private dropped() {
		if (this.mode === 'closed' || this.mode === 'waiting') return;
		this.teardown();
		this.lostAt = Date.now(); this.askedAt = 0; this.quiet = false;
		this.setMode('connecting');
		this.onPeer(false, false);
	}
	/** It is over for good: the other left, the room was closed, or coming back took too long. */
	private gone() {
		if (this.mode === 'closed') return;
		this.close(false);
		this.onPeer(false, true);
	}

	// ------------------------------------------------------------------ the room: polling, and carrying the game when it must
	private loop() {
		if (this.mode === 'closed') return;
		const wait = this.mode === 'relay' ? 110 : this.mode === 'direct' ? 2500 : 450;
		this.timer = window.setTimeout(() => void this.poll().finally(() => this.loop()), wait);
	}
	private async poll() {
		if (this.busy) return;
		this.busy = true;
		try {
			const now = Date.now();
			if (this.mode === 'relay' && this.outbox.length) { const msgs = this.outbox.splice(0); await call(this.api, 'send', { room: this.room, token: this.token }, { msgs }); }
			// the supporter asks the main player to connect again, until an offer comes
			if (this.role === 'guest' && this.lostAt && this.mode === 'connecting' && !this.pc && now - this.askedAt > 2500) { this.askedAt = now; await call(this.api, 'send', { room: this.room, token: this.token }, { msgs: [{ t: 'again' }] }); }
			const r = await call(this.api, 'poll', { room: this.room, token: this.token }, undefined, 'GET');
			this.misses = 0;
			for (const m of (r.msgs as Msg[]) ?? []) this.fromRoom(m);
			if (this.mode === 'relay') {                                             // through the room there is no channel to close: silence is the sign
				if (!this.quiet && r.peer === false) { this.quiet = true; this.lostAt = now; this.onPeer(false, false); }
				else if (this.quiet && r.peer === true) { this.quiet = false; this.lostAt = 0; this.onMode(this.mode); }
			}
			if (this.role === 'guest' && this.lostAt && now - this.lostAt > GIVE_UP_MS) this.gone();
		} catch (e) {
			const why = String((e as Error).message);
			if (why === 'no_room' || why === 'bad_token') this.gone();                // the room is closed, or the place was given to another
			else if (++this.misses > 60 && this.mode !== 'direct') this.gone();       // the server cannot be reached any more
		} finally { this.busy = false; }
	}
	private fromRoom(m: Msg) {
		if (this.mode === 'closed') return;
		if (m.t === 'joined' || m.t === 'again') {                                 // a supporter arrived, or the same one asks to be connected again
			if (this.role !== 'host') return;
			const fresh = m.t === 'joined';
			this.teardown();
			this.lostAt = 0; this.quiet = false;
			this.setMode('connecting');
			if (fresh) this.onPeer(true, false);
			void this.startDirect();
			return;
		}
		if (m.t === 'left') {                                                      // the supporter left on purpose: the room stays open
			this.teardown();
			this.lostAt = 0; this.quiet = false;
			this.setMode('waiting');
			this.onPeer(false, true);
			return;
		}
		if (m.t === 'rtc') { void this.onSignal(m); return; }
		if (m.t === 'relay') { if (this.mode !== 'direct') { this.lostAt = 0; this.setMode('relay'); } return; }
		if (this.mode === 'relay') this.onMessage(m);
	}

	// ------------------------------------------------------------------ the direct connection
	private peerConnection() {
		const pc = new RTCPeerConnection({ iceServers: (settings.stunUrls ?? []).length ? [{ urls: settings.stunUrls! }] : [] });
		pc.onicecandidate = e => { if (e.candidate && this.pc === pc) this.signal({ t: 'rtc', ice: e.candidate.toJSON() }); };
		pc.onconnectionstatechange = () => {
			if (this.pc !== pc || this.mode !== 'direct') return;
			if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropped();
			// a short break often mends itself: only one that lasts is treated as a drop
			else if (pc.connectionState === 'disconnected') window.setTimeout(() => { if (this.pc === pc && this.mode === 'direct' && pc.connectionState !== 'connected') this.dropped(); }, 4000);
		};
		this.pc = pc;
		// if the browsers cannot reach each other directly, the room carries the game
		this.fallback = window.setTimeout(() => { if (this.mode === 'connecting' && this.pc === pc) { this.signal({ t: 'relay' }); this.lostAt = 0; this.setMode('relay'); } }, settings.directTimeoutMs ?? 6000);
		return pc;
	}
	private wire(dc: RTCDataChannel) {
		this.dc = dc;
		dc.onopen = () => { if (this.dc !== dc) return; clearTimeout(this.fallback); this.outbox = []; this.lostAt = 0; this.setMode('direct'); if (this.role === 'guest') this.onPeer(true, false); };
		dc.onmessage = e => { if (this.dc !== dc) return; try { this.onMessage(JSON.parse(e.data as string) as Msg); } catch { /* not ours */ } };
		dc.onclose = () => { if (this.mode === 'direct' && this.dc === dc) this.dropped(); };
	}
	private async startDirect() {
		if (typeof RTCPeerConnection === 'undefined') { this.signal({ t: 'relay' }); this.setMode('relay'); return; }
		try {
			const pc = this.peerConnection();
			this.wire(pc.createDataChannel('game', { ordered: true }));
			await pc.setLocalDescription(await pc.createOffer());
			this.signal({ t: 'rtc', sdp: pc.localDescription!.toJSON() });
		} catch { this.signal({ t: 'relay' }); this.setMode('relay'); }
	}
	private async onSignal(m: Msg) {
		try {
			if (m.sdp) {
				const sdp = m.sdp as RTCSessionDescriptionInit;
				if (sdp.type === 'offer') {
					this.teardown();                                                     // a new offer replaces whatever was there
					if (this.mode !== 'connecting') this.setMode('connecting');
					const pc = this.peerConnection();
					pc.ondatachannel = e => { if (this.pc === pc) this.wire(e.channel); };
					await pc.setRemoteDescription(sdp);
					await pc.setLocalDescription(await pc.createAnswer());
					this.signal({ t: 'rtc', sdp: pc.localDescription!.toJSON() });
				} else await this.pc?.setRemoteDescription(sdp);
			} else if (m.ice) await this.pc?.addIceCandidate(m.ice as RTCIceCandidateInit);
		} catch { /* the fallback timer takes over */ }
	}
}

async function call(api: string, action: string, query: Record<string, string> = {}, body?: unknown, method = 'POST', keepalive = false): Promise<Record<string, unknown>> {
	const url = api + '?' + new URLSearchParams({ a: action, ...query }).toString();
	const res = await fetch(url, { method, cache: 'no-store', keepalive, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
	const data = await res.json().catch(() => ({ error: 'bad_answer' })) as Record<string, unknown>;
	if (!res.ok || data.error) throw new Error(String(data.error ?? res.status));
	return data;
}
