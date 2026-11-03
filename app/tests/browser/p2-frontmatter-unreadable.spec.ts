/**
 * DEF-DATA-002 — 머리말(frontmatter)을 읽지 못하는 노트는 쓰기 경로가 파일을 바꾸지 않는다.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter)
 * 설계: docs/waterfall/03-상세설계/옵시디언-원본-최소-frontmatter.md "머리말을 읽지 못하는 노트의 쓰기 거부"
 *
 * 잠긴 목표
 * - 탭 들여쓰기·중복 키 머리말 노트도 목록과 열기에는 그대로 보인다(읽기 관용).
 * - 닫힌 노트의 메타 변경(목록 메뉴 할 일 표시)은 파일을 쓰지 않는다. 원본 바이트 불변.
 * - 열린 편집기에서 본문을 바꿔도 저장은 파일을 쓰지 않고 오류를 알린다. 원본 바이트 불변.
 */

import { test, expect, type Page } from "@playwright/test";

const TAB_PATH = "/mock-vault/notes/탭 머리말.md";
const DUP_PATH = "/mock-vault/notes/중복 머리말.md";

// js-yaml이 거부하는 두 형태: 탭 들여쓰기, 중복 키.
const TAB_CONTENT = ["---", "aliases:", "\t- 별칭", "custom: 값", "---", "", "# 탭 머리말", "", "본문 한 줄.", ""].join("\n");
const DUP_CONTENT = ["---", "custom: 첫째", "custom: 둘째", "---", "", "# 중복 머리말", "", "본문 한 줄.", ""].join("\n");

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

async function seedVault(page: Page, files: Record<string, string>) {
  await page.waitForFunction(() => {
    return typeof (window as Window & { __qa_writeVaultFile?: unknown }).__qa_writeVaultFile === "function";
  });
  for (const [path, content] of Object.entries(files)) {
    await page.evaluate(async ({ path, content }) => {
      await (window as Window & { __qa_writeVaultFile?: (p: string, c: string) => Promise<void> })
        .__qa_writeVaultFile?.(path, content);
    }, { path, content });
  }
  await page.reload();
  await waitForAppReady(page);
}

async function readVaultFile(page: Page, path: string): Promise<string> {
  return (await page.evaluate((p) => {
    return (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> }).__qa_readVaultFile?.(p);
  }, path)) ?? "";
}

function noteButton(page: Page, title: string) {
  return page.locator("[data-note-column]").getByRole("button", { name: title, exact: true });
}

for (const [label, path, content, title] of [
  ["탭 들여쓰기", TAB_PATH, TAB_CONTENT, "탭 머리말"],
  ["중복 키", DUP_PATH, DUP_CONTENT, "중복 머리말"],
] as const) {
  test(`${label} 머리말: 닫힌 노트 메타 변경은 쓰기를 거부하고 원본 바이트가 그대로다`, async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    await seedVault(page, { [path]: content });

    // 읽기 관용: 목록에 그대로 보인다.
    await expect(noteButton(page, title)).toBeVisible({ timeout: 10000 });
    await noteButton(page, title).click({ button: "right" });
    await page.getByRole("menuitem", { name: "할 일로 표시" }).click();

    await expect(page.getByText("머리말", { exact: false }).first()).toBeVisible({ timeout: 8000 });
    expect(await readVaultFile(page, path)).toBe(content);
  });

  test(`${label} 머리말: 열린 편집기 저장은 쓰기를 거부하고 원본 바이트가 그대로다`, async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    await seedVault(page, { [path]: content });

    await noteButton(page, title).click();
    // 읽기 관용: 열기에도 본문이 보인다.
    await expect(page.locator(".bn-editor")).toContainText("본문 한 줄.", { timeout: 10000 });

    await page.locator(".bn-editor").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("저장되면 안 되는 입력", { delay: 15 });
    await page.waitForTimeout(4500);

    await expect(page.getByText("머리말", { exact: false }).first()).toBeVisible({ timeout: 8000 });
    expect(await readVaultFile(page, path)).toBe(content);
  });
}

// DFXR-001 — 작성본 복구·내 변경 유지로도 읽지 못한 원본 머리말을 덮어쓰지 않는다.
test("작성본 복구 뒤 내 변경 유지를 눌러도 원본 머리말 파일은 바이트 그대로다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [DUP_PATH]: DUP_CONTENT });

  await noteButton(page, "중복 머리말").click();
  await expect(page.locator(".bn-editor")).toContainText("본문 한 줄.", { timeout: 10000 });
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("복구 대상 입력", { delay: 15 });
  await page.waitForTimeout(2500);
  expect(await readVaultFile(page, DUP_PATH)).toBe(DUP_CONTENT);

  await page.reload();
  await waitForAppReady(page);
  await noteButton(page, "중복 머리말").click();
  await page.getByText("미저장 작성본을 복구했습니다. 원본 파일은 바꾸지 않았습니다.").waitFor({ timeout: 10000 });
  expect(await readVaultFile(page, DUP_PATH)).toBe(DUP_CONTENT);

  await page.getByRole("button", { name: "내 변경 유지", exact: true }).click();
  await page.waitForTimeout(3000);
  expect(await readVaultFile(page, DUP_PATH)).toBe(DUP_CONTENT);
  await expect(page.getByText("머리말", { exact: false }).first()).toBeVisible();
});

// DFXR-003 — 기준 원문을 받아들이는 지점(외부 변경 뒤 내 변경 유지)에서도 보호 플래그가 디스크 기준으로 정해진다.
const NORMAL_PATH = "/mock-vault/notes/정상 머리말.md";
const NORMAL_CONTENT = ["---", "custom: 값", "---", "", "# 정상 머리말", "", "본문 한 줄.", ""].join("\n");

async function simulateExternalEdit(page: Page, path: string, content: string) {
  await page.evaluate(async ({ path, content }) => {
    await (window as Window & { __qa_simulateExternalEdit?: (p: string, c: string) => Promise<void> })
      .__qa_simulateExternalEdit?.(path, content);
  }, { path, content });
}

test("정상 노트가 외부에서 깨진 머리말로 바뀐 뒤 내 변경 유지를 눌러도 원본은 그대로다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [NORMAL_PATH]: NORMAL_CONTENT });

  await noteButton(page, "정상 머리말").click();
  await expect(page.locator(".bn-editor")).toContainText("본문 한 줄.", { timeout: 10000 });
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("로컬 입력", { delay: 15 });
  // 저장 디바운스(1초) 전에 외부에서 깨진 머리말로 바꾼다.
  const external = DUP_CONTENT.replace("# 중복 머리말", "# 정상 머리말");
  await simulateExternalEdit(page, NORMAL_PATH, external);

  const keepLocal = page.getByRole("button", { name: "내 변경 유지", exact: true });
  await keepLocal.waitFor({ timeout: 15000 });
  await keepLocal.click();
  await page.waitForTimeout(3500);

  expect(await readVaultFile(page, NORMAL_PATH)).toBe(external);
  await expect(page.getByText("머리말", { exact: false }).first()).toBeVisible();
});

// DFXR-004·005 — 읽지 못한 머리말 위에서 만든 메타는 디스크가 고쳐진 뒤에도 원본에 쓰지 않는다.
// 탈출은 '외부 변경 버전 불러오기'(고친 원문 다시 열기)이고, 그 뒤에는 정상 노트처럼 저장된다.
const FIXED_CONTENT = [
  "---", "custom: fixed-external", "externalKey: {nested: preserved}", "tags: [EXTERNAL-TAG]", "---",
  "", "# 중복 머리말", "", "EXTERNAL-BODY", "",
].join("\n");
const KEEP_BLOCKED_NOTICE = "머리말을 읽지 못한 상태에서 편집한 내용이라 내 변경 유지로는 저장하지 않습니다.";

async function writeVaultFile(page: Page, path: string, content: string) {
  await page.evaluate(async ({ path, content }) => {
    await (window as Window & { __qa_writeVaultFile?: (p: string, c: string) => Promise<void> })
      .__qa_writeVaultFile?.(path, content);
  }, { path, content });
}

async function addTag(page: Page, tag: string) {
  await page.getByLabel("태그 추가", { exact: true }).click();
  await page.getByLabel("새 태그", { exact: true }).fill(tag);
  await page.getByLabel("새 태그", { exact: true }).press("Enter");
}

async function openBrokenAndType(page: Page, text: string, tag?: string) {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [DUP_PATH]: DUP_CONTENT });
  await noteButton(page, "중복 머리말").click();
  await expect(page.locator(".bn-editor")).toContainText("본문 한 줄.", { timeout: 10000 });
  if (tag) await addTag(page, tag);
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(text, { delay: 15 });
  await page.waitForTimeout(2500);
  expect(await readVaultFile(page, DUP_PATH)).toBe(DUP_CONTENT);
}

for (const tag of [undefined, "LOCAL-TAG"]) {
  test(`깨진 머리말 노트를 외부에서 고쳐도 내 변경 유지는 원본을 쓰지 않고 불러오기로 빠져나온다(로컬 태그 ${tag ? "있음" : "없음"})`, async ({ page }) => {
    await openBrokenAndType(page, "로컬 입력", tag);
    await simulateExternalEdit(page, DUP_PATH, FIXED_CONTENT);
    const keepLocal = page.getByRole("button", { name: "내 변경 유지", exact: true });
    await keepLocal.waitFor({ timeout: 15000 });
    await keepLocal.click();
    await page.waitForTimeout(3000);

    expect(await readVaultFile(page, DUP_PATH)).toBe(FIXED_CONTENT);
    await expect(page.getByText(KEEP_BLOCKED_NOTICE, { exact: false }).first()).toBeVisible();
    // 충돌 선택이 닫히지 않아 탈출 버튼이 남아 있다.
    await page.getByRole("button", { name: "외부 변경 버전 불러오기", exact: true }).click();
    await expect(page.locator(".bn-editor")).toContainText("EXTERNAL-BODY", { timeout: 10000 });

    // 불러온 뒤에는 정상 노트처럼 저장되고 고친 머리말 키가 남는다.
    await page.locator(".bn-editor").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("불러온 뒤 입력", { delay: 15 });
    await expect.poll(() => readVaultFile(page, DUP_PATH), { timeout: 12000 }).toContain("불러온 뒤 입력");
    const saved = await readVaultFile(page, DUP_PATH);
    expect(saved).toContain("externalKey:");
    expect(saved).toContain("EXTERNAL-TAG");
    expect(saved).not.toContain("LOCAL-TAG");
  });
}

test("고친 뒤 작성본을 복구하면 본문만 작성본이고 고친 머리말 키는 그대로이며 내 변경 유지로 저장된다", async ({ page }) => {
  await openBrokenAndType(page, "RECOVER-LOCAL-BODY", "LOCAL-TAG");
  await writeVaultFile(page, DUP_PATH, FIXED_CONTENT);
  await page.reload();
  await waitForAppReady(page);
  await noteButton(page, "중복 머리말").click();
  await page.getByText("미저장 작성본을 복구했습니다. 원본 파일은 바꾸지 않았습니다.", { exact: false }).waitFor({ timeout: 10000 });
  await expect(page.getByText("메타는 반영하지 않고", { exact: false }).first()).toBeVisible();
  expect(await readVaultFile(page, DUP_PATH)).toBe(FIXED_CONTENT);

  await page.getByRole("button", { name: "내 변경 유지", exact: true }).click();
  await expect.poll(() => readVaultFile(page, DUP_PATH), { timeout: 12000 }).toContain("RECOVER-LOCAL-BODY");
  const saved = await readVaultFile(page, DUP_PATH);
  expect(saved).toContain("externalKey:");
  expect(saved).toContain("fixed-external");
  expect(saved).toContain("EXTERNAL-TAG");
  expect(saved).not.toContain("LOCAL-TAG");
});

test("정상 노트는 외부 변경 뒤 내 변경 유지에서 로컬 태그와 본문을 그대로 저장한다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [NORMAL_PATH]: NORMAL_CONTENT });
  await noteButton(page, "정상 머리말").click();
  await expect(page.locator(".bn-editor")).toContainText("본문 한 줄.", { timeout: 10000 });
  await addTag(page, "LOCAL-TAG");
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("로컬 입력", { delay: 15 });
  const external = ["---", "custom: 외부 값", "tags: [EXTERNAL-TAG]", "---", "", "# 정상 머리말", "", "본문 한 줄.", ""].join("\n");
  await simulateExternalEdit(page, NORMAL_PATH, external);
  const keepLocal = page.getByRole("button", { name: "내 변경 유지", exact: true });
  await keepLocal.waitFor({ timeout: 15000 });
  await keepLocal.click();
  await expect.poll(() => readVaultFile(page, NORMAL_PATH), { timeout: 12000 }).toContain("로컬 입력");
  const saved = await readVaultFile(page, NORMAL_PATH);
  expect(saved).toContain("LOCAL-TAG");
  expect(saved).not.toContain("EXTERNAL-TAG");
});

// DFXR-006 — 작성본이 있을 때 원문 읽기 실패는 "읽을 수 있는 빈 머리말"이 아니다.
// 표시·쓰기 차단을 유지하고, 실제 원문을 불러오는 외부 변경 버전 불러오기로만 빠져나온다.
async function failEditorReads(page: Page, path: string, fixed: string) {
  await page.evaluate(async ({ path, fixed }) => {
    await (window as Window & { __qa_writeVaultFile?: (p: string, c: string) => Promise<void> }).__qa_writeVaultFile?.(path, fixed);
    const { tauriVaultAdapter, setActiveVaultAdapter } = await import("/src/lib/tauri-vault-adapter.ts");
    const state = { active: true };
    (window as Window & { __failReads?: { active: boolean } }).__failReads = state;
    const originalRead = tauriVaultAdapter.readTextFile.bind(tauriVaultAdapter);
    // 어댑터 메서드는 프로토타입에 있어 spread로 복사되지 않는다. 키를 명시해 위임한다.
    const delegate = Object.fromEntries(["kind", "selectVaultFolder", "registerVaultPath", "getVaultPath",
      "setVaultPath", "createDirectory", "readTextFile", "readBinaryFile", "writeBinaryFile", "writeTextFile",
      "deleteFile", "renameDirectory", "trashDirectory", "listDirectoryEntries", "getFileStat"]
      .map((k) => [k, (tauriVaultAdapter as unknown as Record<string, unknown>)[k]]));
    setActiveVaultAdapter({
      ...delegate,
      readTextFile: async (target: string) => {
        if (target === path && state.active && new Error().stack?.includes("useNoteEditor")) {
          throw new Error("QA: 편집기 원문 읽기 실패");
        }
        return originalRead(target);
      },
    } as unknown as typeof tauriVaultAdapter);
  }, { path, fixed });
}

test("작성본 복구 중 원문 읽기가 실패해도 고친 머리말 키를 지우지 않는다(내 변경 유지 뒤 원본 불변, 불러오기로 탈출)", async ({ page }) => {
  await openBrokenAndType(page, "LOCAL-RECOVER-BODY", "LOCAL-TAG");
  await noteButton(page, "감마 노트").click();
  await expect(page.locator(".bn-editor")).toContainText("감마 노트", { timeout: 10000 });
  await failEditorReads(page, DUP_PATH, FIXED_CONTENT);

  await noteButton(page, "중복 머리말").click();
  await page.getByText("미저장 작성본을 복구했습니다.", { exact: false }).waitFor({ timeout: 10000 });
  await expect(page.getByText("원본 파일을 읽지 못해 머리말을 확인할 수 없습니다", { exact: false }).first()).toBeVisible();
  expect(await readVaultFile(page, DUP_PATH)).toBe(FIXED_CONTENT);

  await page.evaluate(() => { (window as Window & { __failReads?: { active: boolean } }).__failReads!.active = false; });
  await page.getByRole("button", { name: "내 변경 유지", exact: true }).click();
  await page.waitForTimeout(3000);
  expect(await readVaultFile(page, DUP_PATH)).toBe(FIXED_CONTENT);
  await expect(page.getByText(KEEP_BLOCKED_NOTICE, { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "외부 변경 버전 불러오기", exact: true }).click();
  await expect(page.locator(".bn-editor")).toContainText("EXTERNAL-BODY", { timeout: 10000 });
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("불러온 뒤 입력", { delay: 15 });
  await expect.poll(() => readVaultFile(page, DUP_PATH), { timeout: 12000 }).toContain("불러온 뒤 입력");
  const saved = await readVaultFile(page, DUP_PATH);
  expect(saved).toContain("externalKey:");
  expect(saved).toContain("EXTERNAL-TAG");
});

// DFXR-007 — 쓰기는 "이 세션에서 원문을 성공적으로 읽은 기록"이 있을 때만 열린다(기본 거부).
// 작성본 없는 최초 읽기 실패 뒤에는 입력해도 원본이 바이트 그대로이고, 다시 열면 정상 저장된다.
test("작성본 없이 최초 원문 읽기가 실패하면 입력해도 원본을 쓰지 않고 다시 열면 저장된다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [DUP_PATH]: FIXED_CONTENT });
  await noteButton(page, "감마 노트").click();
  await expect(page.locator(".bn-editor")).toContainText("감마 노트", { timeout: 10000 });
  await failEditorReads(page, DUP_PATH, FIXED_CONTENT);

  await noteButton(page, "중복 머리말").click();
  await expect(page.getByText("노트를 불러오는데 실패했습니다.", { exact: false }).first()).toBeVisible({ timeout: 10000 });
  await page.locator(".bn-editor").click();
  await page.keyboard.type("TYPED-AFTER-INITIAL-READ-FAILURE", { delay: 15 });
  await page.waitForTimeout(2800);
  expect(await readVaultFile(page, DUP_PATH)).toBe(FIXED_CONTENT);

  // 읽기가 복구된 뒤 노트를 다시 열면 증거가 생겨 정상 저장되고 머리말 키가 남는다.
  await page.evaluate(() => { (window as Window & { __failReads?: { active: boolean } }).__failReads!.active = false; });
  await noteButton(page, "감마 노트").click();
  await expect(page.locator(".bn-editor")).toContainText("감마 노트", { timeout: 10000 });
  await noteButton(page, "중복 머리말").click();
  // 읽기 실패 중 입력은 작성본으로 보관되어 복구 선택이 뜬다. 실제 원문을 불러와 증거를 만든다.
  await page.getByRole("button", { name: "외부 변경 버전 불러오기", exact: true }).click({ timeout: 10000 });
  await expect(page.locator(".bn-editor")).toContainText("EXTERNAL-BODY", { timeout: 10000 });
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("다시 연 뒤 입력", { delay: 15 });
  await expect.poll(() => readVaultFile(page, DUP_PATH), { timeout: 12000 }).toContain("다시 연 뒤 입력");
  const saved = await readVaultFile(page, DUP_PATH);
  expect(saved).toContain("externalKey:");
  expect(saved).toContain("EXTERNAL-TAG");
});

// DFXR-007 재개 — 작성본 메타는 "읽은 디스크 메타 위에서 만들었다"는 긍정 증거(metaFromDisk)가 있을 때만 믿는다.
function draftKey(path: string) { return "ticksidian.note-recovery.v1.active." + encodeURIComponent(path); }
async function readDraft(page: Page, path: string): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), draftKey(path));
  return raw === null ? null : JSON.parse(raw);
}

test("최초 읽기 실패 중 만든 작성본은 metaFromDisk=false이고 다시 연 뒤 내 변경 유지도 원본 키를 지우지 않는다", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [DUP_PATH]: FIXED_CONTENT });
  await noteButton(page, "감마 노트").click();
  await expect(page.locator(".bn-editor")).toContainText("감마 노트", { timeout: 10000 });
  await failEditorReads(page, DUP_PATH, FIXED_CONTENT);
  await noteButton(page, "중복 머리말").click();
  await expect(page.getByText("노트를 불러오는데 실패했습니다.", { exact: false }).first()).toBeVisible({ timeout: 10000 });
  await page.locator(".bn-editor").click();
  await page.keyboard.type("TYPED-AFTER-INITIAL-READ-FAILURE", { delay: 15 });
  await page.waitForTimeout(2800);
  expect(await readVaultFile(page, DUP_PATH)).toBe(FIXED_CONTENT);
  expect((await readDraft(page, DUP_PATH))?.metaFromDisk).toBe(false);

  // 읽기가 정상인 새 세션에서 다시 열고 내 변경 유지.
  await page.reload();
  await waitForAppReady(page);
  await noteButton(page, "중복 머리말").click();
  await page.getByText("미저장 작성본을 복구했습니다.", { exact: false }).waitFor({ timeout: 10000 });
  await expect(page.getByText("메타는 반영하지 않고", { exact: false }).first()).toBeVisible();
  expect(await readVaultFile(page, DUP_PATH)).toBe(FIXED_CONTENT);
  await page.getByRole("button", { name: "내 변경 유지", exact: true }).click();
  await expect.poll(() => readVaultFile(page, DUP_PATH), { timeout: 12000 }).toContain("TYPED-AFTER-INITIAL-READ-FAILURE");
  const saved = await readVaultFile(page, DUP_PATH);
  expect(saved).toContain("externalKey:");
  expect(saved).toContain("fixed-external");
  expect(saved).toContain("EXTERNAL-TAG");
});

test("작성본 생성 출처 행렬: 디스크 읽음=true, 머리말 파싱 실패=false, 읽기 실패=false", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [NORMAL_PATH]: NORMAL_CONTENT, [DUP_PATH]: DUP_CONTENT });

  await noteButton(page, "정상 머리말").click();
  await expect(page.locator(".bn-editor")).toContainText("본문 한 줄.", { timeout: 10000 });
  await addTag(page, "LOCAL-TAG");
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("읽음 행", { delay: 15 });
  await expect.poll(async () => (await readDraft(page, NORMAL_PATH))?.metaFromDisk, { timeout: 8000 }).toBe(true);

  await noteButton(page, "중복 머리말").click();
  await expect(page.locator(".bn-editor")).toContainText("본문 한 줄.", { timeout: 10000 });
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("파싱 실패 행", { delay: 15 });
  await expect.poll(async () => (await readDraft(page, DUP_PATH))?.metaFromDisk, { timeout: 8000 }).toBe(false);
});

test("필드 없는 기존 작성본 복구는 지금처럼 작성본 메타를 쓴다(호환)", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await seedVault(page, { [NORMAL_PATH]: NORMAL_CONTENT });
  await noteButton(page, "정상 머리말").click();
  await expect(page.locator(".bn-editor")).toContainText("본문 한 줄.", { timeout: 10000 });
  await addTag(page, "LEGACY-TAG");
  await page.locator(".bn-editor").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("옛 작성본 입력", { delay: 15 });
  await expect.poll(async () => (await readDraft(page, NORMAL_PATH))?.metaFromDisk, { timeout: 8000 }).toBe(true);
  // 필드를 지워 이 변경 이전에 보관된 작성본 모양으로 만든다.
  await page.evaluate((key) => {
    const draft = JSON.parse(localStorage.getItem(key) as string);
    delete draft.metaFromDisk; delete draft.metaUnreadable;
    localStorage.setItem(key, JSON.stringify(draft));
  }, draftKey(NORMAL_PATH));
  await page.reload();
  await waitForAppReady(page);
  await noteButton(page, "정상 머리말").click();
  await page.getByText("미저장 작성본을 복구했습니다.", { exact: false }).waitFor({ timeout: 10000 });
  await expect(page.getByText("메타는 반영하지 않고", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "내 변경 유지", exact: true }).click();
  await expect.poll(() => readVaultFile(page, NORMAL_PATH), { timeout: 12000 }).toContain("옛 작성본 입력");
  expect(await readVaultFile(page, NORMAL_PATH)).toContain("LEGACY-TAG");
});
