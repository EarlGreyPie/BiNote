import { add, cmp, div, mul, rat, sub, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import { foldPitch, soundingRangeOf, TIE_BEND_LIMIT, type GameProfile } from "./profile.js";
import { shortestLength } from "./note-length.js";
import { replaceNotes } from "./note-edit.js";

/**
 * 트릴·트레몰로: 고른 음 하나를 같은 길이의 짧은 음 여러 개로 바꾼다. MML에 트릴 기호가 없으므로 음을 실제로 나눠 쓴다.
 * - 트릴: 본음과 위(또는 아래) 음을 번갈아 친다. 같은 연주자·같은 시작인 고른 음(화음)은 가장 높은 음에만 건다.
 * - 트레몰로: 같은 음을 되풀이한다. 고른 화음 음은 트랙마다 모두 되풀이한다.
 * 빠르기는 음 하나 길이(박자 기준)로 정하므로 템포를 따라간다. 본음 길이가 나누어떨어지지 않으면 남는 길이를 마지막 음에 붙인다
 * (반올림하지 않는다. 마지막 음 길이를 정확히 쓸 수 없으면 그 음은 건너뛴다). 결과만 계산하고 곡은 바꾸지 않는다
 */

export type TrillKind = "trill" | "tremolo";

export interface TrillOptions {
  readonly kind: TrillKind;
  /** 트릴 상대 음: 본음 기준 반음 수 (0이 아닌 수. 트레몰로는 보지 않는다) */
  readonly offset: number;
  /** 음 하나 길이 (온음표 단위) */
  readonly length: Rat;
  /** 트릴을 상대 음부터 시작한다 */
  readonly startOther: boolean;
  /** 트릴이 상대 음으로 끝나면 마지막 음을 앞 본음에 합쳐 본음으로 끝낸다 */
  readonly endOnMain: boolean;
  /** 트릴 음을 &로 이어 다시 치지 않게 한다 (트레몰로는 보지 않는다: 같은 음을 이으면 긴 음 하나가 된다) */
  readonly tie: boolean;
  /** 이 길이를 게임 길이로 정확히 쓸 수 있는지 (출력기와 같은 판정) */
  readonly canWrite: (dur: Rat) => boolean;
  readonly locked?: ReadonlySet<string>;
  /** 트랙이 실제로 소리 내는 악기 (음역 접기·& 사슬 높이 차를 재생과 같이 잰다) */
  readonly instrumentOf?: (trackId: string) => string | undefined;
  /** 나눈 음을 놓을 타브 줄 (본음이 보이는 줄). 없으면 본음에 적어 둔 줄 */
  readonly stringOf?: (note: Note) => number | undefined;
}

export interface TrillSkipped {
  /** &로 이어 받은 음이라 새로 치지 않음 */
  readonly tied: number;
  /** 본음이 음 하나 길이의 두 배보다 짧음 */
  readonly short: number;
  /** 마지막 음 길이(남는 길이를 붙인 것)를 정확히 쓸 수 없음 */
  readonly unwritable: number;
  /** 잠근 트랙 */
  readonly locked: number;
  /** & 사슬 높이 차가 너무 큼 */
  readonly bend: number;
  /** 상대 음이 MIDI 범위 밖이거나, 악기 음역 밖이라 게임이 옥타브째 접어 간격이 달라짐 */
  readonly range: number;
}

export interface TrillResult {
  /** 바뀐 트랙과 그 트랙 음 전체. 바뀐 것이 없으면 빈 목록 */
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 나눈 본음 수 */
  readonly made: number;
  /** 나눠서 생긴 음 수 (모두 더한 것) */
  readonly pieces: number;
  /** 만든 음 (적용 뒤 고른 음으로 쓴다) */
  readonly ids: readonly string[];
  readonly skipped: TrillSkipped;
}

/** 트릴 상대 음 간격 한도 (입력 상한) */
export const TRILL_OFFSET_LIMIT = 12;

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

/** 시작 순으로 놓은 트랙 음에서 n 바로 앞 음 */
function before(sorted: readonly Note[], n: Note): Note | undefined {
  let prev: Note | undefined;
  for (const x of sorted) {
    if (x.id === n.id || cmp(x.start, n.start) >= 0) break;
    prev = x;
  }
  return prev;
}

/** 바로 앞 음이 &로 이어 주는 음인지 (새로 치지 않는 음) */
function isHeld(sorted: readonly Note[], n: Note): boolean {
  const prev = before(sorted, n);
  return !!prev && prev.tie === "next" && cmp(end(prev), n.start) === 0;
}

/** 고른 음 → 나눌 본음 (트랙과 함께). 트릴은 같은 연주자·같은 시작인 고른 음 가운데 가장 높은 음만. 시작 순 */
function targetsOf(song: Song, picked: readonly Note[], kind: TrillKind): { trackId: string; note: Note }[] {
  const ids = new Set(picked.map((n) => n.id));
  const out: { trackId: string; note: Note }[] = [];
  const groups = new Map<string, { trackId: string; note: Note }>();
  for (const tr of song.tracks) {
    for (const n of tr.notes) {
      if (!ids.has(n.id)) continue;
      if (kind === "tremolo") {
        out.push({ trackId: tr.id, note: n });
        continue;
      }
      const key = `${tr.playerId}|${n.start.n}/${n.start.d}`;
      const was = groups.get(key);
      if (!was || n.pitch > was.note.pitch) groups.set(key, { trackId: tr.id, note: n });
    }
  }
  return [...out, ...groups.values()].sort((a, b) => cmp(a.note.start, b.note.start));
}

/**
 * 본음 하나를 나눈 높이·길이 (트랙과 상관없는 계산). 두 개보다 적게 나뉘거나 마지막 길이를 쓸 수 없으면 까닭
 */
export function trillPieces(
  dur: Rat,
  pitch: number,
  options: Pick<TrillOptions, "kind" | "offset" | "length" | "startOther" | "endOnMain" | "canWrite">,
  shortest: Rat,
): { ok: true; pieces: { pitch: number; dur: Rat }[] } | { ok: false; why: "short" | "unwritable" } {
  if (cmp(options.length, shortest) < 0) return { ok: false, why: "short" };
  const q = div(dur, options.length);
  const count = Math.floor(q.n / q.d);
  if (count < 2) return { ok: false, why: "short" };
  const other = options.kind === "trill" ? pitch + options.offset : pitch;
  const first = options.kind === "trill" && options.startOther;
  const pieces: { pitch: number; dur: Rat }[] = [];
  for (let i = 0; i < count; i++) pieces.push({ pitch: (i % 2 === 1) !== first ? other : pitch, dur: options.length });
  // 남는 길이는 마지막 음에 붙인다
  const rest = sub(dur, mul(options.length, rat(count)));
  if (rest.n !== 0) pieces[count - 1] = { ...pieces[count - 1]!, dur: add(options.length, rest) };
  // 본음으로 끝내기: 마지막이 상대 음이면 앞 본음에 합친다 (본음·상대 음·본음이 남을 만큼은 있어야 한다)
  if (options.kind === "trill" && options.endOnMain && pieces.length >= 3 && pieces.at(-1)!.pitch !== pitch) {
    const last = pieces.pop()!;
    pieces[pieces.length - 1] = { ...pieces.at(-1)!, dur: add(pieces.at(-1)!.dur, last.dur) };
  }
  if (!options.canWrite(pieces.at(-1)!.dur)) return { ok: false, why: "unwritable" };
  return { ok: true, pieces };
}

export function planTrill(song: Song, picked: readonly Note[], options: TrillOptions, profile: GameProfile, newId: () => string): TrillResult {
  const skipped = { tied: 0, short: 0, unwritable: 0, locked: 0, bend: 0, range: 0 };
  const shortest = shortestLength(profile.length);
  const tracks = new Map<string, readonly Note[]>(song.tracks.map((t) => [t.id, t.notes]));
  const touched = new Set<string>();
  const ids: string[] = [];
  let made = 0;
  let pieces = 0;
  const tie = options.kind === "trill" && options.tie;
  for (const tg of targetsOf(song, picked, options.kind)) {
    if (options.locked?.has(tg.trackId)) {
      skipped.locked++;
      continue;
    }
    const own = [...(tracks.get(tg.trackId) ?? [])].sort((a, b) => cmp(a.start, b.start));
    const main = own.find((n) => n.id === tg.note.id);
    if (!main) continue;
    if (isHeld(own, main)) {
      skipped.tied++;
      continue;
    }
    const range = soundingRangeOf(profile, options.instrumentOf?.(tg.trackId));
    if (options.kind === "trill") {
      const other = main.pitch + options.offset;
      // 상대 음이 접히면 간격이 달라져 트릴이 되지 않는다 (본음이 접히는 만큼 같이 접히면 괜찮다)
      if (options.offset === 0 || other < 0 || other > 127 || foldPitch(other, range) - foldPitch(main.pitch, range) !== options.offset) {
        skipped.range++;
        continue;
      }
    }
    const plan = trillPieces(main.dur, main.pitch, options, shortest);
    if (!plan.ok) {
      skipped[plan.why]++;
      continue;
    }
    // & 사슬: 트릴 음을 모두 이을 때, 또는 본음이 뒤 음에 &로 이어질 때 그 사슬의 높이 차를 재생처럼 접어 잰다
    if (tie || main.tie === "next") {
      const chain = tie ? plan.pieces.map((p) => p.pitch) : [plan.pieces.at(-1)!.pitch];
      let at = own.findIndex((n) => n.id === main.id);
      if (main.tie === "next") while (own[at]?.tie === "next" && own[at + 1] && cmp(end(own[at]!), own[at + 1]!.start) === 0) chain.push(own[++at]!.pitch);
      const head = foldPitch(chain[0]!, range);
      if (chain.some((p) => Math.abs(foldPitch(p, range) - head) > TIE_BEND_LIMIT)) {
        skipped.bend++;
        continue;
      }
    }
    const tabString = options.stringOf?.(main) ?? main.tabString;
    let at = main.start;
    const notes: Note[] = plan.pieces.map((p, i) => {
      const last = i === plan.pieces.length - 1;
      const { made: _made, lab, ...body } = main;
      const n: Note = {
        ...body,
        id: newId(),
        start: at,
        dur: p.dur,
        pitch: p.pitch,
        // 마지막 음은 본음의 &를 이어받는다 (뒤 음과 이어져 있었으면 그대로)
        tie: last ? main.tie : tie ? "next" : "none",
        // 실험실 표시(고스트·하모닉스)는 본음 높이 음에만 남긴다
        ...(lab && p.pitch === main.pitch ? { lab } : {}),
        ...(tabString !== undefined ? { tabString } : {}),
      };
      at = add(at, p.dur);
      return n;
    });
    const changes = new Map<string, Note | null>([[main.id, null], ...notes.map((n) => [n.id, n] as const)]);
    tracks.set(tg.trackId, replaceNotes(tracks.get(tg.trackId) ?? [], changes, new Set(notes.map((n) => n.id))));
    touched.add(tg.trackId);
    ids.push(...notes.map((n) => n.id));
    made++;
    pieces += notes.length;
  }
  const changes = song.tracks.filter((t) => touched.has(t.id)).map((t) => ({ trackId: t.id, notes: tracks.get(t.id)! }));
  return { changes, made, pieces, ids, skipped };
}
