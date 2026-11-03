import { devices, expect, test, type Page } from '@playwright/test';

test.use({ ...devices['Desktop Safari'], browserName: 'webkit' });

async function openBody(page: Page) {
  await page.goto('/');
  await page.getByLabel('빠른 기록 제목').waitFor();
  await page.locator('.bn-editor').waitFor();
  await page.evaluate(async () => {
    await window.__qa_writeVaultFile?.('/mock-vault/inbox/korean-enter.md', '# 한글 Enter\n\n앞문장\n\n끝문장\n');
  });
  await page.reload();
  await page.getByRole('button', { name: '한글 Enter', exact: true }).click();
  await expect(page.locator('.bn-editor h1').first()).toHaveText('한글 Enter');
  await page.locator('.bn-editor [data-content-type="paragraph"]').first().click();
  await page.keyboard.press('End');
}

// 합성 조합/DOM 확정으로 실행 순서를 검사한다. 실제 OS 한글 조합 증거는 아니다.
// then: 보류된 Enter를 취소해야 하는 사건을 같은 동기 구간에서 이어 낸다. Enter 보류 제한(25ms)보다
// Playwright 왕복이 느릴 수 있어 별도 evaluate로 나누면 보류된 Enter가 먼저 실행된다
// (2026-10-20 간헐 실패 원인, 간격 60ms면 8/8 재현).
type AfterCompose = 'new-composition' | 'blur' | 'browser-newline';
async function compose(page: Page, order: 'key-first' | 'end-first', data = '한', then?: AfterCompose) {
  await page.locator('.bn-editor').evaluate((dom, { order, data, then }) => {
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    dom.dispatchEvent(new CompositionEvent('compositionupdate', { data, bubbles: true }));
    const selection = window.getSelection();
    const node = selection?.focusNode;
    if (!selection || !node || node.nodeType !== Node.TEXT_NODE) throw new Error('본문 커서 없음');
    node.textContent += data;
    selection.collapse(node, node.textContent?.length ?? 0);
    const end = () => dom.dispatchEvent(new CompositionEvent('compositionend', { data, bubbles: true }));
    const key = () => dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 229, isComposing: order === 'key-first',
      bubbles: true, cancelable: true,
    }));
    if (order === 'key-first') { key(); end(); }
    else { end(); key(); }
    if (then === 'new-composition') {
      dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    } else if (then === 'blur') {
      (dom as HTMLElement).blur();
    } else if (then === 'browser-newline') {
      dom.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertParagraph', bubbles: true, cancelable: true,
      }));
    }
  }, { order, data, then });
}

for (const order of ['key-first', 'end-first'] as const) {
  test(`한글 ${order}: 글자 보존과 줄바꿈 한 번`, async ({ page }) => {
    await openBody(page);
    await compose(page, order);
    // BlockNote의 끝 빈 문단과 Enter로 생긴 중간 문단을 구분한다.
    await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toHaveCount(4);
    await expect(page.locator('.bn-editor [data-content-type="paragraph"]').first()).toHaveText('앞문장한');
    await page.keyboard.type('next');
    await expect(page.locator('.bn-editor [data-content-type="paragraph"]').nth(1)).toHaveText('next');
    await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
  });
}

test('일본어 후보 확정은 줄바꿈을 보정하지 않는다', async ({ page }) => {
  await openBody(page);
  await compose(page, 'key-first', 'あ');
  await page.waitForTimeout(300);
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toHaveCount(3);
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]').first()).toHaveText('앞문장あ');
});

test('포커스 이탈 시 늦은 줄바꿈 없음', async ({ page }) => {
  await openBody(page);
  await compose(page, 'key-first', '한', 'blur');
  await page.waitForTimeout(300);
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toHaveCount(3);
});

test('일반 Enter와 Shift Enter 유지', async ({ page }) => {
  await openBody(page);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.insertText('같은 문단');
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toHaveCount(4);
});

test('브라우저 줄바꿈 시작 뒤 보류한 Enter 중복 실행 없음', async ({ page }) => {
  await openBody(page);
  await compose(page, 'key-first', '한', 'browser-newline');
  await page.waitForTimeout(300);
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toHaveCount(3);
});

test('새 조합 시작은 이전 Enter를 취소한다', async ({ page }) => {
  await openBody(page);
  await compose(page, 'key-first', '한', 'new-composition');
  await page.waitForTimeout(300);
  await expect(page.locator('.bn-editor [data-content-type="paragraph"]')).toHaveCount(3);
});
