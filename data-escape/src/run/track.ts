// Track generation (pure: no rendering). A stage is run segments separated by decision gates. Obstacles come in rows
// across the three lanes; every row keeps one guaranteed "path lane" that moves at most one lane per row, so there is
// always a route a child can follow. tests/track.test.mjs replays an autopilot over many seeds to prove it.
import balance from '../data/balance.json';

export type ObstacleKind = 'low' | 'high' | 'block';
export type PickupKind = 'bit' | 'shield' | 'lens' | 'hint';
export type Need = 'none' | 'jump' | 'slide';
export type Lesson = 'lane' | 'jump' | 'slide' | 'collect';

export interface Obstacle { id: number; kind: ObstacleKind; s: number; lane: number; hit: boolean; passed: boolean; soft: boolean }
export interface Pickup { id: number; kind: PickupKind; s: number; lane: number; y: number; taken: boolean; missed: boolean }
export interface Row { s: number; cells: (ObstacleKind | null)[]; pathLane: number; need: Need; lesson?: Lesson }
export interface GateDef { index: number; s: number; stopS: number; checkpointId: string }
export interface StageTrack {
	missionId: string; index: number; start: number; end: number;
	speed: [number, number]; gates: GateDef[]; segmentStarts: number[];
	rows: Row[]; obstacles: Obstacle[]; pickups: Pickup[];
}
export interface StageSpec { speed: number[]; segments: number[]; difficulty: number[]; gapSeconds: number[] }

export const LANES = 3;
export const laneZ = (lane: number) => (lane - 1) * balance.laneWidth;

/** Small seeded generator (mulberry32) so a run can be replayed from its seed. */
export function seededRandom(seed: string): () => number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
	let a = h >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface BuildOptions { missionId: string; index: number; start: number; spec: StageSpec; checkpointIds: string[]; seed: string; lessons: boolean }

/** One stage: run segment, gate, run segment, gate, … final run segment. Distances are global (stages follow each other). */
export function buildStage(o: BuildOptions): StageTrack {
	const rnd = seededRandom(o.seed + '|' + o.missionId);
	const { spec } = o;
	const total = spec.segments.reduce((n, x) => n + x, 0);
	const track: StageTrack = { missionId: o.missionId, index: o.index, start: o.start, end: o.start + total,
		speed: [spec.speed[0], spec.speed[1]], gates: [], segmentStarts: [], rows: [], obstacles: [], pickups: [] };
	let id = o.index * 100000;
	let pathLane = 1;
	let cursor = o.start;
	let powerUps: PickupKind[] = ['shield', 'hint', 'lens', 'shield'];

	spec.segments.forEach((length, seg) => {
		const segStart = cursor, segEnd = cursor + length;
		track.segmentStarts.push(segStart);
		const isLast = seg === spec.segments.length - 1;
		const firstRowAt = segStart + (seg === 0 ? 34 : balance.gateClearAfter);
		const lastRowAt = segEnd - (isLast ? 30 : balance.gateClearBefore);
		const scripted: Lesson[] = o.lessons && seg === 0 ? ['lane', 'jump', 'slide', 'collect'] : [];
		let s = firstRowAt;
		let prevS = segStart + 6;
		let rowInSeg = 0;
		let powerPlaced = false;
		while (s <= lastRowAt) {
			const progress = (s - o.start) / total;
			const speedHere = lerp(spec.speed[0], spec.speed[1], progress);
			const d = lerp(spec.difficulty[0], spec.difficulty[1], progress);
			const lesson = scripted.shift();
			const prevPath = pathLane;
			let row: Row;
			if (lesson) {
				row = lessonRow(lesson, s, pathLane);
				pathLane = row.pathLane;
			} else {
				if (rnd() < 0.55) pathLane = Math.max(0, Math.min(LANES - 1, pathLane + (rnd() < 0.5 ? -1 : 1)));
				row = randomRow(s, pathLane, d, rnd);
			}
			track.rows.push(row);
			row.cells.forEach((kind, lane) => { if (kind) track.obstacles.push({ id: id++, kind, s, lane, hit: false, passed: false, soft: !!lesson }); });
			// Data bits lead along the safe route: on the previous path lane first, then on this row's path lane.
			const from = prevS + 3.2, to = s - 3.2;
			const switchAt = from + Math.min(4.4, Math.max(0, (to - from) * 0.3));
			for (let b = from; b <= to; b += 2.4) {
				if (lesson && lesson !== 'collect' && s - b < 10) break;             // keep the lesson obstacle clear to read
				track.pickups.push({ id: id++, kind: 'bit', s: b, lane: b < switchAt ? prevPath : row.pathLane, y: 0.75, taken: false, missed: false });
			}
			if (row.need === 'jump') for (const [ds, y] of [[-1.5, 1.25], [0, 1.6], [1.5, 1.25]] as const)
				track.pickups.push({ id: id++, kind: 'bit', s: s + ds, lane: row.pathLane, y, taken: false, missed: false });
			if (row.need === 'slide') for (const ds of [-1.2, 0, 1.2])
				track.pickups.push({ id: id++, kind: 'bit', s: s + ds, lane: row.pathLane, y: 0.4, taken: false, missed: false });
			// One helper item per segment, on the safe lane in the middle of a gap.
			if (!powerPlaced && !lesson && rowInSeg >= 2 && powerUps.length && rnd() < 0.55 && to - from > 8) {
				const kind = powerUps.shift()!;
				const at = (switchAt + to) / 2 + 1.2;
				track.pickups = track.pickups.filter(p => !(p.kind === 'bit' && Math.abs(p.s - at) < 1.3 && p.lane === row.pathLane && p.s < s - 2));
				track.pickups.push({ id: id++, kind, s: at, lane: row.pathLane, y: 0.85, taken: false, missed: false });
				powerPlaced = true;
			}
			prevS = s;
			rowInSeg++;
			const gap = lesson ? 2.6 : lerp(spec.gapSeconds[0], spec.gapSeconds[1], progress) * (0.92 + rnd() * 0.22);
			s += Math.max(9, speedHere * gap);
		}
		// A last line of bits into the gate (or the finish).
		for (let b = prevS + 3.2; b <= segEnd - (isLast ? 8 : balance.gateStandoff + 2); b += 2.6)
			track.pickups.push({ id: id++, kind: 'bit', s: b, lane: pathLane, y: 0.75, taken: false, missed: false });
		cursor = segEnd;
		if (!isLast) track.gates.push({ index: seg, s: segEnd, stopS: segEnd - balance.gateStandoff, checkpointId: o.checkpointIds[seg] });
	});
	track.obstacles.sort((a, b) => a.s - b.s);
	track.pickups.sort((a, b) => a.s - b.s);
	return track;
}

/** The four first rows of the first stage teach one move each, with nothing else to read. */
function lessonRow(lesson: Lesson, s: number, pathLane: number): Row {
	switch (lesson) {
		case 'lane': {
			const cells: (ObstacleKind | null)[] = [null, null, null];
			cells[pathLane] = 'block';
			const next = pathLane === 0 ? 1 : pathLane - 1;                         // the lesson asks for a move to the left when possible
			return { s, cells, pathLane: next, need: 'none', lesson };
		}
		case 'jump': return { s, cells: ['low', 'low', 'low'], pathLane, need: 'jump', lesson };
		case 'slide': return { s, cells: ['high', 'high', 'high'], pathLane, need: 'slide', lesson };
		default: return { s, cells: [null, null, null], pathLane, need: 'none', lesson };
	}
}

function randomRow(s: number, pathLane: number, d: number, rnd: () => number): Row {
	const cells: (ObstacleKind | null)[] = [null, null, null];
	const others = [0, 1, 2].filter(l => l !== pathLane);
	const roll = rnd();
	let need: Need = 'none';
	const action = (): ObstacleKind => (rnd() < 0.5 ? 'low' : 'high');
	if (roll < 0.30 - d * 0.18) {
		// one blocker beside the route
		cells[others[Math.floor(rnd() * others.length)]] = rnd() < 0.5 ? 'block' : action();
	} else if (roll < 0.58 - d * 0.14) {
		// both side lanes closed: the route is the only way
		for (const l of others) cells[l] = 'block';
	} else if (roll < 0.80 - d * 0.08) {
		// the route itself needs a jump or a slide; the side lanes are closed or need the same move
		const kind = action();
		cells[pathLane] = kind;
		need = kind === 'low' ? 'jump' : 'slide';
		for (const l of others) cells[l] = rnd() < 0.6 ? 'block' : kind;
	} else if (roll < 0.92) {
		// a full wall of the same move
		const kind = action();
		for (let l = 0; l < LANES; l++) cells[l] = kind;
		need = kind === 'low' ? 'jump' : 'slide';
	} else {
		// mixed: route free, one side needs a move, the other is closed
		cells[others[0]] = rnd() < 0.5 ? 'block' : action();
		cells[others[1]] = rnd() < 0.5 ? 'block' : action();
	}
	return { s, cells, pathLane, need };
}

/** Every stage of one run, laid end to end. */
export function buildRun(seed: string, missions: { id: string; checkpoints: { id: string }[] }[], lessons = true): StageTrack[] {
	const stages = balance.stages as Record<string, StageSpec>;
	let start = 0;
	return missions.map((m, index) => {
		const t = buildStage({ missionId: m.id, index, start, spec: stages[m.id], checkpointIds: m.checkpoints.map(c => c.id), seed, lessons: lessons && index === 0 });
		start = t.end;
		return t;
	});
}
