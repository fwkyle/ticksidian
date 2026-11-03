/**
 * TICK-UX-013/014 — 즐겨찾기 고정 섹션과 우선순위 그룹 QA (2026-09-19).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/즐겨찾기와-우선순위-시각화.md
 *
 * 잠긴 목표
 * - 별표를 켜면 목록 맨 위 고정 섹션에 모이고, 아래 목록에서는 빠진다(중복 표시 없음).
 * - 저장은 frontmatter `favorite: true` 한 줄이고, 끄면 키가 사라진다.
 * - 접힘 상태가 저장돼 새로 열어도 유지된다.
 * - 할 일 목록과 투두바가 같은 우선순위 그룹 헤더를 쓰고, 깃발은 값이 있는 행에만 그린다.
 */

import { test, expect, type Page } from "@playwright/test";

const RECORD_PLAIN = "/mock-vault/notes/일반 기록.md";
const RECORD_STAR = "/mock-vault/notes/별표 기록.md";
const TODO_URGENT = "/mock-vault/notes/긴급 할일.md";
const TODO_MID = "/mock-vault/notes/중간 할일.md";
const TODO_NONE = "/mock-vault/notes/없음 할일.md";

function recordFile(title: string): string {
  return [
    "---",
    `id: "${title}"`,
    `title: "${title}"`,
    "---",
    "",
    `# ${title}`,
    "",
    "본문 한 줄.",
    "",
  ].join("\n");
}

function todoFile(title: string, priority?: string): string {
  return [
    "---",
    `id: "${title}"`,
    `title: "${title}"`,
    'type: "todo"',
    "done: false",
    ...(priority ? [`priority: "${priority}"`] : []),
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function seedVault(page: Page, files: Record<string, string>) {
  await page.waitForFunction(() => {
    return typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile
      === "function";
  });
  for (const [path, content] of Object.entries(files)) {
    await page.evaluate(async ({ path, content }) => {
      await (window as Window & { __qa_writeVaultFile: (p: string, c: string) => Promise<void> })
        .__qa_writeVaultFile(path, content);
    }, { path, content });
  }
  await page.reload();
  await waitForAppReady(page);
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return page.evaluate(async (target) => {
    return (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> })
      .__qa_readVaultFile(target);
  }, path);
}

const column = (page: Page) => page.locator("[data-note-column]");
const infoBar = (page: Page) => page.locator("[data-note-info-bar]");

async function openNote(page: Page, title: string) {
  const button = column(page).getByRole("button", { name: title, exact: true });
  await button.waitFor({ state: "visible", timeout: 10000 });
  await button.click();
  await expect(page.locator(".bn-editor")).toContainText(title, { timeout: 8000 });
  await page.waitForTimeout(500);
}

test("별표를 켜면 맨 위 고정 섹션에 모이고 아래 목록에서는 빠진다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, {
    [RECORD_PLAIN]: recordFile("일반 기록"),
    [RECORD_STAR]: recordFile("별표 기록"),
  });

  await openNote(page, "별표 기록");
  await infoBar(page).getByRole("button", { name: "즐겨찾기", exact: true }).click();

  const pinned = column(page).locator('[data-list-section="pinned"]');
  await expect(pinned).toBeVisible({ timeout: 8000 });
  await expect(pinned).toContainText("즐겨찾기");
  await expect(pinned.locator('[data-list-item="별표 기록"]')).toHaveCount(1);
  // 중복 표시 없음 — 고정된 항목은 아래 일반 목록에서 빠진다.
  await expect(column(page).locator('[data-list-section="rest"]')).not.toContainText("별표 기록");

  const saved = await readVaultFile(page, RECORD_STAR);
  expect(saved).toMatch(/^favorite: true$/m);
  expect(saved.match(/favorite/g)?.length).toBe(1);
  expect(saved).toContain("본문 한 줄.");
});

test("별표를 끄면 파일에서 키가 사라지고 고정 섹션도 없어진다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [RECORD_STAR]: recordFile("별표 기록") });

  await openNote(page, "별표 기록");
  await infoBar(page).getByRole("button", { name: "즐겨찾기", exact: true }).click();
  await expect(column(page).locator('[data-list-section="pinned"]')).toBeVisible({ timeout: 8000 });

  await infoBar(page).getByRole("button", { name: "즐겨찾기 해제", exact: true }).click();
  await expect(column(page).locator('[data-list-section="pinned"]')).toHaveCount(0, { timeout: 8000 });

  const saved = await readVaultFile(page, RECORD_STAR);
  expect(saved).not.toContain("favorite");
});

test("고정 섹션은 접을 수 있고 접힘 상태가 남는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, {
    [RECORD_PLAIN]: recordFile("일반 기록"),
    [RECORD_STAR]: recordFile("별표 기록"),
  });

  await openNote(page, "별표 기록");
  await infoBar(page).getByRole("button", { name: "즐겨찾기", exact: true }).click();
  await expect(column(page).locator('[data-list-section="pinned"]')).toBeVisible({ timeout: 8000 });

  const collapse = column(page).getByRole("button", { name: "즐겨찾기 접기" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();

  await expect(column(page).locator('[data-list-section="pinned"]')).toContainText("즐겨찾기");
  await expect(column(page).locator('[data-list-section="pinned"] [data-list-item="별표 기록"]')).toHaveCount(0);

  await page.reload();
  await waitForAppReady(page);
  await expect(column(page).locator('[data-list-section="pinned"]')).toBeVisible({ timeout: 8000 });
  await expect(column(page).locator('[data-list-section="pinned"] [data-list-item="별표 기록"]')).toHaveCount(0);
  await expect(column(page).getByRole("button", { name: "즐겨찾기 펼치기" }))
    .toHaveAttribute("aria-expanded", "false");
});

test("할 일 목록이 우선순위 그룹 헤더로 나뉘고 깃발은 값이 있는 행에만 그린다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, {
    [TODO_URGENT]: todoFile("긴급 할일", "긴급"),
    [TODO_MID]: todoFile("중간 할일", "중간"),
    [TODO_NONE]: todoFile("없음 할일"),
  });

  await column(page).getByRole("button", { name: /^할 일/ }).click();

  const keys = await column(page).locator("[data-list-section]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-list-section")));
  expect(keys).toEqual(["priority:긴급", "priority:중간", "priority:"]);

  const urgent = column(page).locator('[data-list-section="priority:긴급"]');
  await expect(urgent).toContainText("긴급 할일");
  await expect(urgent.locator('[data-priority-flag="긴급"]')).toHaveCount(1);
  await expect(column(page).locator('[data-list-section="priority:중간"]')).toContainText("중간 할일");
  await expect(column(page).locator('[data-list-section="priority:"]')).toContainText("없음 할일");
  // 값이 없는 행에는 빈 깃발도 그리지 않는다(소음 방지).
  await expect(column(page).locator('[data-list-section="priority:"] [data-priority-flag]')).toHaveCount(0);
});

test("정보 바 깃발이 값을 보여주고, 우선순위를 바꾸면 목록 그룹이 따라 바뀐다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, {
    [TODO_URGENT]: todoFile("긴급 할일", "긴급"),
    [TODO_MID]: todoFile("중간 할일", "중간"),
    [TODO_NONE]: todoFile("없음 할일"),
  });

  await column(page).getByRole("button", { name: /^할 일/ }).click();
  await openNote(page, "긴급 할일");

  await infoBar(page).getByRole("button", { name: /상세/ }).click();
  await expect(infoBar(page).locator('[data-priority-flag="긴급"]')).toHaveCount(1);

  await infoBar(page).getByLabel("우선순위 변경").selectOption("중간");
  // 정보 바 편집은 에디터 경유 저장 뒤 목록 재스캔으로 이어진다(그룹이 따라 바뀐다).
  await expect(column(page).locator('[data-list-section="priority:긴급"]')).toHaveCount(0, { timeout: 8000 });
  await expect(column(page).locator('[data-list-section="priority:중간"]')).toContainText("긴급 할일");

  const saved = await readVaultFile(page, TODO_URGENT);
  expect(saved).toContain('priority: "중간"');
});
