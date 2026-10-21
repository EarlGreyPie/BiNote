import { CHORD_KIND_IDS, cmp, defaultLengthLimit, type ArpOrder, type ArpSource, type ArpStyle, type ChordKind, type Note, type Rat, type Song } from "@mmlce/core";
import type { LengthName } from "./roll";
import { isGameLengthName } from "./tuplet";

/** 아르페지오 음 길이 목록: 셋잇단(l3·l6·l12·l24·l48)을 넣어 긴 것부터 길이 순 (게임 한도는 lengthsFor로 거른다) */
export const ARP_LENGTHS = ["grid", "1", "2.", "2", "4.", "3", "4", "8.", "6", "8", "16.", "12", "16", "32.", "24", "32", "64.", "48", "64"] as const satisfies readonly LengthName[];
/** 목록 길이 + 사용자가 정한 잇단음 ("20", "20.") */
export type ArpLength = (typeof ARP_LENGTHS)[number] | `${number}` | `${number}.`;

/** 아르페지오 창에서 고른 것 (이 브라우저에 마지막 값을 기억한다) */
export interface ArpChoice {
  readonly source: ArpSource;
  readonly chord: ChordKind;
  readonly style: ArpStyle;
  readonly order: ArpOrder;
  readonly length: ArpLength;
  readonly octaves: 1 | 2 | 3;
  readonly repeat: boolean;
  readonly clear: boolean;
}

export const ARP_KEY = "mmlce.arpeggio";
/** 저장값 판: 2부터 굴려 치기가 방식(roll)으로 따로 있다. 판이 없는 예전 값만 옮겨 읽는다 */
export const ARP_STORE_VERSION = 2;

/** 저장할 글 (판을 붙인다) */
export function storeArpChoice(choice: ArpChoice): string {
  return JSON.stringify({ ...choice, v: ARP_STORE_VERSION });
}

export const DEFAULT_ARP: ArpChoice = { source: "together", chord: "major", style: "spread", order: "up", length: "16", octaves: 1, repeat: true, clear: true };

/** 저장해 둔 값을 읽는다. 모르는 값은 기본으로 */
export function parseArpChoice(raw: unknown): ArpChoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const octaves = pick(v.octaves, [1, 2, 3] as const, DEFAULT_ARP.octaves);
  const repeat = typeof v.repeat === "boolean" ? v.repeat : DEFAULT_ARP.repeat;
  // 예전(beta.21까지, 판 없음)에는 깔기 + 옥타브 1 + 반복 끔이 굴려 치기였다
  const style = pick(v.style, ["spread", "roll", "strum"] as const, DEFAULT_ARP.style);
  const old = v.v !== ARP_STORE_VERSION;
  return {
    source: pick(v.source, ["together", "selected", "chord"] as const, DEFAULT_ARP.source),
    chord: pick(v.chord, CHORD_KIND_IDS, DEFAULT_ARP.chord),
    style: old && style === "strum" && octaves === 1 && !repeat ? "roll" : style,
    order: pick(v.order, ["up", "down", "updown", "random"] as const, DEFAULT_ARP.order),
    // 잇단음은 게임이 받는 한 토막이면 받는다 (곡 프로필로 다시 거르는 건 창이 한다)
    length: isGameLengthName(v.length, defaultLengthLimit()) ? v.length : pick(v.length, ARP_LENGTHS, DEFAULT_ARP.length),
    octaves,
    repeat,
    clear: typeof v.clear === "boolean" ? v.clear : DEFAULT_ARP.clear,
  };
}

/**
 * 타브 보기에서 아르페지오에 넘길 화음. 타브는 화음 음이 줄마다 다른 트랙에 있어서 같은 악보의 여러 트랙 음을 함께 넘긴다.
 * 고른 음이 있으면 첫 고른 음의 트랙을 고른 트랙으로, 그 악보에서 고른 음 전부.
 * 없으면 타브 커서 자리(at)에서 시작하는 같은 악보(소리 끄지 않은 트랙, 타브에 보이는 트랙)의 음 전부:
 * 고른 트랙에 그 자리 음이 있으면 고른 트랙, 없으면 그 자리 음이 있는 위쪽 트랙이 고른 트랙. 하나도 없으면 undefined
 */
export function tabArpPick(
  song: Pick<Song, "tracks">,
  activeTrackId: string | undefined,
  at: Rat | undefined,
  selected: readonly Note[] = [],
): { trackId: string; picked: Note[] } | undefined {
  if (selected.length > 0) {
    const ids = new Set(selected.map((n) => n.id));
    const track = song.tracks.find((t) => t.notes.some((n) => n.id === selected[0]!.id));
    if (track) {
      const score = song.tracks.filter((t) => t.playerId === track.playerId);
      return { trackId: track.id, picked: score.flatMap((t) => t.notes.filter((n) => ids.has(n.id))) };
    }
  }
  const active = song.tracks.find((t) => t.id === activeTrackId);
  if (!active || !at) return undefined;
  const same = song.tracks.filter((t) => t.playerId === active.playerId && !t.mute);
  const order = [active, ...same.filter((x) => x.id !== active.id)];
  const hits = order.map((t) => ({ t, notes: t.notes.filter((n) => cmp(n.start, at) === 0) })).filter((x) => x.notes.length > 0);
  if (hits.length === 0) return undefined;
  return { trackId: hits[0]!.t.id, picked: hits.flatMap((x) => x.notes) };
}
