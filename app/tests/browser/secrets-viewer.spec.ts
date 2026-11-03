/**
 * 보안 메모 뷰어 브라우저 QA (2026-08-15)
 *
 * 분류: 브라우저 fixture QA (mockIPC)
 * 한계: 실제 비밀 폴더 파일 접근/권한·네이티브 폴더 선택 창은 검증하지 않는다(Rust command 경계).
 *
 * 테스트:
 * 1. 폴더 트리: 기본 접힘 + 펼치기/접기 + 필터 경로 매칭(TICK-SEC-001)
 * 2. env 파일: 키는 보이고 값은 가려짐 → 토글로 표시
 * 3. pem 파일: 전체 가림 → 토글로 표시
 * 4. 새 메모 추가 — 존재 거부 + 성공(TICK-SEC-002)
 * 5. 수정 버튼 → 백업 생성 → 편집 → 저장(TICK-SEC-002)
 * 6. 편집 중 외부 변경 감지 — mtime 불일치 거부 후 재시도(TICK-SEC-002)
 * 7. Finder에서 보기 버튼(TICK-SEC-002)
 * 8. 비밀 폴더 미설정 안내 → 고른 뒤 목록(2026-11-02)
 */

import { test, expect } from "@playwright/test";

async function waitForAppReady(page: import("@playwright/test").Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function openSecretsViewer(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /보안 메모 열기\/닫기/ }).click();
  await page.waitForSelector("[aria-label='보안 메모']", { timeout: 15000 });
}

test("보안 메모: 폴더 트리 — 기본 접힘, 펼치기, 필터 경로 매칭", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openSecretsViewer(page);

  // 폴더는 보이지만 기본은 접혀 있다 — 폴더 안 파일 버튼이 바로 보이지 않는다
  await expect(page.getByRole("button", { name: "aws 폴더 펼치기" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "gemini 폴더 펼치기" })).toBeVisible();
  await expect(page.getByRole("button", { name: /notion\.env/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /aws\/test-key\.pem/ })).toBeHidden();

  // 폴더를 펼치면 파일이 보인다
  await page.getByRole("button", { name: "aws 폴더 펼치기" }).click();
  await expect(page.getByRole("button", { name: "aws 폴더 접기" })).toBeVisible();
  await expect(page.getByRole("button", { name: /aws\/test-key\.pem/ })).toBeVisible();

  // 접으면 다시 숨는다
  await page.getByRole("button", { name: "aws 폴더 접기" }).click();
  await expect(page.getByRole("button", { name: /aws\/test-key\.pem/ })).toBeHidden();

  // 필터: 경로가 걸리는 폴더는 자동으로 펼쳐 결과를 바로 보여준다
  const filter = page.getByLabel("보안 메모 경로 필터");
  await filter.fill("gemini");
  await expect(page.getByRole("button", { name: /gemini\/projects\/memory-core\.env/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /aws\/test-key\.pem/ })).toBeHidden();
  await expect(page.getByRole("button", { name: /notion\.env/ })).toBeHidden();

  // 필터를 지우면 필터가 강제로 펼친 폴더는 다시 접힌다
  await filter.fill("");
  await expect(page.getByRole("button", { name: /gemini\/projects\/memory-core\.env/ })).toBeHidden();
});

test("보안 메모: env 파일은 키만 보이고 값은 가렸다가 토글로 표시된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openSecretsViewer(page);

  // 폴더가 접혀 있으므로 필터로 경로를 걸어 펼친 뒤 선택한다
  await page.getByLabel("보안 메모 경로 필터").fill("memory-core");
  await page.getByRole("button", { name: /gemini\/projects\/memory-core\.env/ }).click();

  // 키는 보인다
  await expect(page.getByText("GEMINI_API_KEY=").first()).toBeVisible({ timeout: 15000 });
  // 값은 가려진다 — 실제 값 문자열이 화면에 없어야 한다
  await expect(page.getByText("fake-key-for-qa")).toHaveCount(0);
  await expect(page.locator("[data-secret-file-path] ~ div span").filter({ hasText: /^•+$/ }).first()).toBeVisible();

  // 토글하면 값이 표시된다
  await page.getByRole("button", { name: "값 표시" }).click();
  await expect(page.getByText("fake-key-for-qa")).toBeVisible();
  await expect(page.getByRole("button", { name: "값 가리기" })).toBeVisible();
});

test("보안 메모: pem 파일은 전체가 가려진다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openSecretsViewer(page);

  await page.getByRole("button", { name: "aws 폴더 펼치기" }).click();
  await page.getByRole("button", { name: /aws\/test-key\.pem/ }).click();

  // 본문 전체가 가려진다 — 실제 pem 내용이 화면에 없어야 한다
  await expect(page.getByText("fakekeybodyline1")).toHaveCount(0);
  await expect(page.locator("h3[data-secret-file-path='aws/test-key.pem']")).toBeVisible({ timeout: 15000 });

  // 토글하면 표시된다
  await page.getByRole("button", { name: "값 표시" }).click();
  await expect(page.getByText("fakekeybodyline1")).toBeVisible();
});

test("보안 메모: 새 메모 추가 — 존재하면 거부, 성공하면 목록 갱신+선택", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openSecretsViewer(page);

  await page.getByRole("button", { name: "+ 새 메모" }).click();

  // 이미 있는 파일명은 거부 — 덮어쓰기 불가
  await page.getByLabel("파일명").fill("notion.env");
  await page.getByLabel("내용").fill("NEW_KEY=abc\n");
  await page.getByRole("button", { name: "만들기" }).click();
  await expect(page.getByText(/이미 존재하는 파일입니다/)).toBeVisible({ timeout: 15000 });

  // 새 파일명으로 만들면 성공 → 읽기 화면(가림)으로 선택된다
  await page.getByLabel("파일명").fill("openai-key.env");
  await page.getByRole("button", { name: "만들기" }).click();
  await expect(page.locator("h3[data-secret-file-path='openai-key.env']")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("NEW_KEY=")).toBeVisible();
  await expect(page.getByText("abc")).toHaveCount(0); // 값은 가려진다
  await expect(page.getByRole("button", { name: "openai-key.env" })).toBeVisible();
});

test("보안 메모: 수정 버튼 → 백업 생성 → 편집 → 저장", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openSecretsViewer(page);

  await page.getByRole("button", { name: "notion.env" }).click();
  await expect(page.locator("h3[data-secret-file-path='notion.env']")).toBeVisible({ timeout: 15000 });

  const backupsBefore = await page.evaluate(() => window.__qa_secretBackups().length);
  await page.getByRole("button", { name: "수정" }).click();

  // 편집 모드: textarea에 평문 원본이 로드된다(진입 시 백업 1개 생성)
  const editor = page.getByLabel("보안 메모 편집 내용");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(/NOTION_TOKEN=fake-notion-token/, { timeout: 15000 });
  const backupsAfter = await page.evaluate(() => window.__qa_secretBackups().length);
  expect(backupsAfter).toBe(backupsBefore + 1);

  await editor.fill("NOTION_TOKEN=rotated-token\n");
  await page.getByRole("button", { name: "저장" }).click();

  // 저장 후 읽기 화면 복귀 — 새 값은 기본 가림
  await expect(page.getByText("NOTION_TOKEN=")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("rotated-token")).toHaveCount(0);
  await page.getByRole("button", { name: "값 표시" }).click();
  await expect(page.getByText("rotated-token")).toBeVisible();
});

test("보안 메모: 편집 중 외부 변경 감지 — mtime 불일치 거부 후 재시도", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openSecretsViewer(page);

  await page.getByRole("button", { name: "notion.env" }).click();
  await page.getByRole("button", { name: "수정" }).click();
  const editor = page.getByLabel("보안 메모 편집 내용");
  await expect(editor).toBeVisible();

  // 열려 있는 사이 외부에서 파일이 바뀐다
  await page.evaluate(() => window.__qa_writeSecretFileExternal("notion.env", "NOTION_TOKEN=external-change\n"));
  await editor.fill("NOTION_TOKEN=my-edit\n");
  await page.getByRole("button", { name: "저장" }).click();

  // 거부 + 경고 — 수정본은 아직 반영되지 않았다
  await expect(page.getByText(/외부에서 바뀌었습니다/)).toBeVisible({ timeout: 15000 });
  await expect(editor).toHaveValue(/NOTION_TOKEN=my-edit/);

  // 새로 불러와 다시 시도 → 외부 변경본이 로드되고, 그 위에 저장된다
  await page.getByRole("button", { name: "새로 불러와 다시 시도" }).click();
  await expect(editor).toHaveValue(/NOTION_TOKEN=external-change/, { timeout: 15000 });
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("NOTION_TOKEN=")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("my-edit")).toHaveCount(0);
  await expect(page.getByText("external-change")).toHaveCount(0); // 읽기 화면 가림
});

test("보안 메모: Finder에서 보기 버튼(Rust 명령 경유)", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await openSecretsViewer(page);

  await page.getByRole("button", { name: "notion.env" }).click();
  await page.getByRole("button", { name: "Finder에서 보기" }).click();
  expect(await page.evaluate(() => window.__qa_revealFinderCalls())).toBe(1);
});

test("보안 메모: 비밀 폴더 미설정이면 선택 안내 → 고른 뒤 목록과 경로 표시", async ({ page }) => {
  await page.goto("/?secretsUnset=1");
  await waitForAppReady(page);
  await openSecretsViewer(page);

  // 미설정: 목록 대신 안내와 선택 버튼만 보인다(앱 시작·다른 화면은 정상)
  await expect(page.getByRole("heading", { name: "비밀 폴더를 고르세요" })).toBeVisible();
  await expect(page.getByRole("button", { name: /notion\.env/ })).toBeHidden();

  // 고르면(Rust 선택 창은 fixture가 대신한다) 같은 뷰어가 목록과 고른 경로를 보여 준다
  await page.getByRole("button", { name: "비밀 폴더 고르기" }).click();
  await expect(page.getByRole("button", { name: /notion\.env/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("secrets-folder-path")).toHaveText("/qa/secrets-folder");
  const calls = await page.evaluate(() =>
    (window as Window & { __qa_secretsSelectCalls?: () => number }).__qa_secretsSelectCalls?.(),
  );
  expect(calls).toBe(1);
});

test("보안 메모: 허용되지 않아 무시된 설정은 이유를 보이고, 버튼 44px·줄바꿈 기준을 지킨다", async ({ page }) => {
  // 열기 버튼은 넓은 창에서 누르고, 같은 화면을 두 폭에서 잰다.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?secretsRejected=1");
  await waitForAppReady(page);
  await openSecretsViewer(page);
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByRole("heading", { name: "비밀 폴더를 고르세요" })).toBeVisible();
    await expect(page.getByTestId("secrets-folder-reason")).toContainText("허용되지 않아 무시했습니다");
    for (const name of ["비밀 폴더 고르기", "닫기"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const wrap = await page.getByTestId("secrets-folder-reason").evaluate((el) => {
      const style = getComputedStyle(el);
      return { wordBreak: style.wordBreak, overflowWrap: style.overflowWrap, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
    });
    expect(wrap.wordBreak).toBe("keep-all");
    expect(wrap.overflowWrap).toBe("break-word");
    expect(wrap.scrollW).toBeLessThanOrEqual(wrap.clientW);
  }
});
