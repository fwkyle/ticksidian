/**
 * DEF-DATA-001 + DEF-CONC-004 — 닫힌 노트 메타 변경(`updateNoteFrontmatter`)의 직렬화와 외부 변경 보호.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/옵시디언-원본-최소-frontmatter.md
 *       "닫힌 노트 메타 변경의 직렬화와 외부 변경 보호"
 */

import { test, expect, type Page } from "@playwright/test";

const OBJ_PATH = "/mock-vault/notes/객체 머리말.md";
const OBJ_CONTENT = [
  "---",
  'id: "객체 머리말"',
  "meta:",
  "  owner: kyle",
  "  stars: [1, 2]",
  "---",
  "",
  "# 객체 머리말",
  "",
  "본문 한 줄.",
  "",
].join("\n");

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function seedObjectNote(page: Page) {
  await page.goto("/");
  await waitForAppReady(page);
  await page.waitForFunction(() => {
    return typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile === "function";
  });
  await page.evaluate(async ({ path, content }) => {
    await (window as Window & { __qa_writeVaultFile?: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile?.(path, content);
  }, { path: OBJ_PATH, content: OBJ_CONTENT });
  await page.reload();
  await waitForAppReady(page);
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> }).__qa_readVaultFile?.(p);
  }, path)) ?? "";
}

function noteButton(page: Page, title: string) {
  return page.locator("[data-note-column]").getByRole("button", { name: title, exact: true });
}

test("객체 값 머리말은 닫힌 노트 메타 변경 뒤에도 객체로 남는다", async ({ page }) => {
  await seedObjectNote(page);
  await noteButton(page, "객체 머리말").click({ button: "right" });
  await page.getByRole("menuitem", { name: "할 일로 표시" }).click();

  await expect.poll(() => readVaultFile(page, OBJ_PATH), { timeout: 8000 }).toContain('type: "todo"');
  const saved = await readVaultFile(page, OBJ_PATH);
  expect(saved).not.toContain("[object Object]");
  expect(saved).toContain('meta: {"owner":"kyle","stars":[1,2]}');
  expect(saved).toContain("본문 한 줄.");
});

test("쓰기 직전 외부 쓰기가 끼면 덮어쓰지 않고 오류로 멈춘다", async ({ page }) => {
  await seedObjectNote(page);
  const external = OBJ_CONTENT.replace("본문 한 줄.", "EXTERNAL-CONC004-바깥에서 쓴 줄");
  // 앱의 읽기·stat 확인이 모두 끝난 뒤, 실제 쓰기 직전에 외부 변경을 끼워 넣는다.
  await page.evaluate(async ({ path, content }) => {
    const w = window as Window & {
      __qa_beforeVaultWrite?: (p: string, c: string) => Promise<void>;
      __qa_simulateExternalEdit?: (p: string, c: string) => Promise<void>;
    };
    w.__qa_beforeVaultWrite = async (p: string) => {
      w.__qa_beforeVaultWrite = undefined;
      if (p === path) await w.__qa_simulateExternalEdit?.(path, content);
    };
  }, { path: OBJ_PATH, content: external });

  await noteButton(page, "객체 머리말").click({ button: "right" });
  await page.getByRole("menuitem", { name: "할 일로 표시" }).click();

  await expect(page.getByText("외부에서 바뀌어", { exact: false }).first()).toBeVisible({ timeout: 8000 });
  const saved = await readVaultFile(page, OBJ_PATH);
  expect(saved).toBe(external);
  expect(saved).not.toContain('type: "todo"');
});
