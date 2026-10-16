import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeTempo } from "@mmlce/core";
import { mergeTies } from "@mmlce/mml";
import { decodeText, read3mle, readMmi, write3mle } from "../src/index.js";

// 저작권 있는 편곡 샘플은 저장소에 넣지 않는다. MMLCE_SAMPLES에 폴더를 주면 그 안의 파일로 확인한다.
const dir = process.env.MMLCE_SAMPLES;

function walk(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const p = join(root, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(mml|mmi)$/i.test(name) ? [p] : [];
  });
}

describe.skipIf(!dir)("로컬 샘플", () => {
  for (const file of dir ? walk(dir) : []) {
    it(file, () => {
      const text = decodeText(readFileSync(file));
      const { song, diagnostics } = file.endsWith(".mmi") ? readMmi(text) : read3mle(text);
      expect(diagnostics.filter((d) => d.level === "error")).toEqual([]);
      expect(song.tracks.length).toBeGreaterThan(0);
      if (file.endsWith(".mml")) {
        const shape = (s: typeof song) => s.tracks.map((t) => mergeTies(t.notes));
        // 원문 그대로 저장, 그리고 원문을 지우고 출력기로 다시 쓴 저장 모두 같은 소리여야 한다
        const printed = { ...song, tracks: song.tracks.map(({ mml: _mml, ...t }) => t) };
        for (const source of [song, printed]) {
          const back = read3mle(write3mle(source).text).song;
          expect(shape(back)).toEqual(shape(song));
          // 같은 위치의 같은 템포가 여러 채널에 적혀 있던 것은 출력할 때 하나로 합친다
          expect(normalizeTempo(back.tempo)).toEqual(normalizeTempo(song.tempo));
        }
      }
    });
  }
});
