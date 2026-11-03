import { test, expect } from '@playwright/test';

// DFUB-R002: 렌더 전 ref 가드가 아직 화면에 안 나온 변경 뒤의 알림을 버리지 않는지 실제 훅으로 잠근다.
test('목록 제목·별칭 알림: 묶음·생성·재스캔 직후에도 마지막 알림 값이 목록과 링크 인덱스에 남는다', async ({ page }) => {
  await page.route('**/__notes-updater-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('/__notes-updater-test');
  const result = await page.evaluate(async () => {
    const refreshPath = '/@react-refresh';
    const refresh = await import(/* @vite-ignore */ refreshPath);
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type,
      __vite_plugin_react_preamble_installed__: true });
    const path = '/tests/browser/notes-updater.harness.ts';
    return (await import(/* @vite-ignore */ path)).orders();
  });
  const initial = result.initial as { title: string; aliases: string[] };
  expect.soft(result.control).toEqual({ title: 'review-title', index: 'review-title' });
  expect.soft(result.controlAlias).toEqual({ aliases: ['review-alias'], index: ['review-alias'] });
  expect.soft(result.batchedTitle).toEqual({ title: initial.title, index: initial.title });
  expect.soft(result.batchedAlias).toEqual({ aliases: initial.aliases, index: initial.aliases });
  expect.soft(result.immediateCreate).toEqual({ title: 'review-created', index: 'review-created' });
  expect.soft(result.afterRescan).toEqual({ title: initial.title, index: initial.title });
});

// DFUB-R004: updater 안의 new Date()가 ref/React 두 번 실행에서 달라
// 삭제 뒤 수정 시각이 되돌아가던 틈.
test(
  '제목 변경 뒤 다른 노트를 삭제해도 남은 노트의 수정 시각이 바뀌지 않는다',
  async ({ page }) => {
    await page.route('**/__notes-updater-test', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body></body></html>'
    }));
    await page.goto('/__notes-updater-test');
    const result = await page.evaluate(async () => {
      const refreshPath = '/@react-refresh';
      const refresh = await import(/* @vite-ignore */ refreshPath);
      refresh.default.injectIntoGlobalHook(window);
      Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type,
        __vite_plugin_react_preamble_installed__: true });
      const path = '/tests/browser/notes-updater.harness.ts';
      return (await import(/* @vite-ignore */ path)).deleteAfterRename();
    });
    expect(result.remaining).toBe('review-renamed');
    expect(result.deletedGone).toBe(true);
    expect(result.afterDelete).toBe(result.beforeDelete);
  }
);
