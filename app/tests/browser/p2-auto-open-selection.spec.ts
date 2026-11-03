/**
 * 첫 화면 자동 선택 — 열 수 있는 노트만 (2026-08-18 [kyle] 결정).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/첫-화면-자동-선택.md
 */

import { test, expect, type Page } from "@playwright/test";

const GIANT_PATH = "/mock-vault/inbox/거대-덤프.md";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
}

test("가장 최근 수정이 거대 노트여도 다음 열 수 있는 노트로 시작한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 거대 노트를 가장 최근 수정으로 만든 뒤 상태를 localStorage 미러에 남긴다.
  const original = (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> })
      .__qa_readVaultFile?.(p);
  }, GIANT_PATH)) ?? "";
  expect(original.length).toBeGreaterThan(500_000);
  const touched = `---\nupdatedAt: "2030-01-01T00:00:00.000Z"\n---\n${original}`;
  await page.evaluate(({ path, content }) => {
    return (window as Window & { __qa_writeVaultFile?: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile?.(path, content);
  }, { path: GIANT_PATH, content: touched });

  await page.reload();
  await waitForAppReady(page);
  await page.waitForTimeout(1000);

  // 거대 노트 차단 안내가 첫 화면이면 안 된다.
  await expect(page.getByText("이 노트는 너무 커서")).toHaveCount(0);
  // 다음 일반 노트의 정보 바/에디터가 열려 있어야 한다.
  const infoBar = page.locator("[data-note-info-bar]");
  await expect(infoBar).toBeVisible();
  await expect(infoBar).not.toContainText("거대 덤프");
  await expect(page.locator(".bn-editor")).toBeVisible();
});
