/**
 * 2026-08-18 TICK-UX-008 0단계(P0) 2건 회귀 방지.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 *
 * 1. 새 노트 생성 직후 포커스가 에디터로 가는가. 수정 전에는 포커스가 + 버튼에
 *    남아 스페이스 입력마다 노트가 양산되고 입력이 유실됐다(고객 여정 실측).
 * 2. 노트 삭제가 확인 다이얼로그를 거치는가. 수정 전에는 x 클릭 1번에 즉시 삭제됐다.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

test("새 노트 생성 직후 에디터에 포커스가 가고, 타이핑해도 노트가 양산되지 않는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);

  await page.keyboard.press("Control+n");
  // 에디터 초기 로드 + 포커스 이동 대기
  await page.waitForTimeout(1200);

  const active = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, editable: el.isContentEditable };
  });
  expect(active.editable).toBe(true);

  await page.keyboard.type("포커스 회귀 노트", { delay: 25 });
  await page.waitForTimeout(1600); // 디바운스 자동 저장 대기

  const after = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  const created = after.filter((p) => !before.includes(p));
  expect(created).toHaveLength(1);

  const content = await page.evaluate(
    (p) => window.__qa_readVaultFile?.(p) ?? "",
    created[0],
  );
  expect(content).toContain("포커스 회귀 노트");
});

test("노트 삭제는 확인 다이얼로그를 거친다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const target = page.locator("[data-note-column]").getByRole("button", { name: "맨몸 메모 삭제" });

  // 삭제 요청 → 다이얼로그
  await target.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("맨몸 메모");

  // 취소하면 파일이 그대로 남는다.
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  const kept = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  expect(kept.some((p) => p.includes("맨몸-메모"))).toBe(true);

  // 다시 요청해 확인하면 파일이 제거된다.
  await target.click();
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  expect(after.some((p) => p.includes("맨몸-메모"))).toBe(false);
});
