import { test, expect } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`${width}px 폴더 상단은 인증·모드 표시 없이 기본함으로 이어진다`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    for (let pass = 0; pass < 2; pass += 1) {
      if (pass === 1) await page.reload();
      await expect(page.locator(".bn-editor")).toBeVisible();
      if (width < 768) {
        await page.getByRole("button", { name: "사이드바 열기" }).click();
        await expect.poll(async () => {
          const drawer = await page.locator("[data-sidebar-drawer]").boundingBox();
          return drawer ? Math.abs(drawer.x) : Infinity;
        }).toBeLessThanOrEqual(1);
      }
      const folder = page.locator("[data-folder-column]");
      await expect(folder.getByRole("heading", { name: "Ticksidian", exact: true })).toBeVisible();
      await expect(folder.getByRole("button", { name: /로그인|가입|로그아웃/ })).toHaveCount(0);
      await expect(folder.getByText("로컬 전용", { exact: true })).toHaveCount(0);
      const header = await folder.locator(":scope > div").first().boundingBox();
      expect(header).not.toBeNull();
      expect(header?.height).toBeLessThanOrEqual(64);
      const inbox = folder.locator('[data-folder-select="기본함"]');
      await expect(inbox).toBeVisible();
      await expect(inbox).toHaveAttribute("aria-current", "true");
      const inboxBox = await inbox.boundingBox();
      expect(inboxBox?.y).toBeLessThanOrEqual((header?.y ?? 0) + (header?.height ?? 0) + 9);
    }
    await page.screenshot({ path: testInfo.outputPath(`sidebar-header-${width}.png`) });
  });
}
