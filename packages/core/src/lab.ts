import { add, cmp, toFloat, type Rat } from "./rat.js";
import type { Note, NoteLab, Song } from "./model.js";
import { MOBILE_PROFILE, volumeStepMax, type GameProfile } from "./profile.js";

/**
 * 실험실 입력 (설정 → 실험실을 켰을 때만 메뉴가 보인다). 결과는 늘 보통 MML(v·음 높이)이라 게임과 다른 앱은 그대로 읽는다.
 * 앱만 아는 것은 음에 붙이는 표시(Note.lab)뿐이다: 프로젝트 파일(.mme)에만 저장되고, 되돌리기(풀기)와 타브 표시에 쓴다.
 * - 고스트 노트: 주변 보통 음보다 N단계 작은 v. 곡마다 볼륨이 달라 절대 v가 아니라 주변 음 기준이다
 * - 하모닉스: 자연(12프렛 = +12, 7프렛 = +19, 5프렛 = +24 …)·인공(누른 음 +12). 조금 작게 칠 수 있다
 * 결과만 계산하고 곡은 바꾸지 않는다
 */

/**
 * 한 번에 줄일 수 있는 단계 상한 (v 범위 전체). 곡 프로필이 닿지 않는 설정 읽기에서만 쓰고,
 * 창은 volumeStepMax(곡 프로필)를 쓴다
 */
export const LAB_STEP_MAX = volumeStepMax(MOBILE_PROFILE);

/** 자연 하모닉스를 낼 수 있는 프렛 → 개방현보다 높은 반음 수 */
export const NATURAL_HARMONICS: ReadonlyMap<number, number> = new Map([
  [12, 12],
  [7, 19],
  [19, 19],
  [5, 24],
  [24, 24],
]);

export type HarmonicType = "natural" | "artificial";

export interface LabSkipped {
  /** &로 이어 받은 음이라 새로 치지 않음 (게임은 & 뒤의 v를 무시한다) */
  readonly tied: number;
  /** 잠근 트랙 */
  readonly locked: number;
  /** 자연 하모닉스가 나지 않는 프렛이거나 타브 줄을 모름 */
  readonly fret: number;
  /** 높이가 MIDI 범위(0~127) 밖 */
  readonly range: number;
  /** 바꿔도 그대로인 음 */
  readonly same: number;
}

export interface LabResult {
  /** 바뀐 트랙과 그 트랙 음 전체. 바뀐 것이 없으면 빈 목록 */
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 바꾼 음 (&로 같은 높이를 이어 받은 뒷음은 세지 않는다) */
  readonly made: number;
  /** 바꾼 음 id (이어 받은 뒷음 포함. 적용 뒤 고른 음으로 쓴다) */
  readonly ids: readonly string[];
  readonly skipped: LabSkipped;
}

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);
const clampVol = (v: number, profile: GameProfile) => Math.max(profile.volume.min, Math.min(profile.volume.max, v));

/** 고스트 노트 표시가 붙은 음인지 */
export function isGhost(note: Note): boolean {
  return note.lab?.kind === "ghost";
}

/** 시작 순으로 놓은 트랙 음에서 i번째 음이 앞 음에서 &로 이어 받은 음인지 */
function heldAt(sorted: readonly Note[], i: number): boolean {
  const prev = sorted[i - 1];
  return !!prev && prev.tie === "next" && cmp(end(prev), sorted[i]!.start) === 0;
}

/** i번째 음 뒤로 &로 같은 높이를 이어 받는 음들 (이어 울림. 높이가 바뀌면 슬라이드라 거기서 멈춘다) */
function heldTail(sorted: readonly Note[], i: number): Note[] {
  const out: Note[] = [];
  for (let at = i; sorted[at]?.tie === "next"; at++) {
    const next = sorted[at + 1];
    if (!next || cmp(end(sorted[at]!), next.start) !== 0 || next.pitch !== sorted[i]!.pitch) break;
    out.push(next);
  }
  return out;
}

interface Edit {
  readonly trackId: string;
  readonly sorted: readonly Note[];
  readonly index: number;
}

/** 고른 음을 트랙별로 찾는다. 시작 순 */
function editsOf(song: Song, picked: readonly Note[]): Edit[] {
  const ids = new Set(picked.map((n) => n.id));
  const out: Edit[] = [];
  for (const tr of song.tracks) {
    const sorted = [...tr.notes].sort((a, b) => cmp(a.start, b.start));
    sorted.forEach((n, index) => {
      if (ids.has(n.id)) out.push({ trackId: tr.id, sorted, index });
    });
  }
  return out;
}

/** 바뀐 음(id → 음)을 트랙에 넣어 결과로 */
function collect(song: Song, changed: ReadonlyMap<string, ReadonlyMap<string, Note>>, made: number, skipped: LabSkipped): LabResult {
  const changes = song.tracks
    .filter((t) => changed.has(t.id))
    .map((t) => {
      const m = changed.get(t.id)!;
      return { trackId: t.id, notes: t.notes.map((n) => m.get(n.id) ?? n) };
    });
  const ids = [...changed.values()].flatMap((m) => [...m.keys()]);
  return { changes, made, ids, skipped };
}

export interface GhostOptions {
  /** 주변 보통 음보다 몇 단계 작게 (1 이상) */
  readonly steps: number;
  readonly locked?: ReadonlySet<string>;
}

/**
 * 고스트 노트의 기준 v: 같은 트랙에서 가장 가까운 보통 음(고른 음·고스트 노트가 아닌 음, &로 이어 받은 음 제외)의 v.
 * 앞뒤가 같은 거리면 앞 음. 트랙에 보통 음이 없으면 그 음 자신의 v
 */
export function ghostReference(sorted: readonly Note[], index: number, picked: ReadonlySet<string>): number {
  const self = sorted[index]!;
  const normal = (i: number) => {
    const n = sorted[i]!;
    return !picked.has(n.id) && !isGhost(n) && !heldAt(sorted, i);
  };
  let prev: Note | undefined;
  for (let i = index - 1; i >= 0; i--) {
    if (normal(i)) {
      prev = sorted[i];
      break;
    }
  }
  let next: Note | undefined;
  for (let i = index + 1; i < sorted.length; i++) {
    if (normal(i)) {
      next = sorted[i];
      break;
    }
  }
  if (!prev && !next) return self.vol;
  if (!next) return prev!.vol;
  if (!prev) return next.vol;
  // 거리: 앞 음은 끝에서, 뒤 음은 시작에서 이 음까지
  const before = Math.max(0, toFloat(self.start) - toFloat(end(prev)));
  const after = Math.max(0, toFloat(next.start) - toFloat(end(self)));
  return after < before ? next.vol : prev.vol;
}

/** 고른 음을 고스트 노트로: 주변 보통 음보다 steps단계 작은 v. 같은 높이로 &로 이어 받은 뒷음도 같은 v */
export function planGhost(song: Song, picked: readonly Note[], options: GhostOptions, profile: GameProfile): LabResult {
  const skipped = { tied: 0, locked: 0, fret: 0, range: 0, same: 0 };
  const pickedIds = new Set(picked.map((n) => n.id));
  const changed = new Map<string, Map<string, Note>>();
  let made = 0;
  for (const e of editsOf(song, picked)) {
    if (options.locked?.has(e.trackId)) {
      skipped.locked++;
      continue;
    }
    if (heldAt(e.sorted, e.index)) {
      skipped.tied++;
      continue;
    }
    const n = e.sorted[e.index]!;
    const vol = clampVol(ghostReference(e.sorted, e.index, pickedIds) - Math.max(1, options.steps), profile);
    if (vol === n.vol && n.lab) {
      skipped.same++;
      continue;
    }
    const m = changed.get(e.trackId) ?? new Map<string, Note>();
    changed.set(e.trackId, m);
    // 처음 고스트로 만들 때의 v를 기억한다 (풀기로 되돌린다). 이미 고스트면 처음 값 그대로.
    // 하모닉스인 음은 하모닉스 표시를 그대로 두고 v만 바꾼다 (풀면 높이와 처음 v로 돌아간다)
    const lab: NoteLab = n.lab ?? { kind: "ghost", vol: n.vol };
    m.set(n.id, { ...n, vol, lab });
    for (const tail of heldTail(e.sorted, e.index)) m.set(tail.id, { ...tail, vol, lab });
    made++;
  }
  return collect(song, changed, made, skipped);
}

export interface HarmonicOptions {
  readonly type: HarmonicType;
  /** 하모닉스를 몇 단계 작게 (0이면 그대로) */
  readonly quieter: number;
  readonly locked?: ReadonlySet<string>;
  /** 타브에서 그 음이 놓인 줄·프렛과 그 줄 개방현 높이(카포 포함). 자연 하모닉스에 꼭 필요하다 */
  readonly positionOf?: (note: Note) => { readonly string: number; readonly fret: number; readonly open: number } | undefined;
}

/**
 * 고른 음을 하모닉스로. 자연: 그 음의 프렛(12·7·5·19·24)에서 나는 하모닉스 높이로 바꾼다 (줄은 그대로).
 * 인공: 누른 음보다 한 옥타브 위. 둘 다 quieter단계 작게 하고, 같은 높이로 &로 이어 받은 뒷음도 함께 바꾼다
 */
export function planHarmonic(song: Song, picked: readonly Note[], options: HarmonicOptions, profile: GameProfile): LabResult {
  const skipped = { tied: 0, locked: 0, fret: 0, range: 0, same: 0 };
  const changed = new Map<string, Map<string, Note>>();
  let made = 0;
  for (const e of editsOf(song, picked)) {
    if (options.locked?.has(e.trackId)) {
      skipped.locked++;
      continue;
    }
    if (heldAt(e.sorted, e.index)) {
      skipped.tied++;
      continue;
    }
    const n = e.sorted[e.index]!;
    if (n.lab?.kind === "harmonic") {
      // 이미 하모닉스: 두 번 올리지 않는다
      skipped.same++;
      continue;
    }
    const at = options.positionOf?.(n);
    let pitch: number;
    if (options.type === "natural") {
      const up = at ? NATURAL_HARMONICS.get(at.fret) : undefined;
      if (!at || up === undefined) {
        skipped.fret++;
        continue;
      }
      pitch = at.open + up;
    } else pitch = n.pitch + 12;
    if (pitch < 0 || pitch > 127) {
      skipped.range++;
      continue;
    }
    const origVol = n.lab?.kind === "ghost" ? n.lab.vol : n.vol;
    const vol = clampVol(n.vol - Math.max(0, options.quieter), profile);
    const lab: NoteLab = {
      kind: "harmonic",
      type: options.type,
      pitch: n.pitch,
      vol: origVol,
      ...(at ? { string: at.string, fret: at.fret } : {}),
    };
    const m = changed.get(e.trackId) ?? new Map<string, Note>();
    changed.set(e.trackId, m);
    const string = at?.string ?? n.tabString;
    const put = (x: Note) => m.set(x.id, { ...x, pitch, vol, lab, ...(string !== undefined ? { tabString: string } : {}) });
    put(n);
    for (const tail of heldTail(e.sorted, e.index)) put(tail);
    made++;
  }
  return collect(song, changed, made, skipped);
}

/**
 * 고른 음의 실험실 표시를 풀어 처음 값으로: 고스트는 v, 하모닉스는 높이와 v. 표시가 없는 음은 그대로.
 * 같은 높이로 &로 이어 받은 뒷음도 함께 되돌린다
 */
export function planLabClear(song: Song, picked: readonly Note[], options: { readonly locked?: ReadonlySet<string> } = {}): LabResult {
  const skipped = { tied: 0, locked: 0, fret: 0, range: 0, same: 0 };
  const changed = new Map<string, Map<string, Note>>();
  let made = 0;
  for (const e of editsOf(song, picked)) {
    const n = e.sorted[e.index]!;
    if (!n.lab || heldAt(e.sorted, e.index)) continue;
    if (options.locked?.has(e.trackId)) {
      skipped.locked++;
      continue;
    }
    const lab = n.lab;
    const m = changed.get(e.trackId) ?? new Map<string, Note>();
    changed.set(e.trackId, m);
    // 하모닉스를 만든 뒤 음정 변환 등으로 높이가 바뀌었으면 처음 높이로 되돌리지 않고 표시만 버린다
    const fresh = lab.kind === "ghost" || harmonicPitch(lab) === n.pitch;
    const restore = (x: Note): Note => {
      const { lab: _lab, ...rest } = x;
      if (!fresh) return rest;
      return lab.kind === "harmonic" ? { ...rest, pitch: lab.pitch, vol: lab.vol } : { ...rest, vol: lab.vol };
    };
    const tails = heldTail(e.sorted, e.index);
    m.set(n.id, restore(n));
    for (const tail of tails) if (tail.lab) m.set(tail.id, restore(tail));
    made++;
  }
  return collect(song, changed, made, skipped);
}

/** 하모닉스 표시대로라면 지금 나야 할 높이 (자연: 짚은 줄 개방현 + 하모닉스 반음, 인공: 누른 음 + 12) */
export function harmonicPitch(lab: Extract<NoteLab, { kind: "harmonic" }>): number | undefined {
  if (lab.type === "artificial") return lab.pitch + 12;
  const up = lab.fret !== undefined ? NATURAL_HARMONICS.get(lab.fret) : undefined;
  return up === undefined ? undefined : lab.pitch - lab.fret! + up;
}

/**
 * 타브에 쓸 하모닉스 글자: 자연은 "<12>", 인공은 누른 프렛 뒤에 하모닉스 자리 "3<15>".
 * 표시가 지금 놓인 줄·프렛과 맞을 때만 (튜닝을 바꾸거나 높이를 고쳐 맞지 않으면 보통 숫자로 쓴다)
 */
export function harmonicLabel(note: Note, at: { readonly string: number; readonly fret: number }): string | undefined {
  const lab = note.lab;
  if (lab?.kind !== "harmonic" || lab.string !== at.string || lab.fret === undefined) return undefined;
  if (lab.type === "natural") return NATURAL_HARMONICS.get(lab.fret) === at.fret ? `<${lab.fret}>` : undefined;
  return lab.fret + 12 === at.fret ? `${lab.fret}<${at.fret}>` : undefined;
}
