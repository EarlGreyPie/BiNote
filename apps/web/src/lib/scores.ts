import { add, chainVolumes, cmp, type Note, type Rat, type Song } from "@mmlce/core";

/** 사슬 볼륨은 core 한곳에서 계산한다 (울림·재생·표시가 같은 판정) */
export { chainVolumes };

/** 게임에 붙여넣는 단위 하나: 연주자 한 명의 트랙 최대 maxChords개 */
export interface ScoreGroup {
  /** 곡 안에서 1부터 */
  readonly number: number;
  readonly playerId: string;
  readonly trackIds: readonly string[];
}

/**
 * 곡의 트랙을 악보 단위로 묶는다. 연주자 순서대로, 연주자마다 트랙 순서대로 maxChords개씩 끊는다
 * (MML@ 복사와 같은 묶음). 연주자가 없는 트랙은 맨 끝에 따로 묶는다.
 */
export function scoreGroups(song: Song, maxChords: number | ((playerId: string) => number)): ScoreGroup[] {
  const out: ScoreGroup[] = [];
  const owners = [...song.players.map((p) => p.id), ...new Set(song.tracks.map((t) => t.playerId))];
  for (const playerId of new Set(owners)) {
    const ids = song.tracks.filter((t) => t.playerId === playerId).map((t) => t.id);
    const size = Math.max(1, typeof maxChords === "number" ? maxChords : maxChords(playerId));
    for (let i = 0; i < ids.length; i += size) {
      out.push({ number: out.length + 1, playerId, trackIds: ids.slice(i, i + size) });
    }
  }
  return out;
}

/**
 * 멜로디 트랙 (음량 레인 여러 트랙 그리기에서 그은 값을 그대로 받는다). "멜로디"로 표시한 트랙,
 * 악보에 표시한 트랙이 없으면 그 악보 첫 트랙 (첫 트랙에 다른 역할을 주면 빠진다)
 */
export function melodyTrackIds(song: Song, groups: readonly ScoreGroup[]): Set<string> {
  const out = new Set<string>();
  const roleOf = (id: string) => song.tracks.find((t) => t.id === id)?.role;
  for (const g of groups) {
    const marked = g.trackIds.filter((id) => roleOf(id) === "melody");
    if (marked.length > 0) marked.forEach((id) => out.add(id));
    else if (g.trackIds[0] && roleOf(g.trackIds[0]) === "free") out.add(g.trackIds[0]);
  }
  return out;
}

/** 트랙 목록에서 무엇을 보여 줄지: 곡 전체, 악보 하나, 고른 트랙 하나 */
export type TrackView = { readonly kind: "all" } | { readonly kind: "score"; readonly number: number } | { readonly kind: "track" };

/** 이 보기에서 보여 줄 트랙 id. 모르는 악보 번호면 곡 전체 */
export function visibleTrackIds(song: Song, groups: readonly ScoreGroup[], view: TrackView, activeTrackId: string | undefined): string[] {
  if (view.kind === "track" && activeTrackId && song.tracks.some((t) => t.id === activeTrackId)) return [activeTrackId];
  if (view.kind === "score") {
    const group = groups.find((g) => g.number === view.number);
    if (group) return [...group.trackIds];
  }
  return song.tracks.map((t) => t.id);
}

/**
 * 트랙 색 방식.
 * - position: 악보 안 위치마다 같은 색 (어느 악보든 1번 파랑, 2번 주황 …)
 * - score: 악보마다 색 계열, 같은 악보 안 트랙은 색조를 조금씩 돌리고 진하기를 번갈아 구분
 * - stored: 파일에 저장된 트랙 색 그대로 (곡 전체에 6색을 차례로)
 */
export type ColorScheme = "position" | "score" | "stored";
/** 트랙 색을 고를 바탕: 밝은 테마는 진한 색, 어두운 테마는 밝은 색 */
export type PaletteTheme = "light" | "dark";

/** 위치 방식 6색. 밝은 바탕·어두운 바탕에서 각각 또렷하게 따로 고른 짝 */
const POSITION_COLORS: Record<PaletteTheme, readonly string[]> = {
  light: ["#2f6fe4", "#e0592f", "#1f9d5c", "#9146e0", "#c48a00", "#0094b3"],
  dark: ["#6ea2ff", "#ff8a66", "#4fcf8a", "#c08cff", "#f5c542", "#3fd0ec"],
};
const SCORE_HUES = [218, 14, 145, 275, 45, 190, 330, 95];
/** 악보 방식: 같은 악보 안 k번째 트랙의 색조 어긋남. 진하기만으로 나누면 6트랙이 구분되지 않아서 */
const HUE_STEPS = [0, 26, -26, 52, -52, 78];

/** 트랙 id → 화면에 쓸 색 */
export function trackColors(song: Song, groups: readonly ScoreGroup[], scheme: ColorScheme, theme: PaletteTheme = "light"): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of song.tracks) out.set(t.id, t.color);
  if (scheme === "stored") return out;
  const palette = POSITION_COLORS[theme];
  for (const g of groups) {
    g.trackIds.forEach((id, k) => {
      if (scheme === "position") out.set(id, palette[k % palette.length]!);
      else {
        const hue = (SCORE_HUES[(g.number - 1) % SCORE_HUES.length]! + HUE_STEPS[k % HUE_STEPS.length]! + 360) % 360;
        // 진하기는 두 단계를 번갈아 (밝은 테마 42/56%, 어두운 테마 62/74%)
        const light = (theme === "dark" ? 62 : 42) + (k % 2) * (theme === "dark" ? 12 : 14);
        out.set(id, `hsl(${hue} 72% ${light}%)`);
      }
    });
  }
  return out;
}

/** 이 시점(온음표 단위)에 울리는 음 수 (음소거 트랙 제외) */
/**
 * 소리 나는 음 [시작, 끝]. 재생처럼 &로 바로 이어 붙인 음은 첫 음의 볼륨으로 이어 가므로,
 * 사슬 첫 음이 v0이면 사슬 전체가 무음이고 뒤 조각의 v0은 소리를 끊지 않는다
 */
function soundingNotes(notes: readonly Note[]): { start: Rat; end: Rat }[] {
  const vols = chainVolumes(notes);
  return [...notes]
    .sort((a, b) => cmp(a.start, b.start))
    .filter((n) => (vols.get(n.id) ?? 0) > 0)
    .map((n) => ({ start: n.start, end: add(n.start, n.dur) }));
}

/** 재생에서 소리 나는 트랙인지 (음소거 제외, 솔로가 있으면 솔로만) */
function audible(song: Song): Song["tracks"] {
  const anySolo = song.tracks.some((t) => t.solo);
  return song.tracks.filter((t) => !t.mute && (!anySolo || t.solo));
}

export function soundingAt(song: Song, time: number): number {
  let count = 0;
  for (const t of audible(song)) {
    for (const n of soundingNotes(t.notes)) {
      // 시작은 그대로 나눠 비교하고, 끝은 분수로 더해 1/3+2/3 같은 경계가 소수 오차로 겹치지 않게 한다
      const end = n.end;
      if (n.start.n <= time * n.start.d && time * end.d < end.n) count++;
    }
  }
  return count;
}

/** 곡 전체에서 가장 많이 동시에 울리는 음 수와 그 시점 */
export function peakPolyphony(song: Song): { count: number; at: number } {
  const edges: [Rat, number][] = [];
  for (const t of audible(song)) {
    for (const n of soundingNotes(t.notes)) edges.push([n.start, 1], [n.end, -1]);
  }
  // 같은 시점이면 끝나는 음을 먼저 뺀다 (시점은 분수로 정확히 비교)
  edges.sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]);
  let now = 0;
  let best = { count: 0, at: 0 };
  for (const [at, d] of edges) {
    now += d;
    if (now > best.count) best = { count: now, at: at.n / at.d };
  }
  return best;
}
