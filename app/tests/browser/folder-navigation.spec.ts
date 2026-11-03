import { expect, test, type Page } from '@playwright/test';

const column = (page: Page) => page.locator('[data-note-column]');
const folder = (page: Page, name: string) => page.locator(`[data-folder-select="${name}"]`);
const file = (page: Page, path: string) => page.evaluate(async p => {
  try { return await window.__qa_readVaultFile?.(p); } catch { return null; }
}, path);

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
}

async function moveDialog(page: Page, title: string) {
  await column(page).locator(`[data-list-item="${title}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '다른 폴더로 이동…' }).click();
  const dialog = page.getByRole('dialog', { name: '다른 폴더로 이동', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('폴더별 할 일 탐색 뒤 입력은 선택 폴더에 할 일을 만든다', async ({ page }) => {
  await ready(page);
  await column(page).getByRole('group', { name: '종류 필터' }).getByRole('button', { name: /^할 일/ }).click();
  await folder(page, 'lectures').click();
  await expect(
    column(page).getByRole('group', { name: '종류 필터' }).getByRole('button', { name: /^할 일/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  await page.getByLabel('빠른 기록 제목').fill('폴더별 할 일');
  await page.getByLabel('빠른 기록 제목').press('Enter');
  await expect(page.locator('.bn-editor h1')).toHaveText('폴더별 할 일');
  const added = await page.evaluate(async old =>
    (await window.__qa_listVaultFiles?.() ?? []).filter(path => !old.includes(path)), before);
  expect(added).toHaveLength(1);
  expect(added[0]).toContain('/lectures/');
  expect(await file(page, added[0])).toContain('type: "todo"');
});

test('완료 항목만 있는 폴더는 숨김 수와 보기, 같은 기준의 폴더 수를 표시한다', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => window.__qa_writeVaultFile?.(
    '/mock-vault/lectures/done-only.md',
    '---\nid: done-only\ntype: todo\ndone: true\n---\n# 끝낸 작업\n\n완료 본문',
  ));
  await page.reload();
  await expect(page.locator('.bn-editor')).toBeVisible();
  await folder(page, 'lectures').click();
  await column(page).getByRole('group', { name: '종류 필터' }).getByRole('button', { name: /^할 일/ }).click();
  await expect(column(page).getByText('남은 할 일이 없습니다', { exact: true })).toBeVisible();
  await expect(column(page).getByText('완료한 할 일 1개 숨김')).toBeVisible();
  await expect(folder(page, 'lectures').locator('.tabular-nums')).toHaveText('0');
  await column(page).getByRole('button', { name: '보기', exact: true }).click();
  await expect(column(page).getByRole('button', { name: '끝낸 작업', exact: true })).toBeVisible();
  await expect(folder(page, 'lectures').locator('.tabular-nums')).toHaveText('1');
  await expect(column(page).getByRole('button', { name: '완료한 할 일 숨기기' })).toHaveAttribute('aria-pressed', 'true');
});

test('목록 밖 안내와 목록 복귀는 편집기와 본문을 그대로 보존한다', async ({ page }) => {
  await ready(page);
  await folder(page, '전체').click();
  await column(page).getByRole('button', { name: '알파 노트', exact: true }).click();
  const editor = page.locator('.bn-editor');
  await expect(editor).toContainText('알파 노트');
  await editor.press('Control+End');
  await page.keyboard.insertText(' 목록 왕복 보존');
  await expect.poll(() => file(page, '/mock-vault/notes/note-alpha.md')).toContain('목록 왕복 보존');
  const before = await editor.innerText();
  await editor.evaluate(el => el.setAttribute('data-navigation-preserved', 'true'));
  await folder(page, 'lectures').click();
  await expect(page.locator('[data-outside-list-notice]')).toContainText('알파 노트');
  await page.getByRole('button', { name: '이 글의 목록 보기' }).click();
  await expect(page.locator('[data-outside-list-notice]')).toHaveCount(0);
  await expect(editor).toHaveAttribute('data-navigation-preserved', 'true');
  expect(await editor.innerText()).toBe(before);
  await expect(folder(page, 'notes')).toHaveAttribute('aria-current', 'true');
  await expect(column(page).getByRole('button', { name: '알파 노트', exact: true }))
    .toHaveAttribute('aria-current', 'true');
});

test('이동 취소·충돌은 양쪽 파일을 보존하고 목적지 수정 후 재시도할 수 있다', async ({ page }) => {
  await ready(page);
  await folder(page, '전체').click();
  const source = '/mock-vault/notes/todo-beta.md';
  const target = '/mock-vault/lectures/todo-beta.md';
  const before = await file(page, source);
  await column(page).getByRole('group', { name: '종류 필터' }).getByRole('button', { name: /^할 일/ }).click();
  let dialog = await moveDialog(page, '멘토님 연락');
  await dialog.getByLabel('이동할 폴더').selectOption('lectures');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  expect(await file(page, source)).toBe(before);
  expect(await file(page, target)).toBeNull();
  await page.evaluate(async p => window.__qa_writeVaultFile?.(p, '목적지 원문'), target);
  dialog = await moveDialog(page, '멘토님 연락');
  await dialog.getByLabel('이동할 폴더').selectOption('lectures');
  await dialog.getByRole('button', { name: '이동', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('이동할 폴더')).toHaveValue('lectures');
  expect(await file(page, source)).toBe(before);
  expect(await file(page, target)).toBe('목적지 원문');
  await dialog.getByLabel('이동할 폴더').selectOption('inbox');
  await dialog.getByRole('button', { name: '이동', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await file(page, '/mock-vault/inbox/todo-beta.md')).toBe(before);
  expect(await file(page, source)).toBeNull();
});

type MoveProbe = Window & {
  __moveWrites?: number;
  __releaseMove?: () => void;
  __qa_beforeVaultWrite?: (path: string) => Promise<void>;
};

test('이동 중에는 이중 확정과 닫기를 막고 한 번만 이동한다', async ({ page }) => {
  await ready(page);
  await folder(page, '전체').click();
  const before = await file(page, '/mock-vault/notes/note-alpha.md');
  await page.evaluate(() => {
    const probe = window as MoveProbe;
    probe.__moveWrites = 0;
    probe.__qa_beforeVaultWrite = async path => {
      if (path !== '/mock-vault/lectures/note-alpha.md') return;
      probe.__moveWrites = (probe.__moveWrites ?? 0) + 1;
      await new Promise<void>(resolve => { probe.__releaseMove = resolve; });
    };
  });
  const dialog = await moveDialog(page, '알파 노트');
  await dialog.getByLabel('이동할 폴더').selectOption('lectures');
  await dialog.getByRole('button', { name: '이동', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as MoveProbe).__moveWrites)).toBe(1);
  await expect(dialog.getByRole('button', { name: '이동 중…' })).toBeDisabled();
  await dialog.locator('form').dispatchEvent('submit');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as MoveProbe).__moveWrites)).toBe(1);
  await page.evaluate(() => (window as MoveProbe).__releaseMove?.());
  await expect(dialog).toBeHidden();
  expect(await file(page, '/mock-vault/lectures/note-alpha.md')).toBe(before);
});

for (const browserName of ['chromium', 'webkit'] as const) {
  test.describe(browserName, () => {
    for (const width of [375, 768, 1024, 1280]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        test(`탐색 ${width}px ${colorScheme}: 열기·선택·닫기·검색·너비`, async ({ playwright }, info) => {
          const browser = await playwright[browserName].launch();
          const page = await browser.newPage({ baseURL: 'http://localhost:5175' });
          try {
            await page.setViewportSize({ width, height: 900 });
            await page.emulateMedia({ colorScheme });
            await ready(page);
            const drawer = page.locator('[data-sidebar-drawer]');
            if (width < 1024) {
              await expect(drawer).toBeHidden();
              const main = await page.locator('main').boundingBox();
              expect(main?.width).toBe(width);
              await page.getByRole('button', { name: '사이드바 열기' }).click();
              await expect(folder(page, '전체')).toBeVisible();
              await expect(column(page)).toBeHidden();
              await page.getByRole('button', { name: '+ 새 폴더', exact: true }).click();
              const name = page.getByLabel('폴더 이름', { exact: true });
              await name.fill('취소할 새 폴더');
              await name.press('Escape');
              await expect(drawer).toBeVisible();
              await expect(folder(page, '취소할 새 폴더')).toHaveCount(0);
            }
            await folder(page, '전체').click();
            await expect(column(page).getByRole('button', { name: '알파 노트', exact: true })).toBeVisible();
            if (width < 1024) {
              await expect(page.locator('[data-folder-column]')).toBeHidden();
              await page.getByRole('button', { name: '← 폴더로 돌아가기' }).click();
              await expect(folder(page, '전체')).toBeVisible();
              await folder(page, '전체').click();
              await page.keyboard.press('Escape');
              await expect(drawer).toBeHidden();
              await page.keyboard.press('Control+k');
              await expect(page.getByLabel('노트 검색', { exact: true })).toBeFocused();
              await page.getByLabel('노트 검색', { exact: true }).press('Escape');
            }
            await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(width < 1024 ? 0 : 56);
            await page.screenshot({ path: info.outputPath('navigation.png') });
            await column(page).getByRole('button', { name: '알파 노트', exact: true }).click();
            await expect(page.locator('.bn-editor')).toContainText('알파 노트');
            if (width < 1024) await expect(drawer).toBeHidden();
            expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
            const editor = page.locator('.bn-editor');
            expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            await page.screenshot({ path: info.outputPath('editor.png') });
          } finally { await browser.close(); }
        });
      }
    }
  });
}

// DEF-UI-001 (2026-10-20): 1024px 미만에서 레일이 숨겨져도 세 기능에 갈 수 있어야 한다.
const TOOL_NAMES = ['보안 메모 열기/닫기 — 값은 기본 가림', 'HTML 내보내기', '볼트 폴더 변경/재선택'] as const;
const toolRow = (page: Page) => page.locator('[data-drawer-tool-row]');

for (const width of [375, 1023]) {
  test(`좁은 창 ${width}px: 드로어 도구 줄에 보안 메모·내보내기·볼트 변경이 있고 백링크는 없다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    await expect(page.locator('[data-app-rail]')).toBeHidden();
    await page.getByRole('button', { name: '사이드바 열기' }).click();
    for (const pane of ['folders', 'notes'] as const) {
      if (pane === 'notes') await folder(page, '전체').click();
      await expect(toolRow(page)).toBeVisible();
      for (const name of TOOL_NAMES) {
        const button = toolRow(page).getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await expect(toolRow(page).getByRole('button', { name: /백링크/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /백링크/ })).toHaveCount(0);
    }
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('좁은 창: 보안 메모 버튼은 보안 메모 화면을 열고 드로어를 닫는다', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await ready(page);
  await page.getByRole('button', { name: '사이드바 열기' }).click();
  await toolRow(page).getByRole('button', { name: TOOL_NAMES[0], exact: true }).click();
  await expect(page.locator('[data-sidebar-drawer]')).toBeHidden();
  await expect(page.getByLabel('보안 메모 경로 필터')).toBeVisible();
});

test('좁은 창: HTML 내보내기 버튼은 내보내기를 실행하고 드로어를 닫는다', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await ready(page);
  await page.getByRole('button', { name: '사이드바 열기' }).click();
  await toolRow(page).getByRole('button', { name: TOOL_NAMES[1], exact: true }).click();
  await expect(page.locator('[data-sidebar-drawer]')).toBeHidden();
  await expect(page.locator('text=내보냄')).toBeVisible({ timeout: 15000 });
});

test('좁은 창: 볼트 변경 버튼은 볼트 선택 동작을 실행하고 드로어를 닫는다', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await ready(page);
  await page.getByRole('button', { name: '사이드바 열기' }).click();
  await folder(page, '전체').click();
  await column(page).getByRole('button', { name: '알파 노트', exact: true }).click();
  await expect(page.locator('.bn-editor')).toContainText('알파 노트');
  await page.getByRole('button', { name: '사이드바 열기' }).click();
  await toolRow(page).getByRole('button', { name: TOOL_NAMES[2], exact: true }).click();
  // 브라우저 fixture에서는 저장 안 된 변경이 없으면 볼트 재선택이 곧바로 실행돼 열린 글이 닫힌다.
  await expect(page.locator('[data-sidebar-drawer]')).toBeHidden();
  await expect(page.locator('.bn-editor')).toHaveCount(0);
});

test('1024px 이상: 레일 동작은 그대로이고 드로어 도구 줄은 렌더되지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await ready(page);
  const rail = page.locator('[data-app-rail]');
  await expect(rail).toBeVisible();
  for (const name of [...TOOL_NAMES, '백링크 패널 켜기/끄기']) {
    await expect(rail.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(toolRow(page)).toBeHidden();
});
