import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { add, MOBILE_PROFILE, positionToSeconds, type Song } from "@mmlce/core";
import { decodeText, read3mle } from "@mmlce/fileio";
import { mergeTies } from "@mmlce/mml";
import { analyzeMidi, midiToSong, readSmf, songToSmf, writeSmf, type SmfEvent } from "../src/index.js";

// 저작권 있는 편곡 샘플은 저장소에 넣지 않는다. MMLCE_SAMPLES에 폴더를 주면 그 안의 파일로 확인한다.
const dir = process.env.MMLCE_SAMPLES;

function walk(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const p = join(root, name);
    return statSync(p).isDirectory() ? walk(p) : /\.mml$/i.test(name) ? [p] : [];
  });
}

/** 음마다 (높이, 시작 초, 끝 초) */
const timed = (song: Song) =>
  song.tracks.flatMap((t) =>
    mergeTies(t.notes)
      .filter((n) => n.vol > 0)
      .map((n) => ({ pitch: n.pitch, on: positionToSeconds(song.tempo, n.start), off: positionToSeconds(song.tempo, add(n.start, n.dur)) })),
  );

/** 같은 높이에서 시작이 40ms 안인 음끼리 짝짓는다. 끝은 80ms 안이면 같다고 본다 */
function match(want: ReturnType<typeof timed>, got: ReturnType<typeof timed>) {
  const pool = new Map<number, typeof want>();
  for (const n of want) pool.set(n.pitch, [...(pool.get(n.pitch) ?? []), n]);
  let hit = 0;
  let sameEnd = 0;
  for (const n of got) {
    const list = pool.get(n.pitch) ?? [];
    const i = list.findIndex((w) => Math.abs(w.on - n.on) <= 0.04);
    if (i < 0) continue;
    hit++;
    if (Math.abs(list[i]!.off - n.off) <= 0.08) sameEnd++;
    list.splice(i, 1);
  }
  return { precision: hit / got.length, recall: hit / want.length, sameEnd: sameEnd / Math.max(1, hit) };
}

/** 결정적인 흔들림 (±15ms 안팎) */
function jitter(events: readonly SmfEvent[], ppq: number, seed: number): SmfEvent[] {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const span = Math.round(ppq / 32);
  return events.map((e) => (e.type === "noteOn" || e.type === "noteOff" ? { ...e, tick: Math.max(0, e.tick + Math.round(rand() * span)) } : e));
}

describe.skipIf(!dir)("MIDI 왕복 (손편곡 → MIDI → 흔들기 → 가져오기)", () => {
  for (const file of dir ? walk(dir) : []) {
    it(file, () => {
      const song = read3mle(decodeText(readFileSync(file))).song;
      const smf = songToSmf(song);
      const shaken = { ...smf, tracks: smf.tracks.map((t, k) => ({ events: jitter(t.events, smf.ppq, k + 7) })) };
      const analysis = analyzeMidi(readSmf(writeSmf(shaken)));
      const plan = {
        players: song.players.map((p, k) => ({
          name: p.name,
          instrument: p.instrument,
          parts: analysis.parts.filter((x) => x.track === k + 1).map((x) => x.id),
          chords: MOBILE_PROFILE.maxChordsPerPlayer,
        })),
      };
      const result = midiToSong(analysis, plan, MOBILE_PROFILE);
      const { precision, recall, sameEnd } = match(timed(song), timed(result.song));
      console.log(`${file.split("/").pop()}: 격자 1/${result.grid} 셋잇단 ${result.tripletBeats}박, 정밀도 ${precision.toFixed(3)} 재현율 ${recall.toFixed(3)} 끝 일치 ${sameEnd.toFixed(3)}, 트랙 ${song.tracks.length}→${result.song.tracks.length}`);
      // 템포 루바토를 l7·l37 같은 불규칙 길이로 적은 곡(Green Tea Farm)은 격자로 되돌릴 수 없어 조금 낮다
      expect(recall).toBeGreaterThan(0.85);
      expect(precision).toBeGreaterThan(0.85);
    });
  }
});
