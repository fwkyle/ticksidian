/**
 * 2026-08-18 파일명-제목 동기화 회귀 ([kyle] 결정 — 1·2단계 한방).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/파일명-제목-동기화.md
 *
 * rename은 "노트를 벗어나는 순간(switch-away)"에 실행된다. 각 시나리오는
 * 제목 입력 → 자동 저장 대기 → 다른 노트 선택 → 파일명 확인 순서다.
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

/** 새 노트를 만들고 생성된 파일 경로(UUID)를 돌려준다. */
async function createNoteAndGetPath(page: Page): Promise<string> {
  const before = await listVaultFiles(page);
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(1200); // 에디터 초기 로드 + 포커스
  const after = await listVaultFiles(page);
  const created = after.filter((p) => !before.includes(p));
  expect(created).toHaveLength(1);
  return created[0];
}

/**
 * 제목 영역을 선택해 새 제목을 타이핑한 뒤, **파일에 저장된 것을 확인**할 때까지
 * 기다린다. 고정 대기는 병렬 실행 부하에서 저장 완료 전에 전환해 dirty 가드에 걸린다.
 */
async function replaceEditorWithTitle(page: Page, title: string, filePath: string) {
  // 에디터 로드가 느리면 포커스 전에 타이핑이 허공에 나간다(전체 실행 부하에서 실측).
  // P0 규칙(초기 로드 완료 시 편집 DOM 포커스)이 자리잡을 때까지 기다린다.
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
  // 전체 선택은 현재 커서 영역만 대상으로 하므로 제목을 명시적으로 클릭한다.
  await page.locator(".bn-editor h1").first().click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type(title, { delay: 20 });
  await expect
    .poll(
      () => page.evaluate((p) => window.__qa_readVaultFile?.(p) ?? "", filePath),
      { timeout: 15000 },
    )
    .toContain(title);
  await page.waitForTimeout(400); // 저장 완료 → dirty=false 전파 여유
}

/** 다른 노트를 선택해 switch-away를 일으키고 rename+재스캔이 자리잡을 시간을 준다. */
async function switchAwayTo(page: Page, noteName: string) {
  await page.locator('[data-folder-select="전체"]').click();
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: noteName, exact: true })
    .click();
  await page.waitForTimeout(1200);
}

/** rename 결과 파일이 나타날 때까지 폴링한다. */
async function expectVaultFile(page: Page, path: string) {
  await expect
    .poll(() => listVaultFiles(page), { timeout: 15000 })
    .toContain(path);
}

test("1단계: 새 노트 제목이 확정되면 벗어날 때 파일명이 제목으로 바뀐다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const uuidPath = await createNoteAndGetPath(page);
  await replaceEditorWithTitle(page, "동기화 테스트 제목", uuidPath);
  await switchAwayTo(page, "알파 노트");

  await expectVaultFile(page, "/mock-vault/inbox/동기화 테스트 제목.md");
  const files = await listVaultFiles(page);
  expect(files).not.toContain(uuidPath);

  const content = await page.evaluate(
    () => window.__qa_readVaultFile?.("/mock-vault/inbox/동기화 테스트 제목.md") ?? "",
  );
  expect(content).toContain("동기화 테스트 제목");

  // 목록에서도 새 제목으로 다시 열 수 있다(재스캔 후 id 전환 확인).
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "동기화 테스트 제목", exact: true })
    .click();
  await expect(page.locator("[data-note-info-bar]")).toBeVisible();
});

test("1단계 충돌: 같은 제목이면 '제목 1'로 비켜난다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const firstPath = await createNoteAndGetPath(page);
  await replaceEditorWithTitle(page, "중복 제목", firstPath);
  await switchAwayTo(page, "알파 노트");
  await expectVaultFile(page, "/mock-vault/inbox/중복 제목.md");

  const secondPath = await createNoteAndGetPath(page);
  await replaceEditorWithTitle(page, "중복 제목", secondPath);
  await switchAwayTo(page, "알파 노트");
  await expectVaultFile(page, "/mock-vault/inbox/중복 제목 1.md");
});

test("제목을 넣지 않은 새 노트는 UUID 파일명이 유지된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const uuidPath = await createNoteAndGetPath(page);
  await switchAwayTo(page, "알파 노트");

  const files = await listVaultFiles(page);
  expect(files).toContain(uuidPath);
});

test("2단계: 기존 노트의 제목을 바꾸면 벗어날 때 파일명이 따라간다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 옵시디언식 파일명(비 UUID)의 기존 노트를 연다.
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "맨몸 메모", exact: true })
    .click();
  await page.waitForTimeout(1200);

  await replaceEditorWithTitle(page, "홈트 메모", "/mock-vault/inbox/맨몸-메모.md");
  await switchAwayTo(page, "알파 노트");

  await expectVaultFile(page, "/mock-vault/inbox/홈트 메모.md");
  const files = await listVaultFiles(page);
  expect(files).not.toContain("/mock-vault/inbox/맨몸-메모.md");
});

test("제목을 바꾸지 않고 열었다 닫은 기존 노트는 파일명이 그대로다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "맨몸 메모", exact: true })
    .click();
  await page.waitForTimeout(1200);
  await switchAwayTo(page, "알파 노트");

  const files = await listVaultFiles(page);
  expect(files).toContain("/mock-vault/inbox/맨몸-메모.md");
});
