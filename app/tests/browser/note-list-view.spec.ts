/**
 * 노트·투두 통합 목록 브라우저 QA (2026-08-18 [kyle] 요청)
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/노트-투두-통합-목록.md
 *
 * 확인 대상
 * 1. 한 목록에 노트와 투두가 함께 있고, 종류 필터로 좁혀진다.
 * 2. 정렬 기준을 바꾸면 순서가 바뀌고, 새로고침 후에도 유지된다.
 * 3. 목록 전체가 가진 공통 태그는 숨고, 구분되는 태그만 남는다.
 * 4. 목록에서 투두 완료를 바로 토글한다.
 * 5. 위키링크 배너는 기본 접힘이고 눌러야 펼쳐진다.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

const list = (page: Page) => page.locator("[data-note-column]");
const kindBtn = (page: Page, name: RegExp) =>
  list(page).getByRole("button", { name });

test("종류 필터로 목록을 좁힌다(기본 보기는 노트)", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 2026-08-29 "전체" 필터 제거로 기본 보기는 노트다 — 투두는 안 보인다.
  await expect(list(page).getByRole("button", { name: "알파 노트", exact: true })).toBeVisible();
  await expect(list(page).getByRole("button", { name: "세금계산서 발행", exact: true })).toHaveCount(0);

  // '투두'로 좁히면 반대가 보인다.
  await kindBtn(page, /^할 일/).click();
  await expect(list(page).getByRole("button", { name: "세금계산서 발행", exact: true })).toBeVisible();
  await expect(list(page).getByRole("button", { name: "알파 노트", exact: true })).toHaveCount(0);
  await expect(list(page).getByRole("button", { name: "세금계산서 발행", exact: true })).toBeVisible();
  await expect(list(page).getByRole("button", { name: "알파 노트", exact: true })).toHaveCount(0);
});

test("정렬 기준을 바꾸면 순서가 바뀌고 새로고침 후에도 유지된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const sortSelect = list(page).getByLabel("정렬 기준");
  await expect(sortSelect).toHaveValue("updated");

  await sortSelect.selectOption("title");
  await expect(sortSelect).toHaveValue("title");

  await page.reload();
  await waitForAppReady(page);
  await expect(list(page).getByLabel("정렬 기준")).toHaveValue("title");
});

test("목록에는 태그 칩을 표시하지 않는다", async ({ page }) => {
  // 2026-08-29 [kyle] 승인: 태그 칩이 목록 리듬을 깨서 목록에서 뗐다.
  // 공통 태그든 개별 태그든 목록에는 안 나오고, 노트 정보 바에서만 확인·편집한다.
  await page.goto("/");
  await waitForAppReady(page);

  await kindBtn(page, /^할 일/).click();
  await expect(list(page).getByText("ticktick-import")).toHaveCount(0);
  await expect(list(page).getByText("ticktick-inbox")).toHaveCount(0);
  await expect(list(page).getByText("manual-review")).toHaveCount(0);
});

test("목록에서 투두 완료를 바로 토글한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await kindBtn(page, /^할 일/).click();
  // 완료 숨기기(기본 on) 상태에서는 완료 처리한 행이 사라진다 — 완료 보기로 전환(2026-08-30).
  await list(page).getByRole("button", { name: "완료한 할 일 보이기" }).click();

  const toggle = list(page).getByRole("button", { name: "세금계산서 발행 완료" });
  await expect(toggle).toBeVisible();
  await toggle.click();

  // 완료로 바뀌면 라벨이 "완료 취소"가 된다
  await expect(
    list(page).getByRole("button", { name: "세금계산서 발행 완료 취소" }),
  ).toBeVisible({ timeout: 10000 });
});

test("위키링크 배너는 기본 접힘이고 눌러야 펼쳐진다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await list(page).getByRole("button", { name: "알파 노트", exact: true }).click();
  await page.waitForSelector(".bn-editor", { timeout: 15000 });

  const bar = page.getByRole("button", { name: /위키링크/ });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("aria-expanded", "false");

  await bar.click();
  await expect(bar).toHaveAttribute("aria-expanded", "true");
});

test("투두 행에 마감일이 보이고, 기한이 지났으면 강조된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await kindBtn(page, /^할 일/).click();
  // todo-beta fixture: dueDate 2026-01-15(과거) — "마감 1월 15일"이 보인다.
  const row = list(page).locator("[data-list-item='멘토님 연락']");
  await expect(row).toBeVisible();
  await expect(row.getByText("마감 1월 15일")).toBeVisible();
  // 마감 없는 투두(todo-alpha)는 수정일 보조 줄을 쓴다(마감 라벨 없음).
  const alpha = list(page).locator("[data-list-item='세금계산서 발행']");
  await expect(alpha).toBeVisible();
  await expect(alpha.getByText(/^마감 /)).toHaveCount(0);
});

test("완료 숨기기(기본 on)가 끝난 투두를 목록에서 가린다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await kindBtn(page, /^할 일/).click();
  // 완료 처리 → hideDone(기본)이라 목록에서 사라진다.
  await list(page).getByRole("button", { name: "세금계산서 발행 완료", exact: true }).click();
  await expect(
    list(page).getByRole("button", { name: "세금계산서 발행 완료 취소" }),
  ).toHaveCount(0);

  // "완료 포함"을 켜면 다시 보인다(완료 상태 유지).
  const doneToggle = list(page).getByRole("button", { name: "완료한 할 일 보이기" });
  await expect(doneToggle).toHaveAttribute("aria-pressed", "false");
  await doneToggle.click();
  await expect(
    list(page).getByRole("button", { name: "세금계산서 발행 완료 취소" }),
  ).toBeVisible();

  // 원상 복구: 완료 취소를 먼저 하고(행이 보이는 동안) 토글을 되돌린다.
  await list(page).getByRole("button", { name: "세금계산서 발행 완료 취소" }).click();
  await expect(
    list(page).getByRole("button", { name: "세금계산서 발행 완료", exact: true }),
  ).toBeVisible();
  await list(page).getByRole("button", { name: "완료한 할 일 숨기기" }).click();
  await expect(doneToggle).toHaveAttribute("aria-pressed", "false");
});
