/**
 * 패널 너비 조정 브라우저 QA (2026-08-16 [kyle] 요청)
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/패널-너비-조정.md
 *
 * 확인 대상
 * 1. 마우스 드래그로 사이드바가 넓어지고, 새로고침 후에도 그 폭이 유지된다.
 * 2. 키보드(화살표/Home)로도 조절된다 — 접근성 기준선.
 * 3. 폭 한계를 넘겨 끌어도 최대 560px에서 멈춘다.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(500);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

/**
 * 노트 열의 실제 픽셀 폭.
 * 2026-08-18 3열 레이아웃 이후 사이드바가 폴더 열(aside)과 노트 열(section)로 나뉘었다.
 */
async function noteColumnWidth(page: Page): Promise<number> {
  const box = await page.locator("[data-note-column]").boundingBox();
  return box?.width ?? 0;
}

/** 폴더 열의 실제 픽셀 폭. */
async function folderColumnWidth(page: Page): Promise<number> {
  const box = await page.locator("[data-folder-column]").boundingBox();
  return box?.width ?? 0;
}

test("드래그: 노트 열을 넓히면 폭이 커지고 새로고침 후에도 유지된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const before = await noteColumnWidth(page);
  expect(before).toBe(319);

  const handle = page.locator('[data-panel-resizer="notes"]');
  await expect(handle).toBeVisible();

  const box = await handle.boundingBox();
  if (!box) throw new Error("리사이저 위치를 찾지 못했다");

  // 손잡이를 오른쪽으로 100px 끈다
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await noteColumnWidth(page);
  expect(after).toBeGreaterThan(before + 80);

  // 새로고침 후에도 유지되는지 (localStorage 저장 확인)
  await page.reload();
  await waitForAppReady(page);
  const afterReload = await noteColumnWidth(page);
  expect(Math.abs(afterReload - after)).toBeLessThan(4);
});

test("키보드: 화살표와 Home으로도 노트 열 폭을 조절한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const handle = page.locator('[data-panel-resizer="notes"]');
  await handle.focus();
  await expect(handle).toBeFocused();

  const before = await noteColumnWidth(page);

  // 오른쪽 화살표 = 16px씩 넓어짐
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const afterArrows = await noteColumnWidth(page);
  expect(afterArrows).toBeGreaterThan(before);

  // Home = 최소 폭(160px)
  await page.keyboard.press("Home");
  const afterHome = await noteColumnWidth(page);
  expect(afterHome).toBeLessThan(180);
  expect(afterHome).toBeGreaterThan(150);

  // 접근성 속성이 실제 폭을 따라간다
  await expect(handle).toHaveAttribute("aria-valuenow", /1[0-9][0-9]/);
  await expect(handle).toHaveAttribute("role", "separator");
});

test("한계: 아주 멀리 끌어도 최대 폭에서 멈춘다", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await waitForAppReady(page);

  const handle = page.locator('[data-panel-resizer="notes"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error("리사이저 위치를 찾지 못했다");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1500, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await noteColumnWidth(page);
  expect(after).toBeLessThanOrEqual(561); // PANEL_MAX_WIDTH = 560
  expect(after).toBeGreaterThan(500);
});

test("오른쪽 패널: 백링크 폭도 드래그로 조절된다(방향 반대)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForAppReady(page);
  await page.getByRole("button", { name: "백링크 패널 켜기/끄기", exact: true }).click();

  // 백링크 패널은 노트를 열어야 나온다
  await page.getByRole("button", { name: /알파 노트/ }).first().click();
  await page.waitForSelector(".bn-editor", { timeout: 15000 });

  const handle = page.locator('[data-panel-resizer="backlink"]');
  await expect(handle).toBeVisible({ timeout: 10000 });

  const panel = page.locator("text=백링크").first();
  await expect(panel).toBeVisible();

  const before = await handle.getAttribute("aria-valuenow");
  const box = await handle.boundingBox();
  if (!box) throw new Error("백링크 리사이저 위치를 찾지 못했다");

  // 오른쪽 패널은 왼쪽으로 끌어야 넓어진다
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await handle.getAttribute("aria-valuenow");
  expect(Number(after)).toBeGreaterThan(Number(before) + 60);
});


test("폴더 열도 따로 폭을 조절한다 (2026-08-18 3열 레이아웃)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await waitForAppReady(page);

  const before = await folderColumnWidth(page);
  expect(before).toBeGreaterThan(180);
  expect(before).toBeLessThan(230); // 기본 200px

  const handle = page.locator('[data-panel-resizer="folder"]');
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error("폴더 리사이저 위치를 찾지 못했다");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await folderColumnWidth(page);
  expect(after).toBeGreaterThan(before + 70);

  // 노트 열은 영향받지 않는다(각자 폭을 갖는다)
  const notes = await noteColumnWidth(page);
  expect(notes).toBe(319);
});

// 2026-08-18: 투두 전용 열이 사라지고 목록 열의 '투두' 필터로 대체됐다
// (설계: docs/waterfall/03-상세설계/노트-투두-통합-목록.md).
// 투두 폭 조절 테스트는 대상이 없어져 제거했다. 필터 동작은 sidebar-columns.spec.ts가 본다.
