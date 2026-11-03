/**
 * DEF-CONC-002 — 저장 직후 외부 쓰기가 기준선(mtime)으로 승격되어 영구 무시되던 틈.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter). 실제 Tauri 쓰기 명령의 반환값은
 * Rust 테스트(`perf_checked_write_returns_own_mtime_not_later_external_mtime`)가 잠근다.
 * 설계: docs/waterfall/03-상세설계/에디터-저장-외부수정-리팩토링-설계.md §4 불변 계약.
 *
 * 재현: 편집기 저장이 파일을 게시한 직후, 저장 코드가 결과를 받기 전에 외부 쓰기가 끼어든다.
 * 예전에는 저장 뒤 stat을 다시 읽어 외부 mtime을 기준선으로 삼았고, 폴러가
 * `currentMtime <= lastKnown → ignore`로 그 외부 변경을 영구히 무시했다.
 */

import { test, expect, type Page } from "@playwright/test";

const NOTE_PATH = "/mock-vault/notes/note-alpha.md";
const EXTERNAL_MARKER = "EXTERNAL-C2-게시직후-외부쓰기";

async function openAlphaNote(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "알파 노트", exact: true })
    .click();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.waitForTimeout(600);
}

test("저장 게시 직후 끼어든 외부 쓰기를 폴러가 감지해 편집기에 반영한다", async ({ page }) => {
  await openAlphaNote(page);

  // 첫 저장이 파일을 게시한 직후(결과 반환 전) 외부 쓰기를 한 번만 끼운다.
  await page.evaluate(({ path, marker }) => {
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
      await w.__qa_simulateExternalEdit(
        path,
        `---\nid: "note-alpha"\n---\n# 알파 노트\n\n${marker}\n`,
      );
    };
  }, { path: NOTE_PATH, marker: EXTERNAL_MARKER });

  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("LOCAL-C2-내가-쓴-줄", { delay: 5 });

  // 1초 디바운스 저장 → 게시 직후 외부 쓰기 → 3초 폴러가 외부 변경을 봐야 한다.
  // 저장 직후라 미저장 변경이 없으므로 폴러는 배너 없이 외부 내용을 편집기에 다시 불러온다.
  // 기준선이 외부 mtime으로 승격되면(결함) 폴러가 이를 영구 무시해 편집기에 반영되지 않는다.
  await expect(page.locator(".bn-editor")).toContainText(EXTERNAL_MARKER, { timeout: 12000 });

  // 디스크에도 외부 내용이 남아 있고, 이후 자동 저장이 그것을 덮지 않는다.
  await page.waitForTimeout(2500);
  const onDisk = await page.evaluate(
    (path) => (window as unknown as { __qa_readVaultFile: (p: string) => Promise<string> }).__qa_readVaultFile(path),
    NOTE_PATH,
  );
  expect(onDisk).toContain(EXTERNAL_MARKER);
});
