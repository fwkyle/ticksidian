import { test, expect } from "@playwright/test";

test("시작은 기본함이며 기존 inbox를 중복 표시하지 않는다", async ({ page }) => {
  await page.goto("/");
  const inbox = page.locator('[data-folder-select="기본함"]');
  await expect(inbox).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-folder-select]").first()).toHaveAttribute("data-folder-select", "기본함");
  await expect(page.locator('[data-folder-select="inbox"]')).toHaveCount(0);
  const files = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  expect(files.filter((path) => path.includes("/inbox/"))).toHaveLength(2);
  await expect(page.locator(".bn-editor")).toContainText("맨몸 메모");
});

test("백링크는 시작·재로드·닫은 뒤 노트 전환에도 닫혀 있다", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "백링크 패널 켜기/끄기", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.locator('[data-folder-select="전체"]').click();
  await page.getByRole("button", { name: "알파 노트", exact: true }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await page.getByRole("button", { name: "베타 노트", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("전체에서 빠른 기록은 기본함, 명시 폴더에서 만들기는 그 폴더", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-folder-select="전체"]').click();
  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  await page.keyboard.press("Control+n");
  await expect(page.locator('[data-folder-select="기본함"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator('[data-list-item="새 노트"]')).toBeVisible();
  const created = await page.evaluate(async (old) =>
    (await window.__qa_listVaultFiles?.() ?? []).filter((p) => !old.includes(p)), before);
  expect(created).toHaveLength(1);
  expect(created[0]).toContain("/inbox/");
  await page.locator('[data-folder-select="notes"]').click();
  await page.keyboard.press("Control+n");
  await expect(page.locator('[data-folder-select="notes"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator('[data-list-item="새 노트"]')).toBeVisible();
});

test("노트는 한 줄이고 본문은 넓고 15px이다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('[data-folder-select="전체"]').click();
  const row = page.locator('[data-list-item="알파 노트"]');
  await row.getByRole("button", { name: "알파 노트", exact: true }).click();
  await expect(row.locator('span[aria-hidden="true"]')).toHaveCount(0);
  expect((await row.boundingBox())?.height).toBe(40);
  const editor = page.locator(".bn-editor");
  await expect(editor).toBeVisible();
  const style = await editor.evaluate((el) => {
    const css = getComputedStyle(el);
    return { font: css.fontSize, padding: css.paddingLeft, width: el.getBoundingClientRect().width };
  });
  expect(style.font).toBe("15px");
  expect(style.padding).toBe("32px");
  expect(style.width).toBeGreaterThan(800);
  await page.screenshot({ path: testInfo.outputPath("inbox-first-desktop.png") });
});

test("빈 기본함은 시작만으로 생성하지 않고 첫 기록 때 만든다", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __qa_omitInboxSeed?: boolean }).__qa_omitInboxSeed = true;
  });
  await page.goto("/");
  await expect(page.locator('[data-folder-select="기본함"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".bn-editor")).toHaveCount(0);
  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  expect(before.some((p) => p.includes("/inbox/"))).toBe(false);
  await page.keyboard.press("Control+n");
  await expect(page.locator(".bn-editor")).toBeVisible();
  const after = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  expect(after.filter((p) => !before.includes(p))).toHaveLength(1);
  expect(after.some((p) => p.includes("/inbox/"))).toBe(true);
});

for (const width of [375, 768, 1440, 1920]) {
  test(`기록 화면 ${width}px에서 글자·본문이 넘치지 않는다`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const editor = page.locator(".bn-editor");
    await expect(editor).toBeVisible();
    const box = await editor.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (width < 1024) {
        await page.getByRole("button", { name: "사이드바 열기" }).click();
        await page.locator('[data-folder-select="기본함"]').click();
      }
    const note = page.locator('[data-list-item="맨몸 메모"]');
    expect((await note.boundingBox())?.height).toBe(width < 768 ? 44 : 40);
    const noteButton = note.getByRole("button", { name: "맨몸 메모", exact: true });
    expect((await noteButton.boundingBox())?.height).toBe(width < 768 ? 44 : 40);
    const filter = page.getByRole("group", { name: "종류 필터" }).getByRole("button", { name: "기록", exact: true });
    expect((await filter.boundingBox())?.height).toBeLessThanOrEqual(width < 1024 ? 44 : 32);
    if (width < 1024) {
      await noteButton.click();
      await expect(page.locator("[data-sidebar-drawer]")).toHaveAttribute("data-open", "false");
      await expect.poll(async () => {
        const drawer = await page.locator("[data-sidebar-drawer]").boundingBox();
        return (drawer?.x ?? 0) + (drawer?.width ?? 0);
      }).toBeLessThanOrEqual(1);
      const menu = await page.getByRole("button", { name: "사이드바 열기" }).boundingBox();
      const saved = await page.getByText("저장됨", { exact: true }).boundingBox();
      expect(saved?.y).toBeGreaterThanOrEqual((menu?.y ?? 0) + (menu?.height ?? 0));
    }
    await page.screenshot({ path: testInfo.outputPath(`inbox-first-dark-${width}.png`) });
  });
}
