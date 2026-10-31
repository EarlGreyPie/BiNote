import { existsSync } from "node:fs";
import { chromium, defineConfig, devices } from "@playwright/test";

/**
 * 화면 연기(smoke) 시험 (점검 S40). vite build로 만든 dist를 vite preview로 띄워 실제 앱을 브라우저로 연다.
 * 느려서 pnpm check에는 넣지 않는다. 루트에서 pnpm e2e(빌드 뒤 시험)로 돌린다.
 * Vitest(*.test.ts)에 걸리지 않게 시험은 e2e/*.spec.ts에 둔다
 */

/**
 * 시험용 서버 자리. vite preview 기본(4173)은 다른 작업 폴더의 미리 보기와 겹치기 쉬워 따로 둔다.
 * 이미 떠 있는 서버는 다른 빌드일 수 있어 다시 쓰지 않는다 (자리가 차 있으면 바로 실패한다). PW_PORT로 바꿀 수 있다
 */
const PORT = Number(process.env.PW_PORT ?? 4391);

/** 받아 둔 브라우저를 못 찾을 때 쓰는 미리 깔린 Chromium (개발 컨테이너) */
const PRESET_CHROMIUM = "/opt/pw-browsers/chromium";

/**
 * 브라우저 파일. 보통은 Playwright가 받아 둔 Chromium을 그대로 쓴다(CI는 playwright install로 받는다).
 * 그것을 못 찾는 컨테이너에서만 미리 깔린 Chromium을 쓴다. PW_CHROMIUM으로 직접 줄 수도 있다
 */
function chromiumPath(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  if (existsSync(chromium.executablePath())) return undefined;
  return existsSync(PRESET_CHROMIUM) ? PRESET_CHROMIUM : undefined;
}

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  // 시험마다 새 브라우저 문맥(저장소가 비어 있음)이라 서로 기대지 않는다. 그래도 한 서버를 함께 쓰므로 너무 많이 띄우지 않는다
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // 화면 글을 한국어로 고정해 단추 이름으로 찾는다 (언어는 navigator.languages로 고른다)
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // PC 화면 (롤·트랙 줄·편집기가 모두 보이는 크기)
        viewport: { width: 1280, height: 800 },
        launchOptions: chromiumPath() ? { executablePath: chromiumPath()! } : {},
      },
    },
  ],
  webServer: {
    // 빌드는 미리 해 둔다 (pnpm e2e가 먼저 빌드한다). 여기서는 dist만 띄운다
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
