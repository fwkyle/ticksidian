/**
 * TICK-IMG-002 2-C — attachments 폴더 정렬/기본 접힘 QA.
 *
 * 분류: 브라우저 fixture QA
 * 설계: docs/waterfall/03-상세설계/이미지-넣기-노션-체감형.md 2-C
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

test("attachments 폴더는 맨 아래(archive 앞)에 있고 기본 접혀 있다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const rows = page.locator("[data-folder-row]");
  await expect(rows.first()).toBeVisible({ timeout: 10000 });
  const names = await rows.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.folderRow ?? ""),
  );

  const attachmentsIndex = names.indexOf("attachments");
  const archiveIndex = names.indexOf("archive");
  expect(attachmentsIndex).toBeGreaterThanOrEqual(0);
  expect(archiveIndex).toBeGreaterThanOrEqual(0);
  expect(attachmentsIndex).toBeLessThan(archiveIndex);
  expect(attachmentsIndex).toBe(names.length - 2);
  expect(archiveIndex).toBe(names.length - 1);

  // 기본 접힘: attachments의 하위 폴더가 이미지 첨부로 생겨도 접힌 상태다.
  // fixture에서 최상위 폴더는 전부 접힘 시작 — aria-expanded로 확인한다.
  const attachmentsToggle = page.locator(
    "[data-folder-row='attachments'] [aria-expanded]",
  );
  await expect(attachmentsToggle).toHaveAttribute("aria-expanded", "false");
});

test("새로고침 후에도 정렬이 유지된다(상태 오염 없음)", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await page.reload();
  await waitForAppReady(page);

  const names = await page
    .locator("[data-folder-row]")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.folderRow ?? ""));
  expect(names.indexOf("attachments")).toBe(names.length - 2);
  expect(names.indexOf("archive")).toBe(names.length - 1);
});
