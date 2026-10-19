import { describe, expect, it } from "vitest";
import { assignTab, emptySong, rat, STANDARD_TUNING, type Note, type Song } from "@mmlce/core";
import { fretFromKeys, pinShownStrings, placeTabNote, shownStrings, typeFretDigit, type DigitNote, removeTabNote, setTabNoteLength, tieTabNote } from "../src/lib/tabInput";

function song(): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  const track = (id: string) => ({ id, playerId: "p", name: id, color: "", role: "free" as const, mute: false, solo: false, notes: [] as Note[], spelling: {} });
  return { ...base, players: [{ id: "p", name: "", instrument: { canonical: "folk-guitar" } }], tracks: [track("a"), track("b")] };
}

describe("타브 입력", () => {
  it("빈 트랙부터 채워 같은 자리 화음은 트랙을 나눠 쓴다", () => {
    let s = song();
    const put = (pitch: number) => {
      const edit = placeTabNote(s, ["a", "b"], "a", rat(0), rat(1, 8), pitch);
      s = { ...s, tracks: s.tracks.map((t) => ({ ...t, notes: edit.changes.find((c) => c.trackId === t.id)?.notes ?? t.notes })) };
    };
    put(64);
    put(59);
    expect(s.tracks.map((t) => t.notes.map((n) => n.pitch))).toEqual([[64], [59]]);
  });

  it("같은 줄에 다시 치면 그 음 높이만 바꾸고, 지우면 빠진다", () => {
    const s0 = song();
    const first = placeTabNote(s0, ["a", "b"], "a", rat(0), rat(1, 8), 64);
    const s1 = { ...s0, tracks: s0.tracks.map((t) => (t.id === "a" ? { ...t, notes: first.changes[0]!.notes } : t)) };
    const note = s1.tracks[0]!.notes[0]!;
    const again = placeTabNote(s1, ["a", "b"], "a", rat(0), rat(1, 8), 65, note);
    expect(again.changes[0]!.notes.map((n) => [n.id, n.pitch])).toEqual([[note.id, 65]]);
    expect(removeTabNote(s1, note).changes[0]!.notes).toEqual([]);
  });

  it("빈 트랙이 없으면 덮어쓰지 않고 트랙을 더해 넣고, 한도면 넣지 않는다", () => {
    let s = song();
    const put = (pitch: number) => {
      const edit = placeTabNote(s, ["a", "b"], "a", rat(0), rat(1, 8), pitch, undefined, undefined, 3);
      s = { ...s, tracks: s.tracks.map((t) => ({ ...t, notes: edit.changes.find((c) => c.trackId === t.id)?.notes ?? t.notes })) };
      return edit;
    };
    put(64);
    put(59);
    const third = put(55);
    // 앞 두 음은 그대로 남는다 (예전에는 고른 트랙의 64가 지워졌다)
    expect(s.tracks.map((t) => t.notes.map((n) => n.pitch))).toEqual([[64], [59]]);
    expect(third.newTrack?.playerId).toBe("p");
    expect(third.newTrack?.notes.map((n) => n.pitch)).toEqual([55]);
    expect(third.noteId).toBe(third.newTrack?.notes[0]?.id);
    expect(third.newTrack?.instrument).toBeUndefined();
    // 고른 트랙에 악기를 따로 정했으면 새 트랙도 그 악기 (악보 기본 악기로 바뀌지 않게)
    const guitar = { canonical: "guitar" };
    const own = { ...s, tracks: s.tracks.map((t) => (t.id === "a" ? { ...t, instrument: guitar } : t)) };
    expect(placeTabNote(own, ["a", "b"], "a", rat(0), rat(1, 8), 55, undefined, undefined, 3).newTrack?.instrument).toEqual(guitar);
    // 트랙이 이미 한도(2)면 넣지 않는다
    const full = placeTabNote(s, ["a", "b"], "a", rat(0), rat(1, 8), 55, undefined, undefined, 2);
    expect(full).toEqual({ changes: [], noteId: undefined, full: true });
  });

  it("음 길이를 바꾸되 뒤 음 앞까지만 늘린다", () => {
    const n = (id: string, start: number, dur: number, pitch = 64): Note => ({ id, start: rat(start, 16), dur: rat(dur, 16), pitch, vol: 8, tie: "none" });
    const base = song();
    const s = { ...base, tracks: base.tracks.map((t) => (t.id === "a" ? { ...t, notes: [n("x", 0, 1), n("y", 8, 2)] } : t)) };
    const x = s.tracks[0]!.notes[0]!;
    const len = (d: { changes: { notes: Note[] }[] }) => d.changes[0]!.notes.map((m) => [m.id, m.dur.n, m.dur.d]);
    // 4분음표로: 다음 음(8/16)까지 자리가 있어 그대로
    expect(len(setTabNoteLength(s, x, rat(1, 4)))).toEqual([["x", 1, 4], ["y", 1, 8]]);
    // 온음표로: 다음 음 앞(반음표)까지만 늘리고 다음 음은 남는다
    expect(len(setTabNoteLength(s, x, rat(1)))).toEqual([["x", 1, 2], ["y", 1, 8]]);
  });

  it("& 잇기: 뒤가 비면 같은 음을 새 음 길이만큼 더해 잇고, 붙어 있으면 그 음과 잇는다", () => {
    const n = (id: string, start: number, dur: number, pitch = 64): Note => ({ id, start: rat(start, 16), dur: rat(dur, 16), pitch, vol: 8, tie: "none" });
    const base = song();
    const withNotes = (notes: Note[]) => ({ ...base, tracks: base.tracks.map((t) => (t.id === "a" ? { ...t, notes } : t)) });
    // 뒤가 비었다: 64를 8분음표 더해 잇는다
    const s1 = withNotes([n("x", 0, 2)]);
    const e1 = tieTabNote(s1, s1.tracks[0]!.notes[0]!, rat(1, 8));
    const out1 = e1.changes[0]!.notes;
    expect(out1.map((m) => [m.pitch, m.start.n, m.start.d, m.dur.n, m.dur.d, m.tie])).toEqual([
      [64, 0, 1, 1, 8, "next"],
      [64, 1, 8, 1, 8, "none"],
    ]);
    expect(e1.noteId).toBe(out1[1]!.id);
    // 빈자리(1/16)보다 길면 다음 음 앞까지만
    const s2 = withNotes([n("x", 0, 2), n("y", 3, 1, 67)]);
    const out2 = tieTabNote(s2, s2.tracks[0]!.notes[0]!, rat(1, 4)).changes[0]!.notes;
    expect(out2.map((m) => [m.pitch, m.dur.n, m.dur.d])).toEqual([[64, 1, 8], [64, 1, 16], [67, 1, 16]]);
    // 바로 붙은 다른 음이면 슬라이드로 잇고, 다시 누르면 푼다
    const s3 = withNotes([n("x", 0, 2), n("y", 2, 2, 67)]);
    const tied = tieTabNote(s3, s3.tracks[0]!.notes[0]!, rat(1, 8));
    expect(tied.changes[0]!.notes.map((m) => m.tie)).toEqual(["next", "none"]);
    expect(tied.noteId).toBeUndefined();
    const s4 = withNotes(tied.changes[0]!.notes);
    expect(tieTabNote(s4, s4.tracks[0]!.notes[0]!, rat(1, 8)).changes[0]!.notes.map((m) => m.tie)).toEqual(["none", "none"]);
  });

  it("숫자 두 개를 이어 치면 두 자리 프렛", () => {
    expect(fretFromKeys("", "1", 20)).toEqual({ fret: 1, buffer: "1" });
    expect(fretFromKeys("1", "2", 20)).toEqual({ fret: 12, buffer: "" });
    expect(fretFromKeys("", "5", 20)).toEqual({ fret: 5, buffer: "" });
    expect(fretFromKeys("2", "5", 20)).toEqual({ fret: 5, buffer: "" });
  });

  it("타브에서 고른 줄을 자동 배정이 지킨다", () => {
    // E4(64)는 보통 1번 줄 개방현이지만, 2번 줄 5프렛으로 골랐으면 그대로
    const n: Note = { id: "x", start: rat(0), dur: rat(1, 4), pitch: 64, vol: 8, tie: "none" };
    expect(assignTab([n], STANDARD_TUNING)[0]!.notes[0]!.at).toEqual({ string: 1, fret: 0 });
    expect(assignTab([n], STANDARD_TUNING, new Map([["x", 2]]))[0]!.notes[0]!.at).toEqual({ string: 2, fret: 5 });
  });
});

describe("타브에서 & 사슬 가운데 음 (beta.11, #98 Codex 점검)", () => {
  const chained = (): Song => {
    const s = song();
    const notes: Note[] = [
      { id: "e", start: rat(0), dur: rat(1, 4), pitch: 64, vol: 12, tie: "next" },
      { id: "g", start: rat(1, 4), dur: rat(1, 4), pitch: 67, vol: 2, tie: "next" },
      { id: "a", start: rat(1, 2), dur: rat(1, 4), pitch: 69, vol: 3, tie: "none" },
    ];
    return { ...s, tracks: s.tracks.map((t) => (t.id === "a" ? { ...t, notes } : t)) };
  };
  const vols = (notes: readonly Note[]) => notes.map((n) => `${n.id}${n.tie === "next" ? "&" : ""}:${n.vol}`);

  it("가운데 음 길이를 줄이면 뒤 음은 사슬 첫 음 v로 소리 낸다", () => {
    const s = chained();
    const g = s.tracks[0]!.notes[1]!;
    expect(vols(setTabNoteLength(s, g, rat(1, 8)).changes[0]!.notes)).toEqual(["e&:12", "g:2", "a:12"]);
  });

  it("가운데 음을 지워도 뒤 음은 사슬 첫 음 v를 받는다", () => {
    const s = chained();
    expect(vols(removeTabNote(s, s.tracks[0]!.notes[1]!).changes[0]!.notes)).toEqual(["e:12", "a:12"]);
  });
});


describe("두 자리 프렛으로 화음을 줄마다 넣기 (E♭maj7 15·15·15·13)", () => {
  /** TabView의 숫자 키 흐름을 그대로 따라 한다: 숫자 버퍼, 첫 숫자 음 기억, 커서 줄 음 찾기, 고른 줄 적기 */
  function typer(maxTracks = 3) {
    const base = emptySong({ title: "", author: "", profileId: "mobile" });
    const track = (id: string) => ({ id, playerId: "p", name: id, color: "", role: "free" as const, mute: false, solo: false, notes: [] as Note[], spelling: {} });
    let s: Song = { ...base, players: [{ id: "p", name: "", instrument: { canonical: "folk-guitar" } }], tracks: [track("t1"), track("t2"), track("t3")] };
    let digits = "";
    let memo: DigitNote | undefined;
    let full = false;
    let n = 0;
    const key = (string: number, digit: string, waited = false) => {
      if (waited) digits = "";
      const cursor = { at: rat(0), string };
      const { fret, buffer, replaceId } = typeFretDigit(digits, memo, digit, cursor, STANDARD_TUNING.maxFret);
      digits = buffer;
      const all = s.tracks.flatMap((t) => t.notes);
      const onString = assignTab(all, STANDARD_TUNING)[0]?.notes.find((x) => x.at?.string === string)?.note;
      const replace = (replaceId ? all.find((x) => x.id === replaceId) : undefined) ?? onString;
      const pitch = STANDARD_TUNING.strings[string - 1]! + fret;
      const edit = placeTabNote(s, s.tracks.map((t) => t.id), "t1", rat(0), rat(1, 4), pitch, replace, undefined, maxTracks);
      if (edit.full) {
        full = true;
        return;
      }
      // 같은 밀리초에 만든 음 id가 겹치지 않게 시험에서만 새 id를 붙인다
      const fresh = (notes: readonly Note[]) => notes.map((x) => (x.id === edit.noteId && !replace ? { ...x, id: `k${++n}` } : x));
      const id = replace ? edit.noteId : `k${n + 1}`;
      const stamp = (notes: readonly Note[]) => fresh(notes).map((x) => (x.id === id ? { ...x, tabString: string } : x));
      if (edit.newTrack) s = { ...s, tracks: [...s.tracks, { ...track(`t${s.tracks.length + 1}`), notes: stamp(edit.newTrack.notes) }] };
      else s = { ...s, tracks: s.tracks.map((t) => ({ ...t, notes: stamp(edit.changes.find((c) => c.trackId === t.id)?.notes ?? t.notes) })) };
      memo = id ? { id, at: cursor.at, string } : undefined;
    };
    const pitches = () => s.tracks.map((t) => `${t.id}:[${t.notes.map((x) => x.pitch).join(",")}]`).join(" ");
    const strings = () => assignTab(s.tracks.flatMap((t) => t.notes), STANDARD_TUNING)[0]!.notes.map((x) => `${x.note.pitch}→${x.at?.string}:${x.at?.fret}`).sort();
    return { key, pitches, strings, isFull: () => full };
  }

  it("친 줄과 트랙에 그대로 들어가고 음이 하나 더 생기지 않는다", () => {
    const t = typer();
    t.key(1, "1"); t.key(1, "5");
    t.key(2, "1"); t.key(2, "5");
    // 전에는 여기서 t1:[79] t2:[60] t3:[74], 60은 5번 줄 15로 밀려 보였다
    expect(t.pitches()).toBe("t1:[79] t2:[74] t3:[]");
    t.key(3, "1"); t.key(3, "5");
    expect(t.pitches()).toBe("t1:[79] t2:[74] t3:[70]");
    expect(t.strings()).toEqual(["70→3:15", "74→2:15", "79→1:15"]);
    // D줄 13(63)은 넷째 음: 트랙 한도 3이면 넣지 않고 알린다 (지금 규칙 그대로)
    t.key(4, "1");
    expect(t.isFull()).toBe(true);
    expect(t.pitches()).toBe("t1:[79] t2:[74] t3:[70]");
  });

  it("한도 안이면 넷째 음은 트랙을 더해 D줄 13", () => {
    const t = typer(4);
    for (const s of [1, 2, 3]) {
      t.key(s, "1");
      t.key(s, "5");
    }
    t.key(4, "1"); t.key(4, "3");
    expect(t.pitches()).toBe("t1:[79] t2:[74] t3:[70] t4:[63]");
    expect(t.strings()).toContain("63→4:13");
  });

  it("버퍼 시간이 지나 둘째 숫자가 따로 오면 그 줄 음을 5프렛으로 바꾼다", () => {
    const t = typer();
    t.key(2, "1");
    t.key(2, "5", true);
    expect(t.pitches()).toBe("t1:[64] t2:[] t3:[]");
    expect(t.strings()).toEqual(["64→2:5"]);
  });

  it("두 자리 사이 커서를 옮기면 기억을 버리고 새 자리에 5", () => {
    const t = typer();
    t.key(2, "1");
    t.key(3, "5");
    expect(t.strings()).toEqual(["60→2:1", "60→3:5"]);
  });
});

describe("타브 입력: 앞 음 줄 지키기", () => {
  // 재현(beta.22): l20 fd+dc<a+ 가 D 3·1·0, A 3·1로 보이는데, 뒤에 A줄 5(d)를 치면 c·a+가 낮은 E줄 8·6으로 옮겨 갔다
  const l20 = rat(1, 20);
  const at = (k: number) => rat(k, 20);
  const notes: Note[] = [53, 51, 50, 48, 46].map((pitch, k) => ({ id: `a.${k + 1}`, start: at(k), dur: l20, pitch, vol: 8, tie: "none" }));
  const fretsOf = (list: readonly Note[]) =>
    assignTab(list).flatMap((e) => e.notes.map((x) => `${x.note.pitch}:${x.at?.string}/${x.at?.fret}`));
  const enterD = (pin: boolean) => {
    const s = { ...song(), tracks: song().tracks.map((t) => (t.id === "a" ? { ...t, notes } : t)) };
    const edit = placeTabNote(s, ["a", "b"], "a", at(5), rat(1, 12), 50);
    const shown = shownStrings(assignTab(notes));
    const changed = edit.changes[0]!.notes.map((n) => (n.id === edit.noteId ? { ...n, tabString: 5 } : n));
    return pin ? pinShownStrings(changed, shown) : changed;
  };

  it("넣기 전에는 A줄 3·1로 보인다", () => {
    expect(fretsOf(notes).slice(3)).toEqual(["48:5/3", "46:5/1"]);
  });

  it("묶지 않으면 앞 음이 다른 줄로 옮겨 간다 (고친 원인)", () => {
    expect(fretsOf(enterD(false)).slice(3, 5)).not.toEqual(["48:5/3", "46:5/1"]);
  });

  it("뒤에 음을 쳐도 앞에 보이던 줄·프렛은 그대로다", () => {
    expect(fretsOf(enterD(true))).toEqual(["53:4/3", "51:4/1", "50:4/0", "48:5/3", "46:5/1", "50:5/5"]);
  });

  it("이미 줄이 적힌 음과 높이가 바뀐 음은 묶지 않는다", () => {
    const shown = new Map([
      ["x", { pitch: 48, string: 5 }],
      ["y", { pitch: 48, string: 5 }],
    ]);
    const x: Note = { id: "x", start: at(0), dur: l20, pitch: 48, vol: 8, tie: "none", tabString: 6 };
    const y: Note = { id: "y", start: at(1), dur: l20, pitch: 50, vol: 8, tie: "none" };
    expect(pinShownStrings([x, y], shown)).toEqual([x, y]);
  });
});
