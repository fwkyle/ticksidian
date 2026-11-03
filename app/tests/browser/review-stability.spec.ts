import { test, expect, type Page } from "@playwright/test";

// fixture 검증: 실제 OS 권한/API 호출 증거와 구분한다.
type ProbeWindow = Window & {
  __qa_simulateExternalEdit: (path: string, text: string) => Promise<void>;
  __qa_readVaultFile: (path: string) => Promise<string>;
  __qa_writeVaultFile: (path: string, text: string) => Promise<void>;
  __qa_createVaultDirectory: (path: string) => Promise<void>;
  __qa_failNextReads: (path: string, count: number) => void;
  __releaseClassification?: () => void;
  __classificationDone?: boolean;
  __probeVault?: () => string | null;
  __TAURI_INTERNALS__: { invoke: (cmd: string, ...args: unknown[]) => Promise<unknown> };
};

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("빠른 기록 제목", { exact: true })).toBeVisible();
}

async function legacy(page: Page) {
  await page.getByRole("button", { name: "AI 정리 열기/닫기" }).click();
  await page.getByRole("button", { name: "외부 가져오기·기존 검토" }).click();
}

test("충돌 중 AI 정리 진입은 초안을 버리지 않는다", async ({ page }) => {
  await ready(page);
  await page.locator('[data-folder-select="전체"]').click();
  await page.getByRole("button", { name: "알파 노트", exact: true }).click();
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.insertText("LOCAL-DRAFT-STABILITY");
  await page.evaluate(() => (window as ProbeWindow).__qa_simulateExternalEdit(
    "/mock-vault/notes/note-alpha.md",
    '---\nid: "note-alpha"\n---\n# 알파 노트\n\nEXTERNAL-STABILITY\n',
  ));
  await expect(page.getByText("파일이 외부에서 수정되었습니다", { exact: true })).toBeVisible();
  await expect(editor).toContainText("LOCAL-DRAFT-STABILITY");
  await page.getByRole("button", { name: "AI 정리 열기/닫기" }).click();
  await expect(editor).toContainText("LOCAL-DRAFT-STABILITY");
  expect(await page.evaluate(() => (window as ProbeWindow).__qa_readVaultFile(
    "/mock-vault/notes/note-alpha.md",
  ))).toContain("EXTERNAL-STABILITY");
  await page.getByRole("button", { name: "보안 메모 열기/닫기 — 값은 기본 가림", exact: true }).click();
  await expect(editor).toContainText("LOCAL-DRAFT-STABILITY");
  await page.getByRole("button", { name: "내 변경 유지", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__qa_readVaultFile(
    "/mock-vault/notes/note-alpha.md",
  ))).toContain("LOCAL-DRAFT-STABILITY");
  await page.getByRole("button", { name: "AI 정리 열기/닫기" }).click();
  await expect(page.getByRole("button", { name: "AI 정리 닫기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI 정리 닫기", exact: true }).click();
  await expect(editor).toContainText("LOCAL-DRAFT-STABILITY");
});

test("변환 대상 읽기 실패가 기존 파일 덮어쓰기로 이어지지 않는다", async ({ page }) => {
  await ready(page);
  await legacy(page);
  await page.getByRole("button", { name: /스냅샷.*가져오기/ }).click();
  await expect(page.getByText(/가져오기 완료/)).toBeVisible();
  await page.getByLabel("검토 상태 필터").getByRole("button", { name: "전체", exact: true }).click();
  const card = page.locator("article[data-review-source-key]").first();
  const sourceKey = await card.getAttribute("data-review-source-key");
  await card.getByLabel(/검토 분류 선택:/).selectOption("참고");
  await card.getByRole("button", { name: "승인", exact: true }).click();
  await expect(card.getByLabel("검토 상태: 승인")).toBeVisible();
  const path = await page.evaluate(async (key) => {
    const w = window as ProbeWindow;
    const queue = JSON.parse(await w.__qa_readVaultFile("/mock-vault/.ticksidian-review-queue/queue.json"));
    const item = queue.cards.find((entry: { sourceKey: string }) => entry.sourceKey === key);
    const rulesPath = "/src/lib/review-queue/rules.ts";
    const { noteTargetForCard } = await import(rulesPath);
    const target = noteTargetForCard(item);
    const destination = `/mock-vault/${target.folder}/${target.noteId}.md`;
    await w.__qa_createVaultDirectory(`/mock-vault/${target.folder}`);
    await w.__qa_writeVaultFile(destination, "ORIGINAL-BYTES-PRESERVE");
    w.__qa_failNextReads(destination, 1);
    return destination;
  }, sourceKey);
  await card.getByRole("button", { name: "Ticksidian으로 변환" }).click();
  await expect(card.getByText("변환됨 · 참고")).toBeVisible();
  expect(await page.evaluate((p) => (window as ProbeWindow).__qa_readVaultFile(p), path))
    .toBe("ORIGINAL-BYTES-PRESERVE");
});

test("볼트 A의 느린 AI 결과는 볼트 B에 기록하지 않는다", async ({ page }) => {
  await ready(page);
  await legacy(page);
  await page.evaluate(async () => {
    const w = window as ProbeWindow;
    await w.__qa_createVaultDirectory("/mock-vault-B");
    const modulePath = "/src/lib/tauri-vault-adapter.ts";
    const { tauriVaultAdapter: adapter, setActiveVaultAdapter } = await import(modulePath);
    const keys = ["kind", "registerVaultPath", "getVaultPath", "setVaultPath", "createDirectory", "readTextFile", "writeTextFile", "readBinaryFile", "writeBinaryFile", "deleteFile", "renameDirectory", "trashDirectory", "listDirectoryEntries", "getFileStat"];
    const register = adapter.registerVaultPath;
    setActiveVaultAdapter({
      ...Object.fromEntries(keys.map((key) => [key, adapter[key]])),
      selectVaultFolder: async () => "/mock-vault-B",
      registerVaultPath: async (path: string) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await register(path);
      },
    });
    w.__probeVault = () => adapter.getVaultPath();
    const invoke = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
    w.__TAURI_INTERNALS__.invoke = async (cmd, ...args) => {
      if (cmd === "classify_review_item") await new Promise<void>((resolve) => { w.__releaseClassification = resolve; });
      const result = await invoke(cmd, ...args);
      if (cmd === "classify_review_item") w.__classificationDone = true;
      return result;
    };
  });
  await page.getByLabel("검토 항목 제목 입력").fill("VAULT-A-ONLY-STABILITY");
  await page.getByRole("button", { name: "AI 분류 추가" }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as ProbeWindow).__releaseClassification)).toBe("function");
  await page.getByRole("button", { name: "볼트 폴더 변경/재선택" }).click();
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__probeVault?.())).toBe("/mock-vault-B");
  await page.evaluate(() => (window as ProbeWindow).__releaseClassification?.());
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__classificationDone)).toBe(true);
  // 응답 뒤 read/modify/write 마이크로태스크와 UI 반영까지 관찰한다.
  await page.waitForTimeout(500);
  const text = await page.evaluate(async () => {
    try { return await (window as ProbeWindow).__qa_readVaultFile("/mock-vault-B/.ticksidian-review-queue/queue.json"); }
    catch { return "MISSING"; }
  });
  expect(text).not.toContain("VAULT-A-ONLY-STABILITY");
});

test("이미 로드한 A 검토 카드는 B 전환 뒤 화면에 남지 않는다", async ({ page }) => {
  await ready(page);
  await legacy(page);
  await page.getByLabel("검토 항목 제목 입력").fill("VAULT-A-LOADED-STABILITY");
  await page.getByRole("button", { name: "AI 분류 추가" }).click();
  await expect(page.getByRole("heading", { name: "VAULT-A-LOADED-STABILITY" })).toBeVisible();
  await page.evaluate(async () => {
    const w = window as ProbeWindow;
    await w.__qa_createVaultDirectory("/mock-vault-B");
    const modulePath = "/src/lib/tauri-vault-adapter.ts";
    const { tauriVaultAdapter: adapter, setActiveVaultAdapter } = await import(modulePath);
    const keys = ["kind", "registerVaultPath", "getVaultPath", "setVaultPath", "createDirectory", "readTextFile", "writeTextFile", "readBinaryFile", "writeBinaryFile", "deleteFile", "renameDirectory", "trashDirectory", "listDirectoryEntries", "getFileStat"];
    setActiveVaultAdapter({ ...Object.fromEntries(keys.map((key) => [key, adapter[key]])), selectVaultFolder: async () => "/mock-vault-B" });
    w.__probeVault = () => adapter.getVaultPath();
  });
  await page.getByRole("button", { name: "볼트 폴더 변경/재선택" }).click();
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__probeVault?.())).toBe("/mock-vault-B");
  await legacy(page);
  await expect(page.getByRole("heading", { name: "VAULT-A-LOADED-STABILITY" })).toHaveCount(0);
  await expect(page.getByText("가져온 검토 항목이 없습니다", { exact: true })).toBeVisible();
});
