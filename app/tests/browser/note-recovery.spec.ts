import { test, expect, type Page } from '@playwright/test';
const path = '/mock-vault/notes/note-gamma.md';
const activeKey = 'ticksidian.note-recovery.v1.active.' + encodeURIComponent(path);
const marker = 'LOCAL-RECOVERY-WRITING';
const external = '---\nid: "note-gamma"\n---\n# 감마 노트\n\nEXTERNAL-RECOVERY-COPY\n';
async function openGamma(page: Page) {
  await page.goto('/');
  await page.getByLabel('빠른 기록 제목').waitFor();
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole('button', { name: /감마 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText('감마 노트');
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
}
async function conflict(page: Page) {
  await openGamma(page);
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.type(marker);
  await page.evaluate(async ({ path, external }) => {
    await (window as Window & { __qa_simulateExternalEdit: (p: string, c: string) => Promise<void> }).__qa_simulateExternalEdit(path, external);
  }, { path, external });
  await expect(page.getByText('파일이 외부에서 수정되었습니다', { exact: true })).toBeVisible({ timeout: 10000 });
}
async function disk(page: Page) {
  return page.evaluate(p => (window as Window & { __qa_readVaultFile: (p: string) => Promise<string> }).__qa_readVaultFile(p), path);
}
async function versions(page: Page) {
  await page.getByText(/보관한 버전 \(/).click();
}

test('충돌 후 새로고침해도 작성본을 먼저 복구하고 파일은 덮어쓰지 않는다', async ({ page }) => {
  await conflict(page);
  expect(await disk(page)).toBe(external);
  expect(await page.evaluate(k => localStorage.getItem(k), activeKey)).toContain(marker);
  await page.reload();
  await page.getByLabel('빠른 기록 제목').waitFor();
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole('button', { name: /감마 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText(marker);
  await expect(page.getByText('미저장 작성본을 복구했습니다. 원본 파일은 바꾸지 않았습니다.')).toBeVisible();
  // fixture 재시작은 원본 seed로 돌아오지만 복구본으로 자동 덮어쓰지 않아야 한다.
  expect(await disk(page)).not.toContain(marker);
});

test('외부본을 불러와도 내 작성본을 볼 수 있고 다시 작성본으로 복원한다', async ({ page }) => {
  await conflict(page);
  await page.getByRole('button', { name: '외부 변경 버전 불러오기' }).click();
  await expect(page.locator('.bn-editor')).toContainText('EXTERNAL-RECOVERY-COPY');
  await versions(page);
  await page.getByRole('button', { name: /내 작성본 ·/ }).first().click();
  await expect(page.getByLabel('보관한 버전 내용')).toHaveValue(new RegExp(marker));
  await page.getByRole('button', { name: '이 버전을 작성본으로 복원' }).click();
  await expect(page.locator('.bn-editor')).toContainText(marker);
  expect(await disk(page)).toBe(external);
});

test('내 글을 저장하기 전에 외부본을 보관하고 나중에 그 내용을 확인한다', async ({ page }) => {
  await conflict(page);
  await page.getByRole('button', { name: '내 변경 유지' }).click();
  await expect.poll(() => disk(page)).toContain(marker);
  await versions(page);
  await page.getByRole('button', { name: /외부 버전 ·/ }).click();
  await expect(page.getByLabel('보관한 버전 내용')).toHaveValue(external);
});

test('보관 실패 시 외부본 선택/내 글 덮어쓰기를 모두 멈추고 화면의 글을 유지한다', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.startsWith('ticksidian.note-recovery.v1.')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      original.call(this, name, value);
    };
  });
  await conflict(page);
  await page.getByRole('button', { name: '외부 변경 버전 불러오기' }).click();
  await expect(page.getByText('작성본을 보관하지 못해 외부 버전을 불러오지 않았습니다. 현재 글을 복사해 주세요.')).toBeVisible();
  await expect(page.locator('.bn-editor')).toContainText(marker);
  await page.getByRole('button', { name: '내 변경 유지' }).click();
  await expect(page.getByText('외부 버전을 보관하지 못해 덮어쓰기를 멈췄습니다. 현재 글은 유지합니다.')).toBeVisible();
  expect(await disk(page)).toBe(external);
});

test('노트를 바꿨다가 돌아와도 미저장 본문을 복구한다', async ({ page }) => {
  await conflict(page);
  await page.getByRole('button', { name: /알파 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText('알파 노트');
  await page.getByRole('button', { name: /감마 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText(marker);
  expect(await disk(page)).toBe(external);
});

test('복구본의 태그·할 일 메타·즐겨찾기는 재열기 뒤 유지한다', async ({ page }) => {
  await conflict(page);
  await page.evaluate(k => {
    const value = JSON.parse(localStorage.getItem(k) ?? 'null');
    value.meta.tags = ['복구태그']; value.meta.todoMeta = { type: 'todo', done: true, priority: 'high' }; value.meta.favorite = true;
    localStorage.setItem(k, JSON.stringify(value));
  }, activeKey);
  // beforeunload가 현재 메타로 다시 쓰지 않도록 최초 페이지 기록을 다음 탐색에서 주입한다.
  const saved = await page.evaluate(k => localStorage.getItem(k), activeKey);
  await page.addInitScript(({ k, saved }) => { if (saved) localStorage.setItem(k, saved); }, { k: activeKey, saved });
  await page.reload();
  await page.getByLabel('빠른 기록 제목').waitFor();
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole('button', { name: /감마 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText(marker);
  await expect(page.getByRole('button', { name: '복구태그 태그로 검색' })).toBeVisible();
  await expect(page.getByRole('button', { name: '할 일 표시 해제' })).toBeVisible();
  await expect(page.getByRole('button', { name: '즐겨찾기 해제' })).toBeVisible();
});

test('자동 재로드가 파일을 읽는 동안 들어온 입력과 메타를 교체하지 않는다', async ({ page }) => {
  await openGamma(page);
  await page.evaluate(async ({ path, external }) => {
    const fixture = window as Window & { __qa_holdNextRead: (p: string) => void; __qa_simulateExternalEdit: (p: string, c: string) => Promise<void> };
    fixture.__qa_holdNextRead(path);
    await fixture.__qa_simulateExternalEdit(path, external);
  }, { path, external });
  await expect.poll(() => page.evaluate(p => (window as Window & { __qa_isReadHeld: (p: string) => boolean }).__qa_isReadHeld(p), path), { timeout: 10000 }).toBe(true);
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.type('INPUT-DURING-RELOAD');
  await page.evaluate(p => (window as Window & { __qa_releaseHeldRead: (p: string) => void }).__qa_releaseHeldRead(p), path);
  await expect(page.getByText('파일이 외부에서 수정되었습니다', { exact: true })).toBeVisible();
  await expect(page.locator('.bn-editor')).toContainText('INPUT-DURING-RELOAD');
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), activeKey)).toContain('INPUT-DURING-RELOAD');
  expect(await disk(page)).toBe(external);
});


test('외부본 읽기 실패 뒤에도 현재 글과 재열기 복구본을 유지한다', async ({ page }) => {
  await conflict(page);
  await page.evaluate(p => (window as Window & { __qa_failNextReads: (p: string, n: number) => void }).__qa_failNextReads(p, 1), path);
  await page.getByRole('button', { name: '외부 변경 버전 불러오기' }).click();
  await expect(page.getByText('노트를 불러오는데 실패했습니다.')).toBeVisible();
  await expect(page.locator('.bn-editor')).toContainText(marker);
  expect(JSON.parse(await page.evaluate(k => localStorage.getItem(k), activeKey) ?? 'null').status).toBe('draft');
  expect(await disk(page)).toBe(external);
  await page.getByRole('button', { name: /알파 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText('알파 노트');
  await page.getByRole('button', { name: /감마 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText(marker);
});

test('입력을 원래대로 되돌린 뒤 저장을 끝내면 미저장 복구본으로 오인하지 않는다', async ({ page }) => {
  await openGamma(page);
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.type('X');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => JSON.parse(await page.evaluate(k => localStorage.getItem(k), activeKey) ?? 'null')?.status).toBe('saved');
  await page.getByRole('button', { name: /알파 노트/ }).first().click();
  await expect(page.locator('.bn-editor')).toContainText('알파 노트');
  await page.getByRole('button', { name: /감마 노트/ }).first().click();
  await expect(page.getByText('미저장 작성본을 복구했습니다. 원본 파일은 바꾸지 않았습니다.')).toHaveCount(0);
});


test('이전 버전 제거 취소/확정은 현재 글과 원본을 바꾸지 않는다', async ({ page }) => {
  await conflict(page);
  await page.getByRole('button', { name: '내 변경 유지' }).click();
  await expect.poll(() => disk(page)).toContain(marker);
  const before = await disk(page);
  const draft = await page.evaluate(k => localStorage.getItem(k), activeKey);
  await versions(page);
  await page.getByRole('button', { name: /외부 버전 ·/ }).click();
  await page.getByRole('button', { name: '제거', exact: true }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByLabel('보관한 버전 내용')).toHaveValue(external);
  await page.getByRole('button', { name: '제거', exact: true }).click();
  await page.getByRole('button', { name: '제거 확인', exact: true }).click();
  await expect(page.getByText(/보관한 버전 \(/)).toHaveCount(0);
  await expect(page.getByLabel('보관한 버전 내용')).toHaveCount(0);
  await expect(page.locator('.bn-editor')).toContainText(marker);
  expect(await disk(page)).toBe(before);
  expect(await page.evaluate(k => localStorage.getItem(k), activeKey)).toBe(draft);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ticksidian.note-recovery.v1..trash.')).length)).toBe(1);
});

test('제거 사본 보관 실패는 이전 버전의 내용을 유지하고 오류를 알린다', async ({ page }) => {
  await conflict(page);
  await page.getByRole('button', { name: '내 변경 유지' }).click();
  await expect.poll(() => disk(page)).toContain(marker);
  await versions(page);
  await page.getByRole('button', { name: /외부 버전 ·/ }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.startsWith('ticksidian.note-recovery.v1..trash.')) throw new DOMException('Quota', 'QuotaExceededError');
      original.call(this, name, value);
    };
  });
  await page.getByRole('button', { name: '제거', exact: true }).click();
  await page.getByRole('button', { name: '제거 확인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('보관한 버전을 제거하지 못했습니다');
  await expect(page.getByLabel('보관한 버전 내용')).toHaveValue(external);
  await expect(page.locator('.bn-editor')).toContainText(marker);
});
