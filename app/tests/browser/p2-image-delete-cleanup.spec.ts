/**
 * TICK-IMG-002 2-D — 노트 삭제 시 전용 이미지 동반 정리 QA.
 *
 * 분류: 브라우저 fixture QA
 * 설계: docs/waterfall/03-상세설계/이미지-넣기-노션-체감형.md 2-D
 * fail-closed: 다른 노트가 쓰는 이미지는 남고, 이 노트만 쓰는 이미지만 정리된다.
 */

import { test, expect, type Page } from "@playwright/test";

const VAULT = "/mock-vault";
const TARGET_NOTE_PATH = `${VAULT}/notes/삭제 대상.md`;
const OTHER_NOTE_PATH = `${VAULT}/notes/남는 노트.md`;

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function setupNotes(page: Page, targetContent: string, otherContent: string) {
  await page.goto("/");
  await page.waitForFunction(() => {
    return typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile
      === "function";
  });
  await page.evaluate(async (files) => {
    const helper = (window as Window & { __qa_writeVaultFile: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile;
    await helper(files[0], files[1]);
    await helper(files[2], files[3]);
  }, [TARGET_NOTE_PATH, targetContent, OTHER_NOTE_PATH, otherContent]);
  // 참조할 이미지 파일을 fixture에 심는다(임베드 resolve가 파일을 찾아야 대상이 된다).
  await page.evaluate(async (paths) => {
    const helper = (window as Window & { __qa_writeVaultBinary: (p: string, b: Uint8Array) => Promise<void> })
      .__qa_writeVaultBinary;
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    for (const path of paths) await helper(path, bytes);
  }, [`${VAULT}/attachments/전용 이미지.png`, `${VAULT}/attachments/공유 이미지.png`]);
  await page.reload();
  await waitForAppReady(page);
}

async function openNote(page: Page, title: string) {
  const button = page
    .locator("[data-note-column]")
    .getByRole("button", { name: title, exact: true });
  await button.waitFor({ state: "visible", timeout: 10000 });
  await button.click();
  await page.waitForSelector(".bn-editor", { timeout: 15000 });
}

async function requestDelete(page: Page, title: string) {
  const deleteButton = page
    .locator("[data-note-column]")
    .getByRole("button", { name: `${title} 삭제`, exact: true });
  await deleteButton.waitFor({ state: "visible", timeout: 10000 });
  await deleteButton.click();
}

async function binaryExists(page: Page, path: string): Promise<boolean> {
  return page.evaluate(async (target) => {
    try {
      const adapter = (window as unknown as {
        __qa_readVaultBinary?: (p: string) => Promise<Uint8Array>;
      }).__qa_readVaultBinary;
      if (!adapter) return false;
      await adapter(target);
      return true;
    } catch {
      return false;
    }
  }, path);
}

async function noteExists(page: Page, path: string): Promise<boolean> {
  try {
    await page.evaluate(async (target) => {
      await (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> })
        .__qa_readVaultFile(target);
    }, path);
    return true;
  } catch {
    return false;
  }
}

test("전용 이미지만 함께 정리되고 공유 이미지는 남는다", async ({ page }) => {
  await setupNotes(
    page,
    "# 삭제 대상\n\n![[전용 이미지.png]]\n\n![[공유 이미지.png]]\n",
    "# 남는 노트\n\n![[공유 이미지.png]]\n",
  );
  await openNote(page, "삭제 대상");
  await requestDelete(page, "삭제 대상");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog).toContainText("이미지 1개를 함께 정리합니다");
  await dialog.getByRole("button", { name: "삭제" }).click();

  await expect
    .poll(() => noteExists(page, TARGET_NOTE_PATH), { timeout: 10000 })
    .toBe(false);
  await expect
    .poll(() => binaryExists(page, `${VAULT}/attachments/전용 이미지.png`), { timeout: 10000 })
    .toBe(false);
  // 공유 이미지와 다른 노트는 남는다.
  expect(await binaryExists(page, `${VAULT}/attachments/공유 이미지.png`)).toBe(true);
  expect(await noteExists(page, OTHER_NOTE_PATH)).toBe(true);
});

test("체크박스를 끄면 이미지를 남긴다", async ({ page }) => {
  await setupNotes(
    page,
    "# 삭제 대상\n\n![[전용 이미지.png]]\n",
    "# 남는 노트\n",
  );
  await openNote(page, "삭제 대상");
  await requestDelete(page, "삭제 대상");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("이미지 1개를 함께 정리합니다", { timeout: 10000 });
  await dialog.getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: "삭제" }).click();

  await expect
    .poll(() => noteExists(page, TARGET_NOTE_PATH), { timeout: 10000 })
    .toBe(false);
  expect(await binaryExists(page, `${VAULT}/attachments/전용 이미지.png`)).toBe(true);
});

test("이미지 없는 노트는 안내 없이 기존 흐름 그대로다", async ({ page }) => {
  await setupNotes(page, "# 삭제 대상\n\n텍스트만 있다\n", "# 남는 노트\n");
  await openNote(page, "삭제 대상");
  await requestDelete(page, "삭제 대상");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog).not.toContainText("함께 정리합니다");
  await dialog.getByRole("button", { name: "삭제" }).click();
  await expect
    .poll(() => noteExists(page, TARGET_NOTE_PATH), { timeout: 10000 })
    .toBe(false);
});
