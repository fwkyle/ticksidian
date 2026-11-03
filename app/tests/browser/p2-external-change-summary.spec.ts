/**
 * TICK-UX-008 3단계 — 외부 수정 충돌 배너에 변경 요약 표시.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/외부-수정-배너-요약.md
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

test("외부 수정 배너에 frontmatter와 본문 변경 요약이 뜬다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "알파 노트", exact: true })
    .click();
  await expect(page.locator(".bn-editor")).toBeVisible();

  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("로컬 미저장", { delay: 10 });

  const external = [
    "---",
    'id: "note-alpha"',
    'aliases: ["alpha","첫 번째"]',
    'updatedAt: "2026-06-11T00:00:00.000Z"',
    "---",
    "# 알파 노트",
    "",
    "브라우저 QA 테스트용 첫 번째 노트입니다.",
    "",
    "관련 문서: [[아직 없는 노트]]",
    "외부 추가 1",
    "외부 추가 2",
    "",
  ].join("\n");
  await page.evaluate((content) => {
    return (window as Window & { __qa_writeVaultFile?: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile?.("/mock-vault/notes/note-alpha.md", content);
  }, external);

  // 외부 쓰기 뒤 3초 폴로가 pending을 잡도록 미저장 상태를 유지한다.
  for (let i = 0; i < 5; i += 1) {
    await page.locator(".bn-editor").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("계속", { delay: 10 });
    await page.waitForTimeout(700);
  }

  await expect(page.getByText("파일이 외부에서 수정되었습니다")).toBeVisible({ timeout: 12000 });
  await expect(page.getByText("변경 요약:")).toBeVisible({ timeout: 12000 });
  await expect(page.getByText("frontmatter: updatedAt")).toBeVisible();
  await expect(page.getByText("본문 +2줄")).toBeVisible();
});
