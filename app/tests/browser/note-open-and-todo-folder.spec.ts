/**
 * 2026-08-18 [kyle] 실사용 보고 2건 회귀 방지.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 *
 * 1. "노트든 투두든 클릭하면 맨위로 올라감 → '수정'처리 되는듯?? … 투두는 아니다. 노트만 그럼"
 *    노트를 열면 에디터가 본문에서 제목을 뽑아 항상 한 번 알려주는데, 제목이 같아도
 *    `updatedAt`을 지금 시각으로 덮어써서 수정일 정렬 맨 위로 튀었다. 투두 경로는
 *    제목 비교를 하고 있어 멀쩡했다 — [kyle]의 구분이 정확했다.
 *
 * 2. "투두가 만들어지면 어떤 기본폴더에 귀속돼?? 폴더별로 투두도 나눌 수가 있나?"
 *    투두도 `.md` 파일이라 폴더 규칙이 노트와 같지만, 만들 진입점이 없었다.
 *    이제 종류 필터가 `투두`일 때 `+`가 **보고 있는 폴더에** 새 투두를 만든다.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

const column = (page: Page) => page.locator("[data-note-column]");
const itemOrder = (page: Page) =>
  column(page).locator("[data-list-item]:visible").evaluateAll(
    (nodes) => nodes.map((n) => n.getAttribute("data-list-item") ?? ""),
  );

test("노트를 열어도 수정일 정렬 순서가 바뀌지 않는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await column(page).getByRole("button", { name: /^기록$/ }).click();
  const before = await itemOrder(page);
  expect(before.length).toBeGreaterThan(2);

  // 맨 위가 아닌 노트를 연다. 예전에는 이 클릭만으로 목록 맨 위로 튀었다.
  const target = before[before.length - 1];
  await column(page).getByRole("button", { name: target, exact: true }).click();
  await page.waitForTimeout(600); // 로드 + onTitleChange 반영 대기

  expect(await itemOrder(page)).toEqual(before);
});

// 2026-09-22 계약 변경: 할 일 필터에서 Cmd+N은 기록이 아니라 빈 할 일을 만든다.
test("할 일 필터의 Cmd+N 은 보고 있는 폴더에 빈 할 일을 만든다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // notes 폴더를 고른 뒤 투두만 보기로 전환한다.
  await page.locator("[data-folder-column]").getByRole("button", { name: /^notes/ }).first().click();
  await column(page).getByRole("button", { name: /^할 일/ }).click();

  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);

  await page.keyboard.press("Control+n");
  await expect(column(page).locator("[data-list-item='새 노트']")).toBeVisible();

  // 실제로 그 폴더 안의 파일로 만들어졌는지 확인한다(파일명은 노트 id라 경로로 본다).
  const after = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  const created = after.filter((path) => !before.includes(path));
  expect(created.length).toBe(1);
  expect(created[0]).toContain("/notes/");

  const content = await page.evaluate(
    (path) => window.__qa_readVaultFile?.(path) ?? "",
    created[0],
  );
  expect(content).toContain('type: "todo"');
});
