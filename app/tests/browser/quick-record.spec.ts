import { expect, test } from '@playwright/test';

type WriteProbe = Window & {
  __qa_beforeVaultWrite?: (path: string, content: string) => Promise<void>;
  __releaseQuickWrite?: () => void;
  __quickWriteCount?: number;
};

test('제목 Enter 후 새 기록 본문에 바로 쓰고 제목과 원본을 보존한다', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '빠른 기록 제목' });
  await expect(input).toBeVisible();
  await expect(page.locator('.bn-editor')).toContainText('맨몸 메모');
  await expect(page.locator('.bn-editor')).toBeFocused();
  await expect(page.getByLabel('노트 검색', { exact: true })).toHaveCount(0);
  for (const title of ['빠르게 적은 생각', '다음 기록']) {
    await input.fill(title);
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(page.locator('.bn-editor')).toBeFocused();
    await expect(page.locator('[data-note-column]').getByRole('button', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('.bn-editor h1')).toHaveText(title);
    await page.keyboard.insertText('바로 이어 쓰는 본문');
    await expect(page.locator('.bn-editor h1')).toHaveText(title);
    await expect(page.locator('.bn-editor p').first()).toHaveText('바로 이어 쓰는 본문');
    await expect.poll(() => page.evaluate(async title => {
      const files = await window.__qa_listVaultFiles?.() ?? [];
      for (const path of files.filter(path => path.endsWith('.md') && !path.includes('/.trash/'))) {
        const content = await window.__qa_readVaultFile?.(path);
        if (content?.includes(`title: "${title}"`)) return content;
      }
    }, title)).toContain('바로 이어 쓰는 본문');
  }
});

test('검색 버튼과 단축키, Escape는 빠른 기록 초안을 보존한다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeFocused();
  const input = page.getByRole('textbox', { name: '빠른 기록 제목' });
  await input.fill('쓰던 제목');
  await page.getByRole('button', { name: '검색 열기', exact: true }).click();
  const search = page.getByLabel('노트 검색', { exact: true });
  await expect(search).toBeFocused();
  await search.fill('alpha');
  await search.press('Escape');
  await expect(input).toHaveValue('쓰던 제목');
  await expect(input).toBeFocused();
  await expect(search).toHaveCount(0);
  await input.press('Meta+k');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await page.getByRole('button', { name: '검색 닫기', exact: true }).click();
  await expect(input).toHaveValue('쓰던 제목');
});

test('공백·한글 조합 Enter는 생성하지 않고 Markdown 기호를 제목 그대로 저장한다', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('빠른 기록 제목');
  await expect(page.locator('.bn-editor')).toBeVisible();
  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  await input.fill('   ');
  await input.press('Enter');
  await input.fill('조합 중');
  await input.dispatchEvent('compositionstart');
  const composingDefaultAllowed = await input.evaluate(el => el.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }),
  ));
  expect(composingDefaultAllowed).toBe(true);
  await input.dispatchEvent('compositionend');
  await page.getByRole('form', { name: '빠른 기록' }).dispatchEvent('submit');
  expect(await page.evaluate(() => window.__qa_listVaultFiles?.() ?? [])).toEqual(before);
  const title = '  **진짜 제목** [링크](https://example.com) <b>한글</b>  ';
  await input.fill(title);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  const added = await page.evaluate(async old => (await window.__qa_listVaultFiles?.() ?? []).filter(p => !old.includes(p)), before);
  expect(added).toHaveLength(1);
  expect(added[0]).toContain('/inbox/');
  const content = await page.evaluate(p => window.__qa_readVaultFile?.(p), added[0]);
  expect(content).toContain('title: ' + JSON.stringify(title.trim()));
  expect(content).not.toContain('type: "todo"');
  await page.getByRole('button', { name: title.trim(), exact: true }).click();
  await expect(page.locator('.bn-editor h1')).toHaveText(title.trim());
  // 편집기의 기존 URL 자동 인식은 유지하되 제목 문법/HTML로 해석하지 않는다.
  await expect(page.locator('.bn-editor h1 strong, .bn-editor h1 b')).toHaveCount(0);
  await expect(page.locator('.bn-editor h1 a')).toHaveAttribute('href', 'https://example.com');
  await page.locator('.bn-editor p').first().click();
  await page.keyboard.insertText('특수 제목 아래 본문');
  await expect.poll(() => page.evaluate(p => window.__qa_readVaultFile?.(p), added[0])).toContain('특수 제목 아래 본문');
  expect(await page.evaluate(p => window.__qa_readVaultFile?.(p), added[0])).toContain('title: ' + JSON.stringify(title.trim()));
  await page.reload();
  await expect(page.getByRole('button', { name: title.trim(), exact: true })).toBeVisible();
});

test('쓰기 실패 때 제목을 남기고 재시도 중 중복 Enter를 막는다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  const input = page.getByLabel('빠른 기록 제목');
  await page.evaluate(() => {
    const w = window as WriteProbe;
    w.__quickWriteCount = 0;
    w.__qa_beforeVaultWrite = async (_path, content) => {
      if (!content.includes('실패 후 재시도')) return;
      w.__quickWriteCount = (w.__quickWriteCount ?? 0) + 1;
      if (w.__quickWriteCount === 1) throw new Error('저장 권한 테스트 오류');
      await new Promise<void>(resolve => { w.__releaseQuickWrite = resolve; });
    };
  });
  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  await input.fill('실패 후 재시도');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('저장 권한 테스트 오류');
  await expect(input).toHaveValue('실패 후 재시도');
  await expect(page.locator('.bn-editor')).toContainText('맨몸 메모');
  expect(await page.evaluate(() => window.__qa_listVaultFiles?.() ?? [])).toEqual(before);
  await input.press('Enter');
  await expect(input).toHaveAttribute('readonly', '');
  await input.press('Enter');
  expect(await page.evaluate(() => (window as WriteProbe).__quickWriteCount)).toBe(2);
  await page.evaluate(() => (window as WriteProbe).__releaseQuickWrite?.());
  await expect(input).toHaveValue('');
  await expect(page.locator('.bn-editor')).toBeFocused();
  await expect(page.locator('.bn-editor h1')).toHaveText('실패 후 재시도');
  const added = await page.evaluate(async old => (await window.__qa_listVaultFiles?.() ?? []).filter(p => !old.includes(p)), before);
  expect(added).toHaveLength(1);
});

// 2026-09-22 [kyle] 요청으로 계약이 바뀌었다: 할 일 보기에서 상단 입력은 할 일을 만든다.
// (이전 계약: 어느 필터에서든 일반 기록을 만든다)
test('선택 폴더에 저장하고 할 일 보기에서는 할 일로 만든다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  await page.locator('[data-folder-select="notes"]').click();
  const column = page.locator('[data-note-column]');
  await column.getByRole('group', { name: '종류 필터' }).getByRole('button', { name: /^할 일/ }).click();
  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  const input = page.getByLabel('빠른 기록 제목');
  await input.fill('폴더에 바로 기록');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  // 필터는 할 일로 유지되고(새 할 일이 보여야 한다), 파일도 할 일로 저장된다.
  await expect(column.getByRole('group', { name: '종류 필터' }).getByRole('button', { name: /^할 일/ }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(column.getByRole('button', { name: '폴더에 바로 기록', exact: true })).toBeVisible();
  const added = await page.evaluate(async old => (await window.__qa_listVaultFiles?.() ?? []).filter(p => !old.includes(p)), before);
  expect(added).toHaveLength(1);
  expect(added[0]).toContain('/notes/');
  expect(await page.evaluate(p => window.__qa_readVaultFile?.(p), added[0])).toContain('type: "todo"');
});

test('추가 버튼도 새 본문을 열고 검색 범위 선택 중 Escape도 닫힌다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  const input = page.getByLabel('빠른 기록 제목');
  await input.fill('버튼으로 기록');
  await page.getByRole('button', { name: '기록 추가', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('.bn-editor')).toBeFocused();
  await page.keyboard.insertText('버튼 뒤 본문');
  await expect(page.locator('.bn-editor h1')).toHaveText('버튼으로 기록');
  await expect(page.locator('.bn-editor p').first()).toHaveText('버튼 뒤 본문');
  await page.getByRole('button', { name: '검색 열기', exact: true }).click();
  await page.getByLabel('검색 범위', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(input).toBeFocused();
  await expect(page.getByLabel('노트 검색')).toHaveCount(0);
});

test('전체 할 일에서 만든 기록은 기본함에 있고 빈 기본함에서도 새 본문을 연다', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __qa_omitInboxSeed?: boolean }).__qa_omitInboxSeed = true;
  });
  await page.goto('/');
  const input = page.getByLabel('빠른 기록 제목');
  await expect(input).toBeVisible();
  await page.getByRole('button', { name: '전체 할 일 보기', exact: true }).click();
  const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
  await input.fill('비어 있어도 기록');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.bn-editor')).toBeFocused();
  await expect(page.locator('.bn-editor h1')).toHaveText('비어 있어도 기록');
  await expect(page.getByRole('button', { name: '비어 있어도 기록', exact: true })).toBeVisible();
  const added = await page.evaluate(async old => (await window.__qa_listVaultFiles?.() ?? []).filter(p => !old.includes(p)), before);
  expect(added).toHaveLength(1);
  expect(added[0]).toContain('/inbox/');
});

test('볼트 전환 중 늦게 저장된 기록은 시작 볼트에만 남고 새 목록에 섞이지 않는다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bn-editor')).toBeVisible();
  await page.evaluate(async () => {
    const w = window as WriteProbe;
    const modulePath = '/src/lib/tauri-vault-adapter.ts';
    const { tauriVaultAdapter: adapter, setActiveVaultAdapter } = await import(modulePath);
    const keys = ['kind', 'registerVaultPath', 'getVaultPath', 'setVaultPath', 'createDirectory', 'readTextFile', 'writeTextFile', 'readBinaryFile', 'writeBinaryFile', 'deleteFile', 'renameDirectory', 'trashDirectory', 'listDirectoryEntries', 'getFileStat'];
    setActiveVaultAdapter({
      ...Object.fromEntries(keys.map(key => [key, adapter[key]])),
      selectVaultFolder: async () => '/mock-vault-B',
    });
    w.__qa_beforeVaultWrite = async (_path, content) => {
      if (content.includes('이전 볼트 기록')) await new Promise<void>(resolve => { w.__releaseQuickWrite = resolve; });
    };
  });
  const input = page.getByLabel('빠른 기록 제목');
  await input.fill('이전 볼트 기록');
  await input.press('Enter');
  await expect(input).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: '볼트 폴더 변경/재선택' }).click();
  await expect(input).not.toHaveAttribute('readonly', '');
  await expect(input).toHaveValue('');
  await page.evaluate(() => (window as WriteProbe).__releaseQuickWrite?.());
  await expect.poll(() => page.evaluate(async () => {
    const files = await window.__qa_listVaultFiles?.() ?? [];
    const matches: string[] = [];
    for (const path of files) {
      if (!path.endsWith('.md')) continue;
      if ((await window.__qa_readVaultFile?.(path))?.includes('이전 볼트 기록')) matches.push(path);
    }
    return matches;
  })).toEqual([expect.stringMatching(/^\/mock-vault\/inbox\/.*\.md$/)]);
  await expect(page.locator('[data-note-column]').getByRole('button', { name: '이전 볼트 기록', exact: true })).toHaveCount(0);
  await expect(page.locator('.bn-editor')).toHaveCount(0);
});

for (const width of [375, 1440]) {
  test(`생성 후 본문 준비 ${width}px — 선택만으로 다시 저장하지 않는다`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('.bn-editor')).toBeFocused();
    if (width < 1024) {
      await page.getByRole('button', { name: '사이드바 열기' }).click();
      await page.locator('[data-folder-select="기본함"]').click();
    }
    await page.screenshot({ path: testInfo.outputPath('before.png') });
    await page.evaluate(() => {
      const w = window as WriteProbe;
      w.__quickWriteCount = 0;
      w.__qa_beforeVaultWrite = async (_path, content) => {
        if (content.includes('바로 쓰기 준비')) w.__quickWriteCount = (w.__quickWriteCount ?? 0) + 1;
      };
    });
    await page.getByLabel('빠른 기록 제목').fill('바로 쓰기 준비');
    await page.getByLabel('빠른 기록 제목').press('Enter');
    await expect(page.locator('.bn-editor h1')).toHaveText('바로 쓰기 준비');
    await expect(page.locator('.bn-editor')).toBeFocused();
    await expect.poll(() => page.evaluate(() => {
      const node = window.getSelection()?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      return element?.closest('p')?.textContent;
    })).toBe('');
    if (width < 768) await expect(page.getByRole('button', { name: '사이드바 열기' })).toBeVisible();
    // 자동 저장 주기(1초)를 지나도 포커스만으로 파일을 다시 쓰지 않아야 한다.
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (window as WriteProbe).__quickWriteCount)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('after.png') });
    await page.keyboard.insertText('바로 쓰는 한글 본문');
    await expect(page.locator('.bn-editor h1')).toHaveText('바로 쓰기 준비');
    await expect(page.locator('.bn-editor p').first()).toHaveText('바로 쓰는 한글 본문');
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

/**
 * 할 일 필터에서 상단 입력은 기록이 아니라 할 일을 만든다(2026-09-22 [kyle] 요청).
 *
 * 잠긴 목표
 * - 입력 안내·버튼 이름이 종류에 맞게 바뀐다(접근 이름 `빠른 기록 제목`은 기존 계약이라 유지).
 * - 파일에 `type: "todo"`로 저장되고, 필터는 할 일로 유지되며, 만든 항목이 편집기에서 열린다.
 * - 기록 필터에서는 기존대로 기록이 만들어진다.
 */
test('할 일 필터에서 상단 입력은 할 일을 만들고 필터를 유지한다', async ({ page }) => {
  await page.goto('/');
  // 볼트 초기 로드가 끝난 뒤에 입력한다. 로드 중 생성이 겹치면 낙관 삽입이 건너뛰어져
  // 목록이 비는 경우가 전체 실행에서 1회 관찰됐다(2026-09-22 일지·TODO 참고, 앱 쪽 조사 대상).
  await expect(page.locator('.bn-editor')).toContainText('맨몸 메모');
  const column = page.locator('[data-note-column]');
  const input = page.getByRole('textbox', { name: '빠른 기록 제목' });

  // 기록 필터(기본)에서는 기존 문구·동작이 그대로다.
  await expect(page.locator('[data-quick-kind="record"]')).toBeVisible();
  await expect(input).toHaveAttribute('placeholder', '기록 제목 입력…');

  await column.getByRole('button', { name: /^할 일/ }).click();
  await expect(page.locator('[data-quick-kind="todo"]')).toBeVisible();
  await expect(input).toHaveAttribute('placeholder', '할 일 제목 입력…');
  await expect(page.getByRole('button', { name: '할 일 추가', exact: true })).toBeVisible();

  await input.fill('빠른 할 일 하나');
  await input.press('Enter');
  await expect(input).toHaveValue('');

  // 필터는 할 일로 유지되고, 새 항목이 할 일 목록에 들어간다.
  await expect(column.locator('[data-list-section]').first()).toBeVisible();
  await expect(column.locator('[data-list-item="빠른 할 일 하나"]')).toBeVisible();
  await expect(page.locator('.bn-editor h1')).toHaveText('빠른 할 일 하나');

  // 파일에는 할 일 frontmatter가 함께 저장된다.
  await expect.poll(() => page.evaluate(async (title) => {
    const files = await window.__qa_listVaultFiles?.() ?? [];
    for (const path of files.filter(p => p.endsWith('.md') && !p.includes('/.trash/'))) {
      const content = await window.__qa_readVaultFile?.(path);
      if (content?.includes(`title: "${title}"`)) return content;
    }
    return '';
  }, '빠른 할 일 하나')).toContain('type: "todo"');
});


for (const reason of ['저장 실패', '외부 충돌']) {
  test(`${reason} 중 새 기록 생성은 초안과 기존 편집기를 보존한다`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.bn-editor')).toBeFocused();
    await page.locator('[data-folder-select="전체"]').click();
    await page.getByRole('button', { name: '알파 노트', exact: true }).click();
    await expect(page.locator('.bn-editor h1')).toHaveText('알파 노트');
    const path = '/mock-vault/notes/note-alpha.md';
    if (reason === '저장 실패') {
      await page.evaluate(p => {
        (window as WriteProbe).__qa_beforeVaultWrite = async writePath => {
          if (writePath === p) throw new Error('현재 기록 저장 실패 테스트');
        };
      }, path);
    }
    await page.locator('.bn-editor p').first().click();
    await page.keyboard.insertText('보존할 미저장 본문');
    if (reason === '외부 충돌') {
      await page.evaluate(p => window.__qa_simulateExternalEdit?.(p, '---\nid: "note-alpha"\n---\n# 알파 노트\n\n외부 원문\n'), path);
      await expect(page.getByText('파일이 외부에서 수정되었습니다', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('alert').filter({ hasText: '저장에 실패' })).toBeVisible();
    }
    const before = await page.evaluate(() => window.__qa_listVaultFiles?.() ?? []);
    const input = page.getByLabel('빠른 기록 제목');
    await input.fill('나중에 이어 만들기');
    await input.press('Enter');
    await expect(input).toHaveValue('나중에 이어 만들기');
    await expect(page.getByRole('alert').filter({ hasText: '현재 기록의 저장이나 외부 변경 확인' })).toBeVisible();
    await expect(page.locator('.bn-editor')).toContainText('보존할 미저장 본문');
    expect(await page.evaluate(() => window.__qa_listVaultFiles?.() ?? [])).toEqual(before);
    if (reason === '외부 충돌') expect(await page.evaluate(p => window.__qa_readVaultFile?.(p), path)).toContain('외부 원문');
    if (reason === '외부 충돌') {
      await page.getByRole('button', { name: '내 변경 유지', exact: true }).click();
    } else {
      await page.evaluate(() => { delete (window as WriteProbe).__qa_beforeVaultWrite; });
      await page.locator('.bn-editor p').first().click();
      // 문장 중간 클릭/OS별 End 키 동작에 기대지 않고 복구 입력 위치를 고정한다.
      await page.locator('.bn-editor p').first().evaluate(paragraph => {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await page.keyboard.insertText(' 복구 후 저장');
    }
    await expect.poll(() => page.evaluate(p => window.__qa_readVaultFile?.(p), path)).toContain('보존할 미저장 본문');
    await input.press('Enter');
    await expect(page.locator('.bn-editor h1')).toHaveText('나중에 이어 만들기');
    await expect(page.locator('.bn-editor')).toBeFocused();
  });
}

for (const change of ['폴더', '기록', '검색', '본문 편집']) {
  test(`느린 생성 중 ${change} 변경은 뒤늦은 자동 열기로 되돌리지 않는다`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.bn-editor')).toBeFocused();
    await page.evaluate(() => {
      (window as WriteProbe).__qa_beforeVaultWrite = async (_path, content) => {
        if (content.includes('느리게 만든 기록')) await new Promise<void>(resolve => { (window as WriteProbe).__releaseQuickWrite = resolve; });
      };
    });
    const input = page.getByLabel('빠른 기록 제목');
    await input.fill('느리게 만든 기록');
    await input.press('Enter');
    await expect(input).toHaveAttribute('readonly', '');
    if (change === '폴더' || change === '기록') await page.locator('[data-folder-select="전체"]').click();
    if (change === '기록') await page.getByRole('button', { name: '알파 노트', exact: true }).click();
    if (change === '검색') await page.getByRole('button', { name: '검색 열기', exact: true }).click();
    if (change === '본문 편집') {
      await page.locator('.bn-editor p').first().click();
      await page.keyboard.insertText('기다리는 중 편집');
    }
    await page.evaluate(() => (window as WriteProbe).__releaseQuickWrite?.());
    await expect(input).toHaveValue('');
    await expect(page.locator('.bn-editor')).toContainText(change === '기록' ? '알파 노트' : '맨몸 메모');
    if (change === '검색') await expect(page.getByLabel('노트 검색', { exact: true })).toBeFocused();
    if (change === '본문 편집') await expect(page.locator('.bn-editor')).toContainText('기다리는 중 편집');
    await expect.poll(() => page.evaluate(async () => {
      const files = await window.__qa_listVaultFiles?.() ?? [];
      let count = 0;
      for (const path of files.filter(p => p.endsWith('.md') && !p.includes('/.trash/'))) {
        if ((await window.__qa_readVaultFile?.(path))?.includes('title: "느리게 만든 기록"')) count += 1;
      }
      return count;
    })).toBe(1);
  });
}
