import { test, expect, type Page } from '@playwright/test';
const key = 'ticksidian.editor-diagnostics.v1';
const path = '/mock-vault/notes/note-gamma.md';
const external = '---\nid: "note-gamma"\naliases: []\n---\n# 감마 노트\n\nPRIVATE_EXTERNAL_BODY\n';
async function openGamma(page: Page) {
  await page.goto('/');
  await page.getByLabel('빠른 기록 제목').waitFor();
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole('button', { name: /감마 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText('감마 노트');
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
}
async function simulateExternal(page: Page) {
  await page.evaluate(async ({ path, external }) => {
    const simulate = (window as Window & { __qa_simulateExternalEdit?: (p: string, c: string) => Promise<void> }).__qa_simulateExternalEdit;
    if (!simulate) throw new Error('Fixture helper unavailable');
    await simulate(path, external);
  }, { path, external });
}
async function readEvents(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, unknown>>, key);
}

test('저장 직전 충돌 근거를 보관하고 본문 없이 내려받으며 재시작 뒤 유지한다', async ({ page }) => {
  await openGamma(page);
  await page.locator('.bn-editor').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' PRIVATE_LOCAL_BODY');
  await simulateExternal(page);
  await expect(page.getByText('외부 수정 대기 중', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect.poll(async () => (await readEvents(page)).some(e => e.event === 'save-blocked')).toBe(true);
  const before = await readEvents(page);
  const blocked = before.find(e => e.event === 'save-blocked');
  expect(blocked?.path).toBe(path);
  expect(blocked?.observedMtime).not.toBe(blocked?.baselineMtime);
  expect(blocked?.dirty).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '오류 기록 받기', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^ticksidian-errors-.*\.json$/);
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Download stream missing');
  let contents = '';
  for await (const chunk of stream) contents += chunk.toString();
  expect(contents).not.toContain('PRIVATE_');
  expect(JSON.parse(contents).entries).toEqual(before);
  expect(await page.evaluate(p => (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> }).__qa_readVaultFile?.(p), path)).toBe(external);
  await page.reload();
  await page.getByLabel('빠른 기록 제목').waitFor();
  await expect.poll(async () => (await readEvents(page)).some(e => e.at === blocked?.at && e.event === 'save-blocked')).toBe(true);
});

test('외부 폴링 재로드와 읽기 실패도 원문 오류 없이 기록한다', async ({ page }) => {
  await openGamma(page);
  await page.evaluate(p => {
    (window as Window & { __qa_failNextReads?: (p: string, n: number) => void }).__qa_failNextReads?.(p, 1);
  }, path);
  await simulateExternal(page);
  await expect(page.getByText('노트를 불러오는데 실패했습니다.', { exact: true })).toBeVisible({ timeout: 12000 });
  const events = await readEvents(page);
  expect(events.some(e => e.event === 'external-reload' && e.stage === 'poll')).toBe(true);
  expect(events.some(e => e.event === 'load-failed' && e.stage === 'external')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('PRIVATE_');
  await expect(page.getByRole('button', { name: '오류 기록 받기' })).toBeVisible();
});

test('localStorage가 막혀도 자동 저장은 성공하고 보관 한계를 표시한다', async ({ page }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      original.call(this, name, value);
    };
  }, key);
  await openGamma(page);
  await page.locator('.bn-editor').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' continued-saving');
  await expect(page.getByText('기록은 앱을 닫으면 사라질 수 있습니다')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
  await expect.poll(async () => await page.evaluate(p => (window as Window & { __qa_readVaultFile?: (p: string) => Promise<string> }).__qa_readVaultFile?.(p), path)).toContain('continued-saving');
});
