/**
 * 사이드바 3열 레이아웃 브라우저 QA (2026-08-18 [kyle] 요청)
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/사이드바-3열-레이아웃.md
 *
 * 확인 대상
 * 1. 폴더 열에서 폴더를 고르면 노트 열이 그 폴더 것만 보여준다(하위 폴더 포함).
 * 2. "전체"로 되돌리면 다시 전부 보인다.
 * 3. 아이콘 레일 버튼으로 투두/검토 큐가 열린다.
 * 4. 백링크 패널을 레일에서 켜고 끌 수 있다.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { state: "attached", timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

const folderColumn = (page: Page) => page.locator("[data-folder-column]");
const noteColumn = (page: Page) => page.locator("[data-note-column]");

test("폴더를 고르면 노트 열이 그 폴더 노트만 보여준다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 기본은 "전체" — fixture 노트가 모두 보인다
  await expect(noteColumn(page).getByRole("button", { name: "알파 노트", exact: true })).toBeVisible();
  await expect(noteColumn(page).getByRole("button", { name: "강의 노트", exact: true })).toBeVisible();

  // 폴더 열에서 lectures 선택
  await folderColumn(page).getByRole("button", { name: /lectures/ }).first().click();

  // 노트 열에는 lectures 것만 남는다
  await expect(noteColumn(page).getByRole("button", { name: "강의 노트", exact: true })).toBeVisible();
  await expect(noteColumn(page).getByRole("button", { name: "알파 노트", exact: true })).toHaveCount(0);

  // 헤더가 선택한 폴더 이름으로 바뀐다
  await expect(noteColumn(page).getByRole("heading", { name: "lectures" })).toBeVisible();

  // "전체"로 되돌리면 다시 전부 보인다
  await folderColumn(page).getByRole("button", { name: /전체/ }).first().click();
  await expect(noteColumn(page).getByRole("button", { name: "알파 노트", exact: true })).toBeVisible();
  await expect(noteColumn(page).getByRole("button", { name: "강의 노트", exact: true })).toBeVisible();
});

test("폴더 열은 폴더만, 노트 열은 노트만 담는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 폴더 열에는 노트 제목이 없어야 한다(537개가 쏟아지던 문제의 핵심)
  await expect(folderColumn(page).getByRole("button", { name: "알파 노트", exact: true })).toHaveCount(0);
  // 노트 열에는 노트가 있다
  await expect(noteColumn(page).getByRole("button", { name: "알파 노트", exact: true })).toBeVisible();
});

test("아이콘 레일 버튼으로 투두 필터와 검토 큐를 연다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const rail = page.locator("[data-app-rail]");
  await expect(rail).toBeVisible();

  // 2026-08-18: 투두 버튼은 별도 패널을 여는 대신 목록을 투두만으로 좁힌다
  const todoBtn = rail.getByRole("button", { name: "전체 할 일 보기" });
  await expect(todoBtn).toHaveAttribute("aria-pressed", "false");
  await todoBtn.click();
  await expect(todoBtn).toHaveAttribute("aria-pressed", "true");

  // 목록 열의 '투두' 필터도 함께 켜진다(같은 상태를 쓴다)
  // 종류 필터 그룹으로 좁힌다 — 상단 입력의 추가 버튼도 이름이 `할 일 추가`로 바뀌기 때문이다(2026-09-22).
  await expect(
    noteColumn(page)
      .getByRole("group", { name: "종류 필터" })
      .getByRole("button", { name: /^할 일/ }),
  ).toHaveAttribute("aria-pressed", "true");

  // 폴더를 골라도 할 일 종류를 유지하되, 전체 할 일 레일의 선택 표시는 해제한다.
  await page.locator('[data-folder-select="기본함"]').click();
  await expect(todoBtn).toHaveAttribute("aria-pressed", "false");

  // 검토 큐도 레일에서 열린다
  await rail.getByRole("button", { name: "AI 정리 열기/닫기" }).click();
  await page.getByRole("button", { name: "외부 가져오기·기존 검토" }).click();
  await expect(page.getByText("검토 큐", { exact: false }).first()).toBeVisible({ timeout: 10000 });
});

test("백링크 패널을 레일에서 켜고 끈다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForAppReady(page);

  // 노트를 열어야 백링크 패널이 나온다
  await noteColumn(page).getByRole("button", { name: "알파 노트", exact: true }).click();
  await page.waitForSelector(".bn-editor", { timeout: 15000 });

  const backlinkBtn = page.locator("[data-app-rail]").getByRole("button", { name: "백링크 패널 켜기/끄기" });
  await expect(backlinkBtn).toHaveAttribute("aria-pressed", "false");
  await backlinkBtn.click();
  await expect(backlinkBtn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-panel-resizer="backlink"]')).toBeVisible();

  // 끄기
  await backlinkBtn.click();
  await expect(backlinkBtn).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-panel-resizer="backlink"]')).toHaveCount(0);

  // 다시 켜기
  await backlinkBtn.click();
  await expect(page.locator('[data-panel-resizer="backlink"]')).toBeVisible();
});

test("1024px 미만 드로어는 닫힘-열림-노트 선택 후 닫힘 위치를 지킨다", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/");
  await waitForAppReady(page);

  const drawer = page.locator("[data-sidebar-drawer]");
  const drawerRight = async () => {
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    return (box?.x ?? 0) + (box?.width ?? 0);
  };

  await expect(page.getByRole("button", { name: "사이드바 열기" })).toBeVisible();
  await expect
    .poll(() => drawer.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe("none");
  expect(await drawerRight()).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "사이드바 열기" }).click();
  await expect.poll(drawerRight).toBeGreaterThanOrEqual(399);

  await noteColumn(page).getByRole("button", { name: "알파 노트", exact: true }).click();
  await expect.poll(drawerRight).toBeLessThanOrEqual(1);
});
