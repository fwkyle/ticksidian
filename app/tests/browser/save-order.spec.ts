import { expect, test, type Page } from '@playwright/test';
import type { SaveHarnessWindow } from './save-order-harness';

// 실제 useNoteEditor + MemoryVaultAdapter 지연 주입. 네이티브 파일/권한 검사가 아니다.
type SaveProbe = Window & {
  __qa_beforeVaultWrite?: (path: string, content: string) => Promise<void>;
  __saveWrites: string[];
  __savePath: string;
  __releaseSave?: () => void;
  __saveResolved?: number;
};

async function prepare(page: Page) {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeFocused();
  await page.getByLabel('빠른 기록 제목').fill('저장 순서 회귀');
  await page.getByLabel('빠른 기록 제목').press('Enter');
  await expect(page.locator('.bn-editor h1')).toHaveText('저장 순서 회귀');
  await expect(page.locator('.bn-editor')).toBeFocused();
  await page.evaluate(() => {
    const w = window as SaveProbe;
    w.__saveWrites = [];
    w.__qa_beforeVaultWrite = async (path, content) => {
      if (!content.includes('저장 순서 회귀')) return;
      w.__savePath = path;
      w.__saveWrites.push(content);
      if (w.__saveWrites.length === 1) {
        await new Promise<void>(resolve => { w.__releaseSave = resolve; });
      }
    };
  });
}

async function disk(page: Page) {
  return page.evaluate(() => window.__qa_readVaultFile?.((window as SaveProbe).__savePath));
}

test('느린 이전 저장이 최신 저장을 덮지 않고 중간 요청은 최신 하나로 합친다', async ({ page }) => {
  await prepare(page);
  await page.keyboard.insertText('FIRST');
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await page.keyboard.insertText(' SECOND');
  await page.waitForTimeout(1200);
  await page.keyboard.insertText(' LATEST');
  await page.waitForTimeout(1200);
  await page.evaluate(() => (window as SaveProbe).__releaseSave?.());
  await expect.poll(() => disk(page)).toContain('FIRST SECOND LATEST');
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(2);
  await page.waitForTimeout(1200);
  expect(await disk(page)).toContain('FIRST SECOND LATEST');
});

const HARNESS_PATH = '/mock-vault/notes/save-harness.md';

async function harness(page: Page) {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeFocused();
  await page.evaluate(async path => {
    await window.__qa_writeVaultFile?.(path, '---\nid: "save-harness"\n---\n# 저장 훅 검사\n\nORIGINAL\n');
    const source = '/tests/browser/save-order-mount.ts';
    const { mountSaveHarness } = await import(/* @vite-ignore */ source);
    mountSaveHarness();
  }, HARNESS_PATH);
  await expect(page.getByTestId('save-harness-status')).toHaveText('saved');
  await expect(page.getByRole('region', { name: '저장 훅 검사' }).locator('.bn-editor')).toContainText('ORIGINAL');
  await page.waitForTimeout(50); // 로드가 주입한 change guard 해제
  await page.evaluate(path => {
    const w = window as SaveProbe;
    w.__savePath = path;
    w.__saveWrites = [];
    w.__qa_beforeVaultWrite = async (target, content) => {
      if (target !== path) return;
      w.__saveWrites.push(content);
      if (w.__saveWrites.length === 1) await new Promise<void>(resolve => { w.__releaseSave = resolve; });
    };
  }, HARNESS_PATH);
}

async function body(page: Page, text: string) {
  await page.evaluate(text => {
    const { editor } = (window as SaveHarnessWindow).__saveHarness;
    if (!editor) throw new Error('hook not ready');
    editor.updateBlock(editor.document[1], { content: text });
  }, text);
}

test('수동 저장 연타와 메타 편집은 최신 1회로 합치고 모든 호출자가 완료를 기다린다', async ({ page }) => {
  await harness(page);
  await body(page, 'FIRST');
  await page.evaluate(() => { void (window as SaveHarnessWindow).__saveHarness.handleManualSave(); });
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await body(page, 'LATEST');
  await page.evaluate(() => {
    const w = window as SaveProbe & SaveHarnessWindow;
    w.__saveResolved = 0;
    for (let i = 0; i < 5; i++) {
      void w.__saveHarness.handleManualSave().then(() => { w.__saveResolved! += 1; });
    }
    void w.__saveHarness.handleTagsUpdate(['최신태그']);
    void w.__saveHarness.handleTodoMetaUpdate('priority', 'high');
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as SaveProbe).__saveResolved)).toBe(0);
  await page.evaluate(() => (window as SaveProbe).__releaseSave?.());
  await expect.poll(() => disk(page)).toContain('LATEST');
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveResolved)).toBe(5);
  expect(await disk(page)).toContain('최신태그');
  expect(await disk(page)).toContain('priority: "high"');
  expect(await page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(2);
  expect(await page.evaluate(() => (window as SaveHarnessWindow).__saveSerializations)).toBe(2);
  await page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.handleManualSave());
  expect(await page.evaluate(() => (window as SaveHarnessWindow).__saveSerializations)).toBe(2);
  expect(await page.evaluate(() => (window as SaveHarnessWindow).__saveHarnessDirty)).toBe(false);
});

test('저장 중 원래 본문으로 되돌려도 되돌린 최신 본문이 저장된다', async ({ page }) => {
  await harness(page);
  await body(page, 'FIRST');
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await body(page, 'ORIGINAL');
  await page.evaluate(() => (window as SaveProbe).__releaseSave?.());
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(2);
  await expect.poll(() => disk(page)).toContain('ORIGINAL');
  expect(await disk(page)).not.toContain('FIRST');
  await expect(page.getByTestId('save-harness-status')).toHaveText('saved');
});

test('실패한 저장은 dirty를 유지하고 다음 저장 요청으로 복구된다', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => {
    const w = window as SaveProbe;
    w.__qa_beforeVaultWrite = async (path, content) => {
      if (path !== w.__savePath) return;
      w.__saveWrites.push(content);
      if (w.__saveWrites.length === 1) throw new Error('의도한 저장 실패');
    };
  });
  await body(page, 'FAILED DRAFT');
  await page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.handleManualSave());
  await expect(page.getByRole('region', { name: '저장 훅 검사' }).getByRole('alert')).toContainText('저장에 실패');
  expect(await page.evaluate(() => (window as SaveHarnessWindow).__saveHarnessDirty)).toBe(true);
  await expect(page.getByTestId('save-harness-status')).toHaveText('pending');
  await body(page, 'RECOVERED');
  await page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.handleManualSave());
  expect(await disk(page)).toContain('RECOVERED');
  await expect(page.getByTestId('save-harness-status')).toHaveText('saved');
});

test('같은 파일 재마운트는 이전 편집기의 마지막 flush까지 기다려 읽는다', async ({ page }) => {
  await harness(page);
  await body(page, 'FIRST');
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await body(page, 'LAST BEFORE UNMOUNT');
  await page.evaluate(() => (window as SaveHarnessWindow).__saveHarnessRemount());
  await expect(page.getByTestId('save-harness-status')).toHaveText('loading');
  await page.evaluate(() => (window as SaveProbe).__releaseSave?.());
  await expect(page.getByTestId('save-harness-status')).toHaveText('saved');
  await expect(page.getByRole('region', { name: '저장 훅 검사' }).locator('.bn-editor')).toContainText('LAST BEFORE UNMOUNT');
  expect(await disk(page)).toContain('LAST BEFORE UNMOUNT');
});

test('볼트를 바꿔도 대기 중인 이전 편집기 저장은 원래 절대경로에만 쓴다', async ({ page }) => {
  await harness(page);
  await body(page, 'FIRST');
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await body(page, 'OLD VAULT LAST');
  await page.evaluate(async () => {
    const source = '/src/lib/local-fs/vault-paths.ts';
    const { ensureDirectory } = await import(/* @vite-ignore */ source);
    await ensureDirectory('/other-vault/notes');
    await window.__qa_writeVaultFile?.('/other-vault/notes/save-harness.md', '# 다른 볼트\n\nOTHER ORIGINAL\n');
    (window as SaveHarnessWindow).__saveHarnessRemount('/other-vault');
  });
  await expect(page.getByTestId('save-harness-status')).toHaveText('saved');
  await page.evaluate(() => (window as SaveProbe).__releaseSave?.());
  await expect.poll(() => disk(page)).toContain('OLD VAULT LAST');
  expect(await page.evaluate(() => window.__qa_readVaultFile?.('/other-vault/notes/save-harness.md'))).toBe('# 다른 볼트\n\nOTHER ORIGINAL\n');
  await expect(page.getByRole('region', { name: '저장 훅 검사' }).locator('.bn-editor')).toContainText('OTHER ORIGINAL');
  expect(await page.evaluate(() => (window as SaveHarnessWindow).__saveHarnessDirty)).toBe(false);
});

test('이전 저장 완료는 디바운스 대기 중인 최신 입력을 저장됨으로 표시하지 않는다', async ({ page }) => {
  await prepare(page);
  await page.keyboard.insertText('FIRST');
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await page.keyboard.insertText(' NEWER');
  await page.evaluate(() => (window as SaveProbe).__releaseSave?.());
  await expect.poll(() => disk(page)).toContain('FIRST');
  await expect(page.getByText('저장됨', { exact: true })).toHaveCount(0);
  await expect.poll(() => disk(page)).toContain('FIRST NEWER');
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
});

test('입력 대기 중 할 일 표시는 허용하고 실제 쓰기 중에만 기존처럼 막는다', async ({ page }) => {
  await prepare(page);
  await page.keyboard.insertText('UNSAVED DRAFT');
  const toggle = page.getByRole('button', { name: '할 일로 표시', exact: true });
  expect(await toggle.isEnabled()).toBe(true);
  await expect(page.getByText('저장됨', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await expect(toggle).toBeDisabled();
  await page.evaluate(() => (window as SaveProbe).__releaseSave?.());
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
  await expect(toggle).toBeEnabled();
});

test('쓰기 대기 중 외부 변경은 실제 쓰기 직전 거부하고 keep-local로만 다시 저장한다', async ({ page }) => {
  await prepare(page);
  await page.keyboard.insertText('LOCAL WAITING');
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await page.evaluate(async () => {
    const path = (window as SaveProbe).__savePath;
    await window.__qa_simulateExternalEdit?.(path, '# 저장 순서 회귀\n\nEXTERNAL DURING WAIT\n');
    (window as SaveProbe).__releaseSave?.();
  });
  await expect(page.getByText('파일이 외부에서 수정되었습니다')).toBeVisible();
  expect(await disk(page)).toContain('EXTERNAL DURING WAIT');
  expect(await disk(page)).not.toContain('LOCAL WAITING');
  await expect(page.locator('.bn-editor')).toContainText('LOCAL WAITING');
  await page.getByRole('button', { name: '내 변경 유지', exact: true }).click();
  await expect.poll(() => disk(page)).toContain('LOCAL WAITING');
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
});

test('외부 충돌 뒤 원래 본문으로 되돌려 keep-local하면 중복 생략 없이 외부 내용을 교체한다', async ({ page }) => {
  await harness(page);
  await body(page, 'FIRST');
  await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
  await page.evaluate(async () => {
    await window.__qa_simulateExternalEdit?.((window as SaveProbe).__savePath, '# 저장 훅 검사\n\nEXTERNAL\n');
    (window as SaveProbe).__releaseSave?.();
  });
  await expect.poll(() => page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.hasExternalChangePending)).toBe(true);
  await body(page, 'ORIGINAL');
  await page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.handleKeepLocalChanges());
  await expect.poll(() => disk(page)).toContain('ORIGINAL');
  expect(await disk(page)).not.toContain('EXTERNAL');
  await expect(page.getByTestId('save-harness-status')).toHaveText('saved');
});

test('외부 자동 재로드 실패 뒤 명시적 저장도 원본을 보호하며 버전 선택 뒤에만 쓴다', async ({ page }) => {
  await harness(page);
  await page.evaluate(async () => {
    const w = window as SaveProbe & { __qa_failNextReads?: (path: string, count: number) => void };
    w.__qa_beforeVaultWrite = undefined;
    w.__qa_failNextReads?.(w.__savePath, 1);
    await window.__qa_simulateExternalEdit?.(w.__savePath, '# 저장 훅 검사\n\nEXTERNAL\n');
  });
  await expect.poll(() => page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.loadError)).toContain('실패');
  await page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.handleManualSave());
  expect(await disk(page)).toContain('EXTERNAL');
  expect(await disk(page)).not.toContain('ORIGINAL');
  expect(await page.evaluate(path => localStorage.getItem('ticksidian.note-recovery.v1.active.' + encodeURIComponent(path)), HARNESS_PATH)).toContain('ORIGINAL');
  await page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.handleKeepLocalChanges());
  await expect.poll(() => page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.hasExternalChangePending)).toBe(false);
  await page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.handleManualSave());
  expect(await disk(page)).toContain('ORIGINAL');
  expect(await disk(page)).not.toContain('EXTERNAL');

});

for (const [paragraphs, characters] of [[10, 100], [100, 200], [500, 500]]) {
  test(`긴 문서 ${paragraphs}문단 약 ${paragraphs * characters}자는 저장 연타에도 첫/최신 2번만 변환한다`, async ({ page }) => {
    await harness(page);
    await page.evaluate(({ paragraphs, characters }) => {
      const state = (window as SaveHarnessWindow).__saveHarness;
      const editor = state.editor;
      if (!editor) throw new Error('editor not ready');
      editor.replaceBlocks(editor.document, [editor.document[0], ...Array.from({ length: paragraphs }, (_, index) => ({
        type: 'paragraph' as const, content: `P${index} ` + '가'.repeat(characters - 12) + ` END${index}`,
      }))]);
      void state.handleManualSave();
    }, { paragraphs, characters });
    await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(1);
    await page.evaluate(paragraphs => {
      const w = window as SaveHarnessWindow & SaveProbe;
      const { editor, handleManualSave } = w.__saveHarness;
      if (!editor) throw new Error('editor not ready');
      // BlockNote가 끝에 빈 문단을 자동 추가한다. 같은 마지막 본문 문단 ID를 수정한다.
      const target = editor.document[paragraphs].id;
      w.__saveResolved = 0;
      for (let i = 0; i < 5; i++) {
        editor.updateBlock(target, { content: i === 4 ? 'LONG DOCUMENT LATEST' : `INTERMEDIATE ${i}` });
        void handleManualSave().then(() => { w.__saveResolved! += 1; });
      }
      w.__releaseSave?.();
    }, paragraphs);
    await expect.poll(() => page.evaluate(() => (window as SaveProbe).__saveResolved)).toBe(5);
    const content = await disk(page);
    expect(content).toContain('LONG DOCUMENT LATEST');
    expect(content?.includes('INTERMEDIATE')).toBe(false);
    for (let i = 0; i < paragraphs - 1; i++) {
      expect(content?.includes(`P${i} ` + '가'.repeat(characters - 12) + ` END${i}`), `문단 ${i} 보존`).toBe(true);
    }
    expect(await page.evaluate(() => (window as SaveProbe).__saveWrites.length)).toBe(2);
    expect(await page.evaluate(() => (window as SaveHarnessWindow).__saveSerializations)).toBe(2);
    await page.evaluate(() => (window as SaveHarnessWindow).__saveHarness.handleManualSave());
    expect(await page.evaluate(() => (window as SaveHarnessWindow).__saveSerializations)).toBe(2);
    await expect(page.getByTestId('save-harness-status')).toHaveText('saved');
    const metrics = {
        paragraphs, approximateInputCharacters: paragraphs * characters,
        initialSavedCharacters: await page.evaluate(() => (window as SaveProbe).__saveWrites[0].length),
        savedCharacters: content?.length,
        writes: await page.evaluate(() => (window as SaveProbe).__saveWrites.length),
        serializationsIncludingNoop: await page.evaluate(() => (window as SaveHarnessWindow).__saveSerializations),
        latestBodyPreserved: content?.includes('LONG DOCUMENT LATEST'),
    };
    console.log('SAVE_METRICS', JSON.stringify(metrics));
    await test.info().attach('save-metrics', {
      contentType: 'application/json',
      body: JSON.stringify(metrics),
    });
  });
}
