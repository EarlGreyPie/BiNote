import { add, assignTab, cmp, replaceSong, type Command, type Note, type PlayerTab, type TabTuning, type Track } from "@mmlce/core";
import { setPlayerTab, setTracksNotes } from "@mmlce/mml";
import { struckNotes, tieLinks } from "./tabMarks";

/** 타브 그대로 튜닝 바꾸기 결과 */
export interface Retune {
  /** 바뀐 트랙과 그 음 (바뀐 것이 없으면 빈 목록) */
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 높이가 바뀐 음 수 (&로 이어 울리는 뒷음 포함) */
  readonly moved: number;
  /** 지금 타브에 자리가 없거나(칠 수 없는 음) 새 튜닝에 그 줄이 없거나 MIDI 범위를 넘어 그대로 둔 음 수 */
  readonly kept: number;
}

/**
 * 잘못 고른 튜닝으로 타브를 친 뒤 튜닝만 바로잡는다: 지금 타브에 보이는 줄·프렛 숫자는 그대로 두고, 새 튜닝(카포 포함)에서
 * 그 줄·프렛이 내는 높이로 음을 바꾼다. 줄 배정은 타브 보기와 같다(소리 켠 트랙만, 같은 높이로 &한 뒷음은 앞 음을 따른다).
 * 바꾼 음에는 그 줄(tabString)을 적어 새 튜닝에서도 같은 줄에 남게 한다
 */
export function retuneKeepingTab(tracks: readonly Track[], from: TabTuning, to: TabTuning): Retune {
  const links = tieLinks(tracks.map((t) => t.notes));
  const slides = new Map(links.flatMap((l) => (l.kind === "slide" ? [[l.to, l.from] as const] : [])));
  const events = assignTab(
    tracks.flatMap((t) => struckNotes(t.notes)),
    from,
    new Map(),
    slides,
  );
  /** 친 음 id → 새 높이와 줄 */
  const placed = new Map<string, { pitch: number; string: number }>();
  for (const e of events) {
    for (const { note, at } of e.notes) {
      const open = at && to.strings[at.string - 1];
      if (!at || open === undefined) continue;
      const pitch = open + to.capo + at.fret;
      if (pitch < 0 || pitch > 127) continue;
      placed.set(note.id, { pitch, string: at.string });
    }
  }

  let moved = 0;
  let kept = 0;
  const changes: { trackId: string; notes: Note[] }[] = [];
  for (const track of tracks) {
    const byId = new Map<string, Note>();
    let prev: Note | undefined;
    /** 이어 울리는 사슬의 앞 음이 받은 높이 차이 (못 옮긴 음이면 undefined) */
    let shift: number | undefined;
    for (const n of [...track.notes].sort((a, b) => cmp(a.start, b.start))) {
      const held = prev?.tie === "next" && prev.pitch === n.pitch && cmp(add(prev.start, prev.dur), n.start) === 0;
      prev = n;
      if (held) {
        if (shift === undefined) kept++;
        else if (shift !== 0) {
          byId.set(n.id, { ...n, pitch: n.pitch + shift });
          moved++;
        }
        continue;
      }
      const next = placed.get(n.id);
      shift = next ? next.pitch - n.pitch : undefined;
      if (!next) {
        kept++;
        continue;
      }
      if (next.pitch !== n.pitch) moved++;
      if (next.pitch !== n.pitch || n.tabString !== next.string) byId.set(n.id, { ...n, pitch: next.pitch, tabString: next.string });
    }
    if (byId.size > 0) changes.push({ trackId: track.id, notes: track.notes.map((n) => byId.get(n.id) ?? n) });
  }
  return { changes: moved > 0 ? changes : [], moved, kept };
}

/**
 * 음 높이와 악보 튜닝을 한 단계로 바꾸는 명령. 실행 취소 한 번에 둘 다 돌아가야 타브 숫자가 그대로 보인다
 * (튜닝은 보통 기록 밖이지만, 한 단계가 튜닝을 바꾸면 History가 그 단계의 앞뒤 튜닝을 기억한다)
 */
export function retuneCommand(playerId: string, to: PlayerTab, changes: Retune["changes"], label: string): Command {
  return {
    label,
    apply: (song) => setPlayerTab(playerId, to).apply(setTracksNotes(changes, label).apply(song)),
    invert: (before) => replaceSong(label, before),
  };
}
