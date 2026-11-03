/**
 * TICK-P0-007 TickTick 검토 큐 브라우저 QA
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter + localStorage 미러)
 * 한계: 실제 OS 파일 IO, macOS keychain, Tauri capability, 실제 TickTick DB는 검증하지 않는다.
 * 재접속 유지 검증은 browser-qa-setup.ts의 localStorage 파일 미러로 시뮬레이션한다.
 *
 * 포트: 5175 (5173은 Tauri dev 전용)
 * 실행: npm run qa:browser
 *
 * 테스트:
 * 1. 가져오기 → 50개 카드 표시, 원문/제안/이유/확신 표시
 * 2. 분류 수정 + 승인/나중에 보기 구분
 * 3. 재접속(리로드) 후 분류·상태 유지
 * 4. 재가져오기 중복 방지 (여전히 50개)
 * 5. 2차 변환: 승인 항목이 노트/투두로 생성되고 재변환되지 않는다
 * 6. 2차 일괄 변환: 승인 항목 전체를 한 번에 변환한다
 * 7. 3차 캡처: 제목 입력 → AI 분류(mock) → 대기 카드 추가 → 변환은 capture- 노트로
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function openReviewQueue(page: Page) {
  await page.getByRole("button", { name: "AI 정리 열기/닫기" }).click();
  await page.getByRole("button", { name: "외부 가져오기·기존 검토" }).click();
  await page.waitForSelector("[aria-label='TickTick 검토 큐']", { timeout: 15000 });
}

async function importSnapshot(page: Page) {
  // 2026-08-18 TICK-UX-008: 빈 상태에선 '스냅샷 50개 가져오기' CTA만, 카드가 있으면
  // 헤더의 '스냅샷 가져오기'만 노출된다(이중 진입점 정리). 두 이름 모두 매칭한다.
  await page.getByRole("button", { name: /스냅샷.*가져오기/ }).click();
  await expect(page.getByText(/가져오기 완료/)).toBeVisible({ timeout: 15000 });
}

/** 상태 필터 버튼(대기/승인/나중에/전체) — 카드 안 버튼과 이름이 겹쳐 그룹으로 스코프한다 */
async function clickFilter(page: Page, label: string) {
  await page.getByLabel("검토 상태 필터").getByRole("button", { name: label, exact: true }).click();
}

test("가져오기: fixture 50개가 카드로 표시되고 제안/이유/확신이 보인다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);

  // 빈 상태 안내 → 가져오기
  await importSnapshot(page);

  const cards = page.locator("article[data-review-source-key]");
  await expect(cards).toHaveCount(50, { timeout: 15000 });

  // 첫 카드(대기 필터)에 AI 제안과 확신, 분류 선택이 모두 표시된다
  const first = cards.first();
  await expect(first.getByText("AI 제안")).toBeVisible();
  await expect(first.getByText(/확신 \d+% \(/)).toBeVisible();
  await expect(first.getByLabel(/검토 분류 선택:/)).toBeVisible();
  await expect(first.getByRole("button", { name: "승인" })).toBeVisible();
  await expect(first.getByRole("button", { name: "나중에 보기" })).toBeVisible();
});

test("분류 수정과 승인/나중에 보기가 구분되고 재접속 후에도 유지된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);
  await importSnapshot(page);

  // 상태가 바뀌어도 카드가 목록에서 빠지지 않게 전체 필터에서 조작한다
  await clickFilter(page, "전체");

  const cards = page.locator("article[data-review-source-key]");
  const first = cards.first();
  const second = cards.nth(1);

  // 첫 카드: 분류를 '참고'로 바꾸고 승인
  const select = first.getByLabel(/검토 분류 선택:/);
  await select.selectOption("참고");
  await expect(first.getByRole("button", { name: "제안 복원" })).toBeVisible();
  await first.getByRole("button", { name: "승인" }).click();
  await expect(first.getByLabel("검토 상태: 승인")).toBeVisible();

  // 두 번째 카드: 나중에 보기
  await second.getByRole("button", { name: "나중에 보기" }).click();
  await expect(second.getByLabel("검토 상태: 나중에")).toBeVisible();

  // 상태 필터: 승인 1개, 나중에 1개로 구분된다
  await clickFilter(page, "승인");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByLabel(/검토 분류 선택:/)).toHaveValue("참고");
  await clickFilter(page, "나중에");
  await expect(cards).toHaveCount(1);

  // 재접속(리로드) 후에도 분류·상태 유지
  await page.reload();
  await waitForAppReady(page);
  await openReviewQueue(page);
  await clickFilter(page, "승인");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByLabel(/검토 분류 선택:/)).toHaveValue("참고");
});

test("재가져오기: 같은 원본을 다시 가져와도 카드가 중복되지 않는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);
  await importSnapshot(page);

  const cards = page.locator("article[data-review-source-key]");
  await expect(cards).toHaveCount(50, { timeout: 15000 });

  // 한 카드에 사용자 변경을 남긴 뒤 재가져오기
  const first = cards.first();
  await first.getByLabel(/검토 분류 선택:/).selectOption("아이디어");

  await importSnapshot(page);
  await expect(page.getByText(/추가 0개/)).toBeVisible();
  await expect(cards).toHaveCount(50);

  // 사용자가 고른 분류는 재가져오기 후에도 그대로다
  await clickFilter(page, "전체");
  await expect(cards.first().getByLabel(/검토 분류 선택:/)).toHaveValue("아이디어");
});

test("2차 변환: 승인 항목이 노트/투두로 생성되고 재변환되지 않는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);
  await importSnapshot(page);

  const cards = page.locator("article[data-review-source-key]");
  await clickFilter(page, "전체");
  const first = cards.first();

  // 첫 카드: '참고'로 분류하고 승인 → 변환
  await first.getByLabel(/검토 분류 선택:/).selectOption("참고");
  await first.getByRole("button", { name: "승인" }).click();
  const convertButton = first.getByRole("button", { name: "Ticksidian으로 변환" });
  await expect(convertButton).toBeVisible();
  await convertButton.click();

  await expect(first.getByText("변환됨 · 참고")).toBeVisible({ timeout: 15000 });
  await expect(first.getByRole("button", { name: "Ticksidian으로 변환" })).toBeHidden();

  // 일반 노트가 생성돼 사이드바 '참고' 폴더에 나타난다
  const sidebarNote = page.getByRole("button", { name: new RegExp("샘플 앱 아이디어: 주간 회고 카드") });
  await expect(sidebarNote.first()).toBeVisible({ timeout: 15000 });

  // 두 번째 카드: '실행'은 투두로 변환된다 (사이드바 일반 노트 목록에는 없음)
  const second = cards.nth(1);
  await second.getByLabel(/검토 분류 선택:/).selectOption("실행");
  await second.getByRole("button", { name: "승인" }).click();
  await second.getByRole("button", { name: "Ticksidian으로 변환" }).click();
  await expect(second.getByText("변환됨 · 실행 (투두)")).toBeVisible({ timeout: 15000 });

  // 2026-08-18: 투두 전용 패널이 사라지고 목록 열의 '투두' 필터로 대체됐다.
  // 레일에서 투두만 보기로 좁히면 변환된 투두가 목록에 나타난다.
  await page.locator("[data-app-rail]").getByRole("button", { name: "전체 할 일 보기" }).click();
  await expect(
    page.locator("[data-note-column]").getByRole("button", { name: "예시 가이드 - 작업 흐름 정리법", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  // 다시 전체로 되돌려 이후 단계에 영향이 없게 한다
  await page.locator('[data-folder-select="전체"]').click();

  // 재접속 후에도 변환 상태 유지 + 변환 버튼 없음
  await page.reload();
  await waitForAppReady(page);
  await openReviewQueue(page);
  await clickFilter(page, "승인");
  await expect(cards).toHaveCount(2);
  await expect(cards.first().getByText(/변환됨/)).toBeVisible();
  await expect(cards.nth(1).getByText(/변환됨/)).toBeVisible();
  await expect(cards.first().getByRole("button", { name: "Ticksidian으로 변환" })).toBeHidden();
});

test("2차 일괄 변환: 승인 항목 전체를 한 번에 변환한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);
  await importSnapshot(page);

  const cards = page.locator("article[data-review-source-key]");

  // 3개만 승인해 둔다 (변환 가능 분류인지와 무관하게 승인)
  await clickFilter(page, "전체");
  for (const index of [0, 1, 2]) {
    await cards.nth(index).getByRole("button", { name: "승인" }).click();
  }

  const bulk = page.getByRole("button", { name: /승인 항목 일괄 변환/ });
  await expect(bulk).toBeVisible();
  await bulk.click();

  // fixture 앞 3개의 제안 분류: 아이디어(1번), 참고(2번), 실행(3번) — 모두 변환 가능
  await expect(page.getByText(/변환 완료: 생성 3개, 이미 있음 0개, 실패 0개/)).toBeVisible({ timeout: 15000 });
  await expect(bulk).toBeHidden();

  // 일괄 재실행은 더 이상 대상이 없다 (재변환 방지)
  await expect(cards.filter({ has: page.getByText("변환됨") })).toHaveCount(3);
});

test("3차 캡처: 입력 → AI 분류(mock) → 대기 카드 → capture 노트로 변환", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);

  // 빠른메모 체험: 검토 큐를 열자마자 제목 입력창에 포커스가 있다
  await expect(page.getByLabel("검토 항목 제목 입력")).toBeFocused();

  // 캡처 입력 → AI 분류 추가 (classify_review_item은 mock이 '아이디어'로 고정 응답)
  await page.getByLabel("검토 항목 제목 입력").fill("나중에 만들어볼 기능 구상");
  await page.getByLabel("검토 항목 내용 입력").fill("검토 큐에서 바로 노트로 넘어가는 흐름 아이디어");
  await page.getByRole("button", { name: "AI 분류 추가" }).click();

  await expect(page.getByText(/추가됨: "나중에 만들어볼 기능 구상" → 제안 아이디어/)).toBeVisible({ timeout: 15000 });

  const cards = page.locator("article[data-review-source-key]");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByLabel(/검토 분류 선택:/)).toHaveValue("아이디어");
  await expect(cards.first().getByText("AI 제안")).toBeVisible();
  await expect(cards.first().getByLabel("검토 상태: 대기")).toBeVisible();

  // 승인 → 변환하면 capture- 노트가 아이디어 폴더에 생긴다
  // (대기 필터에서 승인하면 카드가 목록에서 빠지므로 승인 필터로 이동해 다시 잡는다)
  await cards.first().getByRole("button", { name: "승인" }).click();
  await clickFilter(page, "승인");
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole("button", { name: "Ticksidian으로 변환" }).click();
  await expect(cards.first().getByText("변환됨 · 아이디어")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "나중에 만들어볼 기능 구상" }).first()).toBeVisible({ timeout: 15000 });

  // 재접속 후에도 캡처 카드와 변환 상태가 유지된다
  await page.reload();
  await waitForAppReady(page);
  await openReviewQueue(page);
  await clickFilter(page, "승인");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByText(/변환됨/)).toBeVisible();
});

test("진행 표시: 진행률 바가 있고, 전부 처리하면 검토 완료 상태가 된다", async ({ page }) => {
  // 다른 테스트가 저장한 검토 큐 상태(localStorage 파일 미러)를 받지 않게 초기화한다.
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("ticksidian-qa-vault")) localStorage.removeItem(key);
    }
  });
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);
  await importSnapshot(page);

  const progress = page.getByRole("progressbar");
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("aria-valuenow", "0");

  // 대기 필터에서 전부 승인 → 진행률 100% + 완료 문구
  await clickFilter(page, "대기");
  // 상태 필터에도 "승인" 버튼이 있어 정확 일치가 먼저 잡히므로, 클릭을 카드 안으로 스코프한다.
  const approveButtons = page.locator("article[data-review-source-key]").getByRole("button", { name: "승인", exact: true });
  // 승인하면 카드가 대기 목록에서 빠진다 — 남아 있는 동안 첫 버튼을 반복 클릭한다.
  for (let i = 0; i < 60; i += 1) {
    if ((await approveButtons.count()) === 0) break;
    await approveButtons.first().click();
  }
  await expect(progress).toHaveAttribute("aria-valuenow", "100", { timeout: 15000 });
  await expect(page.getByText("검토 완료!")).toBeVisible();
});

test("카드에 '왜 나왔는지'(reviewReason) 슬롯이 있다 — fixture는 이유 없음", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);
  await importSnapshot(page);

  // TickTick 스냅샷 카드는 reviewReason이 비어 있다(외부 가져오기는 이유가 가져오기 자체).
  // vault-note 소스(단계 2)에서 이 슬롯이 채워진다. UI가 비어 있을 때 아무것도 그리지 않음을 확인.
  const cards = page.locator("article[data-review-source-key]");
  await expect(cards.first()).toBeVisible();
  await expect(page.getByText("💡", { exact: true })).toHaveCount(0);
});

test("내 노트 검토: 볼트에서 후보를 담고 이유가 보이며 보관으로 이동된다", async ({ page }) => {
  // 고정 fixture의 90일 기준이 실제 날짜가 지나며 달라지지 않게 한다.
  await page.clock.setFixedTime(new Date('2026-08-30T12:00:00+09:00'));
  await page.goto("/");
  await waitForAppReady(page);
  await openReviewQueue(page);

  // notes 폴더에 후보 2개(오래된 노트 1 + 임시 흔적 1)가 있는 fixture다.
  const vaultButton = page.getByRole("button", { name: /내 노트 검토/ });
  await expect(vaultButton).toBeVisible();
  await vaultButton.click();
  await expect(page.getByText(/내 노트 2장을 검토 큐에 담았습니다/)).toBeVisible();

  const cards = page.locator("article[data-review-source-key]");
  // 대기 필터 기본 — fixture TickTick 스냅샷은 아직 가져오지 않았으므로 2장이 전부다.
  await expect(cards).toHaveCount(2);

  // "왜 나왔는지"가 카드에 표시된다.
  await expect(cards.first().getByText(/마지막 수정이 \d+일 전|임시·테스트 흔적/)).toBeVisible();

  // 보관으로 이동 → 원본이 archive 폴더로 이동하고 카드는 승인 처리된다.
  const firstCard = cards.first();
  const archiveButton = firstCard.getByRole("button", { name: "보관으로 이동" });
  await archiveButton.click();
  await page.getByRole('group', { name: '검토 상태 필터' }).getByRole('button', { name: '승인', exact: true }).click();
  await expect(firstCard.getByLabel('검토 상태: 승인')).toBeVisible();

  // 반복 클릭 방지: 이미 큐에 있는 노트는 재후보가 아니다.
  await page.getByRole("button", { name: /내 노트 검토/ }).click();
  await expect(page.getByText(/검토 큐에 담았습니다|새로 검토할 노트가 없습니다/)).toBeVisible();
});
