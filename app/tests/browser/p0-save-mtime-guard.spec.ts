/**
 * TICK-BUG-001 / TICK-BUG-002 — 저장 직전 외부 변경 가드 + 이미지 쓰기 실패 안내.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 근거: 2026-08-23 [kyle] 실창 QA C1(외부 변경 무음 덮어씀) / B5(20MB 초과 무음).
 * 설계: docs/waterfall/03-상세설계/에디터-저장-외부수정-리팩토링-설계.md §4 불변 계약 10
 *
 * C1 재현 타이밍: 타이핑(디바운스 1초 예약) → 즉시 외부 쓰기 → 디바운스가 3초 폴러보다
 * 먼저 발화한다. 폴러는 그 외부 변경을 볼 기회조차 없으므로, 저장 직전 재확인이 없으면
 * 외부 내용이 경고 없이 덮인다.
 */

import { test, expect, type Page } from "@playwright/test";

const NOTE_PATH = "/mock-vault/notes/note-alpha.md";
const EXTERNAL_MARKER = "EXTERNAL-C1B-바깥에서-쓴-줄";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function openAlphaNote(page: Page) {
  await page.goto("/");
  await waitForAppReady(page);
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "알파 노트", exact: true })
    .click();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.waitForTimeout(600);
}

test("저장 직전 외부 변경이 있으면 덮어쓰지 않고 충돌 배너를 띄운다", async ({ page }) => {
  await openAlphaNote(page);

  // 1) 로컬 편집 시작 → 1초 디바운스 저장 예약
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("LOCAL-UNSAVED-C1", { delay: 5 });

  // 2) 그 직후(폴러가 돌기 전) 외부에서 파일을 바꾼다
  await page.evaluate(async ({ path, marker }) => {
    const external = [
      "---",
      'id: "note-alpha"',
      "---",
      "# 알파 노트",
      "",
      marker,
      "",
    ].join("\n");
    await (window as Window & {
      __qa_simulateExternalEdit: (p: string, c: string) => Promise<void>;
    }).__qa_simulateExternalEdit(path, external);
  }, { path: NOTE_PATH, marker: EXTERNAL_MARKER });

  // 3) 디바운스 저장이 발화할 시간을 준다(폴러 3초보다 먼저)
  await page.waitForTimeout(2000);

  // 4) 외부 내용이 살아 있어야 한다 — 이게 핵심 계약이다
  const onDisk = await page.evaluate(async (path) => {
    return (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> })
      .__qa_readVaultFile(path);
  }, NOTE_PATH);
  expect(onDisk).toContain(EXTERNAL_MARKER);
  expect(onDisk).not.toContain("LOCAL-UNSAVED-C1");

  // 5) 사용자가 상황을 알 수 있어야 한다
  await expect(page.getByText("파일이 외부에서 수정되었습니다")).toBeVisible({ timeout: 8000 });
});

test("충돌 배너에서 '내 변경 유지'를 고르면 저장이 다시 진행된다", async ({ page }) => {
  await openAlphaNote(page);

  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("KEEP-LOCAL-WINS", { delay: 5 });

  await page.evaluate(async ({ path, marker }) => {
    await (window as Window & {
      __qa_simulateExternalEdit: (p: string, c: string) => Promise<void>;
    }).__qa_simulateExternalEdit(path, `---\nid: "note-alpha"\n---\n# 알파 노트\n\n${marker}\n`);
  }, { path: NOTE_PATH, marker: EXTERNAL_MARKER });

  await expect(page.getByText("파일이 외부에서 수정되었습니다")).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "내 변경 유지" }).click();

  // 기준선이 디스크 현재 상태로 올라가야 재저장이 무한 거부에 빠지지 않는다.
  await expect
    .poll(async () => {
      return page.evaluate(async (path) => {
        return (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> })
          .__qa_readVaultFile(path);
      }, NOTE_PATH);
    }, { timeout: 10000 })
    .toContain("KEEP-LOCAL-WINS");
});

test("20MB를 넘는 이미지를 붙여넣으면 이유를 안내한다", async ({ page }) => {
  await openAlphaNote(page);

  await page.evaluate(() => {
    // 21MiB PNG 헤더 + 패딩. Rust ensure_binary_within_limit(20MiB)를 넘긴다.
    const bytes = new Uint8Array(21 * 1024 * 1024);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    const file = new File([bytes], "너무-큰-이미지.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const target = document.querySelector(".bn-editor");
    if (!target) throw new Error("editor dom not found");
    target.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dataTransfer, bubbles: true, cancelable: true }),
    );
  });

  await expect(page.getByText(/이미지가 너무 큽니다/)).toBeVisible({ timeout: 10000 });
});
