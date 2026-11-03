import { test, expect } from '@playwright/test';

for (const width of [375, 1440]) test(`본문 검색 ${width}px: 준비 작업 없이 모든 폴더를 찾고 목록과 결과를 섞지 않는다`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: width === 375 ? 'light' : 'dark' });
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  if (width < 1024) {
      await page.getByRole('button', { name: '사이드바 열기' }).click();
      await page.locator('[data-folder-select="기본함"]').click();
    }
  const column = page.locator('[data-note-column]');
  await column.getByRole('button', { name: '검색 열기' }).click();
  await column.getByRole('textbox', { name: '노트 검색' }).fill('frontmatter 없는');
  await expect(column.getByRole('option').filter({ hasText: '맨몸 메모' })).toBeVisible();
  await expect(column.getByText('모든 폴더 · 제목·본문·태그')).toBeVisible();
  await expect(column.locator('[data-list-item]')).toHaveCount(0);
  await expect(column.getByRole('option').filter({ hasText: '맨몸 메모' })).toContainText('본문:');
  expect(await column.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('local-search.png') });
  await column.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(column.locator('[data-list-item="맨몸 메모"]')).toBeVisible();
});

test('AI 정리는 선택한 기록을 바로 읽고 건너뛰어도 전송이나 이동하지 않는다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  await page.locator('[data-note-column]').getByRole('button', { name: '맨몸 메모', exact: true }).click();
  await page.getByRole('button', { name: 'AI 정리 열기/닫기' }).click();
  await expect(page.getByLabel('정리할 기본함 노트')).toHaveValue('inbox/맨몸-메모.md');
  await expect(page.getByRole('button', { name: 'Gemini로 폴더 추천' })).toBeEnabled();
  await page.getByRole('button', { name: '건너뛰고 다음 기록' }).click();
  await expect(page.getByLabel('정리할 기본함 노트')).not.toHaveValue('inbox/맨몸-메모.md');
  await expect(page.locator('[data-list-item="거대 덤프"]').getByRole('button', { name: '거대 덤프', exact: true })).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => window.__qa_inboxOrganizer.calls.length)).toBe(0);
  expect(await page.evaluate(() => window.__qa_readVaultFile?.('/mock-vault/inbox/맨몸-메모.md'))).toContain('frontmatter 없는');
  await page.locator('[data-note-column]').getByRole('button', { name: '맨몸 메모', exact: true }).click();
  await expect(page.getByRole('region', { name: '기본함 AI 정리' })).toBeVisible();
  await expect(page.getByLabel('정리할 기본함 노트')).toHaveValue('inbox/맨몸-메모.md');
});
