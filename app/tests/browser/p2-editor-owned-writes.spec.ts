/**
 * 2026-08-18 에디터 밖 중복 쓰기 정리 회귀.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/에디터-밖-쓰기-정리.md
 */

import { test, expect, type Page } from "@playwright/test";

const TODO_PATH = "/mock-vault/notes/todo-alpha.md";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function openTodo(page: Page) {
  await page.goto("/");
  await waitForAppReady(page);
  // 기본 보기가 노트(2026-08-29 "전체" 필터 제거)라 투두 필터를 먼저 고른다.
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: /^할 일/ })
    .click();
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "세금계산서 발행", exact: true })
    .click();
  await expect(page.locator("[data-note-info-bar]")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.isContentEditable,
        ),
      { timeout: 15000 },
    )
    .toBe(true);
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> })
      .__qa_readVaultFile?.(p);
  }, path)) ?? "";
}

async function expectNoExternalChangeBanner(page: Page) {
  await expect(page.getByText("파일이 외부에서 수정되었습니다")).toHaveCount(0);
  await expect(page.getByText("외부 수정이 감지되었습니다")).toHaveCount(0);
}

test("투두 제목 저장 직후 본문을 타이핑해도 자기 편집이 외부 수정으로 뜨지 않는다", async ({ page }) => {
  await openTodo(page);

  const nextTitle = "세금계산서 발행 확정";
  await page.keyboard.press("Meta+a");
  await page.keyboard.type(nextTitle, { delay: 20 });

  // 에디터 저장(1초 디바운스)이 새 제목을 파일에 쓴 시점을 확인한다.
  await expect
    .poll(() => readVaultFile(page, TODO_PATH), { timeout: 15000 })
    .toContain(nextTitle);

  // 저장 직후 미저장 본문을 만든다. 수정 전에는 updateTodoField("title")가
  // 에디터 밖에서 한 번 더 쓴 mtime을 폴러가 남의 수정으로 오해한다.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  // 미저장 상태가 3초 폴러를 지나가도록 디바운스(1초)가 끝나기 전에
  // 입력을 이어준다. 수정 전에는 에디터 밖 제목 중복 쓰기의 mtime이 이 구간에서
  // 외부 수정으로 판정돼야 한다.
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.type("계속", { delay: 20 });
    await page.waitForTimeout(700);
  }

  await page.waitForTimeout(4000);
  await expectNoExternalChangeBanner(page);

  const content = await readVaultFile(page, TODO_PATH);
  expect(content).toContain(nextTitle);
  expect(content).toContain("계속계속계속계속계속");
});

test("열려 있는 투두를 목록에서 토글한 뒤 타이핑해도 완료 상태가 유지된다", async ({ page }) => {
  await openTodo(page);

  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "세금계산서 발행 완료", exact: true })
    .click();

  // 토글 직후 3초 폴러보다 빠르게 본문을 편집한다. 수정 전에는 에디터 밖
  // done 쓰기 + 옛 todoMeta 자동 저장이 만나 완료가 해제될 수 있다.
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("토글 직후 입력", { delay: 20 });

  await page.waitForTimeout(4000);
  await expectNoExternalChangeBanner(page);

  const content = await readVaultFile(page, TODO_PATH);
  expect(content).toContain("done: true");
  expect(content).toContain("토글 직후 입력");
});
