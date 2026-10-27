import { describe, expect, it } from "vitest";
import { add, emptySong, MOBILE_PROFILE, rat, type Note, type Rat, type Song } from "@mmlce/core";
import { optimizeMml } from "@mmlce/mml";
import {
  decodeXml,
  fitWritable,
  instrumentRef,
  isZip,
  looksLikeMusicXml,
  midiToSong,
  parseXml,
  readMusicXml,
  readMxl,
  shapesOf,
  songToMusicXml,
  soundNotes,
  suggestPlan,
  type ImportPlan,
  type MidiAnalysis,
} from "../src/index.js";

const key = (r: Rat) => `${r.n}/${r.d}`;

function score(parts: string, partList: string, head = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<!-- 주석 -->
<score-partwise version="4.0">${head}<part-list>${partList}</part-list>${parts}</score-partwise>`;
}

const note = (step: string, octave: number, duration: number, extra = "") =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${extra}</note>`;

/** 한 파트에 연주자 하나씩, 화음 수는 파트의 동시음 */
function planOf(analysis: MidiAnalysis, attenuate = false): ImportPlan {
  return {
    players: analysis.parts.map((p) => ({
      name: p.name,
      instrument: instrumentRef(p.drum ? "bass-drum" : p.suggestion.canonical),
      parts: [p.id],
      chords: Math.max(1, p.polyphony),
    })),
    quantize: { exact: true },
    fill: false,
    merge: false,
    attenuate,
  };
}

const sounding = (song: Song) =>
  song.tracks
    .flatMap((t) => soundNotes(t.notes).map((n) => `${key(n.start)} ${key(n.dur)} ${n.pitch} v${n.vol}`))
    .sort();

describe("XML 읽기", () => {
  it("속성·글자·엔티티·CDATA·스스로 닫는 태그", () => {
    const root = parseXml(`<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a k='1 > 0' j="&amp;&#65;"><b/>t&lt;<![CDATA[<raw>]]><c>x</c></a>`);
    expect(root.name).toBe("a");
    expect(root.attrs).toEqual({ k: "1 > 0", j: "&A" });
    expect(root.children.map((c) => c.name)).toEqual(["b", "c"]);
    expect(root.text).toBe("t<<raw>");
  });

  it("닫는 태그가 틀리면 막는다", () => {
    expect(() => parseXml("<a><b></a>")).toThrow();
  });
});

describe("MusicXML 읽기", () => {
  it("음·붙임줄·셋잇단·화음·쉼표·템포·셈여림·박자표를 정확한 분수로", () => {
    const xml = score(
      `<part id="P1">
        <measure number="1">
          <attributes><divisions>6</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
          <direction><direction-type><dynamics><p/></dynamics></direction-type><sound tempo="90"/></direction>
          ${note("C", 4, 6)}
          ${note("E", 4, 6, "<chord/>")}
          <note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>
          ${note("D", 4, 2, "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>")}
          ${note("E", 4, 2)}
          ${note("F", 4, 2)}
          <note><rest/><duration>2</duration></note>
          ${note("G", 4, 4, '<tie type="start"/>')}
        </measure>
        <measure number="2">
          <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
          ${note("G", 4, 6, '<tie type="stop"/>')}
          <note dynamics="50"><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>12</duration></note>
          <barline location="right"><repeat direction="backward"/></barline>
        </measure>
      </part>`,
      `<score-part id="P1"><part-name>Flute</part-name></score-part>`,
      `<work><work-title>시험곡</work-title></work><identification><encoding><software>MuseScore 4.4.2</software></encoding></identification>`,
    );
    const { analysis, report } = readMusicXml(xml);
    expect(report).toMatchObject({ title: "시험곡", software: "MuseScore 4.4.2", fromBiNote: false, grace: 1, repeats: 1 });
    expect(analysis.tempo).toEqual([{ at: rat(0), bpm: 90 }]);
    expect(analysis.timeSig).toEqual([{ at: rat(0), beats: 3, unit: 4 }]);
    expect(analysis.parts).toHaveLength(1);
    const part = analysis.parts[0]!;
    // 이름에서 플루트(GM 73)로 짐작
    expect(part.program).toBe(73);
    expect(part.suggestion.canonical).toBe("flute");
    expect(part.polyphony).toBe(2);
    const notes = part.notes.map((n) => `${key(n.start)} ${key(n.dur)} ${n.pitch} ${n.velocity}`);
    expect(notes).toEqual([
      "0/1 1/4 64 49",
      "0/1 1/4 60 49",
      "1/4 1/12 62 49",
      "1/3 1/12 64 49",
      "5/12 1/12 65 49",
      // 붙임줄: 마디를 넘어 한 음 (뒷마디의 f는 이어 받은 음이라 세기는 앞 음 것)
      "7/12 5/12 67 49",
      "1/1 1/2 66 45",
    ]);
  });

  it("못갖춘마디는 적힌 길이만큼, 큰보표는 보표마다 파트, 이조 악기는 소리 높이로", () => {
    const xml = score(
      `<part id="P1">
        <measure number="0" implicit="yes">
          <attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time><transpose><chromatic>-2</chromatic></transpose></attributes>
          ${note("C", 5, 1, "<staff>1</staff>")}
          <backup><duration>1</duration></backup>
          ${note("C", 3, 1, "<staff>2</staff>")}
        </measure>
        <measure number="1">
          ${note("D", 5, 4, "<staff>1</staff>")}
          <backup><duration>4</duration></backup>
          <forward><duration>2</duration></forward>
          ${note("G", 2, 2, "<staff>2</staff>")}
        </measure>
      </part>`,
      `<score-part id="P1"><part-name>Piano</part-name><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>`,
    );
    const { analysis } = readMusicXml(xml);
    expect(analysis.parts.map((p) => [p.id, p.name])).toEqual([
      ["P1s1", "Piano 1"],
      ["P1s2", "Piano 2"],
    ]);
    const [right, left] = analysis.parts;
    expect(right!.notes.map((n) => `${key(n.start)} ${n.pitch}`)).toEqual(["0/1 70", "1/4 72"]);
    expect(left!.notes.map((n) => `${key(n.start)} ${n.pitch}`)).toEqual(["0/1 46", "3/4 41"]);
    expect(analysis.timeSig).toEqual([{ at: rat(0), beats: 4, unit: 4 }]);
  });

  it("오선+TAB 보표 파트는 TAB 음을 빼고 줄 번호만 옮긴다", () => {
    const tech = (s: number) => `<notations><technical><string>${s}</string><fret>0</fret></technical></notations>`;
    const xml = score(
      `<part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>TAB</sign><line>5</line></clef></attributes>
          ${note("E", 4, 2, "<staff>1</staff>")}
          ${note("B", 3, 2, "<staff>1</staff>")}
          <backup><duration>4</duration></backup>
          ${note("E", 4, 2, `<staff>2</staff>${tech(1)}`)}
          ${note("B", 3, 2, `<staff>2</staff>${tech(2)}`)}
        </measure>
      </part>`,
      `<score-part id="P1"><part-name>Guitar</part-name></score-part>`,
    );
    const { analysis, report } = readMusicXml(xml);
    expect(analysis.parts).toHaveLength(1);
    expect(analysis.parts[0]!.notes.map((n) => [n.pitch, n.string])).toEqual([
      [64, 1],
      [59, 2],
    ]);
    expect(report.tabStrings).toBe(2);
    const song = midiToSong(analysis, planOf(analysis), MOBILE_PROFILE).song;
    expect(song.tracks[0]!.notes.map((n) => n.tabString)).toEqual([1, 2]);
  });

  it("정수 divisions로 반올림해 적은 잇단음표는 모양대로의 길이로", () => {
    const tm = "<type>16th</type><time-modification><actual-notes>9</actual-notes><normal-notes>8</normal-notes></time-modification>";
    const notes = [56, 57, 57, 57, 57, 57, 57, 57, 57].map((d) => note("C", 4, d, tm)).join("");
    const xml = score(
      `<part id="P1"><measure number="1"><attributes><divisions>256</divisions></attributes>${notes}${note("D", 4, 512, "<type>half</type>")}</measure></part>`,
      `<score-part id="P1"><part-name>P</part-name></score-part>`,
    );
    const got = readMusicXml(xml).analysis.parts[0]!.notes.map((n) => `${key(n.start)} ${key(n.dur)}`);
    expect(got.slice(0, 2)).toEqual(["0/1 1/18", "1/18 1/18"]);
    expect(got.at(-1)).toBe("1/2 1/2");
  });

  it("score-timewise도 읽는다", () => {
    const xml = `<score-timewise version="4.0"><part-list><score-part id="A"><part-name>A</part-name></score-part></part-list>
      <measure number="1"><part id="A"><attributes><divisions>1</divisions></attributes>${note("A", 4, 4)}</part></measure>
      <measure number="2"><part id="A">${note("B", 4, 4)}</part></measure></score-timewise>`;
    expect(looksLikeMusicXml(xml)).toBe(true);
    const { analysis } = readMusicXml(xml);
    expect(analysis.parts[0]!.notes.map((n) => `${key(n.start)} ${n.pitch}`)).toEqual(["0/1 69", "1/1 71"]);
  });

  it("악보가 아니면 막는다", () => {
    expect(() => readMusicXml("<html></html>")).toThrow();
    expect(looksLikeMusicXml("MML@t120cde;")).toBe(false);
  });
});

describe("MusicXML 쓰기", () => {
  it("길이를 그릴 수 있는 음표 조각으로 나눈다", () => {
    const show = (d: Rat) => shapesOf(d).map((s) => `${key(s.dur)}:${s.type}${".".repeat(s.dots)}${s.tuplet ? `(${s.tuplet.actual}:${s.tuplet.normal})` : ""}`);
    expect(show(rat(3, 8))).toEqual(["3/8:quarter."]);
    expect(show(rat(5, 16))).toEqual(["1/4:quarter", "1/16:16th"]);
    expect(show(rat(1, 12))).toEqual(["1/12:eighth(3:2)"]);
    expect(show(rat(1, 7))).toEqual(["1/7:quarter(7:4)"]);
    expect(show(rat(3, 2))).toEqual(["3/2:whole."]);
    expect(show(rat(9, 4))).toEqual(["7/4:whole..", "1/2:half"]);
    for (const d of [rat(5, 12), rat(11, 28), rat(7, 32), rat(13, 20)]) {
      expect(shapesOf(d).reduce((s, x) => add(s, x.dur), rat(0))).toEqual(d);
    }
  });

  const n = (id: string, start: Rat, dur: Rat, pitch: number, vol: number, extra: Partial<Note> = {}): Note => ({ id, start, dur, pitch, vol, tie: "none", ...extra });

  function sample(): Song {
    const base = emptySong({ title: "왕복 <곡>", author: "EarlGreyPie", profileId: "mobile" });
    return {
      ...base,
      tempo: [
        { at: rat(0), bpm: 100 },
        { at: rat(9, 8), bpm: 132 },
      ],
      timeSig: [
        { at: rat(0), beats: 4, unit: 4 },
        { at: rat(2), beats: 3, unit: 4 },
      ],
      players: [
        { id: "p1", name: "기타", instrument: { canonical: "folk-guitar" } },
        { id: "p2", name: "북", instrument: { canonical: "bass-drum" } },
        { id: "p3", name: "냥", instrument: { canonical: "cat-harmonica" } },
      ],
      tracks: [
        {
          id: "t1",
          playerId: "p1",
          name: "1",
          color: "",
          role: "free",
          mute: false,
          solo: false,
          spelling: {},
          notes: [
            n("a", rat(0), rat(1, 4), 64, 12, { tabString: 1 }),
            // 셋잇단·l7·마디를 넘는 같은 높이 &
            n("b", rat(1, 4), rat(1, 12), 66, 10),
            n("c", rat(1, 3), rat(1, 12), 67, 10),
            n("d", rat(5, 12), rat(1, 7), 69, 8),
            n("e", add(rat(5, 12), rat(1, 7)), rat(1, 2), 71, 15, { tie: "next" }),
            n("f", add(add(rat(5, 12), rat(1, 7)), rat(1, 2)), rat(1, 4), 71, 3),
            // 다른 높이 &(슬라이드)와 v0
            n("g", rat(2), rat(1, 8), 60, 9, { tie: "next" }),
            n("h", rat(17, 8), rat(1, 8), 62, 9),
            n("i", rat(9, 4), rat(1, 4), 64, 0),
          ],
        },
        {
          id: "t2",
          playerId: "p1",
          name: "2",
          color: "",
          role: "free",
          mute: false,
          solo: false,
          spelling: {},
          notes: [n("j", rat(0), rat(1), 52, 11, { tabString: 5 }), n("k", rat(5, 4), rat(1, 16), 47, 7)],
        },
        { id: "t3", playerId: "p2", name: "북", color: "", role: "free", mute: false, solo: false, spelling: {}, notes: [n("m", rat(1, 2), rat(1, 4), 60, 13)] },
        { id: "t4", playerId: "p3", name: "냥", color: "", role: "free", mute: false, solo: false, spelling: {}, notes: [n("o", rat(1), rat(1, 4), 76, 6)] },
      ],
    };
  }

  it("내보낸 MusicXML을 다시 읽으면 소리 나는 음·템포·박자가 그대로다", () => {
    const song = sample();
    const xml = songToMusicXml(song, { volumeMax: 15, date: "2026-10-27" });
    expect(xml).toContain("<work-title>왕복 &lt;곡&gt;</work-title>");
    expect(xml).toContain('<time-modification><actual-notes>7</actual-notes><normal-notes>4</normal-notes></time-modification>');
    expect(xml).toContain('<slide type="start" line-type="solid"/>');
    expect(xml).toContain("<technical><string>5</string></technical>");
    const { analysis, report } = readMusicXml(xml);
    expect(report.fromBiNote).toBe(true);
    expect(report.tabStrings).toBe(2);
    expect(analysis.parts.map((p) => [p.name, p.drum, p.suggestion.canonical])).toEqual([
      ["기타", false, "folk-guitar"],
      ["북", true, "bass-drum"],
      ["냥", false, "cat-harmonica"],
    ]);
    const back = midiToSong(analysis, planOf(analysis), MOBILE_PROFILE, report.title).song;
    expect(back.meta.title).toBe("왕복 <곡>");
    expect(back.tempo).toEqual(song.tempo);
    expect(back.timeSig).toEqual(song.timeSig);
    // 슬라이드는 따로 친 음으로 돌아온다(높이·자리·길이·v는 같음)
    expect(sounding(back)).toEqual(sounding(song));
    expect(back.tracks.flatMap((t) => t.notes).find((x) => x.pitch === 52)?.tabString).toBe(5);
    expect(back.players.map((p) => p.instrument.canonical)).toEqual(["folk-guitar", "bass-drum", "cat-harmonica"]);
  });

  it("마디마다 채운 길이가 박자표와 맞는다", () => {
    const xml = songToMusicXml(sample());
    const root = parseXml(xml);
    const divisions = Number(root.children.find((c) => c.name === "part")!.children[0]!.children.find((c) => c.name === "attributes")!.children.find((c) => c.name === "divisions")!.text);
    for (const part of root.children.filter((c) => c.name === "part")) {
      part.children.forEach((measure, mi) => {
        // 성부마다 쉼표·음 길이 합 = 마디 길이
        const sums = new Map<string, number>();
        for (const el of measure.children) {
          if (el.name !== "note") continue;
          const voice = el.children.find((c) => c.name === "voice")!.text;
          const d = Number(el.children.find((c) => c.name === "duration")!.text);
          expect(Number.isInteger(d)).toBe(true);
          sums.set(voice, (sums.get(voice) ?? 0) + d);
        }
        const expected = mi < 2 ? divisions * 4 : divisions * 3;
        for (const total of sums.values()) expect(total).toBe(expected);
      });
    }
  });

  it("빈 곡도 한 마디를 쓴다", () => {
    const empty = { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [{ id: "p", name: "p", instrument: { canonical: "piano" } }] };
    const xml = songToMusicXml({ ...empty, tracks: [{ id: "t", playerId: "p", name: "", color: "", role: "free", mute: false, solo: false, spelling: {}, notes: [] }] });
    expect(xml).toContain('<rest measure="yes"/>');
  });
});

/** 테스트용 zip (저장 또는 deflate) */
async function zip(files: Record<string, string>, deflate: boolean): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = deflate
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer())
      : raw;
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    chunks.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

describe("압축 MusicXML(.mxl)", () => {
  const inner = score(`<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${note("C", 4, 4)}</measure></part>`, `<score-part id="P1"><part-name>P</part-name></score-part>`);
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/song.musicxml"/></rootfiles></container>`;

  for (const deflate of [false, true]) {
    it(deflate ? "deflate로 묶은 악보" : "저장으로 묶은 악보", async () => {
      const bytes = await zip({ "mimetype": "application/vnd.recordare.musicxml", "META-INF/container.xml": container, "score/song.musicxml": inner }, deflate);
      expect(isZip(bytes)).toBe(true);
      const text = await readMxl(bytes);
      expect(readMusicXml(text).analysis.parts[0]!.notes[0]!.pitch).toBe(60);
    });
  }

  it("container.xml이 없으면 첫 악보 XML", async () => {
    const bytes = await zip({ "a.musicxml": inner }, false);
    expect(await readMxl(bytes)).toBe(inner);
  });
});

describe("Codex 점검 E (beta.32)", () => {
  const P = `<score-part id="P1"><part-name>Piano</part-name></score-part>`;
  const one = (body: string, div = 1) => score(`<part id="P1"><measure number="1"><attributes><divisions>${div}</divisions></attributes>${body}</measure></part>`, P);
  const notesOf = (xml: string) => readMusicXml(xml).analysis.parts.flatMap((p) => p.notes.map((n) => `${key(n.start)} ${key(n.dur)} ${n.pitch} ${n.velocity}`));
  const importSong = (xml: string) => {
    const { analysis } = readMusicXml(xml);
    return midiToSong(analysis, planOf(analysis), MOBILE_PROFILE);
  };

  it("1: 게임 MML로 적을 수 없는 길이는 가까운 자리로 옮겨 음을 잃지 않는다", () => {
    const result = importSong(one(note("C", 4, 1) + note("D", 4, 32), 32));
    const notes = result.song.tracks.flatMap((t) => t.notes);
    expect(notes.map((n) => `${key(n.start)} ${key(n.dur)} ${n.pitch}`)).toEqual(["0/1 1/64 60", "1/64 31/128 62"]);
    expect(result.fitted).toBe(2);
    const text = optimizeMml(notes).text;
    expect(text).toMatch(/c/);
    expect(text).toMatch(/d/);
  });

  it("6: 다른 성부의 같은 높이 음이 붙임줄을 끊지 않는다", () => {
    const xml = score(
      `<part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes>
          ${note("C", 4, 4, '<tie type="start"/><voice>1</voice>')}
          <backup><duration>4</duration></backup>
          ${note("C", 4, 4, "<voice>2</voice>")}
        </measure>
        <measure number="2">${note("C", 4, 4, '<tie type="stop"/><voice>1</voice>')}</measure>
      </part>`,
      P,
    );
    expect(notesOf(xml)).toEqual(["0/1 2/1 60 80", "0/1 1/1 60 80"]);
  });

  it("7: 다른 성부에서 겹쳐 울리는 같은 높이 음의 길이를 자르지 않는다", () => {
    const xml = one(`${note("C", 4, 4, "<voice>1</voice>")}<backup><duration>2</duration></backup>${note("C", 4, 2, "<voice>2</voice>")}`);
    const song = importSong(xml).song;
    const durs = song.tracks.flatMap((t) => t.notes.map((n) => `${key(n.start)} ${key(n.dur)}`)).sort();
    expect(durs).toEqual(["0/1 1/1", "1/2 1/2"]);
  });

  it("8: 셈여림은 offset까지 따져 시각 순으로 적용한다", () => {
    const xml = one(`<direction><direction-type><dynamics><f/></dynamics></direction-type><offset>1</offset></direction>${note("C", 4, 1)}${note("D", 4, 1)}<backup><duration>2</duration></backup>${note("E", 4, 2, "<voice>2</voice>")}`);
    expect(notesOf(xml)).toEqual(["0/1 1/2 64 80", "0/1 1/4 60 80", "1/4 1/4 62 96"]);
  });

  it("9: 세기 0인 음은 소리 나는 음으로 바꾸지 않는다", () => {
    const { analysis, report } = readMusicXml(one(`<note dynamics="0"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>${note("D", 4, 1)}`));
    expect(analysis.parts[0]!.notes.map((n) => n.pitch)).toEqual([62]);
    expect(report.silent).toBe(1);
  });

  it("10: 오선에 없는 TAB 보표 음은 버리지 않는다", () => {
    const xml = one(
      `<attributes><staves>2</staves><clef number="2"><sign>TAB</sign></clef></attributes>${note("C", 4, 1, "<staff>1</staff>")}<backup><duration>1</duration></backup>${note("D", 4, 1, "<staff>2</staff><notations><technical><string>2</string></technical></notations>")}`,
    );
    const { analysis } = readMusicXml(xml);
    expect(analysis.parts).toHaveLength(1);
    expect(analysis.parts[0]!.notes.map((n) => [n.pitch, n.string])).toEqual([
      [62, 2],
      [60, undefined],
    ]);
  });

  it("11: 보표별 이조는 그 보표에만", () => {
    const xml = one(
      `<attributes><staves>2</staves><transpose number="1"><chromatic>-2</chromatic></transpose><transpose number="2"><chromatic>0</chromatic></transpose></attributes>${note("C", 4, 1, "<staff>1</staff>")}<backup><duration>1</duration></backup>${note("C", 3, 1, "<staff>2</staff>")}`,
    );
    expect(readMusicXml(xml).analysis.parts.map((p) => p.notes[0]!.pitch)).toEqual([58, 48]);
  });

  it("12: 마디 중간 박자 바뀜은 그 자리에", () => {
    const xml = one(`<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${note("C", 4, 2)}<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>${note("D", 4, 3)}`);
    expect(readMusicXml(xml).analysis.timeSig).toEqual([
      { at: rat(0), beats: 4, unit: 4 },
      { at: rat(1, 2), beats: 3, unit: 4 },
    ]);
  });

  it("13: 분모가 다른 복합 박자는 더한다", () => {
    const xml = one(`<attributes><time><beats>3</beats><beat-type>8</beat-type><beats>2</beats><beat-type>4</beat-type></time></attributes>${note("C", 4, 1)}`);
    expect(readMusicXml(xml).analysis.timeSig).toEqual([{ at: rat(0), beats: 7, unit: 8 }]);
  });

  it("14: 슬라이드 뒤 음은 사슬 첫 v로 내보낸다", () => {
    const base = emptySong({ title: "", author: "", profileId: "mobile" });
    const song: Song = {
      ...base,
      players: [{ id: "p", name: "p", instrument: { canonical: "piano" } }],
      tracks: [
        {
          id: "t",
          playerId: "p",
          name: "",
          color: "",
          role: "free",
          mute: false,
          solo: false,
          spelling: {},
          notes: [
            { id: "a", start: rat(0), dur: rat(1, 4), pitch: 60, vol: 12, tie: "next" },
            { id: "b", start: rat(1, 4), dur: rat(1, 4), pitch: 62, vol: 0, tie: "none" },
          ],
        },
      ],
    };
    expect(soundNotes(song.tracks[0]!.notes).map((n) => `${n.pitch} v${n.vol}`)).toEqual(["60 v12", "62 v12"]);
    const back = readMusicXml(songToMusicXml(song)).analysis.parts[0]!.notes;
    expect(back.map((n) => n.pitch)).toEqual([60, 62]);
    expect(back[0]!.velocity).toBe(back[1]!.velocity);
  });

  it("15: 같은 GM 번호라도 다른 악기는 따로 연주자로", () => {
    const base = emptySong({ title: "", author: "", profileId: "mobile" });
    const track = (id: string, playerId: string) => ({ id, playerId, name: "", color: "", role: "free" as const, mute: false, solo: false, spelling: {}, notes: [{ id: `${id}n`, start: rat(0), dur: rat(1, 4), pitch: 72, vol: 10, tie: "none" as const }] });
    const song: Song = {
      ...base,
      players: [
        { id: "a", name: "하모니카", instrument: { canonical: "harmonica" } },
        { id: "b", name: "냥", instrument: { canonical: "cat-harmonica" } },
      ],
      tracks: [track("t1", "a"), track("t2", "b")],
    };
    const { analysis } = readMusicXml(songToMusicXml(song));
    const plan = suggestPlan(analysis, MOBILE_PROFILE);
    expect(plan.players.map((p) => p.instrument.canonical)).toEqual(["harmonica", "cat-harmonica"]);
  });

  it("19: 소수·게임 범위 밖 템포는 맞추고 알린다", () => {
    const xml = one(`<sound tempo="300"/>${note("C", 4, 1)}<sound tempo="120.5"/>${note("D", 4, 1)}`);
    const result = importSong(xml);
    expect(result.song.tempo.map((t) => t.bpm)).toEqual([255, 121]);
    expect(result.tempoFixed).toEqual({ rounded: 1, clamped: 1 });
  });

  it("35: UTF-16·선언 인코딩을 따른다", () => {
    const xml = one(note("C", 4, 1));
    const utf16 = new Uint8Array(2 + xml.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let i = 0; i < xml.length; i++) {
      utf16[2 + i * 2] = xml.charCodeAt(i) & 0xff;
      utf16[3 + i * 2] = xml.charCodeAt(i) >> 8;
    }
    expect(decodeXml(utf16)).toBe(xml);
    const latin = `<?xml version="1.0" encoding="ISO-8859-1"?><score-partwise><work><work-title>Caf\xe9</work-title></work><part-list/></score-partwise>`;
    const bytes = Uint8Array.from([...latin].map((c) => c.charCodeAt(0)));
    expect(readMusicXml(decodeXml(bytes)).report.title).toBe("Café");
  });

  it("36: 앞의 주석이 길어도 MusicXML로 알아본다", () => {
    const xml = `<?xml version="1.0"?><!--${"x".repeat(17000)}-->` + one(note("C", 4, 1)).replace(/^<\?xml[^>]*>/, "");
    expect(looksLikeMusicXml(xml)).toBe(true);
    expect(readMusicXml(xml).analysis.parts[0]!.notes).toHaveLength(1);
  });

  it("37: 소수 divisions", () => {
    expect(notesOf(one(note("C", 4, 1), 0.1))).toEqual(["0/1 5/2 60 80"]);
  });
});

describe("Codex 재점검 (beta.32)", () => {
  const P = `<score-part id="P1"><part-name>Piano</part-name></score-part>`;
  const one = (body: string, div = 1) => score(`<part id="P1"><measure number="1"><attributes><divisions>${div}</divisions></attributes>${body}</measure></part>`, P);
  const notesOf = (xml: string) => readMusicXml(xml).analysis.parts.flatMap((p) => p.notes.map((n) => `${key(n.start)} ${key(n.dur)} ${n.pitch}`));
  const importSong = (xml: string) => {
    const { analysis } = readMusicXml(xml);
    return midiToSong(analysis, planOf(analysis), MOBILE_PROFILE);
  };
  const base = () => emptySong({ title: "", author: "", profileId: "mobile" });
  const track = (id: string, playerId: string, notes: Note[]) => ({ id, playerId, name: "", color: "", role: "free" as const, mute: false, solo: false, spelling: {}, notes });
  const n = (id: string, start: Rat, dur: Rat, pitch: number): Note => ({ id, start, dur, pitch, vol: 10, tie: "none" });

  it("N1: 아주 작은 소수 divisions도 정확히", () => {
    // xs:decimal에는 지수 표기가 없으니 글자 그대로 적는다 (JS 숫자로 넣으면 4e-7이 된다)
    const xml = one(`<note><pitch><step>C</step><octave>4</octave></pitch><duration>0.0000004</duration></note>`).replace("<divisions>1</divisions>", "<divisions>0.0000001</divisions>");
    expect(notesOf(xml)).toEqual(["0/1 1/1 60"]);
  });

  it("N2: 길이·세기가 다른 TAB 음은 겹침으로 지우지 않는다", () => {
    const xml = one(
      `<attributes><staves>2</staves><clef number="2"><sign>TAB</sign></clef></attributes>${note("C", 4, 1, "<staff>1</staff>")}<backup><duration>1</duration></backup>${note("C", 4, 4, "<staff>2</staff><notations><technical><string>2</string></technical></notations>")}`,
    );
    expect(notesOf(xml).sort()).toEqual(["0/1 1/1 60", "0/1 1/4 60"]);
    const same = one(
      `<attributes><staves>2</staves><clef number="2"><sign>TAB</sign></clef></attributes>${note("C", 4, 1, "<staff>1</staff>")}<backup><duration>1</duration></backup>${note("C", 4, 1, "<staff>2</staff><notations><technical><string>2</string></technical></notations>")}`,
    );
    expect(notesOf(same)).toEqual(["0/1 1/4 60"]);
  });

  it("N3: 성부를 건넌 붙임줄 음은 가져온 뒤에도 길이를 지킨다", () => {
    // 성부 2의 C가 성부 1의 C로 붙임줄을 잇고, 성부 2에는 같은 높이 C가 또 겹쳐 울린다
    const xml = one(
      `${note("C", 4, 2, '<tie type="start"/><voice>2</voice>')}${note("C", 4, 2, "<voice>2</voice>")}<backup><duration>4</duration></backup><forward><duration>2</duration></forward>${note("C", 4, 1, '<tie type="stop"/><voice>1</voice>')}`,
    );
    expect(notesOf(xml).sort()).toEqual(["0/1 3/4 60", "1/2 1/2 60"]);
    const c = importSong(xml).song.tracks.flatMap((t) => t.notes.map((x) => `${key(x.start)} ${key(x.dur)}`)).sort();
    expect(c).toEqual(["0/1 3/4", "1/2 1/2"]);
  });

  it("N4: 보표를 건넌 붙임줄도 잇는다", () => {
    const xml = score(
      `<part id="P1">
        <measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes>
          ${note("C", 4, 4, '<tie type="start"/><staff>1</staff>')}
        </measure>
        <measure number="2">${note("C", 4, 4, '<tie type="stop"/><staff>2</staff>')}</measure>
      </part>`,
      P,
    );
    expect(notesOf(xml)).toEqual(["0/1 2/1 60"]);
  });

  it("N5: 게임 범위 밖 음은 옥타브를 접어 남기고, 4분음은 알린다", () => {
    const xml = one(note("C", -1, 1) + note("G", 9, 1) + `<note><pitch><step>D</step><alter>0.5</alter><octave>4</octave></pitch><duration>1</duration></note>`);
    const { analysis, report } = readMusicXml(xml);
    expect(analysis.parts[0]!.notes).toHaveLength(3);
    expect(report.microtones).toBe(1);
    const result = midiToSong(analysis, planOf(analysis), MOBILE_PROFILE);
    const pitches = result.song.tracks.flatMap((t) => t.notes.map((x) => x.pitch));
    expect(pitches).toHaveLength(3);
    const lo = (MOBILE_PROFILE.octave.min + 1) * 12;
    const hi = Math.min(127, (MOBILE_PROFILE.octave.max + 1) * 12 + 11);
    for (const p of pitches) {
      expect(p).toBeGreaterThanOrEqual(lo);
      expect(p).toBeLessThanOrEqual(hi);
    }
    expect(result.folded).toBeGreaterThanOrEqual(1);
  });

  it("N6: 같은 악기 연주자 둘은 다시 읽어도 따로 남는다", () => {
    const song: Song = {
      ...base(),
      players: [
        { id: "a", name: "A", instrument: { canonical: "piano" } },
        { id: "b", name: "B", instrument: { canonical: "piano" } },
      ],
      tracks: [track("t1", "a", [n("x", rat(0), rat(1, 4), 60)]), track("t2", "b", [n("y", rat(0), rat(1, 4), 60)])],
    };
    const { analysis } = readMusicXml(songToMusicXml(song));
    const plan = suggestPlan(analysis, MOBILE_PROFILE);
    expect(plan.players).toHaveLength(2);
    const back = midiToSong(analysis, plan, MOBILE_PROFILE).song;
    expect(back.tracks.flatMap((t) => t.notes)).toHaveLength(2);
  });

  it("N7: 마디 중간 이조는 그 시각부터", () => {
    // 성부 2를 먼저 적어 XML 순서와 시각 순서를 어긋나게 한다
    const xml = one(
      `<backup><duration>0</duration></backup>${note("C", 4, 2, "<voice>1</voice>")}<attributes><transpose><chromatic>-2</chromatic></transpose></attributes>${note("C", 4, 2, "<voice>1</voice>")}<backup><duration>4</duration></backup>${note("E", 4, 1, "<voice>2</voice>")}`,
    );
    expect(notesOf(xml).sort()).toEqual(["0/1 1/2 60", "0/1 1/4 64", "1/2 1/2 58"]);
  });

  it("N8: 작곡가를 오간다", () => {
    const song: Song = { ...base(), meta: { ...base().meta, author: "EarlGreyPie" }, players: [{ id: "a", name: "A", instrument: { canonical: "piano" } }], tracks: [track("t", "a", [n("x", rat(0), rat(1, 4), 60)])] };
    expect(readMusicXml(songToMusicXml(song)).report.composer).toBe("EarlGreyPie");
  });

  it("N10: 길이 한도를 프로필에서 읽는다", () => {
    const limit = { ...MOBILE_PROFILE.length, max: 32 };
    const { notes, moved } = fitWritable([n("a", rat(0), rat(1, 64), 60), n("b", rat(1, 64), rat(15, 64), 62)], limit);
    expect(moved).toBeGreaterThan(0);
    expect(notes.map((x) => key(x.dur))).toEqual(["1/32", "7/32"]);
  });
});
