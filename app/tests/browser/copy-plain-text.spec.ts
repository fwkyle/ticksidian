/**
 * TICK-BUG-007 — 복사 평문(클립보드) QA (2026-09-18).
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/복사-평문-클립보드.md
 * 잠긴 목표: 노트의 주소를 복사하면 클립보드 `text/plain`이 "화면에 보이는 글자"이고,
 * 꺾쇠(`<주소>`)나 마크다운 껍데기가 없다. 리치(`text/html`)는 링크를 그대로 유지한다.
 *
 * [kyle] 신고: 노트 주소를 복사해 크롬에 붙여넣으면 `<https://character.ai/>`가 나온다.
 */

import { test, expect, type Page } from "@playwright/test";

const COPY_NOTE_PATH = "/mock-vault/notes/복사-평문.md";
const COPY_NOTE_CONTENT = [
  "# 복사 평문",
  "",
  "https://character.ai/",
  "",
  "<https://character.ai/>",
  "",
  "[캐릭터](https://character.ai/)",
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

async function writeCopyNote(page: Page) {
  // QA setup 모듈이 늦게 붙으면 옵셔널 콜이 조용히 no-op이 된다(실측 실패 원인).
  await page.waitForFunction(() => {
    return typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile
      === "function";
  });
  await page.evaluate(async ({ path, content }) => {
    await (window as Window & { __qa_writeVaultFile: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile(path, content);
  }, { path: COPY_NOTE_PATH, content: COPY_NOTE_CONTENT });
  await page.reload();
  await waitForAppReady(page);
}

async function openCopyNote(page: Page) {
  const editorText = await page.locator(".bn-editor").textContent().catch(() => "");
  if (!editorText?.includes("복사 평문")) {
    const button = page
      .locator("[data-note-column]")
      .getByRole("button", { name: "복사 평문", exact: true });
    await button.waitFor({ state: "visible", timeout: 10000 });
    await button.click();
  }
  await page.waitForSelector(".bn-editor", { timeout: 15000 });
  await expect(page.locator(".bn-editor")).toContainText("복사 평문", { timeout: 8000 });
  await page.waitForTimeout(600);
}

/**
 * 편집기 안에서 `needle`을 포함한 n번째 텍스트 노드를 통째로 선택한다.
 *
 * 링크 글자를 클릭하면 브라우저가 주소를 열 수 있어 마우스 대신 범위 선택을 쓴다.
 * ProseMirror는 `selectionchange`를 읽어 자기 선택 상태를 맞추므로, 선택 뒤 잠깐 기다린다.
 */
async function selectTextNode(page: Page, needle: string, occurrence = 0) {
  const found = await page.evaluate(({ needle, occurrence }) => {
    // BlockNote 버전에 따라 .bn-editor가 ProseMirror 요소 자체이거나 그 부모다.
    // 복사 이벤트를 걸 대상은 ProseMirror 요소(= view.dom)이므로 그쪽을 먼저 본다.
    const editor = document.querySelector(".bn-editor.ProseMirror")
      ?? document.querySelector(".bn-editor")
      ?? document.querySelector(".ProseMirror");
    if (!editor) return { ok: false, text: "" };
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      if (text.includes(needle)) {
        if (seen === occurrence) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return { ok: true, text };
        }
        seen += 1;
      }
      node = walker.nextNode();
    }
    return { ok: false, text: "" };
  }, { needle, occurrence });

  expect(found.ok, `편집기에서 텍스트를 찾지 못했다: ${needle} #${occurrence}`).toBe(true);
  await page.waitForTimeout(250);
  return found.text;
}

/** copy/cut 이벤트를 보내고 클립보드에 실제로 들어간 값을 읽는다. */
async function readClipboardFlavors(page: Page, type: "copy" | "cut") {
  return page.evaluate((eventType) => {
    const dom = document.querySelector(".bn-editor.ProseMirror")
      ?? document.querySelector(".bn-editor")
      ?? document.querySelector(".ProseMirror");
    if (!dom) return { plain: "", html: "", blocknote: "" };
    const data = new DataTransfer();
    const event = new Event(eventType, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    dom.dispatchEvent(event);
    return {
      plain: data.getData("text/plain"),
      html: data.getData("text/html"),
      blocknote: data.getData("blocknote/html"),
    };
  }, type);
}

test("주소를 복사하면 꺾쇠 없이 주소만 나온다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await writeCopyNote(page);
  await openCopyNote(page);

  await selectTextNode(page, "character.ai", 0);
  const clip = await readClipboardFlavors(page, "copy");

  expect(clip.plain.trim()).toBe("https://character.ai/");
  expect(clip.plain).not.toContain("<");
  expect(clip.plain).not.toContain(">");
  // 리치 형식은 그대로 링크를 담는다 — 평문만 바꾼다.
  expect(clip.html).toContain("href");
});

test("오토링크로 저장된 주소도 꺾쇠 없이 나온다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await writeCopyNote(page);
  await openCopyNote(page);

  // 원문이 <https://character.ai/>인 문단(두 번째 character.ai 텍스트 노드).
  await selectTextNode(page, "character.ai", 1);
  const clip = await readClipboardFlavors(page, "copy");

  expect(clip.plain.trim()).toBe("https://character.ai/");
  expect(clip.plain).not.toContain("<");
});

test("글자가 다른 링크는 마크다운 껍데기 대신 보이는 글자를 복사한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await writeCopyNote(page);
  await openCopyNote(page);

  await selectTextNode(page, "캐릭터", 0);
  const clip = await readClipboardFlavors(page, "copy");

  expect(clip.plain.trim()).toBe("캐릭터");
  expect(clip.plain).not.toContain("](");
  expect(clip.html).toContain("href");
});

test("잘라내기도 같은 평문을 넣는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await writeCopyNote(page);
  await openCopyNote(page);

  await selectTextNode(page, "마지막 문단이다.", 0);
  const clip = await readClipboardFlavors(page, "cut");

  expect(clip.plain.trim()).toBe("마지막 문단이다.");
  await expect(page.locator(".bn-editor")).not.toContainText("마지막 문단이다.", { timeout: 5000 });
});
