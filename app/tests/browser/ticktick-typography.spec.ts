import { test, expect } from "@playwright/test";

const path = "/mock-vault/inbox/visual-density.md";
const markdown = "# 기본함에 생각을 기록하기\n\n한글과 English 123을 함께 읽습니다.\n줄바꿈도 그대로 유지합니다.\n\n## 다음 생각\n\n두 번째 문단입니다. **중요한 내용**을 남깁니다.\n\n### 작은 제목\n\n- 첫 번째 목록\n- 두 번째 목록\n\n```js\nconst count = 123;\n```\n";

for (const width of [375, 768, 1440, 1920]) {
  for (const colorScheme of ["dark", "light"] as const) {
    test(`${width}px ${colorScheme} 틱틱 기준 글씨·선택·원본 보존`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.locator(".bn-editor")).toBeVisible();
      await page.evaluate(async ({ path, markdown }) => {
        await window.__qa_writeVaultFile?.(path, markdown);
      }, { path, markdown });
      await page.reload();
      await expect(page.locator(".bn-editor")).toBeVisible();
      if (width < 1024) {
        await page.getByRole("button", { name: "사이드바 열기" }).click();
        await page.locator('[data-folder-select="기본함"]').click();
      }
      const row = page.locator('[data-list-item="기본함에 생각을 기록하기"]');
      await row.getByRole("button", { name: "기본함에 생각을 기록하기", exact: true }).click();
      const editor = page.locator(".bn-editor");
      await expect(editor.locator("h1")).toHaveText("기본함에 생각을 기록하기");
      await page.screenshot({ path: testInfo.outputPath("editor.png") });
      const bodyFont = await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily);
      await expect.soft(editor).toHaveCSS("font-family", bodyFont);
      await expect.soft(editor).toHaveCSS("font-size", "15px");
      const paragraph = editor.locator('[data-content-type="paragraph"]').first();
      await expect.soft(paragraph).toHaveCSS("font-weight", "600");
      await expect.soft(editor.locator('[data-content-type="bulletListItem"]').first()).toHaveCSS("font-weight", "600");
      await expect.soft(editor.locator("pre")).toHaveCSS("font-weight", "400");
      await expect.soft(paragraph).toHaveCSS("line-height", "22.5px");
      await expect.soft(paragraph).toHaveCSS("padding-top", "2px");
      for (const [tag, size] of [["h1", 20], ["h2", 18], ["h3", 16]] as const) {
        await expect.soft(editor.locator(tag)).toHaveCSS("font-size", `${size}px`);
        await expect.soft(editor.locator(tag)).toHaveCSS("font-weight", "600");
      }
      await expect.soft(editor.locator("strong")).toHaveCSS("font-weight", "700");
      expect.soft(await editor.locator("pre").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
      expect.soft(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const background = await editor.evaluate((el) => {
        for (let parent: Element | null = el; parent; parent = parent.parentElement) {
          const value = getComputedStyle(parent).backgroundColor;
          if (value !== "rgba(0, 0, 0, 0)" && value !== "transparent") return value;
        }
        return "transparent";
      });
      expect.soft(background).toBe(colorScheme === "dark" ? "rgb(28, 28, 28)" : "rgb(255, 255, 255)");
      if (colorScheme === "dark") await expect.soft(paragraph).toHaveCSS("color", "rgb(242, 242, 242)");
      if (width < 1024) await page.getByRole("button", { name: "사이드바 열기" }).click();
      const inbox = page.locator('[data-folder-select="기본함"]');
      const selectedColor = colorScheme === "dark" ? "rgb(50, 50, 50)" : "rgb(232, 232, 232)";
      await expect.soft(inbox).toHaveCSS("background-color", selectedColor);
      await expect.soft(row).toHaveCSS("background-color", selectedColor);
      await expect.soft(row).toHaveCSS("font-size", "14px");
      await expect.soft(inbox).toHaveCSS("font-weight", "500");
      await expect.soft(inbox.locator(".truncate")).toHaveCSS("font-weight", "700");
      await expect.soft(inbox.locator(".tabular-nums")).toHaveCSS("font-weight", "500");
      await expect.soft(row).toHaveCSS("height", width < 768 ? "44px" : "40px");
      const selectedTitle = row.locator(".note-list-title");
      await expect.soft(selectedTitle).toHaveCSS("font-weight", "600");
      await expect.soft(selectedTitle).toHaveAttribute("aria-current", "true");
      const otherTitle = page.locator('.note-list-title:not([aria-current="true"])').first();
      const divider = await otherTitle.evaluate((el) => {
        const style = getComputedStyle(el, "::after");
        return { width: style.borderBottomWidth, color: style.borderBottomColor, left: style.left, pointer: style.pointerEvents, opacity: style.opacity };
      });
      expect.soft(divider).toEqual({ width: "1px", color: colorScheme === "dark" ? "rgb(44, 44, 44)" : "oklch(0.928 0.006 264.531)", left: "10px", pointer: "none", opacity: "1" });
      expect.soft(await selectedTitle.evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("0");
      if (width < 1024) await page.getByRole('button', { name: '← 폴더로 돌아가기' }).click();
      await page.keyboard.press("Tab");
      await inbox.focus();
      expect.soft(await inbox.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
      await page.screenshot({ path: testInfo.outputPath("sidebar.png") });
      const after = await page.evaluate(async (p) => window.__qa_readVaultFile?.(p), path);
      expect(after).toBe(markdown);
    });
  }
}
