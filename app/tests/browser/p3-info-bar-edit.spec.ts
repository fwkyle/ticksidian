/**
 * TICK-UX-007 — 정보 바에서 태그·폴더 편집 (+ 노트 공통 태그 잠재 결함 수정).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/정보-바-태그-폴더-편집.md
 */

import { test, expect, type Page } from "@playwright/test";

const ALPHA_PATH = "/mock-vault/notes/note-alpha.md";
const TS_TAGGED_PATH = "/mock-vault/notes/ts-tagged.md";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

const column = (page: Page) => page.locator("[data-note-column]");
const infoBar = (page: Page) => page.locator("[data-note-info-bar]");

async function readVault(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (p) => {
    try {
      return await (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> })
        .__qa_readVaultFile(p);
    } catch {
      return null;
    }
  }, path);
}

async function openNote(page: Page, title: string) {
  await column(page).getByRole("button", { name: title, exact: true }).click();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.waitForTimeout(600);
}

test("틱시디언 생성 일반 노트의 태그는 본문을 편집해도 사라지지 않는다", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() =>
    typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile === "function");
  await page.evaluate(async (p) => {
    const doc = [
      "---",
      'id: "ts-tagged"',
      'title: "태그 달린 틱시디언 노트"',
      'tags: ["보존","검증"]',
      'createdAt: "2026-08-01T00:00:00.000Z"',
      'updatedAt: "2026-08-01T00:00:00.000Z"',
      'exportedAt: "2026-08-01T00:00:00.000Z"',
      'source: "ticksidian"',
      "---",
      "# 태그 달린 틱시디언 노트",
      "",
      "본문",
      "",
    ].join("\n");
    await (window as Window & { __qa_writeVaultFile: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile(p, doc);
  }, TS_TAGGED_PATH);
  await page.reload();
  await waitForAppReady(page);

  await openNote(page, "태그 달린 틱시디언 노트");
  await expect(infoBar(page)).toContainText("#보존");

  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("추가 편집", { delay: 10 });
  await page.waitForTimeout(1800); // 1초 디바운스 자동 저장

  const saved = await readVault(page, TS_TAGGED_PATH);
  expect(saved).toContain("추가 편집");
  expect(saved).toContain('tags: ["보존","검증"]');
});

test("정보 바에서 태그를 추가·삭제하면 파일과 화면에 반영된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openNote(page, "알파 노트");

  await infoBar(page).getByRole("button", { name: "태그 추가" }).click();
  const input = infoBar(page).getByLabel("새 태그");
  await input.fill("프로젝트, 회의");
  await input.press("Enter");

  await expect(infoBar(page)).toContainText("#프로젝트");
  await expect(infoBar(page)).toContainText("#회의");
  await expect.poll(() => readVault(page, ALPHA_PATH), { timeout: 8000 })
    .toContain('tags: ["프로젝트","회의"]');
  // 옵시디언 원본 최소 필드: 기존 id/aliases는 그대로
  expect(await readVault(page, ALPHA_PATH)).toContain('id: "note-alpha"');

  await infoBar(page).getByRole("button", { name: "#회의 태그 제거" }).click();
  await expect(infoBar(page)).not.toContainText("#회의");
  await expect.poll(() => readVault(page, ALPHA_PATH), { timeout: 8000 })
    .toContain('tags: ["프로젝트"]');

  await infoBar(page).getByRole("button", { name: "#프로젝트 태그 제거" }).click();
  await expect.poll(async () => (await readVault(page, ALPHA_PATH))?.includes("tags:"), { timeout: 8000 })
    .toBe(false);
});

test("태그 칩을 누르면 그 태그로 검색한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  // 세금계산서 발행은 투두라 기본(노트) 보기에 없다 — 투두 필터를 먼저 고른다.
  await page.locator("[data-note-column]").getByRole("button", { name: /^할 일/ }).click();
  await openNote(page, "세금계산서 발행");

  await infoBar(page).getByRole("button", { name: "#manual-review 태그로 검색" }).or(
    infoBar(page).getByRole("button", { name: "#ticktick-inbox 태그로 검색" }),
  ).first().click();
  const search = page.getByLabel("노트 검색");
  await expect(search).toHaveValue(/ticktick-inbox|manual-review/);
});

test("정보 바에서 폴더를 옮기면 파일이 이동하고 에디터는 새 경로로 이어진다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openNote(page, "알파 노트");

  // 이동 직전 미저장 변경을 남겨 flush 경로까지 함께 검증한다.
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("이동 전 입력", { delay: 10 });

  await infoBar(page).getByRole("button", { name: /상세/ }).click();
  const moveSelect = infoBar(page).getByLabel("폴더 이동");
  await expect(moveSelect).toHaveValue("notes");
  await moveSelect.selectOption("lectures");

  await expect.poll(() => readVault(page, "/mock-vault/lectures/note-alpha.md"), { timeout: 10000 })
    .toContain("이동 전 입력");
  expect(await readVault(page, ALPHA_PATH)).toBeNull();
  await expect(infoBar(page)).toContainText("lectures");

  // 이동 직후 타이핑은 새 경로에만 저장된다(옛 경로 부활 금지).
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("이동 후 입력", { delay: 10 });
  await page.waitForTimeout(1800);
  expect(await readVault(page, "/mock-vault/lectures/note-alpha.md")).toContain("이동 후 입력");
  expect(await readVault(page, ALPHA_PATH)).toBeNull();
});
