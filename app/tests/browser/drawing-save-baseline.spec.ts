/**
 * DEF-CONC-002 후속 — 그림(`*.excalidraw`) 저장도 쓰기가 돌려준 mtime을 기준선으로 쓴다.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter). 실제 Tauri 쓰기·권한은 [kyle] 잔여.
 * 설계: docs/waterfall/03-상세설계/엑스칼리드로우-그림-편집.md, 에디터-저장-외부수정-리팩토링-설계.md 계약 12.
 *
 * 재현: 첫 저장이 파일을 게시한 직후(결과 반환 전) 외부 쓰기가 끼어든다. 예전에는 저장 뒤 mtime을
 * 다시 읽어 외부 mtime을 기준선으로 삼았고, 다음 저장 직전 확인(`classifyPreSaveGuard`)이
 * 외부 변경을 "내가 쓴 것"으로 보고 덮어썼다.
 */

import { test, expect, type Page } from "@playwright/test";

const DRAWING_PATH = "/mock-vault/바이브코딩 구조.excalidraw";
const EXTERNAL_MARKER = "EXTERNAL-DRAW-게시직후-외부쓰기";

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

const EXTERNAL_CONTENT = JSON.stringify({
  type: "excalidraw", version: 2, source: EXTERNAL_MARKER, elements: [], appState: {}, files: {},
}, null, 2) + "\n";

const readVault = (page: Page, path: string) =>
  page.evaluate(
    (p) => (window as unknown as { __qa_readVaultFile: (p: string) => Promise<string> }).__qa_readVaultFile(p),
    path,
  );

async function openDrawing(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() =>
    typeof (window as unknown as { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile === "function");
  await page.evaluate(async ({ path, content }) => {
    await (window as unknown as { __qa_writeVaultFile: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile(path, content);
  }, { path: DRAWING_PATH, content: DRAWING_CONTENT });
  await page.reload();
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
  const column = page.locator("[data-note-column]");
  await column.getByRole("group", { name: "종류 필터" }).getByRole("button", { name: "그림", exact: true }).click();
  await column.getByRole("button", { name: "바이브코딩 구조", exact: true }).click();
  await expect(page.locator(".excalidraw")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);
}

/** 캔버스를 눌러 포커스한 뒤 전체 선택 → 화살표로 도형을 옮겨 의미 있는 변경을 만든다. */
async function nudgeShapes(page: Page) {
  await page.locator(".excalidraw canvas.interactive").click({ position: { x: 600, y: 400 } });
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("ArrowRight");
}

test("그림 저장 게시 직후 끼어든 외부 쓰기를 다음 저장이 덮지 않고 멈춘다", async ({ page }) => {
  await openDrawing(page);

  await page.evaluate(({ path, content }) => {
    const w = window as unknown as {
      __qa_afterVaultWrite?: (p: string) => Promise<void>;
      __qa_simulateExternalEdit: (p: string, c: string) => Promise<void>;
    };
    let fired = false;
    w.__qa_afterVaultWrite = async (written: string) => {
      if (fired || written !== path) return;
      fired = true;
      // 외부 쓰기 mtime이 내 쓰기 mtime과 같은 ms가 되지 않게 한다.
      await new Promise((resolve) => setTimeout(resolve, 30));
      await w.__qa_simulateExternalEdit(path, content);
    };
  }, { path: DRAWING_PATH, content: EXTERNAL_CONTENT });

  // 첫 변경 → 1초 디바운스 저장 → 게시 직후 외부 쓰기.
  await nudgeShapes(page);
  await expect.poll(() => readVault(page, DRAWING_PATH), { timeout: 8000 }).toContain(EXTERNAL_MARKER);

  // 두 번째 변경 저장은 외부 변경을 감지해 멈춰야 하고, 디스크의 외부 내용은 그대로여야 한다.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("그림 파일이 밖에서 바뀌어 저장을 멈췄습니다")).toBeVisible({ timeout: 8000 });
  expect(await readVault(page, DRAWING_PATH)).toContain(EXTERNAL_MARKER);
});
