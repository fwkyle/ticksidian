import { test, expect } from '@playwright/test';

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [375, 1280]) {
    test(`할 일 한 줄·체크 대비·키보드 완료 ${colorScheme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await expect(page.locator('.bn-editor')).toBeVisible();
      if (width < 768) await page.getByRole('button', { name: '사이드바 열기', exact: true }).click();
      await page.locator('[data-folder-select="전체"]').click();
      const column = page.locator('[data-note-column]');
      await column.getByRole('button', { name: /^할 일/ }).click();
      await column.getByRole('button', { name: '완료한 할 일 보이기' }).click();
      const row = column.locator('[data-list-item="세금계산서 발행"]');
      await expect(row).toHaveCSS('height', width < 768 ? '44px' : '40px');
      await expect(row.locator('[aria-hidden="true"]')).toHaveCount(0);
      const check = row.locator('[data-todo-check]');
      await expect(check).toHaveCSS('border-top-width', '2px');
      const border = await check.evaluate(el => getComputedStyle(el).borderTopColor);
      const measureContrast = () => row.evaluate((el, border) => {
        const rgb = (value: string) => (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const luminance = (values: number[]) => values.map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        let parent: Element | null = el;
        let background = 'rgb(255, 255, 255)';
        while (parent) {
          const color = getComputedStyle(parent).backgroundColor;
          if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { background = color; break; }
          parent = parent.parentElement;
        }
        const a = luminance(rgb(border)), b = luminance(rgb(background));
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      }, border);
      expect(await measureContrast()).toBeGreaterThanOrEqual(3);
      await row.getByRole('button', { name: '세금계산서 발행', exact: true }).click();
      await expect(page.locator('.bn-editor')).toContainText('세금계산서 발행');
      if (width < 768) await page.getByRole('button', { name: '사이드바 열기', exact: true }).click();
      await expect(row).toHaveClass(/bg-selection/);
      expect(await measureContrast()).toBeGreaterThanOrEqual(3);
      const dueRow = column.locator('[data-list-item="멘토님 연락"]');
      const titleWidth = await dueRow.getByRole('button', { name: '멘토님 연락', exact: true }).locator('span').first().evaluate(el => el.getBoundingClientRect().width);
      expect(titleWidth).toBeGreaterThan(40);
      const toggle = row.getByRole('button', { name: '세금계산서 발행 완료', exact: true });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await toggle.press('Space');
      const undo = row.getByRole('button', { name: '세금계산서 발행 완료 취소', exact: true });
      await expect(undo).toHaveAttribute('aria-pressed', 'true');
      await undo.press('Space');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await column.screenshot({ path: testInfo.outputPath('todo-column.png') });
    });
  }
}

test('NFD 이미지 파일을 NFC 링크로 재열기하고 저장해도 원문과 파일이 유지된다', async ({ page }) => {
  const path = '/mock-vault/inbox/unicode-image.md';
  const target = 'attachments/한글 경로/한글 경로 1.png';
  const actualPath = `/mock-vault/${target}`.normalize('NFD');
  const content = `# 한글 경로 검증\n\n![[${target}]]\n\n검증 본문\n`;
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  await page.evaluate(async ({ path, content, actualPath }) => {
    const qa = window as Window & {
      __qa_writeVaultFile: (p: string, c: string) => Promise<void>;
      __qa_writeVaultBinary: (p: string, bytes: Uint8Array) => Promise<void>;
    };
    const binary = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4zxAQAAAE8QGgicpvvwAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    await qa.__qa_writeVaultBinary(actualPath, binary);
    await qa.__qa_writeVaultFile(path, content);
  }, { path, content, actualPath });
  const read = () => page.evaluate(p => window.__qa_readVaultFile?.(p), path);
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(page.locator('.bn-editor')).toBeVisible();
    await page.locator('[data-note-column]').getByRole('button', { name: '한글 경로 검증', exact: true }).click();
    const image = page.locator('.bn-editor img[src^="blob:"]');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    expect(await read()).toContain(`![[${target}]]`);
  }
  const paragraph = page.locator('.bn-editor').getByText('검증 본문', { exact: true });
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' 추가');
  await expect.poll(read).toContain('추가');
  expect(await read()).toContain(`![[${target}]]`);
  expect(await read()).not.toContain('blob:');
  const binaryLength = await page.evaluate(async p => {
    const qa = window as Window & { __qa_readVaultBinary: (p: string) => Promise<Uint8Array> };
    return (await qa.__qa_readVaultBinary(p)).length;
  }, actualPath);
  expect(binaryLength).toBe(70);
});
