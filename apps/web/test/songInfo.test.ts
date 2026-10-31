import { History } from "@mmlce/core";
import { read3mle, readMmi, readProject, write3mle, writeMmi, writeProject } from "@mmlce/fileio";
import { newSong } from "@mmlce/mml";
import { describe, expect, it } from "vitest";
import { oneLine, setSongInfo, songInfoOf } from "../src/lib/songInfo";

const blank = () => newSong({ playerName: "피아노", trackName: "트랙 1" });

describe("곡 정보 창: 제목·지은이·메모 바꾸기", () => {
  it("새 곡은 빈 칸으로 띄우고, 고친 값을 곡에 넣는다", () => {
    const song = blank();
    expect(songInfoOf(song.meta)).toEqual({ title: "", author: "", memo: "" });
    const next = setSongInfo({ title: " 별의 노래 ", author: "EarlGreyPie", memo: "후렴 두 번" }).apply(song);
    expect(next.meta).toEqual({ ...song.meta, title: "별의 노래", author: "EarlGreyPie", memo: "후렴 두 번" });
    // 음·트랙은 그대로
    expect(next.tracks).toBe(song.tracks);
  });

  it("실행 취소 한 칸으로 되돌리고 다시 실행된다", () => {
    const song = blank();
    const history = new History(song);
    history.run(setSongInfo({ title: "제목", author: "지은이", memo: "" }));
    expect(history.song.meta.title).toBe("제목");
    expect(history.canUndo).toBe(true);
    expect(history.undo().meta).toEqual(song.meta);
    expect(history.redo().meta.author).toBe("지은이");
  });

  it("바뀐 것이 없으면 곡을 그대로 돌려준다 (실행 취소에 빈 단계가 남지 않게)", () => {
    const song = setSongInfo({ title: "제목", author: "", memo: "메모" }).apply(blank());
    expect(setSongInfo({ title: "제목 ", author: "", memo: "메모" }).apply(song)).toBe(song);
  });

  it("메모를 비우면 memo 칸을 뺀다", () => {
    const song = setSongInfo({ title: "", author: "", memo: "메모" }).apply(blank());
    const cleared = setSongInfo({ title: "", author: "", memo: "  " }).apply(song);
    expect("memo" in cleared.meta).toBe(false);
  });

  it("줄바꿈은 빈칸으로 바꾼다: 3MLE·마비꼬 파일의 한 줄 칸이 깨지지 않게", () => {
    expect(oneLine("첫 줄\r\n 둘째 줄\n")).toBe("첫 줄 둘째 줄");
    const song = setSongInfo({ title: "가\n나", author: "", memo: "다\n\n라" }).apply(blank());
    expect(song.meta.title).toBe("가 나");
    expect(song.meta.memo).toBe("다 라");
  });

  it("손대지 않은 칸은 한 줄로 바꾸지 않는다 (프로젝트 파일에서 읽은 여러 줄 메모)", () => {
    const base = blank();
    const song = { ...base, meta: { ...base.meta, memo: "첫 줄\n둘째 줄" } };
    // 입력 칸이 줄바꿈을 빼고 돌려줘도 같은 메모로 본다
    expect(setSongInfo({ title: "", author: "", memo: "첫 줄 둘째 줄" }).apply(song)).toBe(song);
    const titled = setSongInfo({ title: "새 제목", author: "", memo: "첫 줄 둘째 줄" }).apply(song);
    expect(titled.meta.memo).toBe("첫 줄\n둘째 줄");
  });

  it("여러 줄 칸은 한 줄로 맞춰 띄운다: 한 줄 입력 칸이 줄바꿈을 지워 낱말이 붙지 않게", () => {
    const base = blank();
    const song = { ...base, meta: { ...base.meta, title: "가\n나", memo: "첫 줄\r\n둘째 줄" } };
    const shown = songInfoOf(song.meta);
    expect(shown).toEqual({ title: "가 나", author: "", memo: "첫 줄 둘째 줄" });
    // 띄운 값을 그대로 적용하면 곡은 그대로, 메모 뒤에 덧붙이면 빈칸을 지킨 채 한 줄이 된다
    expect(setSongInfo(shown).apply(song)).toBe(song);
    expect(setSongInfo({ ...shown, memo: shown.memo + " 셋째" }).apply(song).meta.memo).toBe("첫 줄 둘째 줄 셋째");
  });

  it("고친 정보가 3MLE·마비꼬·프로젝트 파일로 나갔다가 그대로 돌아온다", () => {
    const song = setSongInfo({ title: "별의 노래", author: "EarlGreyPie", memo: "후렴 두 번" }).apply(blank());
    const threemle = read3mle(write3mle(song).text).song;
    expect(songInfoOf(threemle.meta)).toEqual({ title: "별의 노래", author: "EarlGreyPie", memo: "후렴 두 번" });
    const mmi = readMmi(writeMmi(song).text).song;
    expect(mmi.meta.title).toBe("별의 노래");
    expect(mmi.meta.author).toBe("EarlGreyPie");
    const project = readProject(writeProject(song)).song;
    expect(songInfoOf(project.meta)).toEqual(songInfoOf(song.meta));
  });
});
