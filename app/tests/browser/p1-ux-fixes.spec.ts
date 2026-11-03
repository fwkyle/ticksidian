/**
 * 2026-08-18 TICK-UX-008 1단계(P1) 회귀 방지.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 *
 * 1. 문서 메타 — 한국어 앱의 lang/title/theme-color.
 * 2. 볼트 선택 화면 버튼의 키보드 포커스 링(focus-visible).
 *    EmptyVaultScreen은 같은 클래스 패턴을 공유하므로 여기서 대표 검증한다.
 */

import { test, expect } from "@playwright/test";

test("문서 메타가 한국어 앱 기준으로 설정된다", async ({ page }) => {
  await page.goto("/");
  expect(await page.title()).toBe("Ticksidian");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("ko");
  const themeColor = await page.evaluate(
    () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
  );
  expect(themeColor).toBe("#191919");
});

test("볼트 선택 화면 버튼에 키보드 포커스 링이 보인다", async ({ page }) => {
  // 볼트 등록을 비워 시작 화면(VaultSelectionScreen)으로 진입한다.
  await page.addInitScript(() => {
    (window as Window & { __qa_skipVaultSeed?: boolean }).__qa_skipVaultSeed = true;
  });
  await page.goto("/");

  const button = page.getByRole("button", { name: "볼트 폴더 선택" });
  await expect(button).toBeVisible();

  // 키보드로 진입해야 focus-visible 스타일이 활성화된다.
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();

  const ring = await button.evaluate((el) => getComputedStyle(el).boxShadow);
  // Tailwind 4는 색을 oklch로 출력한다. blue-500 토큰(oklch 0.623 0.214 259.815)의
  // 2px 링이 그려졌는지 확인한다. rgb 문자열 비교는 오탐이다(2026-08-18 실측).
  expect(ring).toMatch(/oklch\(0\.623 0\.214 259\.815\) 0px 0px 0px 2px/);
});
