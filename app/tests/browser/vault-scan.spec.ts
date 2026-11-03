/**
 * 볼트 전체 스캔 브라우저 QA (2026-08-16 [kyle] 결정)
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/볼트-전체-스캔.md
 *
 * 배경: 이전에는 `{볼트}/notes/` 아래만 읽어서, 옵시디언 볼트를 열면 `notes/` 밖 문서가
 * 하나도 안 보였다(실사용 볼트 537개 중 186개만 스캔). 뿌리를 볼트 폴더 자체로 바꿨다.
 *
 * 확인 대상
 * 1. `notes/` 밖 폴더(lectures)의 노트가 목록에 뜬다.
 * 2. frontmatter 없는 순수 마크다운(옵시디언 원본 형태)도 제목이 잡힌다.
 * 3. `notes/`도 그냥 하위 폴더로 함께 보인다(기존 노트 유실 없음).
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

test("notes/ 밖 폴더의 노트도 목록에 나온다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // lectures/ 폴더의 노트 — 이전 구조에서는 절대 안 보이던 파일
  await expect(page.getByRole("button", { name: /강의 노트/ }).first()).toBeVisible({
    timeout: 10000,
  });

  // notes/ 안 노트도 그대로 보인다(회귀 없음)
  await expect(page.getByRole("button", { name: /알파 노트/ }).first()).toBeVisible();
});

test("frontmatter 없는 마크다운도 제목을 잡아 목록에 나온다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // inbox/맨몸-메모.md — 본문 첫 헤딩(# 맨몸 메모)이 제목이 되어야 한다
  const item = page.getByRole("button", { name: /맨몸 메모/ }).first();
  await expect(item).toBeVisible({ timeout: 10000 });

  await item.click();
  await page.waitForSelector(".bn-editor", { timeout: 15000 });
  await expect(page.locator(".bn-editor")).toContainText("frontmatter 없는 옵시디언 노트입니다", {
    timeout: 8000,
  });
});

test("검색으로 notes/ 밖 노트를 찾아 열 수 있다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await page.getByRole("button", { name: "검색 열기", exact: true }).click();
  const searchInput = page.getByLabel("노트 검색");
  await searchInput.click();
  await searchInput.fill("강의");

  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
  const hit = page.getByRole("option", { name: /강의 노트/ });
  await expect(hit).toBeVisible({ timeout: 5000 });
  await hit.click();

  await expect(page.locator(".bn-editor")).toContainText("notes 폴더 밖(lectures)에 있는 문서입니다", {
    timeout: 10000,
  });
});

test("한계를 넘는 큰 노트는 열지 않고 안내하며, 원본을 덮어쓰지 않는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const hugePath = "/mock-vault/inbox/거대-덤프.md";
  const before = await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (x: string) => Promise<string> })
      .__qa_readVaultFile?.(p);
  }, hugePath);
  expect((before ?? "").length).toBeGreaterThan(500_000);

  // 큰 노트를 연다 → 파싱 없이 안내만 떠야 한다(프리징 없이 응답)
  await page.getByRole("button", { name: /거대 덤프/ }).first().click();
  await expect(page.getByText(/너무 커서/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/그대로 있고 아무것도 바뀌지 않았습니다/)).toBeVisible();

  // 다른 노트로 전환 → 언마운트 flush 경로를 통과시킨다(여기서 빈 내용이 저장되면 원본 파괴)
  await page.getByRole("button", { name: /알파 노트/ }).first().click();
  await page.waitForSelector(".bn-editor", { timeout: 15000 });
  await page.waitForTimeout(2000);

  const after = await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (x: string) => Promise<string> })
      .__qa_readVaultFile?.(p);
  }, hugePath);
  expect(after).toBe(before);
});

// DEF-CONTRACT-001 — 이름 중간의 `.md`를 자르지 않아 실제 파일이 읽힌다.
for (const [fileName, title, marker] of [
  ["CLAUDE.md 정리.md", "중간 확장자 제목", "중간 md 본문 마커"],
  ["a.mdx.md", "mdx 이름 제목", "mdx 본문 마커"],
] as const) {
  test(`${fileName}은 실제 파일 경로로 읽혀 열린다`, async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    await page.waitForFunction(() => {
      return typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile === "function";
    });
    await page.evaluate(async ({ path, content }) => {
      await (window as Window & { __qa_writeVaultFile?: (p: string, c: string) => Promise<void> })
        .__qa_writeVaultFile?.(path, content);
    }, { path: `/mock-vault/notes/${fileName}`, content: `# ${title}\n\n${marker}\n` });
    await page.reload();
    await waitForAppReady(page);

    const item = page.locator("[data-note-column]").getByRole("button", { name: title, exact: true });
    await expect(item).toBeVisible({ timeout: 10000 });
    await item.click();
    await expect(page.locator(".bn-editor")).toContainText(marker, { timeout: 10000 });
  });
}
