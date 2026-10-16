import { describe, expect, it } from "vitest";
import { rat, type Song } from "@mmlce/core";
import { decodeText, encode3mle, encodeCp949, read3mle, readMmi, write3mle, writeMmi } from "../src/index.js";

const SAMPLE = [
  "[Settings]",
  "Encoding=ks_c_5601-1987",
  "Title=시험곡",
  "Source=EarlGreyPie",
  "TimeBase=960",
  "TimeSignatureNN=3",
  "TimeSignatureDD=4",
  "[ChannelProperty2]",
  "Name=왼손",
  "Patch=21",
  "[Channel2]",
  "o3 l2 c r",
  "/* 메모 */ e",
  "[ChannelProperty1]",
  "Name=오른손",
  "Patch=21",
  "[Channel1]",
  "t100 l8 cdef t120 g4",
  "[ChannelProperty3]",
  "Name=류트",
  "Patch=0",
  "[Channel3]",
  "r1 c1",
].join("\r\n");

describe("read3mle", () => {
  it("채널 번호 순으로 트랙을 만들고, 화음 수(6)씩 한 악보로 묶어 Patch가 다른 채널은 트랙 악기로 둔다", () => {
    const { song, diagnostics } = read3mle(SAMPLE);
    expect(diagnostics).toEqual([]);
    expect(song.meta).toMatchObject({ title: "시험곡", author: "EarlGreyPie" });
    expect(song.tracks.map((t) => t.name)).toEqual(["오른손", "왼손", "류트"]);
    expect(song.players).toHaveLength(1);
    expect(song.players[0]!.instrument).toMatchObject({ canonical: "piano", program: 21 });
    expect(song.tracks.map((t) => t.instrument?.canonical)).toEqual([undefined, undefined, "lute"]);
    // 화음 수를 2로 주면 2채널씩 악보가 나뉜다
    expect(read3mle(SAMPLE, { chordsPerScore: 2 }).song.tracks.map((t) => t.playerId)).toEqual(["p1", "p1", "p2"]);
    expect(song.timeSig).toEqual([{ at: rat(0), beats: 3, unit: 4 }]);
  });

  it("채널 안의 템포를 곡 템포 지도로 모은다", () => {
    const { song } = read3mle(SAMPLE);
    expect(song.tempo).toEqual([
      { at: rat(0), bpm: 100 },
      { at: rat(1, 2), bpm: 120 },
    ]);
  });

  it("주석과 여러 줄 본문", () => {
    const { song } = read3mle(SAMPLE);
    expect(song.tracks[1]!.notes.map((n) => n.pitch)).toEqual([48, 52]);
  });

  it("원문이 있으면 원문을 그대로 저장한다", () => {
    const a = read3mle(SAMPLE).song;
    const b = read3mle(write3mle(a).text).song;
    expect(b.tracks.map((t) => t.mml?.text)).toEqual(a.tracks.map((t) => t.mml?.text.replace(/\r?\n/g, "\n")));
  });

  it("쓰고 다시 읽으면 같은 곡 (원문 없이 출력기로)", () => {
    const read = read3mle(SAMPLE).song;
    const a = { ...read, tracks: read.tracks.map(({ mml: _mml, ...t }) => t) };
    const { text, diagnostics } = write3mle(a);
    expect(diagnostics).toEqual([]);
    const b = read3mle(text).song;
    const shape = (s: Song) =>
      s.tracks.map((t) => t.notes.map((n) => [n.start, n.dur, n.pitch, n.vol, n.tie]));
    expect(shape(b)).toEqual(shape(a));
    expect(b.tempo).toEqual(a.tempo);
    expect(b.tracks.map((t) => t.name)).toEqual(a.tracks.map((t) => t.name));
  });

  it("원문 없이 쓸 때 악보(연주자)마다 곡 템포를 넣는다", () => {
    const read = read3mle(SAMPLE).song;
    const second = { id: "p2", name: "둘째", instrument: read.players[0]!.instrument };
    const a = { ...read, players: [...read.players, second], tracks: read.tracks.map(({ mml: _mml, ...t }, k) => (k === 2 ? { ...t, playerId: "p2" } : t)) };
    const b = read3mle(write3mle(a).text).song;
    const bpms = (k: number) => [...b.tracks[k]!.mml!.text.matchAll(/t(\d+)/g)].map((m) => Number(m[1]));
    expect([...bpms(0), ...bpms(1)].sort()).toEqual([100, 120]);
    expect(bpms(2).sort()).toEqual([100, 120]);
    expect(b.tempo).toEqual(a.tempo);
  });

  it("메모와 채널 볼륨·팬은 편집기가 안 써도 저장할 때 돌려준다", () => {
    const text = SAMPLE.replace("TimeBase=960", "Memo=keep\r\nTimeBase=960").replace("Name=왼손", "Name=왼손\r\nVolume=50\r\nPanpot=96");
    const a = read3mle(text).song;
    expect(a.meta.memo).toBe("keep");
    const out = write3mle(a).text;
    expect(out).toContain("Memo=keep");
    expect(out).toContain("Volume=50\r\nPanpot=96");
    expect(out).toContain("Volume=100\r\nPanpot=64");
  });
});

describe("decodeText", () => {
  it("Encoding 표기를 보고 CP949로 읽는다", () => {
    // "가" = CP949 0xB0 0xA1
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("[Settings]\r\nEncoding=ks_c_5601-1987\r\nTitle="),
      0xb0, 0xa1,
    ]);
    expect(decodeText(bytes).endsWith("Title=가")).toBe(true);
  });

  it("표기가 없으면 UTF-8", () => {
    expect(decodeText(new TextEncoder().encode("﻿Title=가"))).toBe("Title=가");
  });
});

describe("encode3mle", () => {
  it("기본은 CP949, 다시 읽으면 한글 이름 그대로", () => {
    const a = read3mle(SAMPLE).song;
    const r = encode3mle(a);
    expect(r.encoding).toBe("cp949");
    expect(r.unencodable).toEqual([]);
    const text = decodeText(r.bytes);
    expect(text).toContain("Encoding=ks_c_5601-1987");
    expect(read3mle(text).song.tracks.map((t) => t.name)).toEqual(["오른손", "왼손", "류트"]);
  });

  it("CP949에 없는 글자는 알려주고, UTF-8로 다시 쓸 수 있다", () => {
    const a = read3mle(SAMPLE).song;
    const song = { ...a, meta: { ...a.meta, title: "龢 테스트 😀" } };
    const r = encode3mle(song);
    expect(r.unencodable).toContain("😀");
    expect(r.diagnostics.some((d) => d.code === "cp949-unencodable")).toBe(true);
    const u = encode3mle(song, { encoding: "utf-8" });
    expect(decodeText(u.bytes)).toContain("Title=龢 테스트 😀");
  });

  it("일본어 가나는 CP949로 쓸 수 있다", () => {
    expect(encodeCp949("かなカナ").unencodable).toEqual([]);
  });
});

describe("트랙별 악기 저장", () => {
  it("3MLE는 채널마다 트랙 악기 Patch, mmi는 악기가 바뀌는 자리에서 mml-track을 나눈다", () => {
    const a = read3mle(SAMPLE).song;
    const flute = { canonical: "flute", program: 5 };
    const song = { ...a, tracks: a.tracks.map((t, i) => (i === 1 ? { ...t, instrument: flute } : t)) };
    expect(write3mle(song).text).toMatch(/\[ChannelProperty2\]\r\nName=왼손\r\nPatch=5/);
    const mmi = writeMmi(song).text;
    expect(mmi.match(/program=\d+/g)).toEqual(["program=21", "program=5", "program=0"]);
    expect(readMmi(mmi).song.players.map((p) => p.instrument.program)).toEqual([21, 5, 0]);
  });
});

describe("번호 없는 악기 저장", () => {
  it("모바일 전용 악기(포크 기타)는 악보 악기 번호로 쓰고 경고한다", () => {
    const a = read3mle(SAMPLE).song;
    const song = { ...a, tracks: a.tracks.map((t, i) => (i === 1 ? { ...t, instrument: { canonical: "folk-guitar" } } : t)) };
    const out = write3mle(song);
    expect(out.diagnostics).toMatchObject([{ code: "instrument-no-program", where: "왼손" }]);
    expect(writeMmi(song).diagnostics.some((d) => d.code === "instrument-no-program")).toBe(true);
  });
});

describe("write3mle: 악보마다 템포 (공개 전 점검)", () => {
  /** 원문 둘을 서로 다른 연주자(악보)로 */
  function twoPlayers(a: string, b: string): Song {
    const { song } = read3mle(["[Settings]", "[Channel1]", a, "[Channel2]", b].join("\r\n"), { chordsPerScore: 1 });
    return song;
  }

  it("원문 보존 경로도 악보마다 템포가 다 적혔는지 보고, 빠진 악보가 있으면 출력기로 다시 쓴다 (#6)", () => {
    const s = twoPlayers("t150 c4", "e4");
    const { text } = write3mle(s);
    const second = text.split("[Channel2]")[1]!;
    expect(second).toContain("t150");
  });

  it("음 가운데 템포를 옮겨 적은 파일을 다시 열어도 템포 지도는 그대로 (#2)", () => {
    const s = twoPlayers("t150 c48 t90 e48", "c64 d64 e64");
    // 원문 없는 트랙: 출력기가 쓴다
    const loose: Song = { ...s, tracks: s.tracks.map((t, k) => (k === 1 ? (({ mml: _m, ...rest }) => rest)(t) : t)) };
    const { text, diagnostics } = write3mle(loose);
    expect(diagnostics.map((d) => d.code)).toContain("tempo-moved");
    const back = read3mle(text, { chordsPerScore: 1 }).song;
    expect(back.tempo).toEqual(loose.tempo);
    expect(back.tracks[1]!.notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
  });

  it("한 채널에서 같은 빠르기를 다시 적은 t는 지도에 남긴다 (재점검 #2)", () => {
    const s = twoPlayers("t150 c4 t150 d4 t90 e4", "e4");
    expect(s.tempo.map((e) => e.bpm)).toEqual([150, 150, 90]);
  });
});

