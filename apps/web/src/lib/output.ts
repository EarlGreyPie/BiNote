import { barBeatAt, maxChordsOf, type GameProfile, type Rat, type Song, type Track } from "@mmlce/core";
import { gameScores, trackSource, type Diagnostic, type SongDiagnostic } from "@mmlce/mml";

/** 출력 점검판의 악보 한 줄 */
export interface OutputRow {
  /** 곡 안에서 1부터 (트랙 목록의 악보 번호와 같다) */
  readonly number: number;
  readonly playerId: string;
  /** 같은 연주자의 몇 번째 악보인지 (0부터, 화음 수 한도로 나뉘었을 때) */
  readonly index: number;
  readonly instrument: string;
  readonly maxChords: number;
  readonly tracks: readonly { readonly trackId: string; readonly name: string; readonly count: number; readonly over: boolean }[];
  /** 게임에 붙여넣을 글 (MML@...;) */
  readonly text: string;
  /** 글자 수 한도를 넘는 트랙이 있다 */
  readonly over: boolean;
  /** 게임에서 접혀 나는 음 수 */
  readonly fold: number;
  readonly errors: number;
  readonly warnings: number;
  /** 출력기로 정확히 못 써서 화면 글을 그대로 넣은 트랙 */
  readonly asIs: readonly string[];
  /** 붙여넣을 글 뒤에 붙은, 소리 내지 않는 트랙 수 (오르골·축음기 악보 길이·템포 맞추기) */
  readonly silent: number;
  /** 붙여넣을 글에 든 소리 없는 트랙 중 글자 수 한도를 넘는 트랙 이름 (그 트랙도 게임 입력 한도를 넘는다) */
  readonly silentOver: readonly string[];
  /** 음을 쪼갤 수 없어 뒤쪽 음 경계로 옮겨 쓴 템포 수 */
  readonly moved: number;
}

/** 게임 범위 밖 템포와 고칠 방법: 그 구간 음 길이를 factor배(작으면 1/factor) 하고 템포를 to로 */
export interface TempoAdvice {
  readonly at: Rat;
  readonly bpm: number;
  readonly bar: number;
  readonly beat: number;
  readonly high: boolean;
  /** 템포를 몇 배로 나누거나(빠를 때) 곱하나(느릴 때). 2의 거듭제곱 */
  readonly factor: number;
  readonly to: number;
  /** 그 구간 음 길이에 곱할 수. 빠를 때 1/factor(짧게), 느릴 때 factor(길게) */
  readonly lengthScale: number;
}

/** 점검판에 따로 보이므로 악보별 수에서 빼는 검사 */
const SHOWN_ELSEWHERE = new Set(["char-limit", "tempo-range"]);

/**
 * 악보마다 게임에 넣을 글과 점검 결과. diagnostics는 곡 검사(analyzeSong) 결과로,
 * 트랙 글의 검사와 곡 검사를 트랙별로 센다
 */
export function outputRows(
  song: Song,
  profile: GameProfile,
  diagnostics: { readonly tracks: readonly { readonly track: { readonly id: string }; readonly diagnostics: readonly Diagnostic[] }[]; readonly song: readonly SongDiagnostic[] },
): OutputRow[] {
  const limit = profile.charLimitPerScore;
  const instrumentOf = (playerId: string) => song.players.find((p) => p.id === playerId)?.instrument.canonical;
  const byTrack = new Map<string, { level: string; code: string }[]>();
  for (const a of diagnostics.tracks) byTrack.set(a.track.id, [...a.diagnostics]);
  for (const d of diagnostics.song) if (d.trackId) byTrack.get(d.trackId)?.push(d);
  const scores = gameScores(song, (id) => maxChordsOf(profile, instrumentOf(id)), profile.maxChordsPerPlayer, limit);
  // 트랙마다 쓴 글 (소리 없는 자리에 붙인 트랙은 그 트랙의 악보에서 쓴 글 그대로)
  const written = new Map(scores.flatMap((s) => s.texts.map((x) => [x.trackId, x.text] as const)));
  return scores.map((score, k) => {
    const list = score.trackIds.flatMap((id) => byTrack.get(id) ?? []).filter((d) => !SHOWN_ELSEWHERE.has(d.code));
    const tracks = score.texts.map(({ trackId, text }) => ({
      trackId,
      name: song.tracks.find((t) => t.id === trackId)?.name ?? trackId,
      count: text.length,
      over: text.length > limit,
    }));
    const silentOver = score.pasted
      .filter((id): id is string => id !== null && !score.trackIds.includes(id) && (written.get(id)?.length ?? 0) > limit)
      .map((id) => song.tracks.find((t) => t.id === id)?.name ?? id);
    return {
      number: k + 1,
      playerId: score.playerId,
      index: score.index,
      instrument: instrumentOf(score.playerId) ?? "piano",
      maxChords: maxChordsOf(profile, instrumentOf(score.playerId)),
      tracks,
      text: score.text,
      over: tracks.some((t) => t.over) || silentOver.length > 0,
      fold: list.filter((d) => d.code === "pitch-fold").length,
      errors: list.filter((d) => d.level === "error").length,
      warnings: list.filter((d) => d.level === "warning" && d.code !== "pitch-fold").length,
      asIs: score.asIs,
      silent: score.pasted.filter((id) => id !== null && !score.trackIds.includes(id)).length,
      silentOver,
      moved: score.moved.length,
    };
  });
}

/**
 * 게임 범위 밖 템포마다 고칠 방법. 음 하나의 초 = 길이 × 240 / 템포라서, 너무 빠르면 템포를 반씩 줄이고
 * 음 길이도 그만큼 줄이면(1/2, 1/4 …: 4분음표 → 8분음표) 빠르기가 같고, 너무 느리면 그 반대(길이 ×2 …).
 * 템포가 홀수라 반으로 나누어떨어지지 않으면 가까운 정수를 권한다
 */
export function tempoAdvice(song: Song, range: { readonly min: number; readonly max: number }): TempoAdvice[] {
  const out: TempoAdvice[] = [];
  for (const e of song.tempo) {
    const high = e.bpm > range.max;
    if (!high && e.bpm >= range.min) continue;
    let factor = 1;
    if (high) while (e.bpm / factor > range.max) factor *= 2;
    else while (e.bpm * factor < range.min && factor < 64) factor *= 2;
    const to = Math.round(high ? e.bpm / factor : e.bpm * factor);
    out.push({ at: e.at, bpm: e.bpm, ...barBeatAt(song.timeSig, e.at), high, factor, to, lengthScale: high ? 1 / factor : factor });
  }
  return out;
}

/** 미리보기 한 줄: 트랙 MML 글자 수가 어떻게 바뀌나 */
export interface PreviewRow {
  readonly trackId: string;
  readonly name: string;
  readonly before: number;
  readonly after: number;
}

/** 두 곡의 트랙별 MML 글자 수 (트랙 목록에 보이는 수와 같은 글). 바뀐 트랙과 한도를 넘는 트랙만 */
export function previewRows(before: Song, after: Song, limit: number): PreviewRow[] {
  const length = (song: Song, id: string) => {
    const track = song.tracks.find((t) => t.id === id);
    return track ? trackSource(song, track).text.length : 0;
  };
  // 화음 병합으로 지운 트랙은 0자로 보인다
  const gone = before.tracks.filter((t) => !after.tracks.some((x) => x.id === t.id));
  return [...after.tracks, ...gone]
    .map((t) => ({ trackId: t.id, name: t.name, before: length(before, t.id), after: length(after, t.id) }))
    .filter((r) => r.before !== r.after || r.after > limit);
}

/** 복사한 뒤 트랙이 바뀌었는지 알아보는 도장: 음과 원문 */
export function trackStamp(track: Track): string {
  return JSON.stringify([track.notes.map((n) => [n.start.n, n.start.d, n.dur.n, n.dur.d, n.pitch, n.vol, n.tie]), track.mml ?? null, track.instrument ?? null]);
}

/** 이 트랙을 복사한 뒤 그대로인지 (copied: 트랙 id → 복사할 때 도장) */
export function isCopied(song: Song, copied: ReadonlyMap<string, string> | undefined, trackId: string): boolean {
  const stamp = copied?.get(trackId);
  if (stamp === undefined) return false;
  const track = song.tracks.find((t) => t.id === trackId);
  return track !== undefined && trackStamp(track) === stamp;
}

/**
 * 다음에 복사할 트랙 (MML로 내보내기 창에 미리 체크). 아직 복사하지 않은 트랙이 남은 첫 악보의 남은 트랙,
 * 그다음 한도 안에서 일부만 복사한 다른 악보의 남은 트랙을 악보째 더한다 (악보 1의 1·2·3과 악보 2의 1·3·6을 복사했으면
 * 악보 1의 4·5·6 + 악보 2의 2·4·5). 손대지 않은 악보는 섞지 않는다: 처음엔 전처럼 악보 하나씩
 */
export function nextExportPick(scores: readonly { readonly trackIds: readonly string[] }[], copied: (trackId: string) => boolean, limit: number): string[] {
  const left = scores.map((s) => ({ rest: s.trackIds.filter((id) => !copied(id)), partial: s.trackIds.some(copied) }));
  const first = left.findIndex((s) => s.rest.length > 0);
  if (first < 0) return [];
  const out = left[first]!.rest.slice(0, limit);
  for (const s of left.slice(first + 1)) if (s.partial && s.rest.length > 0 && out.length + s.rest.length <= limit) out.push(...s.rest);
  return out;
}
