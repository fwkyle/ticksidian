/**
 * 노트 정보 바 브라우저 QA (2026-08-18 [kyle] 요청).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/노트-정보-바.md
 *
 * [kyle] 지적: "태그처럼 보이던게 난 '폴더명'인줄 알았네", "본문에 이 노트의 정보같은거
 * 볼 수 있으면 좋겠다", "이게 태그라는걸 노트에서는 알수가없네?"
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

const column = (page: Page) => page.locator("[data-note-column]");
const infoBar = (page: Page) => page.locator("[data-note-info-bar]");

test("노트를 열면 종류와 폴더가 본문 위에 보인다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await column(page).getByRole("button", { name: /^기록$/ }).click();
  await column(page).locator("[data-list-item='강의 노트']").getByRole("button").first().click();

  await expect(infoBar(page)).toBeVisible();
  await expect(infoBar(page).getByRole('button', { name: '할 일로 표시', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(infoBar(page).getByText(/lectures/)).toBeVisible();
});

test("투두를 열면 투두 배지와 # 붙은 태그가 보인다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await column(page).getByRole("button", { name: /^할 일/ }).click();
  await column(page).locator("[data-list-item='세금계산서 발행']").getByRole("button").nth(1).click();

  await expect(infoBar(page).getByRole('button', { name: '할 일 표시 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // 핵심: 태그에 # 이 붙어 폴더명과 구분된다
  await expect(infoBar(page).getByText("#ticktick-import")).toBeVisible();
  await expect(infoBar(page).getByText("#ticktick-inbox")).toBeVisible();
});

test("상세는 기본 접힘이고 누르면 파일 경로까지 펼쳐진다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await column(page).getByRole("button", { name: /^기록$/ }).click();
  await column(page).locator("[data-list-item='강의 노트']").getByRole("button").first().click();

  const toggle = infoBar(page).getByRole("button", { name: /상세/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(infoBar(page).getByText("파일", { exact: true })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(infoBar(page).getByText("파일", { exact: true })).toBeVisible();
  await expect(infoBar(page).getByText(/강의-노트\.md/)).toBeVisible();
  await expect(infoBar(page).getByText("별칭", { exact: true })).toBeVisible();
});

test("정보 바의 폴더를 누르면 목록 열이 그 폴더로 바뀐다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await column(page).getByRole("button", { name: /^기록$/ }).click();
  await column(page).locator("[data-list-item='강의 노트']").getByRole("button").first().click();

  await infoBar(page).getByRole("button", { name: /lectures/ }).click();

  // 목록 열 제목이 그 폴더로 바뀌고, 편집 중인 노트는 그대로 열려 있다
  await expect(column(page).getByRole("heading", { name: /lectures/ })).toBeVisible();
  await expect(infoBar(page)).toBeVisible();
});


test("전체 경로를 태그 왼쪽 버튼으로 복사하고 실패를 알린다", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { sessionStorage.setItem("copied-path", text); },
    } });
  });
  await page.goto("/");
  await waitForAppReady(page);
  await column(page).locator("[data-list-item='강의 노트']").getByRole("button").first().click();
  const bar = infoBar(page);
  const copy = bar.getByRole("button", { name: "경로복사", exact: true });
  const path = "/mock-vault/lectures/강의-노트.md";
  await expect(copy).toBeVisible();
  await expect(copy).toHaveAttribute("title", path);
  expect(await copy.evaluate((button) => button.nextElementSibling?.getAttribute("aria-label"))).toBe("태그 추가");
  await copy.click();
  expect(await page.evaluate(() => sessionStorage.getItem("copied-path"))).toBe(path);
  await expect(bar.getByRole("status")).toHaveText("경로를 복사했습니다");
  await bar.getByRole("button", { name: /상세/ }).click();
  await expect(bar.locator("dd").filter({ hasText: path })).toHaveText(path);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: {
      writeText: async () => { throw new Error("denied"); },
    } });
  });
  await copy.click();
  await expect(bar.getByRole("status")).toContainText("경로를 복사하지 못했습니다");
});
