/**
 * 2026-08-20 TICK-UX-009 목록 밀도·타이포그래피 회귀 방지.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 기준: docs/design-rules.md "목록 밀도 스케일"
 *
 * 확인 대상
 1. 노트/투두 목록 행 렌더 높이 >= 40px (min-h-[40px]).
 2. 폴더 열 행 렌더 높이 >= 34px (~36px 스케일).
 3. 태그 칩 computed font-size 11px.
 4. 에디터 본문 computed font-size 15px + line-height 1.5(22.5px).
 *
 * 측정 방식은 p1-ux-fixes.spec.ts와 같다 — 계산된 스타일/박스를 직접 재고
 * 기대값과 비교한다. fixture 한계: 실창(Tauri) 폰트 렌더링은 검증하지 않는다.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

test("목록 밀도·타이포그래피가 기준 스케일(노트 40px·폴더 34px·본문 15px)을 지킨다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForAppReady(page);

  // (1) 노트 행 — min-h-[40px]가 렌더 높이로 나타나야 한다.
  const noteRow = page.locator("[data-note-column] [data-list-item='알파 노트']");
  await expect(noteRow).toBeVisible();
  const noteRowHeight = (await noteRow.boundingBox())?.height ?? 0;
  expect(noteRowHeight, "노트 행 렌더 높이 >= 40px").toBeGreaterThanOrEqual(40);

  // (2) 투두 행(태그 칩 포함)도 같은 스케일이다. 기본 보기가 노트라 필터를 바꿔서 본다.
  const kindFilter = page.locator("[data-note-column]").getByRole("group", { name: "종류 필터" });
  await kindFilter.getByRole("button", { name: /^할 일/ }).click();
  const todoRow = page.locator("[data-note-column] [data-list-item='멘토님 연락']");
  await expect(todoRow).toBeVisible();
  const todoRowHeight = (await todoRow.boundingBox())?.height ?? 0;
  expect(todoRowHeight, "투두 행 렌더 높이 >= 40px").toBeGreaterThanOrEqual(40);

  // (3) 폴더 행 — 사이드바 ~36px 스케일(하한 34px).
  const folderRow = page.locator("[data-folder-column] [data-folder-row]").first();
  await expect(folderRow).toBeVisible();
  const folderRowHeight = (await folderRow.boundingBox())?.height ?? 0;
  expect(folderRowHeight, "폴더 행 렌더 높이 >= 34px").toBeGreaterThanOrEqual(34);

  // (4) 태그 칩 — 2026-08-29 [kyle] 승인으로 목록에서 태그 칩을 뗐다.
  //     칩이 목록 리듬을 깨는 문제라, 목록에 칩이 렌더되지 않음을 검사한다.
  //     태그는 노트 정보 바(NoteInfoBar)에서 확인·편집한다.
  const chipCount = await todoRow.getByText("#manual-review", { exact: true }).count();
  expect(chipCount, "목록에는 태그 칩이 없다").toBe(0);

  // (5) 에디터 본문 — 15px + line-height 1.5. 노트 필터로 되돌린 뒤 연다.
  await kindFilter.getByRole("button", { name: "기록", exact: true }).click();
  await noteRow.getByRole("button", { name: "알파 노트", exact: true }).click();
  await page.waitForSelector(".bn-editor", { timeout: 15000 });
  const paragraph = page.locator(".bn-editor [data-content-type='paragraph']").first();
  await expect(paragraph).toBeVisible();
  const typography = await paragraph.evaluate((el) => {
    const style = getComputedStyle(el);
    return { fontSize: style.fontSize, lineHeight: style.lineHeight };
  });
  expect(typography.fontSize, "에디터 본문 font-size 15px").toBe("15px");
  expect(
    parseFloat(typography.lineHeight),
    "에디터 본문 line-height 1.5(=22.5px)",
  ).toBe(22.5);
});
