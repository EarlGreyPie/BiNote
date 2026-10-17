import { execSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
import { changelogSection } from "./src/lib/releaseNotes";

/**
 * 빌드한 파일 목록을 서비스 워커(public/sw.js)에 적어 넣는다. 캐시 이름은 파일 이름(해시)으로 만들어,
 * 새로 배포하면 옛 캐시를 지우고 새 파일을 받는다
 */
function precacheList(info: { version: string }, notes: string): Plugin {
  let files: string[] = [];
  let outDir = "dist";
  return {
    name: "mmlce-precache",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_, bundle) {
      files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
    },
    writeBundle() {
      const path = join(outDir, "sw.js");
      const list = ["./", ...files.map((f) => `./${f}`), "./manifest.webmanifest", "./icon.svg", "./favicon.ico", "./apple-touch-icon.png",
        "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-192.png", "./icons/icon-maskable-512.png",
        "./licenses/GPL-3.0.txt", "./licenses/third-party.txt", "./licenses/fonts.txt"];
      let hash = 0;
      for (const ch of files.sort().join("|")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      const sw = readFileSync(path, "utf8")
        // 바꿀 글은 함수로 넘긴다. 글을 그대로 넘기면 CHANGELOG 등에 든 $&·$'가 바꾸기 기호로 읽힌다
        .replace('const CACHE = "mmlce-dev";', () => `const CACHE = "mmlce-${hash.toString(36)}";`)
        .replace("const PRECACHE = [];", () => `const PRECACHE = ${JSON.stringify(list)};`)
        .replace('const VERSION = "dev";', () => `const VERSION = ${JSON.stringify(info.version)};`)
        .replace('const NOTES = "";', () => `const NOTES = ${JSON.stringify(notes)};`);
      writeFileSync(path, sw);
      // 앱 자체 라이선스(GPL-3.0) 본문을 라이선스 고지 옆에 둔다. 정보 화면에서 오프라인으로도 열린다
      copyFileSync(new URL("../../LICENSE", import.meta.url), join(outDir, "licenses", "GPL-3.0.txt"));
    },
  };
}

/** git 명령 결과. git이 없거나(압축 파일로 받은 소스 등) 실패하면 "" */
function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }).toString().trim();
  } catch {
    return "";
  }
}

/** 한국 시각(KST) 날짜 YYMMDD와 그날 0시의 시각(ISO) */
function kstDay(ms: number): { day: string; start: string } {
  const kst = new Date(ms + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { day: `${pad(y % 100)}${pad(m + 1)}${pad(d)}`, start: new Date(Date.UTC(y, m, d) - 9 * 3600_000).toISOString() };
}

/**
 * 빌드 표기 "YYMMDD vN": 이 커밋을 만든 날(KST)과, 그날 이 줄기(첫 부모)에 쌓인 몇 번째 커밋인지.
 * 공개 저장소는 판마다 커밋 하나라 그날 몇 번째 판인지가 된다. 같은 커밋은 몇 번 빌드해도 같은 표기다.
 * 얕게 받은 저장소(Cloudflare 빌드 등)면 그날 커밋까지 더 받아 본다. 그래도 셀 수 없으면 날짜만 쓴다
 */
function buildLabel(): string {
  const committed = Date.parse(git("log -1 --format=%cI HEAD"));
  if (!Number.isFinite(committed)) return kstDay(Date.now()).day;
  const { day, start } = kstDay(committed);
  // 얕게 받았으면 그날 0시 뒤의 커밋을 모두 받는다. 받기에 실패했는데 가진 가장 오래된 커밋도 그날 것이면, 그 앞에도 그날 커밋이 있을 수 있어 세지 않는다
  const shallow = git("rev-parse --is-shallow-repository") === "true";
  const fetched = shallow && git(`fetch --quiet --shallow-since=${start} origin && echo ok`) === "ok";
  const count = Number(git(`rev-list --first-parent --count --since=${start} HEAD`));
  if (!(count >= 1)) return day;
  if (shallow && !fetched) {
    const oldest = git("rev-list --first-parent --reverse HEAD").split("\n")[0];
    if (!oldest || Date.parse(git(`log -1 --format=%cI ${oldest}`)) >= Date.parse(start)) return day;
  }
  return `${day} v${count}`;
}

/** 화면에 띄울 판 정보: package.json 버전, 커밋(짧게), 빌드 표기(YYMMDD vN) */
function buildInfo(): { version: string; commit: string; build: string; published: boolean } {
  const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
  // Cloudflare 빌드는 커밋을 환경 변수로도 준다. 둘 다 없으면(압축 파일로 받은 소스 등) 비운다
  const commit = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? git("rev-parse HEAD");
  // 공개 사이트는 공개 저장소를 Pages로 빌드한다. 그 커밋이어야 정보 화면에서 소스 링크를 그 커밋으로 건다
  return { version, commit: commit.slice(0, 7), build: buildLabel(), published: !!process.env.CF_PAGES_COMMIT_SHA };
}

const build = buildInfo();
// 이 판의 CHANGELOG 절을 서비스 워커에 넣어, 옛 판이 새 판을 받았을 때 GitHub Releases를 못 읽으면 대신 보여 준다
const notes = changelogSection(readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8"), build.version);

export default defineConfig({
  // 지금 판의 CHANGELOG 절은 ? 메뉴 "이번 업데이트 내역"이 Releases를 못 읽을 때 쓴다
  define: { __MMLCE_BUILD__: JSON.stringify(build), __MMLCE_NOTES__: JSON.stringify(notes) },
  // GitHub Pages 등 하위 경로에 올려도 되도록 상대 경로로 만든다
  base: "./",
  plugins: [svelte(), precacheList(build, notes)],
});
