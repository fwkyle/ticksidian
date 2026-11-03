/**
 * 보관 폴더 — 기본 접힘 + 맨 아래 + 메뉴로 이동.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/보관-폴더.md
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function folderButtonTexts(page: Page): Promise<string[]> {
  return page.locator("[data-folder-select]").evaluateAll(
    (buttons) => buttons.map((button) => button.textContent?.trim() ?? ""),
  );
}

test("archive 폴더는 폴더 열에서 맨 아래이고 기본 접히다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const texts = await folderButtonTexts(page);
  const archiveIndex = texts.findIndex((text) => text.includes("archive"));
  expect(archiveIndex).toBeGreaterThanOrEqual(0);
  expect(archiveIndex).toBe(texts.length - 1);
  await expect(page.getByRole("button", { name: "archive 펴기" })).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await waitForAppReady(page);
  const afterReload = await folderButtonTexts(page);
  expect(afterReload.findIndex((text) => text.includes("archive"))).toBe(afterReload.length - 1);
});

test("노트 컨텍스트 메뉴로 보관 폴더로 이동한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "베타 노트", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "보관으로 이동" }).click();

  await page.getByRole("button", { name: /archive/ }).last().click();
  await expect(
    page.locator("[data-note-column]").getByRole("button", { name: "베타 노트", exact: true }),
  ).toBeVisible();
});
