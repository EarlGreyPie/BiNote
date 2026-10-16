import { add, cmp, DEFAULT_BPM, eq, maxChordsOf, normalizeTempo, rat, sub, ZERO, type GameProfile, type Rat, type Song, type TempoEvent } from "@mmlce/core";
import { scoreChunks } from "./clipboard.js";
import { optimizeMml } from "./optimizer.js";
import { printMml, restText, type PrintableNote } from "./printer.js";
import { placeTempo, type TempoMove } from "./tempo-placement.js";
import { parseMml } from "./parser.js";
import { sameSound } from "./compare.js";
import { audibleTempo } from "./tempo-text.js";

/**
 * 악보책 나누기 (설계 8장). 채널 하나라도 글자 수 한도를 넘으면 곡을 여러 권으로 나눈다.
 * 모든 채널을 같은 시점에서 자른다(연주자끼리 박자가 어긋나지 않게).
 *
 * 권 수는 늘 가장 적게: 먼저 권마다 가장 멀리까지 넣어 최소 권 수와 그때의 권 끝들을 구한다.
 * 자르는 자리 고르기: 한도 안에 들어가는 가장 먼 자리까지 찾은 뒤, 그 앞쪽 일부(window) 안에서
 * (1) 마커, (2) 끊기는 음이 가장 적은 곳(모두 쉬는 곳이면 0), (3) 더 뒤쪽 순으로 고른다.
 * 다만 고른 자리에서 남은 곡을 남은 권 수 안에 넣을 수 있을 때만 골라, 좋은 자리를 고르느라 권이 늘지 않게 한다.
 * 각 권의 시작에서 옥타브·길이·볼륨은 출력기가 기본값부터 다시 쓰고, 그때의 템포를 다시 적는다.
 * 게임은 악보(연주자)마다 따로 붙여넣고 따로 넘기므로, 템포와 권 끝 쉼표는 악보마다 넣는다.
 *
 * 권 사이 지연: 악보책은 다음 권으로 넘어갈 때 scoreBookGapMs(실측 1010ms)만큼 늦게 시작한다.
 * 그래서 앞 권을 자르는 자리보다 그만큼 일찍 끝내 박자를 맞추고(trim), 자를 자리는 그 구간에서
 * 울리는 음이 가장 적은 곳으로 고른다. 쉼표가 있으면 잃는 게 없고, 없으면 걸친 음 끝이 짧아진다.
 */
export interface SplitOptions {
  /** 한도 안에 들어가는 가장 먼 자리에서 이 비율만큼 앞까지를 자를 후보로 본다 */
  readonly window?: number;
  /** 권 사이 지연(ms). 생략하면 프로필 값, null이면 메우지 않는다 */
  readonly gapMs?: number | null;
  /** 악보 하나의 트랙 수. 생략하면 프로필의 악기별 화음 수 */
  readonly maxChords?: number | ((playerId: string) => number);
  /** 권 하나를 정할 때마다 곡 어디까지 왔는지 (0~1) */
  readonly onProgress?: (fraction: number) => void;
}

export interface SplitPart {
  readonly start: Rat;
  readonly end: Rat;
  /** 곡의 트랙 순서대로 */
  readonly texts: readonly { readonly trackId: string; readonly text: string }[];
  /** 이 권의 끝에서 끊기거나 지연을 메우느라 짧아지는 음 수 (마지막 권은 0) */
  readonly cut: number;
  /** 다음 권의 지연을 메우려고 end 앞에서 뺀 길이 (온음표 단위, 마지막 권은 0) */
  readonly trim: Rat;
  /** 음을 쪼갤 수 없어 뒤쪽 음 경계로 옮겨 쓴 템포 수 (악보마다 센다) */
  readonly moved: number;
  /** 다시 읽으면 음이나 템포 자리가 달라지는 트랙 (출력기로 정확히 쓸 수 없는 길이). 이 트랙 글은 소리가 다르다 */
  readonly lossy: readonly string[];
}

export interface SplitResult {
  readonly parts: SplitPart[];
  /** 한도를 넘는 채널이 있어 나눌 필요가 있었는지 */
  readonly needed: boolean;
}

export function splitSong(song: Song, profile: GameProfile, options: SplitOptions = {}): SplitResult {
  const limit = profile.charLimitPerScore;
  const window = options.window ?? 0.25;
  const gapMs = options.gapMs === undefined ? profile.scoreBookGapMs : options.gapMs;
  const tracks = song.tracks.map((t) => [...t.notes].sort((a, b) => cmp(a.start, b.start)));
  // 들리지 않는 같은 빠르기 템포는 쓰지 않는다
  const tempo = audibleTempo(song.tempo);
  const scores = scoreIndexes(song, options.maxChords ?? ((id) => maxChordsOf(profile, song.players.find((p) => p.id === id)?.instrument.canonical)));

  let songEnd: Rat = ZERO;
  for (const notes of tracks) for (const n of notes) songEnd = max(songEnd, add(n.start, n.dur));
  for (const t of tempo) songEnd = max(songEnd, t.at);

  const whole = render(song, scores, tracks, tempo, ZERO, songEnd, false, false, true);
  if (whole.texts.every((t) => t.text.length <= limit)) {
    return { parts: [{ start: ZERO, end: songEnd, texts: whole.texts, cut: 0, trim: ZERO, moved: whole.moved, lossy: whole.lossy }], needed: false };
  }

  // 자를 수 있는 자리: 음의 시작·끝
  const keys = new Map<string, Rat>();
  for (const notes of tracks) {
    for (const n of notes) {
      keys.set(`${n.start.n}/${n.start.d}`, n.start);
      const end = add(n.start, n.dur);
      keys.set(`${end.n}/${end.d}`, end);
    }
  }
  const candidates = [...keys.values()].filter((r) => cmp(r, ZERO) > 0 && cmp(r, songEnd) < 0).sort(cmp);
  const markers = song.markers.map((m) => m.at);

  /** [start, end)를 한 권으로 쓴 결과. 끝이 곡 끝이 아니면 다음 권 지연만큼 앞당겨 끝내고, 그 길이를 끝 쉼표로 채운다 */
  const part = (start: Rat, end: Rat, quick = false, verify = false) => {
    const trim = cmp(end, songEnd) < 0 ? gapAt(tempo, end, gapMs, start) : ZERO;
    const until = sub(end, trim);
    return { trim, until, ...render(song, scores, tracks, tempo, start, until, quick, cmp(end, songEnd) < 0, verify) };
  };
  // 실제로 내보낼 글(앞당김·끝 쉼표 포함)로 한도를 검사한다. 단순 출력이 들어가면 최적화 출력도 들어간다.
  // 같은 구간을 여러 번 묻게 되므로(최소 권 수 계산 + 자리 고르기) 결과를 기억해 둔다
  const fitMemo = new Map<string, boolean>();
  const fits = (start: Rat, end: Rat) => {
    const key = `${start.n}/${start.d}-${end.n}/${end.d}`;
    const known = fitMemo.get(key);
    if (known !== undefined) return known;
    const ok = part(start, end, true).texts.every((t) => t.text.length <= limit) || part(start, end).texts.every((t) => t.text.length <= limit);
    fitMemo.set(key, ok);
    return ok;
  };

  // 진행률: 정한 권 끝, 권을 찾는 동안에는 한도 안에 들어간다고 확인한 가장 먼 자리 (줄어들지 않게).
  // 최소 권 수를 먼저 한 번 훑으므로 앞 절반은 그 훑기, 뒤 절반은 실제로 자르기다
  let shown = 0;
  let phase = 0;
  const report = (at: Rat) => {
    const fraction = Math.min(1, (phase + toNumber(at) / toNumber(songEnd)) / 2);
    if (fraction > shown) options.onProgress?.((shown = fraction));
  };

  /** start에서 한 권에 넣을 수 있는 가장 먼 후보의 번호 (after 안에서). 없으면 -1 */
  const farthest = (start: Rat, after: readonly Rat[]) => {
    // 길이는 끝으로 갈수록 늘어난다고 보고 이분 탐색
    let lo = 0;
    let hi = after.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fits(start, after[mid]!)) {
        best = mid;
        report(after[mid]!);
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // 끝 쉼표·앞당김 때문에 길이가 늘기만 하지는 않는다(뒤 후보가 다시 들어갈 수 있음).
    // 이분 탐색이 놓친 뒤쪽 후보를 조금 더 훑는다: 단순 출력이 한도를 크게 넘으면 그만 본다
    for (let i = best + 1; i < after.length && i <= best + LOOK_PAST; i++) {
      const quick = part(start, after[i]!, true).texts;
      if (fits(start, after[i]!)) best = i;
      else if (quick.some((t) => t.text.length > Math.max(limit * 1.1, limit + 16))) break;
    }
    return best;
  };

  // 1) 최소 권 수: 권마다 가장 멀리까지 넣으면 권 수가 가장 적다. 그 권 끝들(greedy)을 기억해 두고,
  //    실제로 자를 때 k번째 권 끝이 greedy의 k번째 끝보다 앞서지 않게 해서 권 수가 늘지 않게 한다
  const greedy: Rat[] = [];
  for (let at: Rat = ZERO; cmp(at, songEnd) < 0; ) {
    if (fits(at, songEnd)) break;
    const after = candidates.filter((c) => cmp(c, at) > 0);
    const best = farthest(at, after);
    at = best < 0 ? (after[0] ?? songEnd) : after[best]!;
    greedy.push(at);
  }
  phase = 1;
  shown = Math.max(shown, 0.5);

  /**
   * at에서 시작해 남은 곡을 budget권 안에 넣을 수 있는지. greedy의 같은 차례 끝(k번째)보다 뒤면 늘 된다
   * (늦게 시작해서 권이 늘지는 않는다). 앞이면 가장 멀리 넣기로 budget권까지만 따라가 본다
   */
  const finishes = (at: Rat, k: number, budget: number) => {
    const floor = greedy[k];
    if (!floor || cmp(at, floor) >= 0) return true;
    let pos = at;
    for (let used = 0; used < budget; used++) {
      if (fits(pos, songEnd)) return true;
      const after = candidates.filter((c) => cmp(c, pos) > 0);
      const best = farthest(pos, after);
      if (best < 0) return false;
      pos = after[best]!;
    }
    return false;
  };

  // 2) 자리 고르기: 최소 권 수를 지키는 범위에서 마커 → 끊기는 음이 적은 곳 → 뒤쪽 순
  const parts: SplitPart[] = [];
  let start: Rat = ZERO;
  while (cmp(start, songEnd) < 0) {
    if (fits(start, songEnd)) {
      const last = part(start, songEnd, false, true);
      parts.push({ start, end: songEnd, texts: last.texts, cut: 0, trim: ZERO, moved: last.moved, lossy: last.lossy });
      break;
    }
    const after = candidates.filter((c) => cmp(c, start) > 0);
    const best = farthest(start, after);
    let end: Rat;
    if (best < 0) {
      // 음 하나도 못 넣는 경우는 없겠지만, 그래도 앞으로 나아가게 첫 후보에서 자른다
      end = after[0] ?? songEnd;
    } else {
      const far = after[best]!;
      const from = toNumber(start) + (toNumber(far) - toNumber(start)) * (1 - window);
      const pool = after.slice(0, best + 1).filter((c) => toNumber(c) >= from);
      const marked = pool.filter((c) => markers.some((m) => eq(m, c)));
      const cost = (c: Rat) => {
        const gap = gapAt(tempo, c, gapMs, start);
        // 권이 지연보다 짧아 메우지 못하면 다음 권이 늦어지므로 가장 나쁜 자리로 본다
        if (gapMs && gap === ZERO) return Number.MAX_SAFE_INTEGER;
        return cutCount(tracks, c, gap);
      };
      // 이분 탐색은 길이가 늘기만 한다고 가정하므로 고른 자리도 다시 검사한다
      const byCost = (a: Rat, b: Rat) => cost(a) - cost(b) || cmp(b, a);
      const ranked = [...[...marked].sort(byCost), ...pool.filter((c) => !marked.includes(c)).sort(byCost)];
      // 이 권 끝에서 남은 곡을 남은 권 수 안에 넣을 수 있어야 한다 (권 수가 늘지 않게)
      const budget = greedy.length - parts.length;
      end = ranked.find((c) => fits(start, c) && finishes(c, parts.length, budget)) ?? far;
    }
    const chosen = part(start, end, false, true);
    parts.push({ start, end, texts: chosen.texts, cut: cutCount(tracks, end, chosen.trim), trim: chosen.trim, moved: chosen.moved, lossy: chosen.lossy });
    start = end;
    report(start);
  }
  report(songEnd);
  return { parts, needed: true };
}

/**
 * 이 자리에서 자르면 끊기는 음 수: 걸쳐 있는 음과 &로 이어지다 끊기는 음.
 * trim이 있으면 at − trim부터 at까지 울리는 음도 짧아지거나 빠지므로 함께 센다
 */
export function cutCount(tracks: readonly (readonly PrintableNote[])[], at: Rat, trim: Rat = ZERO): number {
  const from = sub(at, trim);
  let count = 0;
  for (const notes of tracks) {
    for (const n of notes) {
      const end = add(n.start, n.dur);
      if (cmp(n.start, at) < 0 && cmp(end, from) > 0) count++;
      else if (eq(end, from) && n.tie === "next") count++;
    }
  }
  return count;
}

/**
 * 이 자리에서 메울 지연 길이(온음표). 자르는 자리에서 템포 지도를 거꾸로 따라가 지연 시간만큼 앞선 위치를 찾고
 * (앞 구간 템포가 다르면 그 템포로), 64분음표 단위로 맞춘다. 권보다 길면 메우지 않는다
 */
function gapAt(tempo: readonly TempoEvent[], at: Rat, gapMs: number | null | undefined, start: Rat): Rat {
  if (!gapMs) return ZERO;
  let remaining = gapMs / 1000;
  let cursor = toNumber(at);
  let whole = 0;
  while (remaining > 1e-12) {
    // cursor 바로 앞 구간: cursor보다 앞에서 시작한 마지막 템포
    let bpm = DEFAULT_BPM;
    let from = 0;
    for (const t of tempo) {
      if (toNumber(t.at) < cursor - 1e-12) {
        bpm = t.bpm;
        from = toNumber(t.at);
      }
    }
    const perWhole = 240 / bpm;
    const available = (cursor - from) * perWhole;
    if (available >= remaining || from <= 0) {
      whole += remaining / perWhole;
      break;
    }
    whole += cursor - from;
    remaining -= available;
    cursor = from;
  }
  const gap = rat(Math.round(whole * 64), 64);
  return cmp(sub(at, gap), start) > 0 ? gap : ZERO;
}

/** [start, end) 구간의 채널별 텍스트. 구간 밖으로 걸친 음은 잘라서 넣는다 */
function render(
  song: Song,
  scores: readonly (readonly number[])[],
  tracks: readonly (readonly PrintableNote[])[],
  tempo: readonly TempoEvent[],
  start: Rat,
  end: Rat,
  quick = false,
  padEnd = false,
  verify = false,
): { texts: { trackId: string; text: string }[]; moved: number; lossy: string[] } {
  const chunks = tracks.map((notes) => clip(notes, start, end));
  const moves: TempoMove[] = [];
  const lossy: string[] = [];
  const local = tempoIn(tempo, start, end);
  const out = song.tracks.map((t) => ({ trackId: t.id, text: "" }));
  const length = sub(end, start);
  // 악보마다 따로: 게임은 악보 하나씩 붙여넣으므로 템포를 악보마다 넣어야 그 연주자가 그 빠르기로 친다
  for (const score of scores) {
    const placed = placeTempo(
      score.map((k) => chunks[k]!),
      local,
      moves,
    );
    const simple = score.map((k, i) => printMml(chunks[k]!, { tempo: placed[i] ?? [] }).text);
    score.forEach((k, i) => {
      out[k] = { trackId: song.tracks[k]!.id, text: quick ? simple[i]! : optimizeMml(chunks[k]!, { tempo: placed[i] ?? [] }).text };
      // 내보낼 글을 다시 읽어 음과 템포 자리가 그대로인지 본다 (출력기가 못 쓰는 길이는 버려진다)
      if (verify && !writesExactly(out[k]!.text, chunks[k]!, placed[i] ?? [])) lossy.push(song.tracks[k]!.id);
    });
    if (!padEnd) continue;
    // 권 길이는 그 악보에서 가장 늦게 끝나는 채널로 정해진다. 끝의 쉼표는 음으로 남지 않으므로, 어느 채널도 권 끝까지
    // 가지 않으면 가장 짧은 채널 끝에 쉼표를 덧붙여 권 길이를 지킨다 (안 그러면 그 연주자만 다음 권을 일찍 시작한다)
    const reach = score.map((k, i) => {
      let last: Rat = ZERO;
      for (const n of chunks[k]!) last = max(last, add(n.start, n.dur));
      for (const t of placed[i] ?? []) last = max(last, t.at);
      return last;
    });
    if (reach.some((r) => cmp(r, length) >= 0)) continue;
    // 쉼표를 붙일 채널은 단순 출력 길이로 고른다. 최적화 출력은 채널마다 단순 출력보다 길지 않으므로,
    // 같은 채널에 붙이면 "단순 출력이 들어가면 최종 출력도 들어간다"가 그대로 성립한다
    let i = 0;
    for (let j = 1; j < simple.length; j++) if (simple[j]!.length < simple[i]!.length) i = j;
    const k = score[i]!;
    out[k] = { ...out[k]!, text: out[k]!.text + restText(sub(length, reach[i]!)) };
  }
  return { texts: out, moved: moves.length, lossy };
}

/** 글을 다시 읽으면 음과 템포가 notes·tempo와 같은지 */
function writesExactly(text: string, notes: readonly PrintableNote[], tempo: readonly TempoEvent[]): boolean {
  const parsed = parseMml(text);
  if (!sameSound(parsed.notes, notes)) return false;
  const a = normalizeTempo(parsed.tempo);
  const b = normalizeTempo(tempo);
  return a.length === b.length && a.every((e, i) => e.bpm === b[i]!.bpm && eq(e.at, b[i]!.at));
}

/** 악보마다 곡 트랙 번호 (연주자가 없는 트랙은 맨 끝 악보 하나로) */
function scoreIndexes(song: Song, maxChords: number | ((playerId: string) => number)): number[][] {
  const index = new Map(song.tracks.map((t, k) => [t.id, k]));
  const out = scoreChunks(song, maxChords).map((c) => c.trackIds.map((id) => index.get(id)!));
  const seen = new Set(out.flat());
  const rest = song.tracks.map((_, k) => k).filter((k) => !seen.has(k));
  return rest.length > 0 ? [...out, rest] : out;
}

function clip(notes: readonly PrintableNote[], start: Rat, end: Rat): PrintableNote[] {
  const out: PrintableNote[] = [];
  for (const n of notes) {
    const noteEnd = add(n.start, n.dur);
    if (cmp(noteEnd, start) <= 0 || cmp(n.start, end) >= 0) continue;
    const s = max(n.start, start);
    const e = min(noteEnd, end);
    // 끝에서 잘린 음, 또는 이어질 음이 다음 권에 있는 음은 & 를 풀어 준다
    const tie = cmp(noteEnd, end) >= 0 ? "none" : n.tie;
    out.push({ start: sub(s, start), dur: sub(e, s), pitch: n.pitch, vol: n.vol, tie });
  }
  return out;
}

/** 구간 안의 템포. 시작 시점에 걸린 템포도 다시 적는다 */
function tempoIn(tempo: readonly TempoEvent[], start: Rat, end: Rat): TempoEvent[] {
  const out: TempoEvent[] = [];
  let current: TempoEvent | undefined;
  for (const t of tempo) {
    if (cmp(t.at, start) <= 0) current = t;
    else if (cmp(t.at, end) < 0) out.push({ at: sub(t.at, start), bpm: t.bpm });
  }
  return current ? [{ at: ZERO, bpm: current.bpm }, ...out] : out;
}

/** 이분 탐색 뒤에 더 훑어볼 후보 수 */
const LOOK_PAST = 32;

const max = (a: Rat, b: Rat) => (cmp(a, b) >= 0 ? a : b);
const min = (a: Rat, b: Rat) => (cmp(a, b) <= 0 ? a : b);
const toNumber = (r: Rat) => r.n / r.d;
