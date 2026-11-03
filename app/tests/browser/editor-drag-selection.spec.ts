import { devices, expect, test, type Page } from "@playwright/test";

// 실제 앱은 macOS WKWebView(WebKit)로 그린다. 본문 옆 도구 위에서 선택이 위로 튀는 결함은
// WebKit에서만 재현되므로 이 파일만 WebKit으로 실행한다(필요: npx playwright install webkit).
// 브라우저 신분(User-Agent)도 Safari로 둔다. 기본 설정의 Chrome 신분을 쓰면 편집기(ProseMirror)가
// Chrome용 선택 처리로 바뀌어 실제 앱과 다른 경로를 검사하게 된다.
// 근거: docs/waterfall/08-검토/2026-09-22-본문-드래그-선택-경계.md
test.use({ ...devices["Desktop Safari"], browserName: "webkit" });

const TITLE = "드래그 선택 경계";
const PARAGRAPH_COUNT = 40;

const paragraph = (page: Page, index: number) =>
  page.locator('.bn-editor [data-content-type="paragraph"]').nth(index);

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

/** 실제 마우스처럼 여러 번 나눠 움직인다. WebKit은 한 번의 순간 이동으로는 본문 옆 도구를 띄우지 않는다. */
const glide = (page: Page, x: number, y: number) => page.mouse.move(x, y, { steps: 8 });

async function openLongNote(page: Page) {
  expect(page.context().browser()?.browserType().name()).toBe("webkit");
  await page.goto("/");
  await page.getByLabel("빠른 기록 제목").waitFor();
  const body = Array.from({ length: PARAGRAPH_COUNT }, (_, i) =>
    `문단 ${String(i + 1).padStart(2, "0")} 선택 경계 확인용 글입니다.`).join("\n\n");
  await page.evaluate(async (content) => {
    await window.__qa_writeVaultFile?.("/mock-vault/inbox/drag-selection.md", content);
  }, `# ${TITLE}\n\n${body}\n`);
  await page.reload();
  await page.getByRole("button", { name: TITLE, exact: true }).click();
  await expect(page.locator(".bn-editor h1").first()).toHaveText(TITLE);
  await expect(page.getByText("저장됨", { exact: true })).toBeVisible();
  // 편집기 포커스가 본문을 스크롤할 수 있다. 측정은 맨 위에서 시작하고 쓰는 줄이 모두 화면 안인지 확인한다.
  await page.locator(".bn-editor").evaluate((editor) => {
    const panel = editor.closest<HTMLElement>(".overflow-y-auto");
    if (!panel) throw new Error("편집기 스크롤 영역 없음");
    panel.scrollTop = 0;
  });
  const viewportHeight = page.viewportSize()?.height ?? 0;
  await expect.poll(async () => {
    const [top, bottom] = [await boxOf(page, 3), await boxOf(page, 15)];
    return top.y > 0 && bottom.y + bottom.height < viewportHeight;
  }, { message: "4~16번째 문단이 화면 안에 있어야 한다" }).toBe(true);
}

async function boxOf(page: Page, index: number) {
  const box = await paragraph(page, index).boundingBox();
  if (!box) throw new Error(`문단 ${index + 1} 위치 없음`);
  return box;
}

/**
 * 본문 왼쪽 도구(＋·⋮⋮) 위로 포인터를 옮긴다. 도구는 포인터를 조금 늦게 따라오므로
 * 도구가 포인터 아래에 도착할 때까지 기다린 뒤, 사용자처럼 한 번 더 움직여 선택을 갱신한다.
 */
async function moveOverSideMenu(page: Page, index: number) {
  const box = await boxOf(page, index);
  const point = { x: box.x - 12, y: box.y + box.height / 2 };
  await glide(page, point.x, point.y);
  await expect.poll(() => page.evaluate(({ x, y }) =>
    Boolean(document.elementFromPoint(x, y)?.closest(".bn-side-menu")), point),
  { message: "포인터가 본문 옆 도구 위에 있어야 한다" }).toBe(true);
  await page.mouse.move(point.x - 1, point.y);
}

test("아래에서 위로 선택하다 도구 위로 가도 마우스 높이의 줄까지만 선택한다", async ({ page }) => {
  await openLongNote(page);
  const start = await boxOf(page, 15);
  await glide(page, start.x + 160, start.y + start.height / 2);
  await page.mouse.down();

  await moveOverSideMenu(page, 7);
  let selected = await selectedText(page);
  expect(selected).toContain("문단 08");
  expect(selected).not.toContain("문단 07");
  expect(selected).not.toContain(TITLE);

  // 도구를 따라 계속 위로 올려도 포인터 높이의 줄을 따라간다.
  await moveOverSideMenu(page, 3);
  selected = await selectedText(page);
  expect(selected).toContain("문단 04");
  expect(selected).not.toContain("문단 03");
  expect(selected).not.toContain(TITLE);

  await page.mouse.up();
  selected = await selectedText(page);
  expect(selected).toContain("문단 04");
  expect(selected).not.toContain(TITLE);
});

test("스크롤한 긴 기록에서도 도구 위 선택은 화면 위쪽 줄로 튀지 않는다", async ({ page }) => {
  await openLongNote(page);
  // 20번째 문단 쪽으로 스크롤한 상태(제보 화면처럼 문서 중간을 보는 중)에서 시작한다.
  await paragraph(page, 19).evaluate((node) => node.scrollIntoView({ block: "start" }));
  const viewportHeight = page.viewportSize()?.height ?? 0;
  await expect.poll(async () => {
    const scrolled = await page.locator(".bn-editor").evaluate((editor) =>
      (editor.closest<HTMLElement>(".overflow-y-auto")?.scrollTop ?? 0) > 0);
    const [top, bottom] = [await boxOf(page, 19), await boxOf(page, 31)];
    return scrolled && top.y >= 0 && bottom.y + bottom.height < viewportHeight;
  }, { message: "스크롤된 상태에서 20~32번째 문단이 화면 안에 있어야 한다" }).toBe(true);

  const start = await boxOf(page, 31);
  await glide(page, start.x + 160, start.y + start.height / 2);
  await page.mouse.down();
  await moveOverSideMenu(page, 23);
  await page.mouse.up();
  const selected = await selectedText(page);
  expect(selected).toContain("문단 24");
  expect(selected).not.toContain("문단 23");
});

test("본문 옆 도구의 자리와 ＋·⋮⋮ 동작은 그대로다", async ({ page }) => {
  await openLongNote(page);
  const target = await boxOf(page, 5);
  await glide(page, target.x + 80, target.y + target.height / 2);
  const menu = page.locator(".bn-side-menu");
  await expect(menu).toBeVisible();
  // 도구의 오른쪽 끝이 본문 시작에 붙고, 위쪽이 가리킨 줄과 맞는다.
  await expect.poll(async () => {
    const menuBox = await menu.boundingBox();
    if (!menuBox) return "도구 위치 없음";
    return Math.abs(menuBox.x + menuBox.width - target.x) <= 2 && Math.abs(menuBox.y - target.y) <= 3
      ? "맞음" : `도구 ${menuBox.x},${menuBox.y} 너비 ${menuBox.width} / 줄 ${target.x},${target.y}`;
  }).toBe("맞음");

  await page.getByRole("button", { name: "Open block menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.keyboard.press("Escape");

  await glide(page, target.x + 90, target.y + target.height / 2);
  await page.getByRole("button", { name: "Add block" }).click();
  await expect(page.locator(".bn-suggestion-menu").first()).toBeVisible();
});

// 짧은 기록 + 열 너비 조절 손잡이(2026-09-23 [kyle] 제보: "좌우넓이조절이 활성화될때 또 전체선택").
// WebKit은 드래그 선택 중 포인터가 손잡이에 닿으면 선택 끝점을 문서 처음으로 튀게 한다.
const SHORT_TITLE = "짧은 기록 경계";

async function openShortNote(page: Page) {
  expect(page.context().browser()?.browserType().name()).toBe("webkit");
  await page.goto("/");
  await page.getByLabel("빠른 기록 제목").waitFor();
  const content = [`# ${SHORT_TITLE}`, "", "첫 줄 확인 가능한 범위입니다.", "", "둘째 줄 반복 업무 진단입니다.", "",
    "셋째 줄 주소 https://example.com/", "", "마지막 줄 괜찮은듯 개념들", ""].join("\n");
  await page.evaluate(async (text) => {
    await window.__qa_writeVaultFile?.("/mock-vault/inbox/short-selection.md", text);
  }, content);
  await page.reload();
  await page.getByRole("button", { name: SHORT_TITLE, exact: true }).click();
  await expect(page.locator(".bn-editor h1").first()).toHaveText(SHORT_TITLE);
  await expect(page.getByText("저장됨", { exact: true })).toBeVisible();
}

async function lineBox(page: Page, text: string) {
  const box = await page.locator('.bn-editor [data-content-type="paragraph"]', { hasText: text }).boundingBox();
  if (!box) throw new Error(`${text} 위치 없음`);
  return box;
}

async function resizerBox(page: Page) {
  const box = await page.locator('[data-panel-resizer="notes"]').boundingBox();
  if (!box) throw new Error("노트 목록 너비 조절 손잡이 없음");
  return box;
}

/**
 * 포인터를 옮긴 뒤, 본문 옆 도구가 사라지는 전환(250ms)이 끝나기를 기다렸다가 한 번 더 움직인다.
 * 제보 화면처럼 도구가 사라지고 손잡이가 드러난 상태에서 선택이 다시 계산되게 하려는 것이다.
 */
async function settleAt(page: Page, x: number, y: number) {
  await glide(page, x, y);
  await page.waitForTimeout(400);
  await page.mouse.move(x, y - 1);
}

test("짧은 기록에서 너비 조절 손잡이 위로 가도 마우스 줄까지만 선택한다", async ({ page }) => {
  await openShortNote(page);
  const resizer = await resizerBox(page);
  const last = await lineBox(page, "마지막 줄");
  await glide(page, last.x + 120, last.y + last.height / 2);
  await page.mouse.down();

  // 잡기 영역 중 본문과 겹치는 쪽
  const second = await lineBox(page, "둘째 줄");
  await settleAt(page, resizer.x + 2, second.y + second.height / 2);
  let selected = await selectedText(page);
  expect(selected).toContain("둘째 줄");
  expect(selected).not.toContain("첫 줄");
  expect(selected).not.toContain(SHORT_TITLE);

  // 잡기 영역 중 노트 목록 쪽
  const first = await lineBox(page, "첫 줄");
  await settleAt(page, resizer.x - 3, first.y + first.height / 2);
  selected = await selectedText(page);
  expect(selected).toContain("첫 줄");
  expect(selected).not.toContain(SHORT_TITLE);

  await page.mouse.up();
  // 선택이 끝나면 손잡이는 다시 잡을 수 있어야 한다.
  await expect.poll(() => page.locator('[data-panel-resizer="notes"]')
    .evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("auto");
});

test("선택하다 본문 아래 빈 곳의 손잡이로 가도 제목까지 번지지 않는다", async ({ page }) => {
  await openShortNote(page);
  const resizer = await resizerBox(page);
  const first = await lineBox(page, "첫 줄");
  const editor = await page.locator(".bn-editor").boundingBox();
  if (!editor) throw new Error("편집기 위치 없음");
  await glide(page, first.x + 60, first.y + first.height / 2);
  await page.mouse.down();
  await settleAt(page, resizer.x + 2, editor.y + editor.height + 80);
  const selected = await selectedText(page);
  expect(selected).toContain("마지막 줄");
  expect(selected).not.toContain(SHORT_TITLE);
  await page.mouse.up();
});
