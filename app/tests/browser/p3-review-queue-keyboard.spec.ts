/**
 * 검토 큐 퀵키와 다중 선택 (2026-08-19).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/검토-큐-퀵키-다중선택.md
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function openReviewQueue(page: Page) {
  await page.getByRole("button", { name: "AI 정리 열기/닫기" }).click();
  await page.getByRole("button", { name: "외부 가져오기·기존 검토" }).click();
  await page.waitForSelector("[aria-label='TickTick 검토 큐']", { timeout: 15000 });
}

async function importSnapshot(page: Page) {
  await page.getByRole("button", { name: /스냅샷.*가져오기/ }).click();
  await expect(page.getByText(/가져오기 완료/)).toBeVisible({ timeout: 15000 });
}

async function openImportedQueue(page: Page) {
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);
  await importSnapshot(page);
  await page.getByLabel("검토 상태 필터").getByRole("button", { name: "전체", exact: true }).click();
}

test("J/K로 카드를 오가고 Enter/L로 승인한다", async ({ page }) => {
  await openImportedQueue(page);

  const cards = page.locator("article[data-review-source-key]");
  await expect(cards).toHaveCount(50, { timeout: 15000 });

  await cards.first().click();
  await expect(cards.first()).toHaveAttribute("data-review-focused", "true");

  await page.keyboard.press("j");
  await expect(cards.nth(1)).toHaveAttribute("data-review-focused", "true");
  await page.keyboard.press("Enter");
  await expect(cards.nth(1).getByLabel("검토 상태: 승인")).toBeVisible();

  await page.keyboard.press("k");
  await expect(cards.first()).toHaveAttribute("data-review-focused", "true");
  await page.keyboard.press("l");
  await expect(cards.first().getByLabel("검토 상태: 승인")).toBeVisible();

  await page.getByLabel("검토 항목 제목 입력").click();
  await page.keyboard.press("j");
  await expect(cards.first()).toHaveAttribute("data-review-focused", "true");
});

test("여러 카드를 선택해 한 번에 승인한다", async ({ page }) => {
  await openImportedQueue(page);

  const cards = page.locator("article[data-review-source-key]");
  await expect(cards).toHaveCount(50, { timeout: 15000 });

  await cards.first().getByLabel(/카드 선택:/).check();
  await cards.nth(1).getByLabel(/카드 선택:/).check();
  await page.getByRole("button", { name: "선택 항목 승인" }).click();

  await expect(cards.first().getByLabel("검토 상태: 승인")).toBeVisible();
  await expect(cards.nth(1).getByLabel("검토 상태: 승인")).toBeVisible();
  await expect(page.getByText("선택 항목 0개")).toBeVisible();
});
