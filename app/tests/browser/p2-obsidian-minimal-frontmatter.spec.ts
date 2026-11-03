/**
 * TICK-UX-002 — 옵시디언 원본 노트를 편집해도 관리용 frontmatter가 오염되지 않는다.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/옵시디언-원본-최소-frontmatter.md
 */

import { test, expect, type Page } from "@playwright/test";

const OBSIDIAN_NOTE_PATH = "/mock-vault/inbox/맨몸-메모.md";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> })
      .__qa_readVaultFile?.(p);
  }, path)) ?? "";
}

test("frontmatter 없는 옵시디언 원본을 저장해도 exportedAt/source가 붙지 않는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "맨몸 메모", exact: true })
    .click();

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.isContentEditable,
        ),
      { timeout: 15000 },
    )
    .toBe(true);

  await page.keyboard.press("Meta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("옵시디언 원본 편집", { delay: 20 });

  await expect
    .poll(() => readVaultFile(page, OBSIDIAN_NOTE_PATH), { timeout: 15000 })
    .toContain("옵시디언 원본 편집");

  const content = await readVaultFile(page, OBSIDIAN_NOTE_PATH);
  expect(content).not.toContain("exportedAt:");
  expect(content).not.toContain("source:");
});
