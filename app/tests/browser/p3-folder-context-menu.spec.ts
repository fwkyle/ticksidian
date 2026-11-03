/**
 * 폴더 우클릭 컨텍스트 메뉴 — 이름 변경/하위폴더 추가/삭제.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/폴더-컨텍스트-메뉴.md
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function listVaultFiles(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
}

function folderButton(page: Page, name: string) {
  return page.locator("[data-folder-column] button").filter({ hasText: name });
}

test("폴더 우클릭 메뉴에서 이름을 바꾼다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await folderButton(page, "lectures").click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  await page.getByRole("textbox", { name: "폴더 이름" }).fill("강의자료");
  await page.getByRole("button", { name: "이름 바꾸기", exact: true }).click();

  await expect(folderButton(page, "강의자료")).toBeVisible();
  const files = await listVaultFiles(page);
  expect(files).toContain("/mock-vault/강의자료/강의-노트.md");
  expect(files).not.toContain("/mock-vault/lectures/강의-노트.md");
});

test("폴더 우클릭 메뉴에서 하위폴더를 추가한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await folderButton(page, "기본함").click({ button: "right" });
  await page.getByRole("menuitem", { name: "하위폴더 추가" }).click();
  await page.getByRole("textbox", { name: "폴더 이름" }).fill("정리함");
  await page.getByRole("button", { name: "폴더 추가", exact: true }).click();

  // 하위 폴더는 기본 접힘 규칙이라 부모를 한 번 펼쳐서 확인한다.
  await page.getByRole("button", { name: "기본함 펴기" }).click();
  await expect(folderButton(page, "정리함")).toBeVisible();
});

test("폴더 삭제는 확인을 거치고 취소하면 파일이 남는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await page.evaluate(() => {
    return window.__qa_createVaultDirectory?.("/mock-vault/삭제후보");
  });
  await page.evaluate(() => {
    return window.__qa_writeVaultFile?.(
      "/mock-vault/삭제후보/메모.md",
      "# 삭제할 메모",
    );
  });
  await page.reload();
  await waitForAppReady(page);

  await folderButton(page, "삭제후보").click({ button: "right" });
  await page.getByRole("menuitem", { name: "폴더 삭제" }).click();
  await page.getByRole("button", { name: "취소" }).click();

  const files = await listVaultFiles(page);
  expect(files).toContain("/mock-vault/삭제후보/메모.md");
});

test("폴더 삭제를 확인하면 폴더와 파일이 목록에서 사라진다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await page.evaluate(() => {
    return window.__qa_createVaultDirectory?.("/mock-vault/삭제후보");
  });
  await page.evaluate(() => {
    return window.__qa_writeVaultFile?.(
      "/mock-vault/삭제후보/메모.md",
      "# 삭제할 메모",
    );
  });
  await page.reload();
  await waitForAppReady(page);

  await folderButton(page, "삭제후보").click({ button: "right" });
  await page.getByRole("menuitem", { name: "폴더 삭제" }).click();
  await page.getByRole("button", { name: "폴더 삭제", exact: true }).click();

  await expect(folderButton(page, "삭제후보")).toHaveCount(0);
  const files = await listVaultFiles(page);
  expect(files).not.toContain("/mock-vault/삭제후보/메모.md");
});
