import { describe, expect, it } from "vitest";
import { emptySong, rat, type Song, type Track } from "@mmlce/core";
import { parseTrackText } from "@mmlce/mml";
import { textCursorAt, textItems } from "../src/lib/analysis";

function song(track: Track): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return { ...base, players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }], tracks: [track] };
}

/** 원문을 가진 트랙 (편집기 글 그대로) */
function written(text: string, offset?: ReturnType<typeof rat>): Track {
  const mml = offset ? { text, offset } : { text };
  return { id: "a", playerId: "p1", name: "a", color: "", role: "free", mute: false, solo: false, notes: parseTrackText("a", mml).notes, spelling: {}, mml };
}

describe("MML 편집기 글 커서 → 곡 자리", () => {
  // 위치:     0123456789…
  const text = "l4 c d8 r e1";
  const tr = written(text);
  const s = song(tr);

  it("음 글자 위면 그 음과 그 시작", () => {
    const hit = textCursorAt(s, tr, text.indexOf("d"));
    expect(hit.note?.id).toBe(tr.notes[1]!.id);
    expect(hit.at).toEqual(rat(1, 4));
  });

  it("음 바로 뒤(\"d8|\")도 그 음으로 본다", () => {
    const hit = textCursorAt(s, tr, text.indexOf("d8") + 2);
    expect(hit.note?.id).toBe(tr.notes[1]!.id);
  });

  it("쉼표 위면 음 없이 쉼표 시작", () => {
    const hit = textCursorAt(s, tr, text.indexOf("r"));
    expect(hit.note).toBeUndefined();
    expect(hit.at).toEqual(rat(3, 8));
  });

  it("명령·빈칸이면 다음 음 시작, 글 끝이면 마지막 음 끝", () => {
    expect(textCursorAt(s, tr, 0)).toEqual({ at: rat(0) });
    // "c " 다음 빈칸 뒤가 아니라 c 바로 뒤라 c로 본다
    expect(textCursorAt(s, tr, text.indexOf("c") + 1).note?.id).toBe(tr.notes[0]!.id);
    const end = written(text + "  ");
    expect(textCursorAt(song(end), end, text.length + 2)).toEqual({ at: rat(13, 8) });
  });

  it("l7처럼 칸에 안 맞는 길이도 분수 그대로", () => {
    const odd = written("l7 cde");
    const hit = textCursorAt(song(odd), odd, 5);
    expect(hit.at).toEqual(rat(2, 7));
    expect(hit.note?.id).toBe(odd.notes[2]!.id);
  });

  it("트랙이 곡 중간부터 시작하면 그만큼 민다", () => {
    const late = written("c4d4", rat(1));
    expect(textCursorAt(song(late), late, 2).at).toEqual(rat(5, 4));
  });

  it("원문이 없는 트랙(출력한 글)도 같은 높이·자리의 음을 찾는다", () => {
    const notes = parseTrackText("b", { text: "o4c2e2" }).notes;
    const gen: Track = { id: "b", playerId: "p1", name: "b", color: "", role: "free", mute: false, solo: false, notes, spelling: {} };
    const s2 = song(gen);
    const hits = [0, 1, 2, 3, 4, 5, 6].map((p) => textCursorAt(s2, gen, p).note?.id).filter(Boolean);
    expect(new Set(hits)).toEqual(new Set(notes.map((n) => n.id)));
  });
});

describe("글 커서 자리 셈을 다시 쓰기", () => {
  // 원문 없는 트랙은 셀 때마다 글을 새로 쓰므로(optimizeMml), 방향키를 누를 때마다 다시 쓰면 음이 많을 때 굼뜨다
  it("같은 곡·트랙이면 지난번 셈을 그대로 쓰고, 곡이 바뀌면 새로 센다", () => {
    const notes = parseTrackText("b", { text: "o4c4d4e4" }).notes;
    const gen: Track = { id: "b", playerId: "p1", name: "b", color: "", role: "free", mute: false, solo: false, notes, spelling: {} };
    const s1 = song(gen);
    const first = textItems(s1, gen);
    expect(textItems(s1, gen)).toBe(first);
    expect(textCursorAt(s1, gen, first.items[1]!.span[0]).note?.id).toBe(notes[1]!.id);

    // 음을 고치면 곡·트랙이 새 객체가 된다: 옛 셈을 쓰지 않는다
    const moved: Track = { ...gen, notes: parseTrackText("b", { text: "o4r4c4d4e4" }).notes };
    const s2 = song(moved);
    const next = textItems(s2, moved);
    expect(next).not.toBe(first);
    expect(textCursorAt(s2, moved, next.items.find((x) => x.k === 0)!.span[0]).at).toEqual(rat(1, 4));
    // 다른 곡을 섞어 물어도 그 곡으로 센다
    expect(textItems(s1, gen)).not.toBe(next);
    expect(textCursorAt(s1, gen, first.items[0]!.span[0]).at).toEqual(rat(0));
  });
});
