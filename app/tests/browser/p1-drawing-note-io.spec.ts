/**
 * TICK-BUG-004 — 볼트에 그림 파일이 있으면 삭제 확인창의 이미지 동반 정리 안내가 사라진다.
 *
 * 분류: 브라우저 fixture QA
 * 근거: 2026-08-23 [kyle] 실창 QA B6 FAIL (실볼트에 `바이브코딩 구조.excalidraw` 존재).
 *
 * 원인(코드 확인): TICK-DRAW-001에서 그림(`*.excalidraw`)을 노트 목록에 넣었는데,
 * `handleRequestDeleteNote`가 **다른 모든 항목을 `readNoteFile`로 읽는다**. 그 함수는
 * basename 뒤에 `.md`를 붙이므로 그림에서는 항상 실패하고, 판정이 불확실하면 전부
 * 비우는 fail-closed 규칙 때문에 전용 이미지가 0개로 떨어진다.
 */

import { test, expect, type Page } from "@playwright/test";

const VAULT = "/mock-vault";
const TARGET_NOTE_PATH = `${VAULT}/notes/그림 있는 볼트 삭제 대상.md`;
const DRAWING_PATH = `${VAULT}/그림 하나.excalidraw`;
const EXCLUSIVE_IMAGE = `${VAULT}/attachments/전용만 쓰는 이미지.png`;

const DRAWING_CONTENT = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [],
  appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
  files: {},
}, null, 2) + "\n";

const TARGET_CONTENT = [
  "---",
  'id: "그림 있는 볼트 삭제 대상"',
  "---",
  "# 그림 있는 볼트 삭제 대상",
  "",
  "![[전용만 쓰는 이미지.png]]",
  "",
].join("\n");

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

const column = (page: Page) => page.locator("[data-note-column]");

async function seed(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() =>
    typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile === "function");
  await page.evaluate(async ({ note, noteContent, drawing, drawingContent }) => {
    const write = (window as Window & {
      __qa_writeVaultFile: (p: string, c: string) => Promise<void>;
    }).__qa_writeVaultFile;
    await write(note, noteContent);
    await write(drawing, drawingContent);
  }, {
    note: TARGET_NOTE_PATH, noteContent: TARGET_CONTENT,
    drawing: DRAWING_PATH, drawingContent: DRAWING_CONTENT,
  });
  await page.evaluate(async (path) => {
    await (window as Window & {
      __qa_writeVaultBinary: (p: string, b: Uint8Array) => Promise<void>;
    }).__qa_writeVaultBinary(path, new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
  }, EXCLUSIVE_IMAGE);
  await page.reload();
  await waitForAppReady(page);
}

test("볼트에 그림 파일이 있어도 전용 이미지 동반 정리 안내가 뜬다", async ({ page }) => {
  await seed(page);

  const deleteButton = column(page)
    .getByRole("button", { name: "그림 있는 볼트 삭제 대상 삭제", exact: true });
  await deleteButton.waitFor({ state: "visible", timeout: 10000 });
  await deleteButton.click();

  await expect(page.getByText(/이 노트만 쓰는 이미지 1개를 함께 정리합니다/)).toBeVisible({
    timeout: 10000,
  });
});

test("그림 파일은 목록에서 삭제할 수 있다(.md가 아니어도)", async ({ page }) => {
  await seed(page);

  const kindFilter = column(page).getByRole("group", { name: "종류 필터" });
  await kindFilter.getByRole("button", { name: "그림", exact: true }).click();

  const deleteButton = column(page).getByRole("button", { name: "그림 하나 삭제", exact: true });
  await deleteButton.waitFor({ state: "visible", timeout: 10000 });
  await deleteButton.click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();

  // 목록에서 사라지고 파일도 없어져야 한다.
  await expect(column(page).getByRole("button", { name: "그림 하나", exact: true }))
    .toHaveCount(0, { timeout: 10000 });
  const stillThere = await page.evaluate(async (p) => {
    try {
      await (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> })
        .__qa_readVaultFile(p);
      return true;
    } catch {
      return false;
    }
  }, DRAWING_PATH);
  expect(stillThere).toBe(false);
});

test("그림 항목 메뉴에는 노트 전용 동작이 뜨지 않는다", async ({ page }) => {
  await seed(page);

  const kindFilter = column(page).getByRole("group", { name: "종류 필터" });
  await kindFilter.getByRole("button", { name: "그림", exact: true }).click();

  await column(page).getByRole("button", { name: "그림 하나", exact: true })
    .click({ button: "right" });

  const menu = page.getByRole("menu", { name: /항목 작업/ });
  await expect(menu).toBeVisible({ timeout: 10000 });
  // `.md` 전제 동작(frontmatter 수정·이동)은 그림에서 실패하므로 뜨면 안 된다.
  await expect(menu.getByRole("menuitem", { name: "할 일로 표시" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "보관으로 이동" })).toHaveCount(0);
});
