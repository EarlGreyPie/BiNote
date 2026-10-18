import { CHORD_KIND_IDS, cmp, type ArpOrder, type ArpSource, type ArpStyle, type ChordKind, type Note, type Rat, type Song } from "@mmlce/core";
import { NOTE_LENGTHS, type NoteLength } from "./roll";

/** 아르페지오 창에서 고른 것 (이 브라우저에 마지막 값을 기억한다) */
export interface ArpChoice {
  readonly source: ArpSource;
  readonly chord: ChordKind;
  readonly style: ArpStyle;
  readonly order: ArpOrder;
  readonly length: NoteLength;
  readonly octaves: 1 | 2 | 3;
  readonly repeat: boolean;
  readonly clear: boolean;
}

export const ARP_KEY = "mmlce.arpeggio";

export const DEFAULT_ARP: ArpChoice = { source: "together", chord: "major", style: "spread", order: "up", length: "16", octaves: 1, repeat: true, clear: true };

/** 저장해 둔 값을 읽는다. 모르는 값은 기본으로 */
export function parseArpChoice(raw: unknown): ArpChoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  return {
    source: pick(v.source, ["together", "selected", "chord"] as const, DEFAULT_ARP.source),
    chord: pick(v.chord, CHORD_KIND_IDS, DEFAULT_ARP.chord),
    style: pick(v.style, ["spread", "strum"] as const, DEFAULT_ARP.style),
    order: pick(v.order, ["up", "down", "updown", "random"] as const, DEFAULT_ARP.order),
    length: pick(v.length, NOTE_LENGTHS, DEFAULT_ARP.length),
    octaves: pick(v.octaves, [1, 2, 3] as const, DEFAULT_ARP.octaves),
    repeat: typeof v.repeat === "boolean" ? v.repeat : DEFAULT_ARP.repeat,
    clear: typeof v.clear === "boolean" ? v.clear : DEFAULT_ARP.clear,
  };
}

/**
 * 타브 보기에서 아르페지오에 넘길 화음. 타브에서 고른 음이 있으면 첫 고른 음의 트랙에서 고른 음을 쓴다.
 * 없으면 타브 커서 자리(at)에서 시작하는 같은 악보(소리 끄지 않은 트랙, 타브에 보이는 트랙)의 음:
 * 고른 트랙에 있으면 그 음, 없으면 위쪽 트랙의 그 자리 음. 하나도 없으면 undefined
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
    if (track) return { trackId: track.id, picked: track.notes.filter((n) => ids.has(n.id)) };
  }
  const active = song.tracks.find((t) => t.id === activeTrackId);
  if (!active || !at) return undefined;
  const same = song.tracks.filter((t) => t.playerId === active.playerId && !t.mute);
  for (const t of [active, ...same.filter((x) => x.id !== active.id)]) {
    const hit = t.notes.find((n) => cmp(n.start, at) === 0);
    if (hit) return { trackId: t.id, picked: [hit] };
  }
  return undefined;
}
