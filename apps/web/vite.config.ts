import { execSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";

/**
 * 빌드한 파일 목록을 서비스 워커(public/sw.js)에 적어 넣는다. 캐시 이름은 파일 이름(해시)으로 만들어,
 * 새로 배포하면 옛 캐시를 지우고 새 파일을 받는다
 */
function precacheList(info: { version: string }): Plugin {
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
        .replace('const CACHE = "mmlce-dev";', `const CACHE = "mmlce-${hash.toString(36)}";`)
        .replace("const PRECACHE = [];", `const PRECACHE = ${JSON.stringify(list)};`)
        .replace('const VERSION = "dev";', `const VERSION = ${JSON.stringify(info.version)};`);
      writeFileSync(path, sw);
      // 앱 자체 라이선스(GPL-3.0) 본문을 라이선스 고지 옆에 둔다. 정보 화면에서 오프라인으로도 열린다
      copyFileSync(new URL("../../LICENSE", import.meta.url), join(outDir, "licenses", "GPL-3.0.txt"));
    },
  };
}

/** 화면에 띄울 판 정보: package.json 버전, 커밋(짧게), 빌드 시각(UTC) */
function buildInfo(): { version: string; commit: string; date: string; published: boolean } {
  const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
  // Cloudflare 빌드는 커밋을 환경 변수로도 준다. 둘 다 없으면(압축 파일로 받은 소스 등) 비운다
  let commit = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? "";
  if (!commit) {
    try {
      commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      commit = "";
    }
  }
  // 공개 사이트는 공개 저장소를 Pages로 빌드한다. 그 커밋이어야 정보 화면에서 소스 링크를 그 커밋으로 건다
  return { version, commit: commit.slice(0, 7), date: new Date().toISOString(), published: !!process.env.CF_PAGES_COMMIT_SHA };
}

const build = buildInfo();

export default defineConfig({
  define: { __MMLCE_BUILD__: JSON.stringify(build) },
  // GitHub Pages 등 하위 경로에 올려도 되도록 상대 경로로 만든다
  base: "./",
  plugins: [svelte(), precacheList(build)],
});
