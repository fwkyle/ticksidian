import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 브라우저 QA 설정 (TICK-P1-016)
 *
 * - 5175 포트 사용 (5173은 Tauri dev 전용 — 절대 점유하지 않음)
 * - Vite 서버를 webServer로 기동. VITE_TICKSIDIAN_BROWSER_QA=1 주입
 * - Chromium 단일 브라우저로 실행 (다른 브라우저는 CI 편입 시 판단)
 * - npm run qa (기존 Node 검증기 체인)에는 포함하지 않는다 — 별도 `qa:browser` 스크립트
 */
export default defineConfig({
  testDir: "./tests/browser",
  // 각 테스트는 독립 실행 가능해야 한다.
  fullyParallel: false,
  // CI 편입 전이므로 재시도는 로컬 1회로 제한
  retries: 0,
  workers: 1,
  reporter: "line",

  use: {
    baseURL: "http://localhost:5175",
    trace: "on-first-retry",
    // 폴링 대기가 있는 테스트를 위해 기본 action timeout을 넉넉하게
    actionTimeout: 15000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // 5175 포트: Tauri dev(5173)와 충돌하지 않는 포트
    command: "npm run dev -- --port 5175",
    port: 5175,
    reuseExistingServer: false,
    env: {
      VITE_TICKSIDIAN_BROWSER_QA: "1",
      // 셸에 NODE_ENV=production이 설정된 환경에서도 react-refresh preamble이
      // 주입되도록 강제한다 (@vitejs/plugin-react skipFastRefresh 방지).
      NODE_ENV: "development",
    },
    timeout: 30000,
  },
});
