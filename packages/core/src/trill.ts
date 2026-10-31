import { add, cmp, div, mul, rat, sub, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import { foldPitch, MOBILE_PROFILE, soundingRangeOf, volumeStepMax, type GameProfile } from "./profile.js";
import { shortestLength } from "./note-length.js";
import { isCleanTrack, replaceNotes, trackIndex, type TrackIndex } from "./note-edit.js";

/**
 * 트릴·트레몰로: 고른 음 하나를 같은 길이의 짧은 음 여러 개로 바꾼다. MML에 트릴 기호가 없으므로 음을 실제로 나눠 쓴다.
 * - 트릴: 본음과 위(또는 아래) 음을 번갈아 친다. 같은 연주자·같은 시작인 고른 음(화음)은 가장 높은 음에만 건다.
 * - 트레몰로: 같은 음을 되풀이한다. 고른 화음 음은 트랙마다 모두 되풀이한다.
 * 빠르기는 음 하나 길이(박자 기준)로 정하므로 템포를 따라간다. 본음 길이가 나누어떨어지지 않으면 남는 길이를 마지막 음에 붙인다
 * (반올림하지 않는다. 마지막 음 길이를 정확히 쓸 수 없으면 그 음은 건너뛴다). 결과만 계산하고 곡은 바꾸지 않는다
 */

export type TrillKind = "trill" | "tremolo";

/**
 * 나눈 음의 v 모양 (본음 v 기준, 깊이만큼 낮춘 v와 섞는다). 게임에서 어떻게 들리는지는 아직 실측 전이다 (pending trillVolumePattern).
 * - same: 모두 본음 v
 * - alternate: 하나 건너 낮게 (번갈아)
 * - accentFirst: 첫 음만 본음 v, 나머지는 낮게
 * - accentBeat: 박(4분음표) 자리에서 시작하는 음만 본음 v, 나머지는 낮게
 * - crescendo: 낮은 v에서 본음 v까지 점점 크게
 * - decrescendo: 본음 v에서 낮은 v까지 점점 작게
 */
export type TrillVolumePattern = "same" | "alternate" | "accentFirst" | "accentBeat" | "crescendo" | "decrescendo";
export const TRILL_VOLUME_PATTERNS: readonly TrillVolumePattern[] = ["same", "alternate", "accentFirst", "accentBeat", "crescendo", "decrescendo"];

export interface TrillVolume {
  readonly pattern: TrillVolumePattern;
  /** 낮은 v가 본음 v보다 몇 단계 아래인지 */
  readonly depth: number;
  /**
   * 나눈 음 전체를 몇 단계 낮출지 (빠르게 다시 치면 겹쳐 커져서). "auto"면 프로필의 실측 권장값
   * (GameProfile.ornamentRepeatLower: 한 음, 같은 연주자 화음을 함께 되풀이하면 화음 값)
   */
  readonly lower: number | "auto";
}

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
  /** 나눈 음의 v (없으면 모두 본음 v) */
  readonly volume?: TrillVolume;
  /** 끊어 치기: 음마다 앞 절반만 소리 내고 뒤 절반은 쉼표 (&로 잇기와 함께 쓰지 않는다) */
  readonly staccato?: boolean;
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
  /** 마지막 음 길이(남는 길이를 붙인 것)나 끊어 치기의 음·쉼표 길이를 정확히 쓸 수 없음 */
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

/**
 * v 깊이·전체 낮추기 입력 상한 (v 범위 전체). 곡 프로필이 닿지 않는 설정 읽기에서만 쓰고,
 * 창은 volumeStepMax(곡 프로필)를 쓴다
 */
export const TRILL_VOLUME_DEPTH_LIMIT = volumeStepMax(MOBILE_PROFILE);

/**
 * 나눈 음 하나하나의 v. starts: 음마다 시작 자리 (박마다 세게에 쓴다). 결과는 프로필 v 범위 안으로 자른다
 */
export function trillVolumes(
  base: number,
  starts: readonly Rat[],
  volume: (Omit<TrillVolume, "lower"> & { readonly lower: number }) | undefined,
  range: { readonly min: number; readonly max: number },
): number[] {
  const clamp = (v: number) => Math.min(range.max, Math.max(range.min, v));
  if (!volume) return starts.map(() => base);
  const top = clamp(base - volume.lower);
  const low = clamp(top - volume.depth);
  const count = starts.length;
  const quarter = rat(1, 4);
  return starts.map((at, i) => {
    switch (volume.pattern) {
      case "alternate":
        return i % 2 === 0 ? top : low;
      case "accentFirst":
        return i === 0 ? top : low;
      case "accentBeat": {
        const q = div(at, quarter);
        return q.d === 1 ? top : low;
      }
      case "crescendo":
        return count < 2 ? top : Math.round(low + ((top - low) * i) / (count - 1));
      case "decrescendo":
        return count < 2 ? top : Math.round(top - ((top - low) * i) / (count - 1));
      default:
        return top;
    }
  });
}

/** 트릴 상대 음 간격 한도 (입력 상한) */
export const TRILL_OFFSET_LIMIT = 12;

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

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
  const staccato = !!options.staccato;
  const tie = options.kind === "trill" && options.tie && !staccato;
  const targets = targetsOf(song, picked, options.kind);
  // 자동 낮추기: 같은 연주자·같은 시작에 함께 되풀이하는 본음이 둘 이상이면 화음 값.
  // 건너뛴 음(짧음·잠금 등)은 되풀이하지 않으므로 세지 않는다: 먼저 되풀이할 음을 다 정한 뒤 센다
  const playerOf = new Map(song.tracks.map((t) => [t.id, t.playerId]));
  const keyOf = (tg: { trackId: string; note: Note }) => `${playerOf.get(tg.trackId)}|${tg.note.start.n}/${tg.note.start.d}`;
  const together = new Map<string, number>();
  const ready: { tg: (typeof targets)[number]; run: () => void }[] = [];
  // 고를 음을 정하는 동안 트랙은 바뀌지 않으므로 트랙마다 한 번만 정렬·색인한다
  const indexes = new Map<string, TrackIndex>();
  const indexOf = (trackId: string) => {
    let index = indexes.get(trackId);
    if (!index) indexes.set(trackId, (index = trackIndex(tracks.get(trackId) ?? [])));
    return index;
  };
  for (const tg of targets) {
    if (options.locked?.has(tg.trackId)) {
      skipped.locked++;
      continue;
    }
    const index = indexOf(tg.trackId);
    const own = index.sorted;
    const at = index.indexOf(tg.note.id);
    const main = own[at];
    if (!main) continue;
    if (index.isHeld(main)) {
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
    // 끊어 치기는 뒤 음과 &로 이어진 본음에 쓰지 않는다 (쉼표가 끼면 이어 받던 뒤 음을 새로 치게 된다)
    if (staccato && main.tie === "next") {
      skipped.tied++;
      continue;
    }
    const plan = trillPieces(main.dur, main.pitch, options, shortest);
    if (!plan.ok) {
      skipped[plan.why]++;
      continue;
    }
    // 끊어 치기: 나눈 음마다 그 음 길이의 앞 절반만 소리, 나머지는 쉼표. 둘 다 게임 최단 이상이고 정확히 써져야 한다.
    // 트랙의 마지막 음이면 마지막 조각은 끊지 않는다 (끝 쉼표는 남지 않아 곡 끝·되풀이 길이가 짧아지므로)
    const lastOfTrack = cmp(own.at(-1)!.start, main.start) <= 0;
    const cut = (i: number) => staccato && !(lastOfTrack && i === plan.pieces.length - 1);
    const soundOf = (p: { dur: Rat }) => mul(p.dur, rat(1, 2));
    if (
      staccato &&
      plan.pieces.some((p, i) => {
        if (!cut(i)) return false;
        const sound = soundOf(p);
        return cmp(sound, shortest) < 0 || !options.canWrite(sound) || !options.canWrite(sub(p.dur, sound));
      })
    ) {
      skipped.unwritable++;
      continue;
    }
    // & 사슬: 트릴 음을 모두 이을 때, 또는 본음이 뒤 음에 &로 이어질 때 그 사슬의 높이 차를 재생처럼 접어 잰다
    if (tie || main.tie === "next") {
      const chain = tie ? plan.pieces.map((p) => p.pitch) : [plan.pieces.at(-1)!.pitch];
      let i = at;
      if (main.tie === "next") while (own[i]?.tie === "next" && own[i + 1] && cmp(end(own[i]!), own[i + 1]!.start) === 0) chain.push(own[++i]!.pitch);
      const head = foldPitch(chain[0]!, range);
      if (chain.some((p) => Math.abs(foldPitch(p, range) - head) > profile.tieBendLimit)) {
        skipped.bend++;
        continue;
      }
    }
    ready.push({
      tg,
      run: () => {
        const tabString = options.stringOf?.(main) ?? main.tabString;
        const starts: Rat[] = [];
        let from = main.start;
        for (const p of plan.pieces) {
          starts.push(from);
          from = add(from, p.dur);
        }
        // &로 이으면 게임은 사슬 첫 음 v로만 울리므로 v 모양은 쓰지 않는다 (전체 낮추기만)
        const lower =
          options.volume?.lower === "auto" ? ((together.get(keyOf(tg)) ?? 1) > 1 ? profile.ornamentRepeatLower.chord : profile.ornamentRepeatLower.single) : (options.volume?.lower ?? 0);
        const volume = options.volume ? { ...options.volume, lower, ...(tie ? { pattern: "same" as const } : {}) } : undefined;
        const vols = trillVolumes(main.vol, starts, volume, profile.volume);
        const notes: Note[] = plan.pieces.map((p, i) => {
          const last = i === plan.pieces.length - 1;
          const { made: _made, lab, ...body } = main;
          const n: Note = {
            ...body,
            id: newId(),
            start: starts[i]!,
            dur: cut(i) ? soundOf(p) : p.dur,
            pitch: p.pitch,
            vol: vols[i]!,
            // 마지막 음은 본음의 &를 이어받는다 (뒤 음과 이어져 있었으면 그대로)
            tie: staccato ? "none" : last ? main.tie : tie ? "next" : "none",
            // 실험실 표시(고스트·하모닉스)는 본음 높이 음에만 남긴다
            ...(lab && p.pitch === main.pitch ? { lab } : {}),
            ...(tabString !== undefined ? { tabString } : {}),
          };
          return n;
        });
        const changes = pending.get(tg.trackId) ?? new Map<string, Note | null>();
        changes.set(main.id, null);
        for (const n of notes) changes.set(n.id, n);
        if (batch) pending.set(tg.trackId, changes);
        else tracks.set(tg.trackId, replaceNotes(tracks.get(tg.trackId) ?? [], changes, new Set(notes.map((n) => n.id))));
        touched.add(tg.trackId);
        ids.push(...notes.map((n) => n.id));
        made++;
        pieces += notes.length;
      },
    });
  }
  for (const { tg } of ready) together.set(keyOf(tg), (together.get(keyOf(tg)) ?? 0) + 1);
  // 깔끔한 트랙(음이 겹치지 않음)은 본음마다 제자리에서만 바뀌므로 바꿈을 모아 트랙마다 replaceNotes를 한 번만 부른다
  // (본음마다 트랙 전체를 다시 정리하면 음 수의 제곱으로 느려진다). 겹친 음이 있는 트랙은 예전처럼 하나씩 넣는다
  const pending = new Map<string, Map<string, Note | null>>();
  const batch = song.tracks.every((t) => isCleanTrack(t.notes));
  for (const { run } of ready) run();
  for (const [trackId, changes] of pending) {
    const placed = [...changes].filter(([, n]) => n !== null).map(([id]) => id);
    tracks.set(trackId, replaceNotes(tracks.get(trackId) ?? [], changes, new Set(placed)));
  }
  const changes = song.tracks.filter((t) => touched.has(t.id)).map((t) => ({ trackId: t.id, notes: tracks.get(t.id)! }));
  return { changes, made, pieces, ids, skipped };
}
