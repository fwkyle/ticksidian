/**
 * TICK-UX-006 — 생성일 정렬이 파일 생성 시각(birthtime)을 쓴다.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/생성일-정렬-birthtime.md
 *
 * frontmatter createdAt이 없는 노트 X를 먼저, Y를 나중에 만들고 X를 다시 수정하면
 *   생성일 정렬: Y가 X 위 (Y가 나중에 생김)
 *   수정일 정렬: X가 Y 위 (X를 마지막에 고침)
 * 수정 전엔 생성일=수정일이라 두 정렬 모두 X가 위 → RED.
 */

import { test, expect, type Page } from "@playwright/test";

const X_PATH = "/mock-vault/notes/생성일-엑스.md";
const Y_PATH = "/mock-vault/notes/생성일-와이.md";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

const list = (page: Page) => page.locator("[data-note-column]");

async function writeVault(page: Page, path: string, content: string) {
  await page.evaluate(async ({ p, c }) => {
    await (window as Window & { __qa_writeVaultFile: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile(p, c);
  }, { p: path, c: content });
}

async function titlesInOrder(page: Page): Promise<string[]> {
  return list(page)
    .locator("[data-list-item]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-list-item") ?? ""));
}

test("생성일 정렬은 birthtime을, 수정일 정렬은 mtime을 따른다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // X 생성 → Y 생성 → X 수정. 같은 밀리초를 피하려고 사이를 띄운다.
  await writeVault(page, X_PATH, "# 생성일 엑스\n\n먼저 만든 노트\n");
  await page.waitForTimeout(40);
  await writeVault(page, Y_PATH, "# 생성일 와이\n\n나중에 만든 노트\n");
  await page.waitForTimeout(40);
  await writeVault(page, X_PATH, "# 생성일 엑스\n\n먼저 만들었지만 마지막에 고친 노트\n");

  // 재스캔 트리거: 목록의 투두 토글은 frontmatter 저장 후 refreshNotes를 돈다.
  const kindFilter = list(page).getByRole("group", { name: "종류 필터" });
  await kindFilter.getByRole("button", { name: /^할 일/ }).click();
  // 완료 숨기기(기본 on) 때문에 완료 처리하면 행이 사라진다 — 완료 보기로 먼저 튼다.
  await list(page).getByRole("button", { name: "완료한 할 일 보이기" }).click();
  await list(page).getByRole("button", { name: "세금계산서 발행 완료" }).click();
  await expect(list(page).getByRole("button", { name: "세금계산서 발행 완료 취소" })).toBeVisible({ timeout: 10000 });
  // "전체" 필터는 2026-08-29 제거됐다. 노트 필터로 되돌린다.
  await kindFilter.getByRole("button", { name: "기록", exact: true }).click();

  const sortSelect = list(page).getByLabel("정렬 기준");

  await sortSelect.selectOption("created");
  await expect.poll(async () => {
    const titles = await titlesInOrder(page);
    return titles.indexOf("생성일 와이") !== -1 && titles.indexOf("생성일 와이") < titles.indexOf("생성일 엑스");
  }, { timeout: 8000, message: "생성일 정렬에서 나중에 만든 Y가 X 위여야 한다" }).toBe(true);

  await sortSelect.selectOption("updated");
  await expect.poll(async () => {
    const titles = await titlesInOrder(page);
    return titles.indexOf("생성일 엑스") !== -1 && titles.indexOf("생성일 엑스") < titles.indexOf("생성일 와이");
  }, { timeout: 8000, message: "수정일 정렬에서 마지막에 고친 X가 Y 위여야 한다" }).toBe(true);
});
