import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * 시작 화면 선택(기본함 / 오늘 할 일) 브라우저 fixture QA (2026-10-22).
 * 설계: docs/waterfall/03-상세설계/시작-화면-선택.md
 *
 * 합성 볼트(MemoryVaultAdapter) 기준이다. 실제 Tauri 웹뷰의 localStorage 영속성과 파일 권한은
 * 검증하지 않는다(실창은 [kyle] 잔여).
 */

const KEY = "ticksidian-start-screen";
const NOTES = "/mock-vault/notes";

function localDateKey(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todoFile(id: string, due: string | null, extra = ""): string {
  return `---\nid: "${id}"\ntype: "todo"\ndone: false\n${due ? `dueDate: "${due}"\n` : ""}${extra}`
    + `updatedAt: "2026-10-22T00:00:00.000Z"\n---\n# ${id}\n`;
}

type QaWindow = Window & {
  __qa_writeVaultFile?: (path: string, content: string) => Promise<void>;
  __qa_readVaultFile?: (path: string) => Promise<string>;
};

/** 합성 볼트에 오늘/어제/내일 기한 할 일을 심고 새로 읽게 한다. */
async function seedTodos(page: Page): Promise<void> {
  await page.goto("/");
  // 앱 초기화(스캔·첫 노트 열기)가 끝난 뒤에 심어야 부팅 중 저장과 겹치지 않는다.
  await expect(page.locator(".bn-editor")).toContainText("맨몸 메모");
  await page.evaluate(async ({ notes, files }) => {
    for (const [name, content] of Object.entries(files)) {
      await (window as QaWindow).__qa_writeVaultFile?.(`${notes}/${name}.md`, content);
    }
  }, {
    notes: NOTES,
    files: {
      "due-today": todoFile("due-today", localDateKey(0), 'priority: "높음"\n'),
      "due-yesterday": todoFile("due-yesterday", localDateKey(-1)),
      "due-tomorrow": todoFile("due-tomorrow", localDateKey(1)),
      // 실제 scanner가 플러그인 그림으로 읽는 모양(type: todo + excalidraw-plugin).
      "plugin-today.excalidraw": todoFile("plugin-today.excalidraw", localDateKey(0), "excalidraw-plugin: parsed\n"),
    },
  });
  await expect.poll(() => page.evaluate(
    () => Object.keys(window.localStorage).some((k) =>
      k.includes("vault-files") && (window.localStorage.getItem(k) ?? "").includes("due-today")),
  )).toBe(true);
}

async function startWith(page: Page, value: string | null): Promise<void> {
  await page.addInitScript(([key, v]) => {
    if (v === null) return;
    window.localStorage.setItem(key as string, v as string);
  }, [KEY, value]);
  await page.reload();
}

/** 통과한 시험의 산출물은 지워지므로 START_SCREEN_SHOT_DIR이 있으면 거기에 캡처를 남긴다. */
const shotPath = (info: TestInfo, name: string) =>
  process.env.START_SCREEN_SHOT_DIR ? join(process.env.START_SCREEN_SHOT_DIR, name) : info.outputPath(name);

const noteColumn = (page: Page) => page.locator("[data-note-column]");

test("설정이 없으면 기본함으로 시작하고 첫 노트를 연다(기존 동작)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-folder-select="기본함"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".bn-editor")).toContainText("맨몸 메모");
  await expect(noteColumn(page).getByRole("heading", { name: "기본함" })).toBeVisible();
});

for (const bad of ["", "calendar", "TODAY", "{}"]) {
  test(`잘못된 설정값(${JSON.stringify(bad)})은 기본함으로 시작한다`, async ({ page }) => {
    await page.addInitScript(([key, v]) => window.localStorage.setItem(key, v), [KEY, bad]);
    await page.goto("/");
    await expect(page.locator('[data-folder-select="기본함"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".bn-editor")).toContainText("맨몸 메모");
  });
}

test("localStorage 읽기가 예외여도 기본함으로 시작한다", async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function patched(k: string) {
      if (k === key) throw new Error("denied");
      return original.call(this, k);
    };
  }, KEY);
  await page.goto("/");
  await expect(page.locator('[data-folder-select="기본함"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".bn-editor")).toContainText("맨몸 메모");
});

test("오늘 할 일 시작: 그룹·우선순위·자동 열기 없음", async ({ page }) => {
  await seedTodos(page);
  await startWith(page, "today");
  const column = noteColumn(page);
  await expect(column).toHaveAttribute("aria-label", "오늘 할 일 목록");
  await expect(column.getByRole("heading", { name: "오늘 할 일" })).toBeVisible();
  await expect(page.locator(".bn-editor")).toHaveCount(0);

  await expect(column.locator('[data-list-section="due:overdue"]')).toContainText("기한 지남");
  await expect(column.locator('[data-list-section="due:overdue"]')).toContainText("due-yesterday");
  await expect(column.locator('[data-list-section="due:overdue"]')).toContainText("멘토님 연락");
  await expect(column.locator('[data-list-section="due:today"]')).toContainText("due-today");
  await expect(column.locator('[data-list-section="due:today"] [title="우선순위 높음"]')).toHaveCount(1);
  await expect(column.locator('[data-list-section="due:none"]')).toContainText("세금계산서 발행");
  await expect(column.getByText("due-tomorrow")).toHaveCount(0);
  const order = await column.locator("[data-list-section]").evaluateAll(
    (els) => els.map((el) => el.getAttribute("data-list-section")));
  expect(order).toEqual(["due:overdue", "due:today", "due:none"]);
  // 완료 포함 버튼은 이 보기에서 의미가 없다.
  await expect(page.getByRole("button", { name: /완료한 할 일 (보이기|숨기기)/ })).toHaveCount(0);
  await expect(page.locator('[data-folder-select="기본함"]')).not.toHaveAttribute("aria-current", "true");
});

test("오늘 할 일 시작이 저장된 목록 보기(기록)를 덮어쓰지 않는다", async ({ page }) => {
  await seedTodos(page);
  await startWith(page, "today");
  const stored = await page.evaluate(() => window.localStorage.getItem("ticksidian-note-list-view"));
  expect(stored === null || !stored.includes('"kind":"todo"')).toBe(true);
});

test("체크로 완료하면 목록에서 빠지고 파일에 done이 저장된다", async ({ page }) => {
  await seedTodos(page);
  await startWith(page, "today");
  const column = noteColumn(page);
  await column.getByRole("button", { name: "due-today 완료", exact: true }).click();
  await expect(column.locator('[data-list-item="due-today"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(
    (path) => (window as QaWindow).__qa_readVaultFile?.(path), `${NOTES}/due-today.md`,
  )).toContain("done: true");
});

test("플러그인 그림은 오늘 보기에 나오지 않고 원본에 쓰기도 없다 (SSR-002)", async ({ page }) => {
  await seedTodos(page);
  const before = await page.evaluate(
    (path) => (window as QaWindow).__qa_readVaultFile?.(path), `${NOTES}/plugin-today.excalidraw.md`);
  await startWith(page, "today");
  const column = noteColumn(page);
  await expect(column.locator('[data-list-section="due:today"]')).toContainText("due-today");
  await expect(column.getByText("plugin-today", { exact: false })).toHaveCount(0);
  const after = await page.evaluate(
    (path) => (window as QaWindow).__qa_readVaultFile?.(path), `${NOTES}/plugin-today.excalidraw.md`);
  expect(after).toBe(before);
  expect(after).not.toContain("done: true");
});

test("전체 할 일 보기는 오늘 제한을 풀고 앞날 할 일을 보여 준다 (SSR-001)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedTodos(page);
  await startWith(page, "today");
  const column = noteColumn(page);
  await expect(column.getByText("due-tomorrow")).toHaveCount(0);
  await page.getByRole("button", { name: "전체 할 일 보기", exact: true }).click();
  await expect(column).toHaveAttribute("aria-label", "할 일 목록");
  await expect(column.locator('[data-list-item="due-tomorrow"]')).toHaveCount(1);
  await expect(column.locator('[data-list-section="due:today"]')).toHaveCount(0);
  const stored = await page.evaluate(() => window.localStorage.getItem("ticksidian-note-list-view"));
  expect(stored === null || stored.includes('"kind":"todo"')).toBe(true);
});

test("같은 종류(할 일)나 전체 폴더를 다시 골라도 오늘 제한이 풀린다 (SSR-001)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedTodos(page);
  await startWith(page, "today");
  const column = noteColumn(page);
  await column.getByRole("group", { name: "종류 필터" }).getByRole("button", { name: /^할 일/ }).click();
  await expect(column.locator('[data-list-item="due-tomorrow"]')).toHaveCount(1);

  await startWith(page, "today");
  await expect(column.locator('[data-list-item="due-tomorrow"]')).toHaveCount(0);
  await page.locator('[data-folder-select="전체"]').click();
  await expect(column.locator('[data-list-item="due-tomorrow"]')).toHaveCount(1);
});

test("정렬만 바꾸면 오늘 보기는 유지된다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedTodos(page);
  await startWith(page, "today");
  await page.getByRole("combobox", { name: "정렬 기준" }).selectOption("title");
  await expect(noteColumn(page)).toHaveAttribute("aria-label", "오늘 할 일 목록");
});

test("폴더를 고르면 오늘 할 일 보기가 풀린다", async ({ page }) => {
  await seedTodos(page);
  await startWith(page, "today");
  await page.locator('[data-folder-select="기본함"]').click();
  await expect(noteColumn(page)).not.toHaveAttribute("aria-label", "오늘 할 일 목록");
  await expect(noteColumn(page).locator('[data-list-section="due:overdue"]')).toHaveCount(0);
});

test("볼트 전환도 설정을 따른다: 오늘 할 일 → 오늘 할 일 보기, 기본함 → 기본함", async ({ page }) => {
  await seedTodos(page);
  await startWith(page, "today");
  await page.evaluate(() => {
    (window as Window & { __qa_nextVaultSelection?: string }).__qa_nextVaultSelection = "/mock-vault-B";
  });
  await page.locator('[data-folder-select="기본함"]').click();
  await page.getByRole("button", { name: "볼트 폴더 변경/재선택" }).click();
  await expect(noteColumn(page)).toHaveAttribute("aria-label", "오늘 할 일 목록");
  await expect(page.locator(".bn-editor")).toHaveCount(0);

  await page.evaluate((key) => window.localStorage.setItem(key, "inbox"), KEY);
  await page.getByRole("button", { name: "볼트 폴더 변경/재선택" }).click();
  await expect(page.locator('[data-folder-select="기본함"]')).toHaveAttribute("aria-current", "true");
  await expect(noteColumn(page)).not.toHaveAttribute("aria-label", "오늘 할 일 목록");
});

test("레일 설정 버튼은 값을 저장하고 지금 화면은 바꾸지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /^시작 화면: 기본함/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("button", { name: /^시작 화면: 오늘 할 일/ })).toBeVisible();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), KEY)).toBe("today");
  await expect(page.locator('[data-folder-select="기본함"]')).toHaveAttribute("aria-current", "true");
  await page.reload();
  await expect(noteColumn(page)).toHaveAttribute("aria-label", "오늘 할 일 목록");
  await page.getByRole("button", { name: /^시작 화면: 오늘 할 일/ }).click();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), KEY)).toBe("inbox");
});

for (const width of [1280, 768, 375]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`진입점·오늘 할 일 화면 ${width}px ${scheme} 캡처`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await seedTodos(page);
      if (width < 1024) {
        // 드로어 도구 줄: 설정 버튼이 보이고 접근 이름이 있다.
        await page.reload();
        await page.getByRole("button", { name: "사이드바 열기" }).click();
        const toolRow = page.locator("[data-drawer-tool-row]");
        const button = toolRow.getByRole("button", { name: /^시작 화면: 기본함/ });
        await expect(button).toBeVisible();
        // 드로어가 미끄러져 들어오는 동안은 캡처하지 않는다.
        await expect.poll(async () => (await button.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
        await page.waitForTimeout(350);
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: shotPath(testInfo, `start-screen-drawer-${width}-${scheme}.png`) });
        await page.reload();
      } else {
        await expect(page.getByRole("button", { name: /^시작 화면: 기본함/ })).toBeVisible();
      }
      await startWith(page, "today");
      if (width < 1024) {
        // 좁은 창의 `오늘 할 일` 시작은 목록 창으로 열린다.
        await page.getByRole("button", { name: "사이드바 열기" }).click();
      }
      await expect(noteColumn(page).getByRole("heading", { name: "오늘 할 일" })).toBeVisible();
      // 드로어가 화면 안으로 들어와 멈춘 뒤에 확인·캡처한다(검수 SSR-004: transform으로 밖에 있어도 visible은 통과한다).
      await expect(noteColumn(page)).toBeInViewport({ ratio: 0.9 });
      await expect.poll(async () => (await noteColumn(page).boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
      await page.waitForTimeout(350);
      await expect(noteColumn(page).locator('[data-list-section="due:today"]')).toBeInViewport();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      await page.screenshot({ path: shotPath(testInfo, `start-screen-today-${width}-${scheme}.png`) });
    });
  }
}
