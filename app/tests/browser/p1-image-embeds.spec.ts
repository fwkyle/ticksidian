/**
 * TICK-IMG-001 1-C — 이미지 임베드 round-trip 원본 불변 QA (RED 1순위).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/이미지-임베드-보기.md
 * 잠긴 목표: 이미지 임베드가 든 노트를 열고 편집·자동 저장해도 임베드 문법이 원본 그대로다.
 */

import { test, expect, type Page } from "@playwright/test";

const IMAGE_NOTE_PATH = "/mock-vault/notes/이미지-노트.md";
const IMAGE_NOTE_CONTENT = [
  "# 이미지 노트",
  "",
  "![[픽스처-이미지.png]]",
  "",
  "![](attachments/픽스처-이미지2.png)",
  "",
  "![[없는-이미지.png]]",
  "",
  "![[거대-이미지.png]]",
  "",
  "마지막 문단이다.",
  "",
].join("\n");

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function writeImageNote(page: Page) {
  // QA setup 모듈이 늦게 붙으면 옵셔널 콜이 조용히 no-op이 된다(실측 실패 원인).
  // 헬퍼 존재를 결정적으로 기다린 뒤 쓴다.
  await page.waitForFunction(() => {
    return typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile
      === "function";
  });
  await page.evaluate(async ({ path, content }) => {
    await (window as Window & { __qa_writeVaultFile: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile(path, content);
  }, { path: IMAGE_NOTE_PATH, content: IMAGE_NOTE_CONTENT });
  await page.reload();
  await waitForAppReady(page);
}

async function openImageNote(page: Page) {
  const editorText = await page.locator(".bn-editor").textContent().catch(() => "");
  if (!editorText?.includes("이미지 노트")) {
    const button = page
      .locator("[data-note-column]")
      .getByRole("button", { name: "이미지 노트", exact: true });
    await button.waitFor({ state: "visible", timeout: 10000 });
    await button.click();
  }
  await page.waitForSelector(".bn-editor", { timeout: 15000 });
  await expect(page.locator(".bn-editor")).toContainText("이미지 노트", { timeout: 8000 });
  await page.waitForTimeout(600);
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> })
      .__qa_readVaultFile?.(p);
  }, path)) ?? "";
}

test("이미지 임베드 round-trip: 편집 후 자동 저장돼도 원본 문법이 그대로다", async ({ page }) => {
  await page.goto("/");
  await writeImageNote(page);
  await openImageNote(page);

  // 마지막 문단에 커서를 두고 한 글자 타이핑(제목 불변).
  // BlockNote DOM: .bn-editor 요소 자체가 .ProseMirror다(하위가 아님).
  const lastParagraph = page.getByText("마지막 문단이다.");
  await lastParagraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 추가");

  // 자동 저장(1초 디바운스)이 파일까지 갔는지 결정적 대기.
  await expect
    .poll(() => readVaultFile(page, IMAGE_NOTE_PATH), { timeout: 15000 })
    .toContain("마지막 문단이다. 추가");

  const saved = await readVaultFile(page, IMAGE_NOTE_PATH);
  expect(saved).toContain("![[픽스처-이미지.png]]");
  expect(saved).toContain("![](attachments/픽스처-이미지2.png)");
  expect(saved).toContain("![[없는-이미지.png]]");
  expect(saved).toContain("![[거대-이미지.png]]");
  // BlockNote 기본 직렬화 오염(실측 1-2)이 파일에 새어 들어가면 안 된다.
  expect(saved).not.toContain("BlockNote image");
  expect(saved).not.toContain("blob:");
});

test("fixture PNG는 blob URL로 렌더된다", async ({ page }) => {
  await page.goto("/");
  await writeImageNote(page);
  await openImageNote(page);

  const blobImages = page.locator(".bn-editor img[src^='blob:']");
  await expect(blobImages.first()).toBeVisible({ timeout: 10000 });
  const count = await blobImages.count();
  expect(count).toBeGreaterThanOrEqual(2);
});

test("깨진 참조와 20MB 초과는 자리표시 이미지로 표시된다", async ({ page }) => {
  await page.goto("/");
  await writeImageNote(page);
  await openImageNote(page);

  const placeholders = page.locator(".bn-editor img[src^='data:image/svg+xml']");
  await expect(placeholders.first()).toBeVisible({ timeout: 10000 });
  expect(await placeholders.count()).toBeGreaterThanOrEqual(2);
  // 자리표시 안내에 사유와 대상이 담겼는지(alt 텍스트).
  const firstAlt = await placeholders.first().getAttribute("alt");
  expect(firstAlt).toBeTruthy();
});

test("이미지 임베드는 위키링크 미해결(정리 필요)에 섞이지 않는다", async ({ page }) => {
  await page.goto("/");
  // 미해결 노트 링크 1개 + 이미지 임베드 2개가 섞인 노트: 미해결은 링크 1개만 세야 한다.
  const content = [
    "# 이미지 노트",
    "",
    "[[아직 없는 노트]]",
    "",
    "![[픽스처-이미지.png]]",
    "",
    "![[없는-이미지.png]]",
    "",
  ].join("\n");
  await page.waitForFunction(() => {
    return typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile
      === "function";
  });
  await page.evaluate(async ({ path, content: body }) => {
    await (window as Window & { __qa_writeVaultFile: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile(path, body);
  }, { path: IMAGE_NOTE_PATH, content });
  await page.reload();
  await waitForAppReady(page);
  await openImageNote(page);

  // OutgoingLinksBar 요약: 미해결은 링크 1개뿐(이미지 임베드는 제외).
  await expect(page.getByText("연결 0 · 모호 0 · 미해결 1")).toBeVisible({ timeout: 8000 });
});

test("노트를 전환하면 이전 노트의 blob URL이 revoke 된다", async ({ page }) => {
  await page.goto("/");
  await writeImageNote(page);
  await openImageNote(page);

  const blobSrc = await page
    .locator(".bn-editor img[src^='blob:']")
    .first()
    .getAttribute("src");
  expect(blobSrc).toBeTruthy();

  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "알파 노트", exact: true })
    .click();
  await expect(page.locator(".bn-editor")).toContainText("알파 노트", { timeout: 8000 });
  await page.waitForTimeout(400);

  const revoked = await page.evaluate(async (url) => {
    try {
      await fetch(url);
      return false;
    } catch {
      return true;
    }
  }, blobSrc);
  expect(revoked).toBe(true);
});
