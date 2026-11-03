/**
 * 2026-08-18 TICK-UX-008 1단계 — NoteInfoBar 마감일/우선순위 편집 회귀.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 투두를 열고 상세를 펼치면 기한/우선순위를 그 자리에서 고칠 수 있어야 한다.
 * 저장은 기존 updateTodoField → updateNoteFrontmatter 경로를 그대로 쓴다.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

test("투두 상세에서 마감일과 우선순위를 고치면 파일에 반영된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 투두 하나를 연다(세금계산서 발행). 기본 보기가 노트라 투두 필터를 먼저 고른다.
  await page.locator("[data-note-column]").getByRole("button", { name: /^할 일/ }).click();
  await page.locator("[data-note-column]").getByRole("button", { name: "세금계산서 발행", exact: true }).click();
  const infoBar = page.locator("[data-note-info-bar]");
  await expect(infoBar).toBeVisible();

  // 상세 펼치기 전에는 편집 컨트롤이 없다.
  await expect(infoBar.locator("input[type='date']")).toBeHidden();

  await infoBar.getByRole("button", { name: /상세/ }).click();
  const dateInput = infoBar.locator("input[type='date']");
  await expect(dateInput).toBeVisible();

  await dateInput.fill("2026-08-20");
  await page.waitForTimeout(1200); // frontmatter 저장 + 목록 재스캔 대기

  const prioSelect = infoBar.locator("select[aria-label='우선순위 변경']");
  await prioSelect.selectOption("긴급");
  await page.waitForTimeout(1200);

  // 파일에 실제로 반영됐는지 확인한다.
  const content = await page.evaluate(() =>
    window.__qa_readVaultFile?.("/mock-vault/notes/todo-alpha.md") ?? "",
  );
  expect(content).toContain("dueDate");
  expect(content).toContain("2026-08-20");
  expect(content).toContain("priority");
  expect(content).toContain("긴급");

  // 화면 표시도 갱신된다(재스캔 후 라벨).
  await expect(infoBar).toContainText("긴급");
});
