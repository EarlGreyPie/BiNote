import { add, cmp, type Rat } from "./rat.js";
import type { Note } from "./model.js";

/**
 * 기타 타브 배정. 같은 시각에 시작하는 음을 한 묶음(화음)으로 보고, 묶음마다 가능한
 * (줄, 프렛) 배치 중 손 위치 이동이 가장 적은 것을 고른다(비터비).
 */
export interface TabTuning {
  /** 1번 줄(가장 높은 줄)부터 개방현 MIDI 번호 */
  readonly strings: readonly number[];
  readonly capo: number;
  readonly maxFret: number;
}

export const STANDARD_TUNING: TabTuning = { strings: [64, 59, 55, 50, 45, 40], capo: 0, maxFret: 20 };

export interface TabPosition {
  /** 1부터. 1번 줄이 가장 높다 */
  readonly string: number;
  /** 카포 기준 프렛 (카포 위치 = 0) */
  readonly fret: number;
}

export interface TabEvent {
  readonly start: Rat;
  readonly notes: readonly { readonly note: Note; readonly at?: TabPosition }[];
}

/** 손가락이 한 번에 벌릴 수 있는 프렛 폭. 넘으면 비용을 크게 준다 */
const COMFORT_SPAN = 4;
/** 한 묶음에서 살펴볼 배치 수 상한 (6음 화음에서도 계산이 커지지 않게) */
const MAX_CANDIDATES = 400;
/** 다음 묶음과 이어 볼 후보 수. 묶음 안 비용이 낮은 것부터 남긴다 */
const KEEP = 40;

interface Candidate {
  readonly positions: (TabPosition | undefined)[];
  /** 손 위치(누르는 프렛 평균). 개방현만이면 undefined */
  readonly hand: number | undefined;
  readonly cost: number;
}

function options(pitch: number, tuning: TabTuning): TabPosition[] {
  const out: TabPosition[] = [];
  tuning.strings.forEach((open, i) => {
    const fret = pitch - open - tuning.capo;
    if (fret >= 0 && fret <= tuning.maxFret) out.push({ string: i + 1, fret });
  });
  return out;
}

/** 묶음 하나의 배치 후보. 칠 수 없는 음은 빼고(undefined) 나머지를 배치한다 */
function candidates(pitches: readonly number[], tuning: TabTuning, prefer: readonly (number | undefined)[] = []): Candidate[] {
  // 사용자가 고른 줄이 있으면 그 줄을 먼저 본다 (후보 수 제한에 걸려 빠지지 않게)
  const opts = pitches.map((p, i) => {
    const list = options(p, tuning);
    const want = prefer[i];
    return want === undefined ? list : [...list.filter((o) => o.string === want), ...list.filter((o) => o.string !== want)];
  });
  const out: Candidate[] = [];
  const chosen: (TabPosition | undefined)[] = [];
  const used = new Set<number>();

  const finish = () => {
    const fretted = chosen.filter((c): c is TabPosition => !!c && c.fret > 0).map((c) => c.fret);
    const missing = chosen.filter((c) => !c).length;
    const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
    const hand = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : undefined;
    const astray = chosen.filter((c, i) => prefer[i] !== undefined && c?.string !== prefer[i]).length;
    const cost =
      missing * 1000 + Math.max(0, span - COMFORT_SPAN) * 50 + span * 2 + (hand ?? 0) * 0.3 + astray * PREFER_PENALTY;
    out.push({ positions: [...chosen], hand, cost });
  };

  const walk = (i: number) => {
    if (out.length >= MAX_CANDIDATES) return;
    if (i === pitches.length) return finish();
    let placed = false;
    for (const o of opts[i]!) {
      if (used.has(o.string)) continue;
      placed = true;
      used.add(o.string);
      chosen.push(o);
      walk(i + 1);
      chosen.pop();
      used.delete(o.string);
    }
    // 둘 곳이 없으면 그 음은 칠 수 없는 음으로 둔다
    if (!placed) {
      chosen.push(undefined);
      walk(i + 1);
      chosen.pop();
    }
  };
  walk(0);
  out.sort((a, b) => a.cost - b.cost);
  out.length = Math.min(out.length, KEEP);
  return out.length ? out : [{ positions: pitches.map(() => undefined), hand: undefined, cost: pitches.length * 1000 }];
}

interface Held {
  readonly id: string;
  readonly string: number;
  readonly end: Rat;
}

/** 슬라이드(다른 음으로 &)를 다른 줄로 옮기는 비용. 같은 줄 위에서만 손으로 미끄러질 수 있다 */
const SLIDE_STRING_PENALTY = 150;

/** 아직 울리는 음의 줄을 다시 쓰는 비용. 칠 수 없는 음(1000)보다는 작게 둔다 */
const HELD_STRING_PENALTY = 500;

/** 손은 프렛 네 칸 정도를 그대로 덮으므로, 그 안의 이동은 거의 공짜로 본다 */
function move(from: number | undefined, to: number | undefined): number {
  if (from === undefined || to === undefined) return 0;
  const d = Math.abs(from - to);
  return Math.max(0, d - 2) * 4 + d * 0.5;
}

/** 사용자가 고른 줄을 벗어나는 비용. 칠 수 없는 음(1000)보다 작고 손 이동보다는 크다 */
const PREFER_PENALTY = 200;

/**
 * 여러 트랙의 음을 모아 타브로 배정한다. prefer는 음 id → 사용자가 타브에서 고른 줄(1부터). 없으면 음에 적힌 줄(Note.tabString).
 * 고른 줄은 칠 수 있으면 지키고, 다른 음과 부딪히면 그때만 옮긴다.
 * slides는 슬라이드로 닿는 음 id → 출발 음 id. 되도록 출발 음과 같은 줄에 놓는다
 */
export function assignTab(
  notes: readonly Note[],
  tuning: TabTuning = STANDARD_TUNING,
  prefer: ReadonlyMap<string, number> = new Map(),
  slides: ReadonlyMap<string, string> = new Map(),
): TabEvent[] {
  const groups: { start: Rat; notes: Note[] }[] = [];
  for (const n of [...notes].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch)) {
    const last = groups[groups.length - 1];
    if (last && cmp(last.start, n.start) === 0) last.notes.push(n);
    else groups.push({ start: n.start, notes: [n] });
  }
  if (groups.length === 0) return [];

  const layers = groups.map((g) => candidates(g.notes.map((n) => n.pitch), tuning, g.notes.map((n) => prefer.get(n.id) ?? n.tabString)));
  // 비터비: 묶음마다 후보별 (누적 비용, 이전 후보)
  let costs = layers[0]!.map((c) => c.cost);
  /** 후보마다 그 경로에서 아직 울릴 수 있는 줄과 끝나는 때. 끝난 음은 묶음을 넘어갈 때 버린다 */
  const ringing = (k: number, c: Candidate, inherited: readonly Held[]): Held[] => [
    ...inherited,
    ...groups[k]!.notes.flatMap((n, i) => {
      const at = c.positions[i];
      return at ? [{ id: n.id, string: at.string, end: add(n.start, n.dur) }] : [];
    }),
  ];
  let active = layers[0]!.map((c) => ringing(0, c, []));
  const back: number[][] = [];
  for (let k = 1; k < layers.length; k++) {
    const prev = layers[k - 1]!;
    const next: number[] = [];
    const from: number[] = [];
    // 앞 묶음에서 아직 울리는 음의 줄을 다시 쓰면 그 음이 끊긴다 (손으로 동시에 누를 수 없음).
    // 이전 후보마다 한 번만 거른다 (오래 누르는 음도 경로 상태로 따라온다)
    const start = groups[k]!.start;
    const stillHeld = active.map((list) => list.filter((h) => cmp(h.end, start) > 0));
    const heldSets = stillHeld.map((list) => new Set(list.map((h) => h.string)));
    // 이 묶음에 슬라이드로 닿는 음과 그 출발 음 (출발 음은 이 묶음 시작에 끝나므로 걸러지기 전 목록에서 찾는다)
    const targets = groups[k]!.notes.map((n) => slides.get(n.id));
    const sourceStrings = targets.some((x) => x !== undefined)
      ? active.map((list) => new Map(list.map((h) => [h.id, h.string])))
      : undefined;
    for (const c of layers[k]!) {
      let best = Infinity;
      let arg = 0;
      prev.forEach((p, j) => {
        const held = heldSets[j]!;
        const clash = c.positions.filter((at) => at && held.has(at.string)).length;
        let astray = 0;
        if (sourceStrings) {
          targets.forEach((from, i) => {
            const want = from !== undefined ? sourceStrings[j]!.get(from) : undefined;
            if (want !== undefined && c.positions[i] && c.positions[i]!.string !== want) astray++;
          });
        }
        const total = costs[j]! + move(p.hand, c.hand) + clash * HELD_STRING_PENALTY + astray * SLIDE_STRING_PENALTY;
        if (total < best) {
          best = total;
          arg = j;
        }
      });
      next.push(best + c.cost);
      from.push(arg);
    }
    active = layers[k]!.map((c, i) => ringing(k, c, stillHeld[from[i]!]!));
    costs = next;
    back.push(from);
  }

  let pick = costs.indexOf(Math.min(...costs));
  const picks: number[] = new Array(layers.length);
  for (let k = layers.length - 1; k >= 0; k--) {
    picks[k] = pick;
    if (k > 0) pick = back[k - 1]![pick]!;
  }

  return groups.map((g, k) => {
    const chosen = layers[k]![picks[k]!]!;
    return {
      start: g.start,
      notes: g.notes.map((note, i) => {
        const at = chosen.positions[i];
        return at ? { note, at } : { note };
      }),
    };
  });
}

/**
 * MML 글을 다시 읽어 음을 바꿔 끼울 때, 옛 음에 적힌 타브 줄(tabString)을 새 음으로 옮긴다.
 * 글에는 줄 정보가 없어 그대로 두면 다시 읽은 음이 줄을 잃는다. 다시 쓰면 음이 합쳐지거나 나뉘므로 순서가 아니라
 * 시간과 높이로 맞춘다: 새 음의 시작이 옛 음이 울리는 동안 안에 있고 높이가 같으면 그 줄을 받는다.
 * 한 트랙은 한 번에 한 음이라 둘 다 시작 순으로 훑는다
 */
export function carryTabStrings(old: readonly Note[], next: readonly Note[]): Note[] {
  if (!old.some((n) => n.tabString !== undefined)) return [...next];
  const from = [...old].sort((a, b) => cmp(a.start, b.start));
  const order = next.map((_, i) => i).sort((a, b) => cmp(next[a]!.start, next[b]!.start));
  const out = [...next];
  let j = 0;
  for (const i of order) {
    const n = next[i]!;
    while (j < from.length && cmp(add(from[j]!.start, from[j]!.dur), n.start) <= 0) j++;
    // 같은 자리에 시작하는 음이 여럿이면(겹친 음) 높이가 같은 것을 찾는다
    for (let k = j; k < from.length && cmp(from[k]!.start, n.start) <= 0; k++) {
      const o = from[k]!;
      if (o.pitch !== n.pitch || cmp(add(o.start, o.dur), n.start) <= 0) continue;
      if (o.tabString !== undefined && n.tabString === undefined) out[i] = { ...n, tabString: o.tabString };
      break;
    }
  }
  return out;
}
