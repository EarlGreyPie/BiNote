import { describe, expect, it } from "vitest";
import { rat, type Song } from "@mmlce/core";
import { readMmlAt, readMmi, readProject, writeMmi, writeProject } from "../src/index.js";

/** 구조 마커 하나와 작업 메모 둘(한 자리·끝낸 범위 메모)을 둔 곡 */
function sample(): Song {
  const { song } = readMmlAt("MML@t120cdefgab>c,;");
  return {
    ...song,
    markers: [
      { id: "m1", at: rat(0), label: "A" },
      { id: "m2", at: rat(1, 4), label: "여기부터 다시 확인", kind: "memo" },
      { id: "m3", at: rat(1, 2), end: rat(3, 2), label: "17마디 볼륨 +1(일괄)", kind: "memo", done: true },
    ],
  };
}

describe("작업 메모 저장", () => {
  it("프로젝트 파일(.mme)에 저장했다 다시 열면 그대로 (글·끝냄·범위 끝)", () => {
    const song = sample();
    const back = readProject(writeProject(song)).song;
    expect(back.markers).toEqual(song.markers);
  });

  it("예전 파일의 마커(kind 없음)는 구조 마커로 읽고, 메모가 아닌 마커의 done·end는 버린다", () => {
    const text = writeProject(sample()).replace('"kind": "memo"', '"kind": "section"');
    const back = readProject(text).song;
    expect(back.markers[1]).toEqual({ id: "m2", at: rat(1, 4), label: "여기부터 다시 확인" });
    const raw = JSON.parse(writeProject(sample()));
    raw.song.markers[2].kind = undefined;
    const plain = readProject(JSON.stringify(raw)).song.markers[2]!;
    expect(plain).toEqual({ id: "m3", at: rat(1, 2), label: "17마디 볼륨 +1(일괄)" });
  });

  it("끝이 시작보다 앞이거나 잘못된 값이면 끝을 버린다", () => {
    const raw = JSON.parse(writeProject(sample()));
    raw.song.markers[2].end = { n: 1, d: 4 };
    expect(readProject(JSON.stringify(raw)).song.markers[2]!.end).toBeUndefined();
    raw.song.markers[2].end = "x";
    expect(readProject(JSON.stringify(raw)).song.markers[2]!.end).toBeUndefined();
  });

  it("옛 앱처럼 kind·done·end를 모르는 칸으로 들고 다시 써도 메모가 남는다 (extras 왕복)", () => {
    // 옛 앱은 모르는 칸을 extras로 지켜 맨 뒤에 다시 쓴다. 같은 모양의 글을 새 앱이 읽으면 메모로 돌아온다
    const raw = JSON.parse(writeProject(sample()));
    const m = raw.song.markers[2];
    raw.song.markers[2] = { id: m.id, at: m.at, label: m.label, kind: m.kind, done: m.done, end: m.end };
    expect(readProject(JSON.stringify(raw)).song.markers).toEqual(sample().markers);
  });
});

describe("작업 메모는 내보내기에 나가지 않는다", () => {
  it("마비꼬(.mmi)에는 구조 마커만", () => {
    const { text } = writeMmi(sample());
    expect(text).toContain("[marker]");
    expect(text).toContain("=A");
    expect(text).not.toContain("다시 확인");
    expect(text).not.toContain("볼륨 +1");
    expect(readMmi(text).song.markers.map((m) => m.label)).toEqual(["A"]);
  });

  it("메모만 있으면 마비꼬 [marker] 칸을 쓰지 않는다", () => {
    const s = sample();
    const { text } = writeMmi({ ...s, markers: s.markers.filter((m) => m.kind === "memo") });
    expect(text).not.toContain("[marker]");
  });
});
