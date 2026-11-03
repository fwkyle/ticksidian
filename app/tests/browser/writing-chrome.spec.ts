import { test, expect } from "@playwright/test";

for (const width of [375, 768, 1440, 1920]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${width}px ${colorScheme}: 기록 도구와 한국어 안내`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      const editor = page.locator(".bn-editor");
      await expect(editor).toBeVisible();
      const info = page.locator("[data-note-info-bar]");
      await page.screenshot({ path: testInfo.outputPath("editor.png") });
      await expect.soft(info.getByText("저장됨", { exact: true })).toBeVisible();
      await expect.soft(info.getByRole("button", { name: "📁 기본함", exact: true })).toBeVisible();
      await expect.soft(info).toHaveCSS("border-top-width", "0px");
      await expect.soft(page.getByText(/^생성 /)).toHaveCount(0);
      await info.getByRole("button", { name: /상세/ }).click();
      await expect(info.getByText("생성", { exact: true })).toBeVisible();
      await expect(info.getByText("수정", { exact: true })).toBeVisible();
      await expect(info.getByLabel("폴더 이동")).toHaveValue("inbox");
      await info.getByRole("button", { name: /상세/ }).click();
      if (width < 1024) {
        await page.getByRole("button", { name: "사이드바 열기" }).click();
        await expect.poll(async () => (await page.locator("[data-sidebar-drawer]").boundingBox())?.x).toBe(0);
      }
      if (width < 1024) await page.locator('[data-folder-select="기본함"]').click();
      const column = page.locator("[data-note-column]");
      await page.screenshot({ path: testInfo.outputPath("sidebar.png") });
      await expect.soft(column.getByRole("button", { name: /완료한 할 일/ })).toHaveCount(0);
      const searchButton = column.getByRole("button", { name: "검색 열기" });
      // 2026-09-22: 글자 버튼 → 아이콘 버튼(이름은 접근성 라벨로 유지).
      await expect.soft(searchButton.locator("svg")).toHaveCount(1);
      await expect.soft(searchButton).toHaveText("");
      if (width < 1024) expect((await searchButton.boundingBox())?.width).toBeGreaterThanOrEqual(44);
      const quick = column.getByRole("textbox", { name: "빠른 기록 제목" });
      await expect(quick).toBeVisible();
      expect((await quick.boundingBox())?.height).toBe(width < 1024 ? 44 : 36);
      await searchButton.click();
      const scope = column.getByRole("combobox", { name: "검색 범위", exact: true });
      await expect(scope).toBeVisible();
      const search = column.getByRole("textbox", { name: "노트 검색", exact: true });
      const scopeBox = await scope.boundingBox();
      const searchBox = await search.boundingBox();
      expect(Math.abs((scopeBox?.y ?? 0) - (searchBox?.y ?? 0))).toBeLessThan(5);
      expect(await search.evaluate((el) => {
        const css = getComputedStyle(el);
        return el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      })).toBeGreaterThanOrEqual(48);
      const createBox = await column.getByRole("button", { name: "검색 닫기" }).boundingBox();
      const headerBox = await column.getByRole("heading", { name: "기본함", exact: true }).boundingBox();
      expect(Math.abs((createBox?.y ?? 0) - (headerBox?.y ?? 0))).toBeLessThan(12);
      await column.getByRole("button", { name: "검색 닫기" }).click();
      const row = column.locator('[data-list-item="맨몸 메모"]');
      await page.mouse.move(0, 0);
      const title = row.getByRole("button", { name: "맨몸 메모", exact: true });
      const available = await title.boundingBox();
      const rowBox = await row.boundingBox();
      expect((rowBox?.width ?? 0) - (available?.width ?? 0)).toBeLessThanOrEqual(width < 768 ? 44 : 1);
      expect(await column.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (width >= 768) {
        await row.hover();
        await expect(row.getByRole("button", { name: "맨몸 메모 삭제", exact: true })).toHaveCSS("opacity", "1");
      }
      await title.click();
      if (width < 1024) {
        await expect.poll(async () => {
          const drawer = await page.locator("[data-sidebar-drawer]").boundingBox();
          return (drawer?.x ?? 0) + (drawer?.width ?? 0);
        }).toBeLessThanOrEqual(1);
      }
      await editor.press("Control+End");
      await editor.press("Enter");
      const emptyLine = editor.locator('.bn-inline-content').last();
      await expect.poll(() => emptyLine.evaluate((el) => getComputedStyle(el, "::before").content)).toBe('"글을 쓰거나 /로 메뉴 열기"');
      await page.screenshot({ path: testInfo.outputPath("korean-placeholder.png") });
    });
  }
}

test("통합 검색 범위·단축키·투두 필터·새 기록은 기존 동작 유지", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bn-editor")).toBeFocused();
  const column = page.locator("[data-note-column]");
  await column.getByRole("button", { name: "검색 열기" }).click();
  const scope = column.getByRole("combobox", { name: "검색 범위" });
  await scope.selectOption("rag");
  const rag = page.getByRole("textbox", { name: "전체 검색", exact: true });
  await rag.fill("프로젝트");
  await expect(page.locator("[data-search-index]").first()).toBeVisible();
  await rag.press("Escape");
  await expect(rag).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("textbox", { name: "노트 검색", exact: true })).toBeFocused();
  await page.getByRole("group", { name: "종류 필터" }).getByRole("button", { name: /^할 일/ }).click();
  await expect(column.getByRole("button", { name: /완료한 할 일/ })).toBeVisible();
  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  await page.keyboard.press("Control+n");
  await expect(page.locator(".bn-editor")).toBeFocused();
  const added = await page.evaluate(async (old) => (await window.__qa_listVaultFiles?.() ?? []).filter((p) => !old.includes(p)), before);
  expect(added).toHaveLength(1);
  expect(added[0]).toContain("/inbox/");
});

test("긴 제목 공간 확보 후에도 키보드 삭제·취소와 원본 보존", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bn-editor")).toBeVisible();
  const path = "/mock-vault/inbox/긴-제목.md";
  const title = "기본함에 생각을 편하게 기록하기 위한 긴 제목 확인 노트";
  const content = `# ${title}\n\n원본 유지\n`;
  await page.evaluate(async ({ path, content }) => window.__qa_writeVaultFile?.(path, content), { path, content });
  await page.reload();
  // 초기 노트 로드의 자동 포커스가 끝난 뒤 목록의 키보드 조작을 시작한다.
  await expect(page.locator(".bn-editor")).toBeFocused();
  const row = page.locator(`[data-list-item="${title}"]`);
  const open = row.getByRole("button", { name: title, exact: true });
  await expect(open).toBeVisible();
  await expect(open.locator("span")).toHaveCSS("text-overflow", "ellipsis");
  await open.focus();
  await page.keyboard.press("Tab");
  const remove = row.getByRole("button", { name: `${title} 삭제`, exact: true });
  await expect(remove).toBeFocused();
  await expect(remove).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(await page.evaluate((path) => window.__qa_readVaultFile?.(path), path)).toBe(content);
});
