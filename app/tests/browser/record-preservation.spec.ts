import { test, expect, type Page } from '@playwright/test';

const column = (page: Page) => page.locator('[data-note-column]');
const noteButton = (page: Page, title: string) => column(page).getByRole('button', { name: title, exact: true });
async function read(page: Page, path: string) {
  return page.evaluate(async p => {
    try { return await (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> }).__qa_readVaultFile(p); }
    catch { return null; }
  }, path);
}
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  await page.locator('[data-folder-select="전체"]').click();
}

for (const opened of [false, true]) {
  test(`할 일 표시 왕복은 태그와 날짜를 보존한다 — ${opened ? '열린' : '닫힌'} 기록`, async ({ page }) => {
    await ready(page);
    await column(page).getByRole('button', { name: /^할 일/ }).click();
    const target = noteButton(page, '멘토님 연락');
    if (opened) {
      await target.click();
      await expect(page.locator('.bn-editor')).toContainText('멘토님 연락');
    }
    const before = await read(page, '/mock-vault/notes/todo-beta.md');
    expect(before).toContain('2026-01-15');
    await target.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /노트로 되돌리기|할 일 표시 해제/ }).click();
    await expect.poll(() => read(page, '/mock-vault/notes/todo-beta.md')).not.toContain('type: "todo"');
    const after = await read(page, '/mock-vault/notes/todo-beta.md');
    expect(after).toContain('2026-01-15');
    expect(after).toContain('manual-review');
    expect(after).toContain('ticktick-import');
    expect(after).toContain('done: false');
    await page.reload();
    await expect(page.locator('.bn-editor')).toBeVisible();
    await page.locator('[data-folder-select="전체"]').click();
    await column(page).getByRole('button', { name: /^노트$|^기록$/ }).click();
    await noteButton(page, '멘토님 연락').click();
    await expect(page.locator('.bn-editor')).toContainText('멘토님 연락');
    await noteButton(page, '멘토님 연락').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /투두로 변환|할 일로 표시/ }).click();
    await expect.poll(() => read(page, '/mock-vault/notes/todo-beta.md')).toContain('type: "todo"');
    const restored = await read(page, '/mock-vault/notes/todo-beta.md');
    expect(restored).toContain('2026-01-15');
    expect(restored).toContain('manual-review');
  });
}

test('열린 기록을 폴더로 끌면 미저장 글을 보존하고 새 경로로 이어 쓴다', async ({ page }) => {
  await ready(page);
  await noteButton(page, '알파 노트').click();
  await expect(page.locator('.bn-editor')).toContainText('알파 노트');
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.insertText('이동직전보존');
  await column(page).locator('[data-list-item="알파 노트"]').dragTo(page.locator('[data-folder-select="lectures"]'), { sourcePosition: { x: 2, y: 2 } });
  await expect.poll(() => read(page, '/mock-vault/lectures/note-alpha.md')).toContain('이동직전보존');
  expect(await read(page, '/mock-vault/notes/note-alpha.md')).toBeNull();
  await expect(page.locator('[data-note-info-bar]')).toContainText('lectures');
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.insertText('이동뒤보존');
  await expect.poll(() => read(page, '/mock-vault/lectures/note-alpha.md')).toContain('이동뒤보존');
  expect(await read(page, '/mock-vault/notes/note-alpha.md')).toBeNull();
});
