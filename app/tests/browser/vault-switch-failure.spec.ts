/**
 * DEF-CONC-001 — 볼트 전환 초기화가 실패하면 어댑터 경로와 화면이 이전 볼트로 일치한다.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter, 권한 거부 볼트 fixture)
 * 설계: docs/waterfall/03-상세설계/런타임-볼트-전환-정책.md §7.3
 *
 * 권한 거부 볼트 fixture: 경로는 새 볼트로 바뀐 뒤 `registerVaultPath`가 던진다
 * (`initializeVault`가 어댑터 경로를 먼저 바꾸고 이후 단계에서 실패하는 모양).
 */

import { test, expect, type Page } from "@playwright/test";

const PREVIOUS_VAULT = "/mock-vault";
const DENIED_VAULT = "/denied-vault";
const NOTE_PATH = "/mock-vault/notes/note-alpha.md";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function currentVaultPath(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    return (window as Window & { __qa_currentVaultPath?: () => string | null }).__qa_currentVaultPath?.() ?? null;
  });
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> }).__qa_readVaultFile?.(p);
  }, path)) ?? "";
}

test("초기화 실패 볼트를 고르면 이전 볼트로 되돌리고 이후 저장도 이전 볼트로 간다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  expect(await currentVaultPath(page)).toBe(PREVIOUS_VAULT);

  await page.evaluate((denied) => {
    const w = window as Window & { __qa_nextVaultSelection?: string; __qa_denyVaultPath?: string };
    w.__qa_nextVaultSelection = denied;
    w.__qa_denyVaultPath = denied;
  }, DENIED_VAULT);

  await page.getByRole("button", { name: "볼트 폴더 변경/재선택" }).click();

  // 오류를 알리고, 어댑터 경로는 이전 볼트로 돌아오며, 화면에는 이전 볼트의 노트가 다시 보인다.
  await expect(page.getByText("QA 권한 거부 볼트", { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await expect.poll(() => currentVaultPath(page), { timeout: 8000 }).toBe(PREVIOUS_VAULT);
  const column = page.locator("[data-note-column]");
  await expect(column.getByRole("button", { name: "알파 노트", exact: true })).toBeVisible({ timeout: 8000 });

  // 이후 편집 저장은 화면에 보이는 이전 볼트 파일로 간다.
  await page.evaluate(() => {
    const w = window as Window & { __qa_nextVaultSelection?: string; __qa_denyVaultPath?: string };
    delete w.__qa_nextVaultSelection;
    delete w.__qa_denyVaultPath;
  });
  await column.getByRole("button", { name: "알파 노트", exact: true }).click();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("전환 실패 뒤 저장", { delay: 10 });
  await expect.poll(() => readVaultFile(page, NOTE_PATH), { timeout: 10000 }).toContain("전환 실패 뒤 저장");
  expect(await currentVaultPath(page)).toBe(PREVIOUS_VAULT);
});

// DFXR-002 — 게시 이후 단계(경로 저장)가 실패해도 감시·어댑터·저장 경로·hasVault가 이전 볼트와 일치한다.
async function trackWatchCalls(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __watchPaths: string[];
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: { path?: string }, ...rest: unknown[]) => Promise<unknown> };
    };
    w.__watchPaths = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = function (cmd, args, ...rest) {
      if (cmd === "start_vault_watch" && args?.path) w.__watchPaths.push(args.path);
      return invoke.call(this, cmd, args, ...rest);
    };
  });
}

async function denyPathStorage(page: Page, on: boolean) {
  await page.evaluate((deny) => {
    const w = window as unknown as { __origSetItem?: Storage["setItem"] };
    if (deny) {
      w.__origSetItem = Storage.prototype.setItem;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === "ticksidian-vault-path") throw new DOMException("QA-storage-denied", "QuotaExceededError");
        return original.call(this, key, value);
      };
    } else if (w.__origSetItem) {
      Storage.prototype.setItem = w.__origSetItem;
    }
  }, on);
}

async function chooseVault(page: Page, path: string, denied?: string) {
  await page.evaluate(({ path, denied }) => {
    const w = window as Window & { __qa_nextVaultSelection?: string; __qa_denyVaultPath?: string };
    w.__qa_nextVaultSelection = path;
    w.__qa_denyVaultPath = denied;
  }, { path, denied });
  await page.getByRole("button", { name: "볼트 폴더 변경/재선택" }).click();
  await page.waitForTimeout(1200);
}

test("경로 저장이 실패하면 감시·어댑터·저장 경로가 모두 이전 볼트로 남는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await trackWatchCalls(page);
  await denyPathStorage(page, true);
  await chooseVault(page, "/next-vault");

  await expect(page.getByText("QA-storage-denied", { exact: false }).first()).toBeVisible({ timeout: 8000 });
  expect(await currentVaultPath(page)).toBe(PREVIOUS_VAULT);
  const watched = await page.evaluate(() => (window as unknown as { __watchPaths: string[] }).__watchPaths);
  expect(watched).not.toContain("/next-vault");
  expect(await page.evaluate(() => localStorage.getItem("ticksidian-vault-path"))).not.toBe("/next-vault");
  await expect(page.locator("[data-note-column]").getByRole("button", { name: "알파 노트", exact: true }))
    .toBeVisible({ timeout: 8000 });
});

test("취소 → 성공 → 실패 → 재성공 연속 전환에서도 경로가 한 곳을 가리킨다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await trackWatchCalls(page);

  await chooseVault(page, "");
  expect(await currentVaultPath(page)).toBe(PREVIOUS_VAULT);

  await chooseVault(page, "/good-two");
  expect(await currentVaultPath(page)).toBe("/good-two");
  expect(await page.evaluate(() => localStorage.getItem("ticksidian-vault-path"))).toBe("/good-two");

  await chooseVault(page, "/denied-three", "/denied-three");
  expect(await currentVaultPath(page)).toBe("/good-two");
  expect(await page.evaluate(() => localStorage.getItem("ticksidian-vault-path"))).toBe("/good-two");
  const watched = await page.evaluate(() => (window as unknown as { __watchPaths: string[] }).__watchPaths);
  expect(watched).not.toContain("/denied-three");
  expect(watched[watched.length - 1]).toBe("/good-two");

  await chooseVault(page, "/good-four");
  expect(await currentVaultPath(page)).toBe("/good-four");
  expect(await page.evaluate(() => localStorage.getItem("ticksidian-vault-path"))).toBe("/good-four");
});
