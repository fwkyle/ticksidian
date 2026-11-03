import { test, expect } from '@playwright/test';

test('기록과 할 일은 서로 분리되며 가져온 항목도 할 일에서 찾는다', async ({ page }) => {
  await page.goto('/');
  const column = page.locator('[data-note-column]');
  await expect(column.getByRole('button', { name: '기록', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '전체 할 일 보기', exact: true }).click();
  await expect(column.getByRole('heading', { name: '할 일', exact: true })).toBeVisible();
  await expect(column.getByRole('button', { name: '멘토님 연락', exact: true })).toBeVisible();
  await page.locator('[data-folder-select="전체"]').click();
  await expect(column.getByRole('group', { name: '종류 필터' }).getByRole('button', { name: /^할 일/ })).toHaveAttribute('aria-pressed', 'true');
  await column.getByRole('button', { name: '기록', exact: true }).click();
  await expect(column.getByRole('button', { name: '기록', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(column.getByText(/가져온 할 일/)).toHaveCount(0);
  await expect(column.getByRole('button', { name: /완료한 할 일/ })).toHaveCount(0);
  await expect(column.getByRole('button', { name: '멘토님 연락', exact: true })).not.toBeVisible();
  await column.getByRole('button', { name: /^할 일/ }).click();
  await expect(column.getByRole('button', { name: '멘토님 연락', exact: true })).toBeVisible();
});

// 2026-09-22: Cmd+N은 보고 있는 탭을 따른다. 이 검사는 할 일 탭에서 만든 빈 항목이
// 이미 할 일이라는 것과, 종류 표시를 나중에 되돌릴 수 있다는 것을 본다.
// (기록 탭의 Cmd+N·폴더 규칙은 p2-shortcuts.spec.ts가 본다.)
test('할 일 탭 Cmd+N은 빈 할 일로 시작하고 종류 표시는 나중에 바꿀 수 있다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '전체 할 일 보기', exact: true }).click();
  await page.keyboard.press("Control+n");
  await expect(page.locator('[data-note-column]').getByRole('heading', { name: '기본함', exact: true })).toBeVisible();
  const title = page.locator('.bn-editor [data-content-type="heading"]').first();
  await expect(title).toHaveText('');
  await title.click();
  await page.keyboard.insertText('한 입구로 기록');
  await expect(page.locator('[data-note-column] [data-list-item="한 입구로 기록"]')).toBeVisible();
  // 할 일로 만들어졌으므로 정보 줄은 이미 "할 일 표시 해제" 상태다.
  await expect(page.getByRole('button', { name: '할 일 표시 해제', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '할 일 표시 해제', exact: true }).click();
  await expect(page.getByRole('button', { name: '할 일로 표시', exact: true })).toBeVisible();
  // 할 일 목록에서 빠진다(더 이상 할 일이 아니다).
  await expect(page.locator('[data-note-column] [data-list-item="한 입구로 기록"]')).toHaveCount(0);
});
