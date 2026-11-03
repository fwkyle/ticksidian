/**
 * TICK-IMG-002 2-B — 이미지 붙여넣기(노트 소속 저장 + 임베드 삽입) QA.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/이미지-넣기-노션-체감형.md 2-B
 */

import { test, expect, type Page } from "@playwright/test";

const IMAGE_NOTE_PATH = "/mock-vault/notes/이미지-노트.md";
const IMAGE_NOTE_CONTENT = "# 이미지 노트\n\n본문이다.\n";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function setupImageNote(page: Page) {
  await page.goto("/");
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

async function pasteImage(page: Page, name: string) {
  await page.evaluate((fileName) => {
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
      0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 16, 16, 0,
      0, 4, 241, 1, 160, 137, 202, 111, 191, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);
    const file = new File([bytes], fileName, { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const target = document.querySelector(".bn-editor");
    if (!target) throw new Error("editor dom not found");
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, name);
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> })
      .__qa_readVaultFile?.(p);
  }, path)) ?? "";
}

test("이미지 붙여넣기: 노트 소속 경로에 저장되고 옵시디언 문법으로 파일에 남는다", async ({ page }) => {
  await setupImageNote(page);
  await openImageNote(page);

  await pasteImage(page, "스크린샷.png");

  // image 블록이 blob URL로 등장한다.
  const image = page.locator(".bn-editor img[src^='blob:']");
  await expect(image.first()).toBeVisible({ timeout: 10000 });

  // 자동 저장 후 파일에는 경로 포함 옵시디언 임베드가 남는다.
  await expect
    .poll(() => readVaultFile(page, IMAGE_NOTE_PATH), { timeout: 15000 })
    .toContain("![[attachments/이미지 노트/이미지 노트.png]]");
  const saved = await readVaultFile(page, IMAGE_NOTE_PATH);
  expect(saved).not.toContain("blob:");
  expect(saved).not.toContain("BlockNote image");
});

test("두 번째 붙여넣기는 충돌 접미로 노트 소속 폴더에 쌓인다", async ({ page }) => {
  await setupImageNote(page);
  await openImageNote(page);

  await pasteImage(page, "첫장.png");
  await expect(page.locator(".bn-editor img[src^='blob:']").first()).toBeVisible({ timeout: 10000 });
  await expect
    .poll(() => readVaultFile(page, IMAGE_NOTE_PATH), { timeout: 15000 })
    .toContain("![[attachments/이미지 노트/이미지 노트.png]]");

  await pasteImage(page, "둘째장.png");
  await expect
    .poll(() => readVaultFile(page, IMAGE_NOTE_PATH), { timeout: 15000 })
    .toContain("![[attachments/이미지 노트/이미지 노트 1.png]]");
});

test("붙여넣은 이미지는 새로고침 후에도 다시 렌더된다(저장 파일 경유)", async ({ page }) => {
  await setupImageNote(page);
  await openImageNote(page);
  await pasteImage(page, "리로드.png");
  await expect(page.locator(".bn-editor img[src^='blob:']").first()).toBeVisible({ timeout: 10000 });
  await expect
    .poll(() => readVaultFile(page, IMAGE_NOTE_PATH), { timeout: 15000 })
    .toContain("![[attachments/이미지 노트/이미지 노트.png]]");

  await page.reload();
  await waitForAppReady(page);
  await openImageNote(page);
  await expect(page.locator(".bn-editor img[src^='blob:']").first()).toBeVisible({ timeout: 10000 });
});
