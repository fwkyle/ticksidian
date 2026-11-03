import { test, expect, type Page } from '@playwright/test';
const column = (page: Page) => page.locator('[data-note-column]');
async function file(page: Page, path: string) {
  return page.evaluate(async p => { try { return await window.__qa_readVaultFile?.(p); } catch { return null; } }, path);
}
async function ready(page: Page) {
  await page.goto('/'); await expect(page.locator('.bn-editor')).toBeVisible();
  await page.locator('[data-folder-select="전체"]').click();
}

for (const generated of [false, true]) {
  test(`방금 고친 날짜·완료·태그의 표시 왕복 — ${generated ? '틱시디언' : '옵시디언'}`, async ({ page }) => {
    await ready(page);
    const path = '/mock-vault/inbox/보존검사.md';
    await page.evaluate(async ({ path, generated }) => window.__qa_writeVaultFile?.(path,
      `---\nid: 보존검사\n${generated ? 'source: ticksidian\n' : ''}type: todo\ndone: true\ndueDate: "2026-09-01"\ntags: [보존]\nexternalSource: 원본\n---\n# 보존검사\n본문 보존\n`), { path, generated });
    await page.reload(); await expect(page.locator('.bn-editor')).toBeVisible();
    await page.getByRole('button', { name: '전체 할 일 보기', exact: true }).click();
    await column(page).getByRole('button', { name: '완료한 할 일 보이기' }).click();
    await column(page).getByRole('button', { name: '보존검사', exact: true }).click();
    const info = page.locator('[data-note-info-bar]');
    await info.getByRole('button', { name: /상세/ }).click();
    await info.getByLabel('마감일 변경').fill('2026-09-30');
    await info.getByLabel('마감일 변경').press('Tab');
    await expect.poll(() => file(page, path)).toContain('2026-09-30');
    await info.getByRole('button', { name: '할 일 표시 해제', exact: true }).click();
    await expect.poll(() => file(page, path)).not.toContain('type:');
    expect(await file(page, path)).toContain('2026-09-30');
    expect(await file(page, path)).toContain('done: true');
    expect(await file(page, path)).toContain('보존');
    await info.getByRole('button', { name: '할 일로 표시', exact: true }).click();
    await expect.poll(() => file(page, path)).toContain('type: "todo"');
    expect(await file(page, path)).toContain('2026-09-30');
    expect(await file(page, path)).toContain('done: true');
  });
}

test('이동 실패 뒤에도 양쪽 원본과 편집을 보존한다', async ({ page }) => {
  await ready(page);
  await column(page).getByRole('button', { name: '알파 노트', exact: true }).click();
  await expect(page.locator('.bn-editor')).toContainText('알파 노트');
  await page.evaluate(async () => window.__qa_writeVaultFile?.('/mock-vault/lectures/note-alpha.md', '목적지 원본'));
  await column(page).locator('[data-list-item="알파 노트"]').dragTo(page.locator('[data-folder-select="lectures"]'), { sourcePosition: { x: 2, y: 2 } });
  await expect(page.getByText(/노트를 옮기지 못했습니다/)).toBeVisible();
  expect(await file(page, '/mock-vault/lectures/note-alpha.md')).toBe('목적지 원본');
  await page.locator('.bn-editor').click(); await page.keyboard.press('Meta+End');
  await page.keyboard.insertText('실패 후 계속 편집');
  await expect.poll(() => file(page, '/mock-vault/notes/note-alpha.md')).toContain('실패 후 계속 편집');
  expect(await file(page, '/mock-vault/lectures/note-alpha.md')).toBe('목적지 원본');
});

test('실제 드래그로 할 일을 옮겨도 날짜와 할 일 표시는 유지한다', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '전체 할 일 보기', exact: true }).click();
  const before = await file(page, '/mock-vault/notes/todo-beta.md');
  await column(page).locator('[data-list-item="멘토님 연락"]').dragTo(page.locator('[data-folder-select="lectures"]'), { sourcePosition: { x: 2, y: 2 } });
  await expect.poll(() => file(page, '/mock-vault/lectures/todo-beta.md')).toBe(before);
  expect(await file(page, '/mock-vault/notes/todo-beta.md')).toBeNull();
});

test('새 기본함 선택은 진행 중인 이전 AI 추천을 폐기한다', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'AI 정리 열기/닫기' }).click();
  await expect(page.getByRole('button', { name: 'Gemini로 폴더 추천' })).toBeEnabled();
  await page.evaluate(() => { window.__qa_inboxOrganizer.delayMs = 500; });
  await page.getByRole('button', { name: 'Gemini로 폴더 추천' }).click();
  await expect.poll(() => page.evaluate(() => window.__qa_inboxOrganizer.calls.length)).toBe(1);
  await column(page).getByRole('button', { name: '거대 덤프', exact: true }).click();
  await expect(page.getByLabel('정리할 기본함 노트')).toHaveValue('inbox/거대-덤프.md');
  await page.waitForTimeout(650); // 제어한 늦은 추천이 끝난 뒤 새 선택에 섞이는지 확인
  await expect(page.getByLabel('이동할 폴더')).toHaveCount(0);
});

for (const collision of [false, true]) {
  test(`기존 검토 보관 이동은 원본 경로와 성공을 확인한다 — 충돌 ${collision}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-30T12:00:00+09:00'));
    await ready(page);
    const source = '/mock-vault/notes/QA-화면-테스트.md';
    const target = '/mock-vault/archive/QA-화면-테스트.md';
    const before = await file(page, source);
    if (collision) await page.evaluate(async path => window.__qa_writeVaultFile?.(path, '기존 보관 원본'), target);
    await page.getByRole('button', { name: 'AI 정리 열기/닫기' }).click();
    await page.getByRole('button', { name: '외부 가져오기·기존 검토' }).click();
    await page.getByRole('button', { name: /내 노트 검토/ }).click();
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'QA 화면 테스트', exact: true }) });
    await card.getByRole('button', { name: '보관으로 이동' }).click();
    if (collision) {
      await expect(page.getByText(/같은 이름의 파일/)).toBeVisible();
      await expect(card.getByText('대기', { exact: true })).toBeVisible();
      expect(await file(page, source)).toBe(before);
      expect(await file(page, target)).toBe('기존 보관 원본');
    } else {
      await expect.poll(() => file(page, target)).toBe(before);
      expect(await file(page, source)).toBeNull();
      await page.getByRole('group', { name: '검토 상태 필터' }).getByRole('button', { name: '승인', exact: true }).click();
      await expect(card.getByLabel('검토 상태: 승인')).toBeVisible();
    }
  });
}

test('이미지를 넣는 중에는 열린 원본의 폴더 이동을 막는다', async ({ page }) => {
  await ready(page);
  await column(page).getByRole('button', { name: '알파 노트', exact: true }).click();
  await expect(page.locator('.bn-editor')).toContainText('알파 노트');
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const file = new File([bytes], '지연.png', { type: 'image/png' });
    file.arrayBuffer = () => new Promise(resolve => { (window as Window & { __qa_releaseImage?: () => void }).__qa_releaseImage = () => resolve(bytes.buffer); });
    const transfer = new DataTransfer(); transfer.items.add(file);
    document.querySelector('.bn-editor')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { __qa_releaseImage?: () => void }).__qa_releaseImage)).toBe('function');
  await column(page).locator('[data-list-item="알파 노트"]').dragTo(page.locator('[data-folder-select="lectures"]'), { sourcePosition: { x: 2, y: 2 } });
  await expect(page.getByText('이미지 저장이 끝난 뒤 다시 이동해 주세요.')).toBeVisible();
  expect(await file(page, '/mock-vault/lectures/note-alpha.md')).toBeNull();
  await page.evaluate(() => (window as Window & { __qa_releaseImage?: () => void }).__qa_releaseImage?.());
  await expect.poll(() => file(page, '/mock-vault/notes/note-alpha.md')).toContain('![[attachments/');
});
