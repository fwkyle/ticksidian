import { test, expect, type Page } from '@playwright/test';

async function scenario(page: Page, name: string, argument?: string) {
  // App 전체의 에디터/폴러와 독립된 실제 React root. 공용 fixture는 수정하지 않는다.
  await page.route('**/__link-index-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('/__link-index-test');
  return page.evaluate(async ({ name, argument }) => {
    const refreshPath = '/@react-refresh';
    const refresh = await import(/* @vite-ignore */ refreshPath);
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type,
      __vite_plugin_react_preamble_installed__: true });
    const path = '/tests/browser/link-index.harness.ts';
    const harness = await import(/* @vite-ignore */ path);
    return harness[name](argument);
  }, { name, argument });
}

test('링크 실제 훅: 600개 뒤 추가1/제목0/별칭0/삭제0/그림0 및 전체 해석 일치', async ({ page }) => {
  const result = await scenario(page, 'countsAndResolution');
  expect(result.counts).toEqual([600, 1, 0, 0, 0, 0, 1]);
  expect(result.matches).toEqual(Array(7).fill(true));
  expect(result.resolution.slice(0, 6)).toEqual(['resolved', 'ambiguous', 'resolved', 'ambiguous', 'resolved', 'resolved']);
});

test('링크 실제 훅: 대체된 작업 12개 뒤 중단, 늦은 snapshot 게시 금지', async ({ page }) => {
  const result = await scenario(page, 'cancelledReads');
  expect(result).toEqual({ oldReads: 12, afterOld: ['new'], afterFollowup: ['new'] });
});

for (const boundary of ['empty', 'vault', 'unmount']) {
  test(`링크 실제 훅: ${boundary} 경계 취소와 동명 다른 볼트 분리`, async ({ page }) => {
    const result = await scenario(page, 'lifecycle', boundary);
    expect(result.reads).toBe(boundary === 'vault' ? 14 : 12);
    if (boundary === 'empty') expect(result.ids).toEqual([]);
    if (boundary === 'vault') { expect(result.ids).toEqual(['same-0', 'B']); expect(result.target).toBe('B'); }
  });
}

test('링크 실제 훅: 강제 본문 무효화/메타 경합/실패 재시도', async ({ page }) => {
  const result = await scenario(page, 'forcedContentAndRetry');
  expect(result.latest).toBe('target');
  expect(result.title).toBe('바뀐 제목');
  expect(result.retried).toBe('other');
});

test('링크 실제 훅: 읽기 실패했던 대상 삭제/mtime 불명 재읽기', async ({ page }) => {
  const result = await scenario(page, 'failureRemovalAndUnknownMtime');
  expect(result.removed).toEqual({ ids: ['source'], resolution: 'unresolved' });
  expect(result.unknownReads).toBe(1);
  expect(result.ref).toBe('new');
});

test('링크 실제 훅: 전체 갱신 중 본문 저장도 미완료 메타를 포함한다', async ({ page }) => {
  const result = await scenario(page, 'fullThenExplicitContent');
  expect(result.beforeFollowup).toEqual({ ids: ['source', 'new'], target: 'new' });
  expect(result.title).toBe('최신 제목');
});
