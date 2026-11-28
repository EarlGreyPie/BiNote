import { staffGrand, staffKindOf, staffOctaveOf, staffTrack, trackInstrument, type Note, type Song, type StaffBar } from "@mmlce/core";
import type { StaffRow } from "./staffDraw";

/**
 * 오선보에 그릴 단 목록. 악기마다 모양이 다르다 (staffKindOf):
 * - 큰보표(건반·하프 계열): 한 악보에서 같은 악기를 쓰는 트랙을 모두 합쳐 위·아래 두 단
 * - 타악기: 트랙마다 음높이 없는 한 단
 * - 나머지: 트랙마다 한 단 (음역에 따라 높은/낮은음자리표)
 * 단 순서는 트랙 순서를 따르고, 큰보표는 그 악보의 첫 트랙 자리에 놓는다.
 * 옥타브 표시(staffOctaveOf): 기타는 한 옥타브 높여 적고 8vb, 한 옥타브 높게 소리 나는 악기(soundingOctave)는 8va
 */
export function staffRows(
  song: Song,
  trackIds: readonly string[],
  bars: readonly StaffBar[],
  colors: ReadonlyMap<string, string>,
  volume: { readonly min: number; readonly max: number },
  soundingOctave: Readonly<Record<string, number>> = {},
): StaffRow[] {
  const rows: StaffRow[] = [];
  /** 큰보표로 이미 그린 (악보, 악기) */
  const merged = new Set<string>();
  const picked = new Set(trackIds);
  for (const id of trackIds) {
    const tr = song.tracks.find((x) => x.id === id);
    if (!tr) continue;
    const canonical = trackInstrument(song, tr).canonical;
    const kind = staffKindOf(canonical);
    const color = colors.get(id) ?? "currentColor";
    const octave = staffOctaveOf(canonical, soundingOctave);
    const written = (notes: readonly Note[]): readonly Note[] => (octave.shift === 0 ? notes : notes.map((n) => ({ ...n, pitch: n.pitch + octave.shift })));
    const mark = octave.mark ? { octave: octave.mark } : {};
    if (kind === "grand") {
      const key = `${tr.playerId}\u0000${canonical}`;
      if (merged.has(key)) continue;
      merged.add(key);
      // 같은 악보·같은 악기로 고른 트랙의 음을 모두 합친다 (그릴 범위 밖 트랙은 넣지 않는다)
      const notes: Note[] = song.tracks.filter((t) => picked.has(t.id) && t.playerId === tr.playerId && trackInstrument(song, t).canonical === canonical).flatMap((t) => t.notes);
      const player = song.players.find((p) => p.id === tr.playerId);
      const g = staffGrand(written(notes), bars, volume);
      rows.push({ trackId: id, name: player?.name ?? tr.name, color, clef: "treble", voices: g.upper.voices, braceDown: true, ...mark });
      rows.push({ trackId: id, name: "", color, clef: "bass", voices: g.lower.voices, ...mark });
      continue;
    }
    if (kind === "percussion") {
      const view = staffTrack(tr.notes, bars, volume, { clef: "percussion" });
      rows.push({ trackId: id, name: tr.name, color, clef: view.clef, voices: [view] });
      continue;
    }
    const view = staffTrack(written(tr.notes), bars, volume, octave.clef ? { clef: octave.clef } : {});
    rows.push({ trackId: id, name: tr.name, color, clef: view.clef, voices: [view], ...mark });
  }
  return rows;
}
