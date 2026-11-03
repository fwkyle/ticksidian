import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('실제 링크 훅의 대량 본문 처리 메모리와 전체 결과', async ({ page }, testInfo) => {
  const harnessPath = process.env.MEMORY_PROFILE_HARNESS_PATH
    ?? '/tests/browser/memory-profile.harness.ts';
  await page.goto('/tests/browser/fixtures/memory-profile.html');
  const initialize = () => page.evaluate(async harnessPath => {
    const refreshPath = '/@react-refresh';
    const refresh = await import(/* @vite-ignore */ refreshPath);
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {},
      $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    await import(/* @vite-ignore */ harnessPath);
  }, harnessPath);
  await initialize();
  // 최초 의존성 재최적화가 있으면 새 화면 실행 공간에 측정기를 다시 연결한다.
  await page.waitForTimeout(1000);
  await initialize();
  const call = (method: string) => page.evaluate(async ({ method, harnessPath }) => {
    const harness = await import(/* @vite-ignore */ harnessPath);
    return harness[method]();
  }, { method, harnessPath });
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  const before = await heap();
  await call('beginProfile');
  await expect.poll(async () => (await call('profileStatus')).held, { timeout: 15000 }).toBe(true);
  const held = await heap();
  await call('releaseReads');
  await expect.poll(async () => (await call('profileStatus')).complete, { timeout: 15000 }).toBe(true);
  expect(await call('profileStatus')).toMatchObject({ sources: 800, targets: 800 });
  const completed = await heap();
  await call('closeProfile');
  const closed = await heap();
  writeFileSync(testInfo.outputPath('heap.json'), JSON.stringify({
    engine: 'Chromium fixture / real useLinkIndex hook', count: 800, inputChars: 65536,
    before, held, completed, closed, heldDelta: held - before, completedDelta: completed - before,
  }, null, 2));
  // 캐시/진행 중12개/관계 객체는 허용하되 원문 전체50MiB 보관 회귀를 잡는다.
  expect(completed - before).toBeLessThan(24 * 1024 * 1024);
});
