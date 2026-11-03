/**
 * TICK-P1-016 브라우저 클릭 QA 1차 테스트
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 한계: 실제 OS 파일 IO, macOS keychain, Tauri capability는 검증하지 않는다.
 *
 * 포트: 5175 (5173은 Tauri dev 전용)
 * 실행: npm run qa:browser
 *
 * 테스트 3개:
 * 1. 검색: seed 노트 제목/별칭 검색 → 결과 클릭 → 에디터 영역에 해당 노트 열림
 * 2. 외부 수정 충돌 배너: 노트 열고 타이핑(dirty) → "외부" 파일 변경 → 배너 노출 → 불러오기
 * 3. 모달 접근성: 미저장 상태에서 볼트 변경 → RiskyVaultSwitchDialog Esc 닫기 + 포커스 복귀
 */

import { test, expect, type Page } from "@playwright/test";

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * 앱이 노트 목록 화면까지 완전히 로드될 때까지 대기.
 * 검색 input이 보이면 준비 완료.
 */
async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  // 에디터 자체 로딩이 끝날 여유
  await page.waitForTimeout(1000);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

/**
 * 사이드바 목록에서 특정 제목의 노트 버튼을 클릭해 에디터에 연다.
 * NoteEditor는 Suspense lazy load라 내부 스피너가 빠진 뒤를 기다린다.
 */
async function openNoteByTitle(page: Page, title: string) {
  // 사이드바 노트 버튼 — NoteListItem 버튼에 텍스트가 포함됨
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  // NoteEditor 로딩 완료: 로딩 중... 문구가 없어야 하고, 에디터 root div가 나타나야 한다
  await page.waitForSelector(".bn-editor", { timeout: 15000 });
  await page.waitForTimeout(500);
}

// ── 테스트 1: 검색 ─────────────────────────────────────────────────────────

test("검색: 별칭으로 노트 검색 후 클릭하면 해당 노트가 에디터에 열린다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 검색 입력창에 별칭 입력
  await page.getByRole("button", { name: "검색 열기", exact: true }).click();
  const searchInput = page.getByLabel("노트 검색");
  await searchInput.click();
  await searchInput.fill("alpha");

  // 검색 결과 목록이 나타날 때까지 대기 (150ms 디바운스 있음)
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });

  // "알파 노트" 결과가 보이는지 확인
  const hit = page.getByRole("option", { name: /알파 노트/ });
  await expect(hit).toBeVisible({ timeout: 5000 });

  // 클릭
  await hit.click();

  // BlockNote 에디터 안에 "알파 노트" 텍스트가 렌더됐는지 확인
  // (노트 본문의 # 알파 노트 헤딩이 블록으로 렌더됨)
  await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 10000 });

  // 에디터 영역에서 "알파 노트" 텍스트가 보이는지 확인
  const editorArea = page.locator(".bn-editor");
  await expect(editorArea).toContainText("알파 노트", { timeout: 8000 });

  // 검색창 쿼리가 초기화됐는지 (onSelectHit 후 setQuery("") 호출)
  await expect(searchInput).toHaveCount(0);
});

// ── 테스트 2: 외부 수정 자동 재로드 ────────────────────────────────────────
//
// 설계 근거:
// - useNoteEditor 폴링(3초)은 2-pass 구조다.
//   1차 폴링: baseline 설정(lastKnown = 현재 mtime)
//   2차 폴링: 외부 수정 감지 → reload(미저장 변경 없으면 자동 재로드)
// - 미저장 변경 없는 상태에서 외부 수정 → "reload" 경로 → 자동 재로드 + notice 텍스트.
// - 이 경로가 브라우저 fixture에서 가장 안정적으로 재현된다.
//   (배너 경로는 타이핑→1초 자동저장→dirty 소멸 타이밍이 불안정)

test("외부 수정 자동 재로드: 로컬 변경 없는 상태에서 mock 파일 변경 → 자동 재로드 + 내용 반영", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // "감마 노트"를 노트 목록에서 클릭해 에디터에 열기
  await openNoteByTitle(page, "감마 노트");

  // 에디터가 완전히 로드되고 첫 폴링 baseline 설정 대기
  // 폴링 1차(3초)가 set-baseline을 하려면 isLoading=false 이후 3초 이상 필요
  await page.waitForTimeout(4000);

  // 외부 파일 변경 시뮬레이션 — baseline 설정 이후 주입해야 "더 새 mtime" 조건 성립
  const gammaPath = "/mock-vault/notes/note-gamma.md";
  await page.evaluate((path) => {
    return (window as Window & {
      __qa_simulateExternalEdit?: (path: string, content: string) => Promise<void>;
    }).__qa_simulateExternalEdit?.(
      path,
      [
        "---",
        'id: "note-gamma"',
        "aliases: []",
        'updatedAt: "2026-06-10T12:00:00.000Z"',
        "---",
        "# 감마 노트",
        "",
        "외부에서 수정된 내용입니다.",
        "",
      ].join("\n"),
    );
  }, gammaPath);

  // 폴링 2차(최대 3초 + 여유)에서 reload 감지 → 자동 재로드
  // "외부 수정이 감지되어 최신 파일 내용으로 다시 불러왔습니다." notice 표시
  await page.waitForSelector(
    "text=외부 수정이 감지되어 최신 파일 내용으로 다시 불러왔습니다",
    { timeout: 10000 },
  );

  // 에디터에 외부 변경 내용이 반영됐는지 확인
  await expect(page.locator(".bn-editor")).toContainText("외부에서 수정된 내용", {
    timeout: 5000,
  });
});

// ── 테스트 3: 모달 접근성 ─────────────────────────────────────────────────

test("모달 접근성: 위험한 볼트 전환 모달 — Esc로 닫기 + 포커스 복귀", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 감마 노트를 열어 에디터에 로드
  await openNoteByTitle(page, "감마 노트");

  // 에디터에 타이핑해서 dirty 상태로 만들기
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" dirty");

  // dirty 상태가 App으로 전파되길 대기 (onDirtyChange 경로)
  await page.waitForTimeout(800);

  // "볼트 변경" 버튼을 포커스하고 기억
  // 2026-08-18 3열 레이아웃: 사이드바 하단 → 아이콘 레일로 옮겨져 라벨이 바뀌었다.
  const vaultBtn = page.getByRole("button", { name: "볼트 폴더 변경/재선택" });
  await expect(vaultBtn).toBeVisible({ timeout: 5000 });
  await vaultBtn.focus();

  // 클릭 → dirty 상태이므로 RiskyVaultSwitchDialog 모달이 떠야 한다
  await vaultBtn.click();

  // 모달 제목이 보이는지 확인
  await expect(
    page.getByRole("dialog", { name: "볼트 전환 확인" }),
  ).toBeVisible({ timeout: 5000 });

  // 모달 안에 사유 텍스트 확인
  await expect(
    page.locator("text=저장되지 않은 변경이 있습니다"),
  ).toBeVisible({ timeout: 3000 });

  // Esc 키 누르기
  await page.keyboard.press("Escape");

  // 모달이 닫혔는지 확인
  await expect(
    page.getByRole("dialog", { name: "볼트 전환 확인" }),
  ).not.toBeVisible({ timeout: 3000 });

  // 포커스가 볼트 변경 버튼(트리거)으로 복귀했는지 확인
  await expect(vaultBtn).toBeFocused({ timeout: 3000 });
});

// ── 테스트 4: RAG 전체 검색 모드 ───────────────────────────────────────────
//
// mockIPC에서 rag_index_status/rag_search를 고정 응답으로 처리하므로
// 실제 Rust+Gemini 임베딩은 검증하지 않는다 (브라우저 fixture 한계).

test("RAG 검색: 전체 검색 모드에서 mock 결과 표시 + 클릭 시 노트 열림", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // 검색 입력 옆 범위 선택으로 전체 검색 전환.
  await page.getByRole("button", { name: "검색 열기", exact: true }).click();
  await page.getByRole("combobox", { name: "검색 범위" }).selectOption("rag");

  // RAG 인덱스 상태 안내가 보이는지 (mock: 준비됨)
  await expect(page.locator("text=AI 검색 준비됨")).toBeVisible({ timeout: 5000 });

  // RAG 검색 입력창 (aria-label="전체 검색")
  const ragInput = page.getByLabel("전체 검색");
  await ragInput.fill("인증 자동화");

  // mock 결과가 나올 때까지 대기 (400ms 디바운스 + 검색)
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });

  // mock 결과 1번(알파 노트)이 보이는지 확인
  const ragHit = page.getByRole("option", { name: /알파 노트/ });
  await expect(ragHit).toBeVisible({ timeout: 5000 });

  // 소스 배지(FTS/벡터) 표시 확인
  await expect(page.locator("text=본문 일치")).toBeVisible({ timeout: 3000 });

  // 결과 클릭 → 에디터에 해당 노트 열림
  await ragHit.click();
  await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".bn-editor")).toContainText("알파 노트", { timeout: 8000 });
});

// ── 테스트 4: 문서 제목(첫 헤딩) 백스페이스 강등 방지 (2026-08-15 [kyle] 요청) ──

test("제목 보호: 제목을 다 지우고 백스페이스를 눌러도 헤딩이 유지된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openNoteByTitle(page, "알파 노트");

  // 첫 헤딩 블록(# 알파 노트)을 트리플 클릭으로 선택해 텍스트를 지운다
  const heading = page.locator('.bn-editor [data-content-type="heading"]').first();
  await expect(heading).toBeVisible({ timeout: 15000 });
  await heading.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");

  // 빈 헤딩에서 백스페이스를 한 번 더 눌러도(강등 시도) 헤딩 블록이 유지된다
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(
    page.locator('.bn-editor [data-content-type="heading"]').first(),
  ).toBeVisible({ timeout: 5000 });

  // 본문(두 번째 블록)은 그대로다 — 첫 블록이 문단으로 강등돼 병합되지 않았음
  await expect(page.locator(".bn-editor")).toContainText("브라우저 QA 테스트용 첫 번째 노트입니다.");
});

// ── 테스트 6: 외부 읽기 실패 중 원본 보호와 작성본 보관 ─────
// 기존 F1은 배너 없이 저장만 막히던 결함이다. 이제 배너와 복구본을 제공하며,
// 읽지 못한 외부 파일에 자동 저장을 재개하지 않는다(2026-10-07 정책 대체).
// 외부 수정 감지 → 읽기 강제 실패 → 새 입력을 재현하여 양쪽 글 보존을 검사한다.

test("외부 재로드 실패 시 원본은 보호하고 새 입력은 복구본에 보관한다 (F1 후속)", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openNoteByTitle(page, "감마 노트");

  // 폴링 1차(baseline 설정) 대기
  await page.waitForTimeout(4000);

  const gammaPath = "/mock-vault/notes/note-gamma.md";

  // 다음 읽기 1회를 실패시킨 뒤 외부 수정을 넣는다 →
  // 폴러가 reload로 판정하고 loadNoteFromDisk가 읽기에서 실패한다.
  await page.evaluate((path) => {
    (window as Window & { __qa_failNextReads?: (p: string, c: number) => void })
      .__qa_failNextReads?.(path, 1);
  }, gammaPath);

  await page.evaluate((path) => {
    return (window as Window & {
      __qa_simulateExternalEdit?: (p: string, content: string) => Promise<void>;
    }).__qa_simulateExternalEdit?.(
      path,
      [
        "---",
        'id: "note-gamma"',
        "aliases: []",
        'updatedAt: "2026-08-16T00:00:00.000Z"',
        "---",
        "# 감마 노트",
        "",
        "재로드가 실패할 외부 수정입니다.",
        "",
      ].join("\n"),
    );
  }, gammaPath);

  // 재로드 실패 안내가 뜰 때까지 대기(폴링 3초 + 여유)
  await page.waitForSelector("text=노트를 불러오는데 실패했습니다", { timeout: 12000 });

  // 새 입력은 받아 복구본에 보관하되, 읽지 못한 외부 파일은 그대로 둔다.
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("재로드 실패 후 입력");
  await expect(page.getByText('파일이 외부에서 수정되었습니다', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(p => localStorage.getItem('ticksidian.note-recovery.v1.active.' + encodeURIComponent(p)), gammaPath)).toContain('재로드 실패 후 입력');
  const saved = await page.evaluate(p => (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> }).__qa_readVaultFile(p), gammaPath);
  expect(saved).toContain('재로드가 실패할 외부 수정입니다.');
  expect(saved).not.toContain('재로드 실패 후 입력');

});
