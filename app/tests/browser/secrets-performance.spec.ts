import { devices, expect, test, type Page } from "@playwright/test";

test.use({ ...devices["Desktop Safari"], browserName: "webkit" });

async function openHarness(page: Page, count: number) {
  await page.route("**/__secrets-performance?*", route => route.fulfill({
    contentType: "text/html",
    body: '<html><body style="margin:0"><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true; await import("/tests/browser/fixtures/secrets-performance.tsx");</script></body></html>',
  }));
  await page.goto(`/__secrets-performance?count=${count}`);
  await expect(page.getByRole("button", { name: "archive 폴더 펼치기", exact: true })).toBeVisible();
}

const rows = (page: Page) => page.locator('button[aria-current], button[aria-expanded]');

for (const count of [5000, 77117]) {
  test(`${count}개 경로: 첫 글자 검색도 표시 행 상한 유지`, async ({ page }, testInfo) => {
    await openHarness(page, count);
    const input = page.getByLabel("보안 메모 경로 필터");
    await input.pressSequentially("a");
    await expect(page.getByRole("button", { name: "archive 폴더 접기", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__secretMetrics.inputFrames.length)).toBeGreaterThan(0);
    const measurement = { count, rows: await rows(page).count(), ...await page.evaluate(() => window.__secretMetrics) };
    await testInfo.attach("search-cost", { body: JSON.stringify(measurement, null, 2), contentType: "application/json" });
    console.log(JSON.stringify(measurement));
    expect(measurement.rows).toBeLessThanOrEqual(100);
    await input.pressSequentially("w");
    await expect(page.getByRole("button", { name: "archive 폴더 접기", exact: true })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(99);
    expect(await page.evaluate(() => window.__secretMetrics.calls)).toEqual(["list_secret_files"]);
  });
}

test("페이지를 넘겨 모든 결과 접근, 선택·가림 유지, 검색 변경은 첫 페이지", async ({ page }) => {
  await openHarness(page, 240);
  const input = page.getByLabel("보안 메모 경로 필터");
  await input.fill("a");
  const next = page.getByRole("button", { name: "보안 메모 다음 페이지" });
  const previous = page.getByRole("button", { name: "보안 메모 이전 페이지" });
  await expect(previous).toBeDisabled();
  const paths = new Set<string>();
  while (true) {
    for (const path of await page.locator("button[aria-current] > span:first-child").allTextContents()) paths.add(path);
    if (await next.isDisabled()) break;
    await next.click();
  }
  expect(paths.size).toBe(240);
  await expect(page.getByRole("status")).toHaveText("201–249 / 249행");
  const file = page.locator("button[aria-current]").last();
  await file.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("TOKEN=", { exact: true })).toBeVisible();
  await expect(page.getByText("fake-performance-value", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "값 표시", exact: true }).click();
  await expect(page.getByText("fake-performance-value", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("201–249 / 249행");
  await input.fill("archive");
  await expect(previous).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("1–100 / 150행");
  await input.fill("unmatched");
  await expect(page.getByText("필터에 맞는 파일이 없습니다.")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await input.fill("");
  // 검색 중 선택한 aws 파일의 조상만 열린 상태를 보존한다.
  await expect(page.getByRole("button", { name: "archive 폴더 펼치기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "aws 폴더 접기", exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(100);
  expect(await page.evaluate(() => window.__secretMetrics.calls)).toEqual(["list_secret_files", "read_secret_file"]);
});

test("77,117개 중 마지막 파일도 검색하고 검색 밖 펼침에도 상한 적용", async ({ page }) => {
  await openHarness(page, 77117);
  const input = page.getByLabel("보안 메모 경로 필터");
  await input.fill(" FILE-77116 ");
  const last = page.getByRole("button", { name: /archive\/group-03084\/file-77116.env/ });
  await expect(last).toBeVisible();
  await last.click();
  await expect(page.getByText("TOKEN=", { exact: true })).toBeVisible();
  await input.fill("");
  await expect(page.getByRole("button", { name: "archive 폴더 접기", exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(100);
  await page.getByRole("button", { name: "보안 메모 다음 페이지" }).click();
  await expect(page.getByRole("status")).toContainText("101–200");
  await input.fill("aw");
  await expect(rows(page)).toHaveCount(99);
  await expect(page.getByRole("navigation", { name: "보안 메모 목록 페이지" })).toHaveCount(0);
});
