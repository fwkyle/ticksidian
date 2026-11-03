/**
 * 2026-08-18 TICK-UX-008 검수 후속 P1 — 정보바 편집 원복 레이스 회귀.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 *
 * (a) 정보바에서 마감일을 고친 뒤 3초 폴러 재로드 전에 본문을 타이핑해도
 *     자동 저장이 새 마감일을 유지해야 한다(옛 todoMeta 스냅샷으로 되돌리지 않는다).
 * (b) 본문 타이핑 중(미저장 상태) 정보바를 고쳐도 자기 자신의 편집이
 *     "외부 수정 감지" 배너로 뜨지 않고, 둘 다 파일에 반영된다.
 *
 * 설계: docs/waterfall/03-상세설계/노트-정보-바.md §8
 */

import { test, expect, type Page } from "@playwright/test";

const TODO_PATH = "/mock-vault/notes/todo-alpha.md";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function openTodoWithDetails(page: Page) {
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
  const infoBar = page.locator("[data-note-info-bar]");
  await expect(infoBar).toBeVisible();
  await infoBar.getByRole("button", { name: /상세/ }).click();
  await expect(infoBar.locator("input[type='date']")).toBeVisible();
  return infoBar;
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> })
      .__qa_readVaultFile?.(p);
  }, path)) ?? "";
}

test("(a) 정보바 마감일 편집 직후 본문을 타이핑해도 마감일이 유지된다", async ({ page }) => {
  const infoBar = await openTodoWithDetails(page);

  // 마감일을 고친다(수정 전: updateTodoField가 에디터 밖에서 파일을 쓴다).
  await infoBar.locator("input[type='date']").fill("2026-08-20");
  // 폴러(3초)가 재로드하기 전에 바로 본문을 타이핑한다 — 레이스 창.
  await page.waitForTimeout(200);
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.press("End");
  // 제목(첫 헤딩) 뒤에 새 문단에서 타이핑한다 — 제목이 바뀌면 App의
  // handleTodoTitleChange → updateTodoField("title")이 에디터 밖에서 파일을 또
  // 썐서 mtime을 흔들고, 그게 폴러에 잡혀 (b)의 배너 검증이 흔들린다(실측).
  // 제목 불변으로 두면 정보바 커밋 저장 경로만 결정적으로 검증된다.
  await page.keyboard.press("Enter");
  await page.keyboard.type("레이스 테스트 입력");

  // 정보바 저장 + 본문 1초 디바운스 저장이 모두 끝나도록 대기.
  await page.waitForTimeout(2500);

  const content = await readVaultFile(page, TODO_PATH);
  // 본문 자동 저장은 저장돼야 한다.
  expect(content).toContain("레이스 테스트 입력");
  // 그리고 방금 고른 마감일이 옛 스냅샷 재조립으로 지워지지 않아야 한다.
  expect(content).toContain("dueDate");
  expect(content).toContain("2026-08-20");
});

test("(b) 미저장 본문이 있을 때 정보바를 고쳐도 외부 수정 배너가 뜨지 않는다", async ({ page }) => {
  const infoBar = await openTodoWithDetails(page);

  // 본문을 타이핑해 미저장 상태(hasLocalChanges)를 만든다.
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.press("End");
  // 제목 뒤 새 문단에 타이핑한다(제목 불변 — 위와 같은 이유).
  await page.keyboard.press("Enter");
  await page.keyboard.type("동시 편집 입력 ");

  // 그 사이 정보바 마감일을 고친다(수정 전: 에디터 밖 파일 쓰기 → mtime 변화).
  await infoBar.locator("input[type='date']").fill("2026-08-21");

  // 폴러(3초)가 최소 1회 돌 때까지 미저장 타이핑을 이어간다 — 수정 전에는
  // hasLocalChanges + mtime 변화가 만나 자기 편집이 배너로 떴다.
  for (let i = 0; i < 4; i += 1) {
    // date input 조작 후 포커스가 input에 남으므로 매번 에디터로 되돌아간다.
    // 클릭 지점이 제목(첫 헤딩)일 수 있으니 Meta+End(macOS 문서 끝)로 마지막
    // 문단 끝에 커서를 고정한다 — 제목이 오염되지 않게.
    await editor.click();
    await page.keyboard.press("Meta+End");
    await page.waitForTimeout(800);
    await page.keyboard.type("계속");
  }

  // 마지막 타이핑의 디바운스 저장까지 여유를 둔다.
  await page.waitForTimeout(1800);

  // 자기 자신의 정보바 편집이 외부 수정 배너를 띄우면 안 된다.
  // 배너(ExternalChangeConflictBanner)와 상태 안내(EditorMetaBar notice) 둘 다 잡는다.
  await expect(page.getByText("파일이 외부에서 수정되었습니다")).toHaveCount(0);
  await expect(page.getByText("외부 수정이 감지되었습니다")).toHaveCount(0);

  // 마감일과 본문이 모두 파일에 반영돼야 한다.
  const content = await readVaultFile(page, TODO_PATH);
  expect(content).toContain("dueDate");
  expect(content).toContain("2026-08-21");
  expect(content).toContain("동시 편집 입력");
  expect(content).toContain("계속계속계속계속");
});
