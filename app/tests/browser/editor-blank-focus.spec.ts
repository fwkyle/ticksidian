import { expect, test, type Page } from '@playwright/test';

type WriteProbe = Window & {
  __blankWrites?: number;
  __qa_beforeVaultWrite?: (path: string, content: string) => Promise<void>;
};

type GestureProbe = Window & { __blankGestureEvents?: { type: string; pointerType: string; detail: number }[] };

async function createNote(page: Page, body = '마지막 본문') {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeFocused();
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole('button', { name: '사이드바 열기' }).click();
    await page.locator('[data-folder-select="기본함"]').click();
  }
  await page.getByLabel('빠른 기록 제목').fill('빈 공간 검증');
  await page.getByLabel('빠른 기록 제목').press('Enter');
  await expect(page.locator('.bn-editor h1')).toHaveText('빈 공간 검증');
  await expect(page.locator('.bn-editor')).toBeFocused();
  if (body) await page.keyboard.insertText(body);
  const path = await page.evaluate(async () => {
    for (const candidate of await window.__qa_listVaultFiles?.() ?? []) {
      if (candidate.endsWith('.md') && !candidate.includes('/.trash/')
        && (await window.__qa_readVaultFile?.(candidate))?.includes('# 빈 공간 검증')) return candidate;
    }
    throw new Error('새 기록 파일 없음');
  });
  if (body) await expect.poll(() => page.evaluate(p => window.__qa_readVaultFile?.(p), path)).toContain(body);
  await page.evaluate(() => {
    const probe = window as WriteProbe;
    probe.__blankWrites = 0;
    probe.__qa_beforeVaultWrite = async () => { probe.__blankWrites = (probe.__blankWrites ?? 0) + 1; };
  });
  return path;
}

async function blankPoint(page: Page, nearContent = false) {
  return page.locator('.bn-editor').evaluate((editor, near) => {
    const panel = editor.closest<HTMLElement>('.overflow-y-auto');
    if (!panel) throw new Error('편집기 스크롤 영역 없음');
    const bounds = panel.getBoundingClientRect();
    const body = editor.getBoundingClientRect();
    const y = near ? body.bottom + 8 : bounds.bottom - 40;
    if (y <= body.bottom || y >= bounds.bottom) throw new Error('본문 아래 빈 공간 없음');
    return { x: bounds.x + panel.clientWidth / 2, y };
  }, nearContent);
}

async function clickBlank(page: Page, nearContent = false) {
  const point = await blankPoint(page, nearContent);
  await page.mouse.click(point.x, point.y);
}

async function expectBodyCaret(page: Page) {
  await expect(page.locator('.bn-editor')).toBeFocused();
  expect(await page.evaluate(() => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const paragraphs = document.querySelectorAll('.bn-editor p');
    return selection?.isCollapsed && element?.closest('.bn-editor p') === paragraphs[paragraphs.length - 1];
  })).toBe(true);
}

/**
 * 제목을 사람처럼 누른다: 포인터가 먼저 도착해 옆 도구(사이드 메뉴)가 자리 잡은 뒤 누르고,
 * ProseMirror가 바뀐 선택을 읽을 때까지 기다린다. 도착·누름·키가 한 번에 오면 편집기 상태가
 * DOM 선택보다 늦어 곧바로 누른 Cmd+A가 이전 선택 기준으로 동작한다(2026-10-20 DEF 간헐 시험 조사).
 */
async function clickTitleLikeUser(page: Page) {
  const title = page.locator('.bn-editor h1');
  await title.hover();
  await expect(page.locator('.bn-side-menu')).toBeVisible();
  const settled = page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('selectionchange', () => setTimeout(resolve, 0), { once: true });
  }));
  await title.click();
  await settled;
}

for (const width of [375, 768, 1280, 1920]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`빈 배경 클릭 ${width}px ${colorScheme}: 본문 끝 포커스와 원본 보존`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      const path = await createNote(page);
      const before = await page.evaluate(p => window.__qa_readVaultFile?.(p), path);
      const blocks = await page.locator('.bn-editor [data-node-type="blockContainer"]').count();
      const lastParagraph = (await page.locator('.bn-editor p').count()) - 1;
      await expect(page.locator('.bn-editor p').nth(lastParagraph)).toHaveText('');
      await page.locator('.bn-editor h1').click();
      await page.screenshot({ path: info.outputPath('before-click.png') });
      await clickBlank(page);
      await expectBodyCaret(page);
      await clickBlank(page, true);
      await clickBlank(page);
      // 클릭/선택만으로 자동 저장(1초)이 발생하면 안 된다.
      await page.waitForTimeout(1300);
      expect(await page.evaluate(() => (window as WriteProbe).__blankWrites)).toBe(0);
      expect(await page.evaluate(p => window.__qa_readVaultFile?.(p), path)).toBe(before);
      await expect(page.locator('.bn-editor [data-node-type="blockContainer"]')).toHaveCount(blocks);
      await page.screenshot({ path: info.outputPath('after-click.png') });
      await page.keyboard.insertText(' 이어 쓰기');
      await expect(page.locator('.bn-editor p').first()).toHaveText('마지막 본문');
      await expect(page.locator('.bn-editor p').nth(lastParagraph)).toHaveText('이어 쓰기');
      await expect(page.locator('.bn-editor h1')).toHaveText('빈 공간 검증');
      expect(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}

test('빈 본문 클릭은 기존 문단에 커서를 두며 새 줄을 만들지 않는다', async ({ page }) => {
  await createNote(page, '');
  await page.getByLabel('빠른 기록 제목').click();
  await clickBlank(page);
  await expectBodyCaret(page);
  await expect(page.locator('.bn-editor p')).toHaveCount(1);
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => (window as WriteProbe).__blankWrites)).toBe(0);
  await page.keyboard.insertText('첫 본문');
  await expect(page.locator('.bn-editor p').first()).toHaveText('첫 본문');
  await expect(page.locator('.bn-editor h1')).toHaveText('빈 공간 검증');
});

test('제목·검색·정보 바 조작과 본문 전체 선택을 보존한다', async ({ page }) => {
  await createNote(page);
  await clickBlank(page);
  await clickTitleLikeUser(page);
  await page.keyboard.press('Meta+a');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('빈 공간 검증');
  await page.getByRole('button', { name: /^상세/ }).click();
  await expect(page.locator('.bn-editor')).not.toBeFocused();
  await page.getByRole('button', { name: '검색 열기', exact: true }).click();
  const search = page.getByLabel('노트 검색');
  await search.fill('검색 초안');
  await search.press('Control+a');
  await expect(search).toBeFocused();
  await clickBlank(page);
  await expectBodyCaret(page);
  await page.keyboard.press('Control+a');
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe('마지막 본문');
  await expect(search).toHaveValue('검색 초안');
});

test('드래그·보조키 클릭·취소·스크롤은 본문 끝으로 선택을 강제하지 않는다', async ({ page }) => {
  await createNote(page);
  const point = await blankPoint(page);
  const editor = page.locator('.bn-editor');
  await page.getByLabel('빠른 기록 제목').click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 25, point.y - 25, { steps: 4 });
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.mouse.up();
  await expect(editor).not.toBeFocused();
  await page.keyboard.down('Shift');
  await clickBlank(page);
  await page.keyboard.up('Shift');
  await expect(editor).not.toBeFocused();
  for (const event of ['pointercancel', 'scroll']) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await editor.evaluate((element, type) => {
      element.closest('.overflow-y-auto')?.dispatchEvent(new Event(type));
    }, event);
    await page.mouse.up();
    await expect(editor).not.toBeFocused();
  }
  const body = await page.locator('.bn-editor p').first().boundingBox();
  if (!body) throw new Error('본문 없음');
  await page.mouse.move(body.x + 2, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('마지막 본문');
});

test('조합 중 클릭을 가로채지 않고 조합 종료 뒤 다시 본문에 쓸 수 있다', async ({ page }) => {
  await createNote(page);
  const editor = page.locator('.bn-editor');
  // 브라우저 이벤트 가드 검사다. macOS 실제 한글 IME 검증으로 보고하지 않는다.
  await editor.dispatchEvent('compositionstart', { data: '' });
  await clickBlank(page);
  await expect(editor).not.toBeFocused();
  await editor.dispatchEvent('compositionend', { data: '' });
  await page.waitForTimeout(100);
  await clickBlank(page);
  await expectBodyCaret(page);
});

for (const [name, markdown] of [
  ['제목만', '# 빈 공간 검증\n'],
  ['중첩 목록과 코드', '# 빈 공간 검증\n\n- 부모\n  - 자식\n\n```js\nconst value = 1;\n```\n'],
  ['링크', '# 빈 공간 검증\n\n[예시 링크](https://example.com/)\n'],
]) {
  test(`${name} 원본은 빈 배경 클릭만으로 바뀌지 않는다`, async ({ page }) => {
    const path = await createNote(page);
    await page.evaluate(async ({ path, markdown }) => {
      await window.__qa_writeVaultFile?.(path, markdown);
    }, { path, markdown });
    await page.reload();
    await expect(page.locator('.bn-editor')).toBeFocused();
    await page.getByRole('button', { name: '빈 공간 검증', exact: true }).click();
    await expect(page.locator('.bn-editor h1')).toHaveText('빈 공간 검증');
    const before = await page.locator('.bn-editor').innerHTML();
    await page.evaluate(() => {
      const probe = window as WriteProbe;
      probe.__blankWrites = 0;
      probe.__qa_beforeVaultWrite = async () => { probe.__blankWrites = (probe.__blankWrites ?? 0) + 1; };
    });
    await clickBlank(page);
    await page.waitForTimeout(1300);
    expect(await page.evaluate(p => window.__qa_readVaultFile?.(p), path)).toBe(markdown);
    expect(await page.evaluate(() => (window as WriteProbe).__blankWrites)).toBe(0);
    // 포커스 클래스/팝업을 제외하고 블록 수와 제목을 검사한다.
    const blockCount = (before.match(/data-node-type="blockContainer"/g) ?? []).length;
    await expect(page.locator('.bn-editor [data-node-type="blockContainer"]')).toHaveCount(blockCount);
    await expect(page.locator('.bn-editor h1')).toHaveText('빈 공간 검증');
  });
}

test.describe('터치 클릭', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 900 } });
  test('빈 배경 탭은 본문으로 돌아온다', async ({ page }, info) => {
    await createNote(page, '');
    await page.locator('.bn-editor h1').click();
    const point = await blankPoint(page);
    await page.evaluate(() => {
      const probe = window as GestureProbe;
      probe.__blankGestureEvents = [];
      const root = document.querySelector('.bn-editor')?.closest('.overflow-y-auto');
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'scroll', 'click']) {
        root?.addEventListener(type, event => probe.__blankGestureEvents?.push({
          type, pointerType: event instanceof PointerEvent ? event.pointerType : '',
          detail: event instanceof MouseEvent ? event.detail : 0,
        }), true);
      }
    });
    await page.touchscreen.tap(point.x, point.y);
    await info.attach('touch-events', { body: JSON.stringify(await page.evaluate(() => (window as GestureProbe).__blankGestureEvents)), contentType: 'application/json' });
    await expectBodyCaret(page);
    await expect(page.locator('.bn-editor p')).toHaveCount(1);
  });
});
