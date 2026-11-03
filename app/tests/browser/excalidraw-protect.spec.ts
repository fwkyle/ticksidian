/**
 * 2026-08-20 옵시디언 Excalidraw 플러그인 그림 파일 편집 보호 회귀.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * Why: [kyle] 볼트에 플러그인 그림 5개가 실존한다. 일반 에디터로 열어 저장하면
 * 압축 그림 데이터가 오염되므로, 편집을 열지 않고 보호 문구를 보여야 한다.
 * 설계: app/src/lib/excalidraw-note.ts
 *
 * 정적 시드 대신 테스트 안에서 파일을 만들고 새로고침한다 — 기존 스펙들의
 * 노트 개수 검증을 흔들지 않기 위해서다.
 */

import { test, expect, type Page } from "@playwright/test";

// __qa_writeVaultFile은 없는 폴더를 만들지 않으므로 볼트 루트에 쓴다.
const DRAWING_PATH = "/mock-vault/kimaki-arch.excalidraw.md";
const DRAWING_CONTENT = `---

excalidraw-plugin: parsed

---
# Excalidraw Data

## Text Elements
토큰 저장 ^BsEqTnmS

%%
## Drawing
\`\`\`compressed-json
N4KAkARALgngDgUwgLgAQQwDwMYEMA3AlgCYBOuA7hADTgQBuCpAzoQPYB2KqATLZM
\`\`\`
%%
`;

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

test("Excalidraw 플러그인 그림 파일은 편집을 열지 않고 원본을 보호한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await page.evaluate(
    ([p, c]) => window.__qa_writeVaultFile?.(p, c),
    [DRAWING_PATH, DRAWING_CONTENT] as const,
  );
  await page.reload();
  await waitForAppReady(page);

  // H1이 "Excalidraw Data"라 목록 제목도 그것이다.
  await page
    .locator("[data-note-column]")
    .getByRole("button", { name: "Excalidraw Data", exact: true })
    .click();

  // 에디터 대신 보호 문구가 떠야 한다.
  await expect(page.getByText(/Excalidraw 그림 파일이라 편집을 열지 않았습니다/)).toBeVisible({
    timeout: 10000,
  });

  // 타이핑을 시도해도(자동 저장 경로) 원본은 한 글자도 변하지 않아야 한다.
  await page.keyboard.type("오염 시도", { delay: 20 });
  await page.waitForTimeout(1800);
  const after = await page.evaluate(
    (p) => window.__qa_readVaultFile?.(p) ?? "",
    DRAWING_PATH,
  );
  expect(after).toBe(DRAWING_CONTENT);
});
