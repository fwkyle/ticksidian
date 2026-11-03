import { test, expect, type Page } from '@playwright/test';

// 2026-10-30 검색 결과 끌어 옮기기·최신순. Chromium 브라우저 fixture 한정(WebKit·실제 Tauri 끌어 놓기는 [kyle] 잔여).
const column = (page: Page) => page.locator('[data-note-column]');
const results = (page: Page) => column(page).getByRole('listbox');
const hitRow = (page: Page, title: string) => column(page).locator(`[data-search-item="${title}"]`);

async function file(page: Page, path: string) {
  return page.evaluate(async p => { try { return await window.__qa_readVaultFile?.(p); } catch { return null; } }, path);
}

async function ready(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
}

async function search(page: Page, query: string) {
  await column(page).getByRole('button', { name: '검색 열기' }).click();
  await column(page).getByRole('textbox', { name: '노트 검색' }).fill(query);
}

/** 이동 뒤 재검색 동안 빈 상태·찾는 중 표시가 한 번이라도 나타났는지 기록한다. */
async function watchEmptyFlash(page: Page) {
  await page.evaluate(() => {
    const seen = { flashed: false };
    (window as Window & { __qa_searchFlash?: typeof seen }).__qa_searchFlash = seen;
    const check = () => {
      const text = document.querySelector('[data-note-column]')?.textContent ?? '';
      if (text.includes('결과가 없습니다') || text.includes('기록을 찾는 중')) seen.flashed = true;
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const flashed = (page: Page) => page.evaluate(() =>
  (window as Window & { __qa_searchFlash?: { flashed: boolean } }).__qa_searchFlash?.flashed);

test('검색 결과를 폴더로 끌어 놓으면 옮겨지고 결과는 열린 채 새 위치를 보여준다', async ({ page }) => {
  await ready(page);
  await search(page, '노트');
  const row = hitRow(page, '알파 노트');
  await expect(row).toBeVisible();
  await expect(row).toContainText('notes');
  await row.hover();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  const before = await file(page, '/mock-vault/notes/note-alpha.md');
  await watchEmptyFlash(page);
  await row.dragTo(page.locator('[data-folder-select="lectures"]'), { sourcePosition: { x: 2, y: 2 } });
  await expect.poll(() => file(page, '/mock-vault/lectures/note-alpha.md')).toBe(before);
  expect(await file(page, '/mock-vault/notes/note-alpha.md')).toBeNull();
  await expect(row).toContainText('lectures');
  await expect(column(page).getByRole('textbox', { name: '노트 검색' })).toHaveValue('노트');
  await page.waitForTimeout(600); // 재검색(250ms 대기 + 읽기)이 끝난 뒤까지 본다
  await expect(row).toContainText('lectures');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  expect(await flashed(page)).toBe(false);
});

test('검색 결과를 전체(볼트 최상위)로 끌어 놓아도 같은 이동 경로로 옮겨진다', async ({ page }) => {
  await ready(page);
  await search(page, '베타');
  const row = hitRow(page, '베타 노트');
  await expect(row).toBeVisible();
  const before = await file(page, '/mock-vault/notes/note-beta.md');
  await watchEmptyFlash(page);
  await row.dragTo(page.locator('[data-folder-select="전체"]'), { sourcePosition: { x: 2, y: 2 } });
  await expect.poll(() => file(page, '/mock-vault/note-beta.md')).toBe(before);
  await expect(row).toContainText('볼트 최상위');
  await page.waitForTimeout(600);
  await expect(row).toBeVisible();
  expect(await flashed(page)).toBe(false);
});

test('그림 검색 결과는 끌 수 없다', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__qa_writeVaultFile?.('/mock-vault/검색그림.excalidraw',
    JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: [], appState: {}, files: {} })));
  await page.reload();
  await expect(page.locator('.bn-editor')).toBeVisible();
  await search(page, '검색그림');
  const row = column(page).getByRole('option').filter({ hasText: '검색그림' });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('draggable', 'false');
  await expect(hitRow(page, '알파 노트')).toHaveCount(0);
});

test('최신순: Enter는 일치도보다 최근에 고친 첫 결과를 연다', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    await window.__qa_writeVaultFile?.('/mock-vault/notes/오래된-정확.md',
      '---\nid: "old-exact"\nupdatedAt: "2020-01-01T00:00:00.000Z"\n---\n# 귤나무qz\n');
    await window.__qa_writeVaultFile?.('/mock-vault/notes/최근-본문.md',
      '---\nid: "recent-body"\nupdatedAt: "2099-01-01T00:00:00.000Z"\n---\n# 최근 본문 기록\n\n오늘 귤나무qz 심음\n');
  });
  await page.reload();
  await expect(page.locator('.bn-editor')).toBeVisible();
  await search(page, '귤나무qz');
  const options = results(page).getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText('최근 본문 기록');
  await expect(options.nth(1)).toContainText('귤나무qz');
  await column(page).getByRole('textbox', { name: '노트 검색' }).press('Enter');
  await expect(page.locator('.bn-editor')).toContainText('오늘 귤나무qz 심음');
});

test('열린 편집기 노트를 검색 결과에서 끌어도 목록 끌기와 같은 실패 처리로 원본을 지킨다', async ({ page }) => {
  await ready(page);
  await page.locator('[data-folder-select="전체"]').click();
  await column(page).getByRole('button', { name: '알파 노트', exact: true }).click();
  await expect(page.locator('.bn-editor')).toContainText('알파 노트');
  await page.evaluate(async () => window.__qa_writeVaultFile?.('/mock-vault/lectures/note-alpha.md', '목적지 원본'));
  await search(page, '알파');
  await hitRow(page, '알파 노트').dragTo(page.locator('[data-folder-select="lectures"]'), { sourcePosition: { x: 2, y: 2 } });
  await expect(page.getByText(/노트를 옮기지 못했습니다/)).toBeVisible();
  expect(await file(page, '/mock-vault/lectures/note-alpha.md')).toBe('목적지 원본');
  expect(await file(page, '/mock-vault/notes/note-alpha.md')).toContain('알파 노트');
});
