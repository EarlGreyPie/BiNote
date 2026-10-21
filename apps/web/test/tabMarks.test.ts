import { describe, expect, it } from "vitest";
import { assignTab, harmonicLabel, rat, STANDARD_TUNING, type Note } from "@mmlce/core";
import { parseMml } from "@mmlce/mml";
import { layoutTabMarks, struckNotes, tieLinks } from "../src/lib/tabMarks";

/** MML 트랙들 → 음 (트랙마다 id 앞글자를 달리한다) */
function tracksOf(mmls: readonly string[]): Note[][] {
  return mmls.map((mml, k) => parseMml(mml).notes.map((n, i) => ({ id: `${k}.${i}`, start: n.start, dur: n.dur, pitch: n.pitch, vol: n.vol, tie: n.tie })));
}

/** 그리는 쪽과 같은 길: 이어 울리는 뒷음을 빼고 줄 배정 → 숫자·괄호·× 자리 */
function marksOf(tracks: readonly Note[][], pxPerWhole: number) {
  return marksAt(tracks, [pxPerWhole])[0]!;
}

/** 확대(온음표 px)마다 한 번씩. 줄 배정은 확대와 상관없어 한 번만 한다 */
function marksAt(tracks: readonly Note[][], zooms: readonly number[], tight = 18) {
  const links = tieLinks(tracks);
  const slides = new Map(links.flatMap((l) => (l.kind === "slide" ? [[l.to, l.from] as const] : [])));
  const events = assignTab(tracks.flatMap((t) => struckNotes(t)), STANDARD_TUNING, new Map(), slides);
  return zooms.map((z) => layoutTabMarks(events, links, (t) => t * z, (text) => text.length * 7, tight));
}

/** 확대마다 화면에 아무 표시도 없는 음 id */
function unseen(tracks: readonly Note[][], zooms: readonly number[]): string[] {
  return marksAt(tracks, zooms).flatMap((m, k) => {
    const seen = new Set([...m.frets, ...m.holds, ...m.missing].flatMap((x) => x.ids));
    return tracks.flat().map((n) => n.id).filter((id) => !seen.has(id)).map((id) => `${id}@${zooms[k]}`);
  });
}

const LENGTHS = ["1", "2", "2.", "3", "4", "4.", "5", "6", "7", "8", "8.", "9", "11", "12", "13", "16", "16.", "20", "24", "28", "32", "32.", "48", "64", "4..", "64."];
const DEFAULTS = ["4", "16", "20", "28", "64"];
const ZOOMS = [40, 220, 900];

describe("타브에 안 나오는 음이 없다", () => {
  it("16분음표 뒤에 &로 이은 점4분음표(EarlGreyPie 제보: l16 … f+c+&c+4.)도 괄호로 보인다", () => {
    const tracks = tracksOf(["o5l16f+c+&c+4.d8"]);
    const m = marksOf(tracks, 220);
    const tail = tracks[0]![2]!.id;
    const hold = m.holds.find((h) => h.ids.includes(tail));
    expect(hold).toBeDefined();
    // 앞 숫자(c+ 14)를 덮지 않고 그 오른쪽에 쓴다
    const head = m.frets.find((f) => f.ids.includes(tracks[0]![1]!.id))!;
    expect(hold!.left).toBeGreaterThanOrEqual(head.left + head.width);
    expect(unseen(tracks, ZOOMS)).toEqual([]);
  });

  it("모든 길이 × 기본 길이 × 같은 음·다른 음 잇기 × 마디 넘기 × 확대", () => {
    const bad: string[] = [];
    for (const def of DEFAULTS)
      for (const a of LENGTHS)
        for (const b of [...LENGTHS, ""])
          for (const lead of ["", "r2.", "c16"])
            for (const second of ["c", "d", "c&c", "<c", "c&d&c"]) {
              const mml = `o4l${def}${lead}e${a}&${second}${b}g`;
              const tracks = tracksOf([mml]);
              const miss = unseen(tracks, ZOOMS);
              if (miss.length) bad.push(`${mml} ${miss.join(" ")}`);
            }
    expect(bad.slice(0, 10)).toEqual([]);
  }, 60_000);

  it("화음(여러 트랙) 안에서 잇기, 칠 수 없는 음에 잇기", () => {
    const bad: string[] = [];
    const parts = ["l16cc&c4.e", "l8e&e16.g&a32", "l4c&>c<c", "l16o8c&c4", "l20d&d&d&d&d", "l28c&c&c&c&c&c&c"];
    for (const x of parts)
      for (const y of parts)
        for (const z of ["", "l16e&e4.", "o2l8a&a"]) {
          const tracks = tracksOf([`o4${x}`, `o3${y}`, ...(z ? [z] : [])]);
          const miss = unseen(tracks, ZOOMS);
          if (miss.length) bad.push(`${x} | ${y} | ${z} ${miss.join(" ")}`);
        }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("붙은 괄호는 같은 사슬 앞 괄호가 함께 맡고, 떨어진 괄호는 호를 긋는다", () => {
    const tracks = tracksOf(["o4l64c&c&c&c"]);
    const m = marksOf(tracks, 220);
    expect(m.holds).toHaveLength(1);
    expect(m.holds[0]!.ids).toHaveLength(3);
    expect(m.holds[0]!.arc).toBeUndefined();
    const wide = marksOf(tracksOf(["o4l4c&c"]), 220);
    expect(wide.holds[0]!.arc).toBeDefined();
  });
});

describe("실험실 하모닉스 글자", () => {
  it("하모닉스 표시가 맞는 줄·프렛이면 숫자 대신 <7>, 이어 울림 괄호도 같은 글자", () => {
    const lab = { kind: "harmonic", type: "natural", pitch: 47, vol: 10, string: 6, fret: 7 } as const;
    const notes: Note[] = [
      { id: "a", start: rat(0), dur: rat(1, 4), pitch: 59, vol: 8, tie: "next", tabString: 6, lab },
      { id: "b", start: rat(1, 4), dur: rat(1, 4), pitch: 59, vol: 8, tie: "none", tabString: 6, lab },
      { id: "c", start: rat(1, 2), dur: rat(1, 4), pitch: 59, vol: 8, tie: "none" },
    ];
    const links = tieLinks([notes]);
    const events = assignTab(struckNotes(notes), STANDARD_TUNING);
    const m = layoutTabMarks(events, links, (t) => t * 400, (text) => text.length * 7, 18, -Infinity, Infinity, harmonicLabel);
    expect(m.frets.find((f) => f.ids.includes("a"))?.text).toBe("<7>");
    expect(m.holds[0]?.text).toBe("(<7>)");
    // 표시 없는 같은 높이 음은 보통 숫자
    expect(m.frets.find((f) => f.ids.includes("c"))?.text).not.toContain("<");
  });
});
