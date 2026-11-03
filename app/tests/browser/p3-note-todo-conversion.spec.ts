/**
 * 노트 ↔ 투두 상호 변환 진입점 복구 (TICK-UX-005).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/노트-투두-상호-변환.md
 */

import { test, expect, type Page } from "@playwright/test";

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

function noteButton(page: Page, title: string) {
  return page.locator("[data-note-column]").getByRole("button", { name: title, exact: true });
}

test("목록 메뉴에서 노트를 투두로 변환한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await noteButton(page, "알파 노트").click({ button: "right" });
  await page.getByRole("menuitem", { name: "할 일로 표시" }).click();

  await page.locator("[data-note-column]").getByRole("button", { name: /^할 일/ }).first().click();
  await expect(noteButton(page, "알파 노트")).toBeVisible();
  const content = await readVaultFile(page, "/mock-vault/notes/note-alpha.md");
  expect(content).toContain('type: "todo"');
  expect(content).toContain("done: false");
});

test("목록 메뉴에서 투두를 노트로 되돌린다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 기본 보기가 노트(2026-08-29 "전체" 필터 제거)라 투두 필터를 먼저 고른다.
  await page.locator("[data-note-column]").getByRole("button", { name: /^할 일/ }).click();
  await noteButton(page, "세금계산서 발행").click({ button: "right" });
  await page.getByRole("menuitem", { name: "할 일 표시 해제" }).click();

  await page.locator("[data-note-column]").getByRole("button", { name: /^기록$/ }).click();
  await expect(noteButton(page, "세금계산서 발행")).toBeVisible();
  const content = await readVaultFile(page, "/mock-vault/notes/todo-alpha.md");
  expect(content).not.toContain('type: "todo"');
  expect(content).toContain("done: false");
});

test("열려 있는 노트를 투두로 변환한 뒤 타이핑해도 외부 수정 배너가 안 뜬다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await noteButton(page, "알파 노트").click();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await noteButton(page, "알파 노트").click({ button: "right" });
  await page.getByRole("menuitem", { name: "할 일로 표시" }).click();

  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("변환 직후 입력", { delay: 10 });
  await page.waitForTimeout(4500);

  await expect(page.getByText("파일이 외부에서 수정되었습니다")).toHaveCount(0);
  await expect(page.getByText("외부 수정이 감지되었습니다")).toHaveCount(0);
  const content = await readVaultFile(page, "/mock-vault/notes/note-alpha.md");
  expect(content).toContain('type: "todo"');
  expect(content).toContain("변환 직후 입력");
});
