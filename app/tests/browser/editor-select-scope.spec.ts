import { test, expect, type Page } from "@playwright/test";

async function openNote(page: Page) {
  await page.goto("/");
  await page.getByLabel("빠른 기록 제목").waitFor();
  await expect(page.locator(".bn-editor")).toBeFocused();
  await page.locator('[data-folder-select="전체"]').click();
  await page.getByRole("button", { name: /알파 노트/ }).first().click();
  await expect(page.locator(".bn-editor h1").first()).toHaveText("알파 노트");
  // 제목 DOM 교체만으로 로드 후 포커스 effect까지 끝났다고 가정하지 않는다.
  await expect(page.getByText("저장됨", { exact: true })).toBeVisible();
  await expect(page.locator(".bn-editor")).toBeFocused();
}

for (const key of ["Meta+a", "Control+a"]) {
  test(`${key}: 본문 반복 전체 선택 후 교체해도 제목 유지`, async ({ page }) => {
    await openNote(page);
    await page.locator('.bn-editor [data-content-type="paragraph"]').first().click();
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    expect(selected).toBeTruthy();
    expect(selected).not.toContain("알파 노트");
    await page.keyboard.insertText("교체된 본문");
    await expect(page.locator(".bn-editor h1").first()).toHaveText("알파 노트");
    await expect(page.locator(".bn-editor")).toContainText("교체된 본문");
  });

  test(`${key}: 제목 전체 선택은 본문을 보존`, async ({ page }) => {
    await openNote(page);
    const body = page.locator('.bn-editor [data-content-type="paragraph"]').first();
    const before = await body.textContent();
    await page.locator(".bn-editor h1").first().click();
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("알파 노트");
    await page.keyboard.insertText("새 제목");
    await expect(page.locator(".bn-editor h1").first()).toHaveText("새 제목");
    await expect(body).toHaveText(before ?? "");
  });
}

test("기본 열 경계는 270/590px, 구분선은 1px", async ({ page }) => {
  await openNote(page);
  const notes = await page.locator("[data-note-column]").boundingBox();
  expect(notes?.x).toBe(270);
  expect(notes?.width).toBe(319);
  for (const panel of ["folder", "notes"]) {
    expect((await page.locator(`[data-panel-resizer="${panel}"]`).boundingBox())?.width).toBe(1);
  }
});

test("본문 삭제 후에도 제목과 다시 입력할 본문이 남는다", async ({ page }) => {
  await openNote(page);
  await page.locator('.bn-editor [data-content-type="paragraph"]').first().click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".bn-editor h1").first()).toHaveText("알파 노트");
  await page.keyboard.insertText("다시 기록");
  await expect(page.locator(".bn-editor h1").first()).toHaveText("알파 노트");
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toContainText(["다시 기록"]);
});

test("제목을 비워도 본문 선택 범위로 확대되지 않는다", async ({ page }) => {
  await openNote(page);
  await page.locator(".bn-editor h1").first().click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText("복원 제목");
  await expect(page.locator(".bn-editor h1").first()).toHaveText("복원 제목");
  await expect(page.locator(".bn-editor")).toContainText("브라우저 QA 테스트용 첫 번째 노트입니다.");
});

test("검색 입력의 전체 선택은 기존대로 유지한다", async ({ page }) => {
  await openNote(page);
  await page.getByRole("button", { name: "검색 열기", exact: true }).click();
  const search = page.getByLabel("노트 검색");
  await search.fill("알파");
  await search.press("Meta+a");
  await search.press("Backspace");
  await expect(search).toHaveValue("");
  await expect(page.locator(".bn-editor h1").first()).toHaveText("알파 노트");
});

test("본문의 중첩 목록과 코드도 모두 선택하고 제목만 남긴다", async ({ page }) => {
  await openNote(page);
  await page.evaluate(async () => {
    await window.__qa_writeVaultFile?.("/mock-vault/inbox/scope-nested.md", "# 선택 경계\n\n첫 문단\n\n- 부모\n  - 자식\n\n```js\nconst nested = 1;\n```\n\n끝 문단\n");
  });
  await page.reload();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.getByRole("button", { name: "선택 경계", exact: true }).click();
  await expect(page.locator(".bn-editor h1")).toHaveText("선택 경계");
  await page.locator(".bn-editor pre").click();
  await page.keyboard.press("Meta+a");
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  for (const text of ["첫 문단", "부모", "자식", "const nested", "끝 문단"]) expect(selected).toContain(text);
  expect(selected).not.toContain("선택 경계");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".bn-editor h1")).toHaveText("선택 경계");
  await expect(page.locator(".bn-editor pre")).toHaveCount(0);
});

test("첫 본문이 이미지여도 전체 선택 삭제에서 빠지지 않는다", async ({ page }) => {
  await openNote(page);
  await page.evaluate(async () => {
    await window.__qa_writeVaultFile?.("/mock-vault/inbox/scope-image.md", "# 이미지 선택\n\n![[픽스처-이미지.png]]\n\n끝 문단\n");
  });
  await page.reload();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.getByRole("button", { name: "이미지 선택", exact: true }).click();
  await expect(page.locator(".bn-editor h1")).toHaveText("이미지 선택");
  await expect(page.locator(".bn-editor img")).toHaveCount(1);
  await page.locator('.bn-editor [data-content-type="paragraph"]').first().click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText("전체 교체");
  await expect(page.locator(".bn-editor h1")).toHaveText("이미지 선택");
  await expect(page.locator(".bn-editor img")).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".bn-editor img")).toHaveCount(1);
  await page.locator('.bn-editor [data-content-type="paragraph"]').first().click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".bn-editor h1")).toHaveText("이미지 선택");
  await expect(page.locator(".bn-editor img")).toHaveCount(0);
  await page.keyboard.insertText("이미지 대신 기록");
  await expect(page.locator(".bn-editor h1")).toHaveText("이미지 선택");
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toContainText(["이미지 대신 기록"]);
});
