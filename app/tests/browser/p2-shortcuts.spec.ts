/**
 * 2026-08-18 TICK-UX-008 2단계 — 전역 단축키 3종 회귀.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * Cmd+\: 사이드바 2열 일괄 토글(집중 모드), Cmd+N: 새 노트, Cmd+K: 검색 포커스.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

test("Cmd+\\ 로 사이드바 2열을 접고 다시 펼친다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await expect(page.locator("[data-folder-column]")).toBeVisible();

  await page.keyboard.press("Meta+\\");
  await expect(page.locator("[data-folder-column]")).toBeHidden();
  await expect(page.locator("[data-note-column]")).toBeHidden();

  await page.keyboard.press("Meta+\\");
  await expect(page.locator("[data-folder-column]")).toBeVisible();
  await expect(page.locator("[data-note-column]")).toBeVisible();
});

test("Cmd+K 로 검색창에 포커스가 간다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await page.keyboard.press("Meta+k");
  const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  expect(label).toBe("노트 검색");
});

test("Cmd+N 은 지금 고른 폴더에 새 기록를 만든다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 폴더 열에서 lectures 를 고른다 — 목록 + 버튼과 같은 규칙이어야 한다(검수 후속 P2).
  await page
    .locator("[data-folder-column]")
    .getByRole("button", { name: /lectures/ })
    .first()
    .click();

  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  await page.keyboard.press("Meta+n");
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  const added = after.filter((p) => !before.includes(p));
  expect(added).toHaveLength(1);
  // 볼트 루트가 아니라 고른 폴더(lectures) 안에 만들어진다.
  expect(added[0]).toContain("/lectures/");
});

test("할 일 필터의 Cmd+N 은 빈 할 일을 만들고 필터를 유지한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 폴더 선택 + 종류 필터가 투두인 상태 — 목록 + 버튼과 같은 분기(검수 후속 P2).
  await page
    .locator("[data-folder-column]")
    .getByRole("button", { name: /lectures/ })
    .first()
    .click();
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: /^할 일/ })
    .click();

  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  await page.keyboard.press("Meta+n");
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  const added = after.filter((p) => !before.includes(p));
  expect(added).toHaveLength(1);
  expect(added[0]).toContain("/lectures/");

  // 2026-09-22 계약 변경: 할 일 탭에서 Cmd+N은 빈 할 일을 만든다(기록은 만들지 않는다).
  const content = await page.evaluate(
    (path) => window.__qa_readVaultFile?.(path) ?? "",
    added[0],
  );
  expect(content).toContain('type: "todo"');
  expect(content).toContain('title: "새 노트"');
  await expect(
    page
      .locator("[data-note-column]")
      .getByRole("group", { name: "종류 필터" })
      .getByRole("button", { name: /^할 일/ }),
  ).toHaveAttribute("aria-pressed", "true");
  // 빈 항목의 기본 제목은 두 종류 모두 "새 노트"이고, 종류만 할 일로 만든다.
  await expect(page.locator("[data-note-column]").locator('[data-list-item="새 노트"]')).toBeVisible();
});
