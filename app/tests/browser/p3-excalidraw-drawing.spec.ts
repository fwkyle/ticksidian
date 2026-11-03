/**
 * TICK-DRAW-001 3a/3b — 그림 파일 열기·편집·저장 + 노트 안 미리보기.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/엑스칼리드로우-그림-편집.md
 *
 * 이 작업의 잠긴 목표는 **포맷 왕복 보존**이다. 그래서 "열었다 닫아도 파일이
 * 한 글자도 안 변한다"를 가장 먼저 검증한다.
 */

import { test, expect, type Page } from "@playwright/test";

const DRAWING_PATH = "/mock-vault/바이브코딩 구조.excalidraw";
const EMBED_NOTE_PATH = "/mock-vault/notes/그림-임베드.md";

// [kyle] 실볼트 파일과 같은 모양: 2칸 들여쓰기 + 끝 개행, source는 excalidraw.com.
const DRAWING_CONTENT = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [{
    id: "rect-1", type: "rectangle", x: 100, y: 100, width: 200, height: 100,
    angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [],
    frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1,
    isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
  }],
  appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
  files: {},
}, null, 2) + "\n";

const EMBED_NOTE_CONTENT = [
  "---",
  'id: "그림-임베드"',
  "---",
  "# 그림 임베드",
  "",
  "![[바이브코딩 구조.excalidraw]]",
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
  await page.evaluate(async ({ drawing, drawingContent, note, noteContent }) => {
    const write = (window as Window & {
      __qa_writeVaultFile: (p: string, c: string) => Promise<void>;
    }).__qa_writeVaultFile;
    await write(drawing, drawingContent);
    await write(note, noteContent);
  }, {
    drawing: DRAWING_PATH, drawingContent: DRAWING_CONTENT,
    note: EMBED_NOTE_PATH, noteContent: EMBED_NOTE_CONTENT,
  });
  await page.reload();
  await waitForAppReady(page);
}

async function readVault(page: Page, path: string): Promise<string> {
  return page.evaluate(async (p) =>
    (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> }).__qa_readVaultFile(p),
    path);
}

test("그림 파일이 목록에 뜨고 '그림' 필터로 좁혀진다", async ({ page }) => {
  await seed(page);

  const kindFilter = column(page).getByRole("group", { name: "종류 필터" });
  await kindFilter.getByRole("button", { name: "그림", exact: true }).click();

  // 확장자를 뗀 이름이 제목이다.
  await expect(
    column(page).getByRole("button", { name: "바이브코딩 구조", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  // 노트/투두는 그림 필터에서 빠진다.
  await expect(column(page).getByRole("button", { name: "알파 노트", exact: true })).toHaveCount(0);

  // "노트" 필터에는 그림이 없다(정의를 좁혔다).
  await kindFilter.getByRole("button", { name: "기록", exact: true }).click();
  await expect(column(page).getByRole("button", { name: "바이브코딩 구조", exact: true })).toHaveCount(0);
});

test("그림을 열면 캔버스가 뜨고, 열었다 닫아도 파일이 한 글자도 안 변한다", async ({ page }) => {
  await seed(page);

  const kindFilter = column(page).getByRole("group", { name: "종류 필터" });
  await kindFilter.getByRole("button", { name: "그림", exact: true }).click();
  await column(page).getByRole("button", { name: "바이브코딩 구조", exact: true }).click();

  // 전용 화면 + 캔버스
  await expect(page.locator("[data-drawing-editor]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".excalidraw")).toBeVisible({ timeout: 20000 });

  // 자동 저장 디바운스(1초)보다 충분히 기다린 뒤에도 원본이 그대로여야 한다.
  await page.waitForTimeout(2500);
  expect(await readVault(page, DRAWING_PATH)).toBe(DRAWING_CONTENT);

  // 다른 노트로 갔다가(언마운트 flush 경로) 돌아와도 그대로.
  await kindFilter.getByRole("button", { name: "기록", exact: true }).click();
  await column(page).getByRole("button", { name: "알파 노트", exact: true }).click();
  await page.waitForTimeout(1500);
  expect(await readVault(page, DRAWING_PATH)).toBe(DRAWING_CONTENT);
});

test("그림 임베드가 있는 노트를 편집·저장해도 원문 문법이 보존된다", async ({ page }) => {
  await seed(page);

  await column(page).getByRole("button", { name: "그림 임베드", exact: true }).click();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.waitForTimeout(1500); // SVG 렌더(동적 import) 대기

  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("본문 추가", { delay: 10 });
  await page.waitForTimeout(1800);

  const saved = await readVault(page, EMBED_NOTE_PATH);
  expect(saved).toContain("본문 추가");
  // 원문 임베드 문법이 그대로 남아야 한다(blob URL이 새어 들어가면 안 된다).
  expect(saved).toContain("![[바이브코딩 구조.excalidraw]]");
  expect(saved).not.toContain("blob:");
});

test("깨진 그림 파일은 편집을 열지 않고 원본을 보호한다", async ({ page }) => {
  await seed(page);
  const brokenPath = "/mock-vault/깨진 그림.excalidraw";
  const broken = "{ this is not json";
  await page.evaluate(async ({ p, c }) => {
    await (window as Window & {
      __qa_writeVaultFile: (p: string, c: string) => Promise<void>;
    }).__qa_writeVaultFile(p, c);
  }, { p: brokenPath, c: broken });
  await page.reload();
  await waitForAppReady(page);

  const kindFilter = column(page).getByRole("group", { name: "종류 필터" });
  await kindFilter.getByRole("button", { name: "그림", exact: true }).click();
  await column(page).getByRole("button", { name: "깨진 그림", exact: true }).click();

  await expect(page.getByText(/그림 파일을 읽지 못했습니다/)).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);
  expect(await readVault(page, brokenPath)).toBe(broken);
});
