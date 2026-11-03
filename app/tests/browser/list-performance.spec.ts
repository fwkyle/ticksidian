import { test, expect, type Page } from '@playwright/test';

interface RowCounts { NoteItem: number; TodoRow: number }
declare global { interface Window { __listRowCounts: RowCounts } }

async function openHarness(page: Page, count: number, imported = false) {
  await page.addInitScript(() => { window.__listRowCounts = { NoteItem: 0, TodoRow: 0 }; });
  // Vite가 변환한 실제 함수 진입점만 계측한다. 제품 소스에는 계수기/테스트 분기를 넣지 않는다.
  await page.route(/\/src\/components\/sidebar\/(NoteColumn|NoteItem)\.tsx(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    let body = await response.text();
    for (const name of ['NoteItem', 'TodoRow']) {
      const expression = new RegExp(`function ${name}\\([\\s\\S]*?\\) \\{`);
      if (expression.test(body)) body = body.replace(expression, match => `${match}\nwindow.__listRowCounts.${name}++;`);
    }
    await route.fulfill({ response, body });
  });
  // 문서를 실제 localhost 응답으로 받아 로컬 네트워크 접근 판정을 보존한다.
  await page.goto(`/tests/browser/fixtures/list-performance.html?count=${count}&imported=${imported}`);
  await expect(page.locator('[data-note-column]')).toBeVisible();
}

async function counts(page: Page, reset = false) {
  return page.evaluate(reset => {
    const current = { ...window.__listRowCounts };
    if (reset) window.__listRowCounts = { NoteItem: 0, TodoRow: 0 };
    return current;
  }, reset);
}

for (const count of [25, 600, 2000]) {
  test(`${count}개 목록: 무관한 상태 0행, 선택은 이전/다음 메모 2행만 실행`, async ({ page }, testInfo) => {
    await openHarness(page, count);
    const initial = await counts(page, true);
    await page.getByRole('button', { name: '무관 상태 변경', exact: true }).click();
    await expect(page.locator('[data-version]')).toHaveText('1');
    const unrelated = await counts(page, true);
    await page.getByRole('button', { name: '기록 0001', exact: true }).click();
    await expect(page.locator('[data-event]')).toHaveText('select:1:note-1');
    const selected = await counts(page, true);
    await page.getByRole('button', { name: '한 제목 변경', exact: true }).click();
    await expect(page.getByRole('button', { name: '바뀐 제목', exact: true })).toBeVisible();
    const changed = await counts(page);
    const measurement = { count, initial, unrelated, selected, changed };
    await testInfo.attach('actual-row-executions', { body: JSON.stringify(measurement, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify(measurement));
    expect(initial.NoteItem + initial.TodoRow).toBe(count); // 계측 누락이면 실패
    expect.soft(unrelated).toEqual({ NoteItem: 0, TodoRow: 0 });
    expect.soft(selected).toEqual({ NoteItem: 2, TodoRow: 0 });
    expect(changed).toEqual({ NoteItem: 1, TodoRow: 0 });
  });

  test(`${count}개 가져온 할 일: 기록 DOM 0, 할 일 보기에서 구성`, async ({ page }, testInfo) => {
    await openHarness(page, count, true);
    expect(await counts(page, true)).toEqual({ NoteItem: 0, TodoRow: 0 });
    await expect(page.locator('[data-list-item]')).toHaveCount(0);
    await page.locator('[data-note-column]').getByRole('button', { name: /^할 일/ }).click();
    await expect(page.locator('[data-list-item]')).toHaveCount(count);
    const rendered = await counts(page, true);
    expect(rendered).toEqual({ NoteItem: 0, TodoRow: count });
    await page.getByRole('button', { name: '무관 상태 변경', exact: true }).click();
    expect(await counts(page, true)).toEqual({ NoteItem: 0, TodoRow: 0 });
    await page.getByRole('button', { name: '기록 0001', exact: true }).click();
    expect(await counts(page, true)).toEqual({ NoteItem: 0, TodoRow: 2 });
    await page.getByRole('button', { name: '한 제목 변경', exact: true }).click();
    expect(await counts(page)).toEqual({ NoteItem: 0, TodoRow: 1 });
    await testInfo.attach('row-counts', { body: JSON.stringify({ count, rendered }), contentType: 'application/json' });
    await page.locator('[data-note-column]').getByRole('button', { name: '기록', exact: true }).click();
    await expect(page.locator('[data-list-item]')).toHaveCount(0);
  });
}

test('최신 콜백·키보드·드래그·완료·날짜·검색/빈 목록 계약 보존', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 8, 8, 23, 59, 0) });
  await openHarness(page, 25);
  const column = page.locator('[data-note-column]');
  const note = column.locator('[data-list-item="기록 0000"]');
  await expect(note).toHaveCSS('height', '40px');
  await expect(note.locator('.note-list-title')).toHaveCSS('font-weight', '600');
  await page.getByRole('button', { name: '무관 상태 변경', exact: true }).click();
  await note.getByRole('button', { name: '기록 0000 삭제', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-event]')).toHaveText('delete:1:note-0');
  await note.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 12, clientY: 34 })));
  await expect(page.locator('[data-event]')).toHaveText('context:1:기록 0000:12:34');
  const drag = await note.evaluate(element => {
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    return dataTransfer.getData('application/x-ticksidian-note');
  });
  expect(drag).toBe('note-0');
  await column.getByLabel('정렬 기준', { exact: true }).selectOption('updated');
  await page.getByRole('button', { name: '한 제목 변경', exact: true }).click();
  const renamed = column.locator('[data-list-item]').first();
  await expect(renamed).toHaveAttribute('data-list-item', '바뀐 제목');
  await renamed.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 23, clientY: 45 })));
  await expect(page.locator('[data-event]')).toHaveText('context:1:바뀐 제목:23:45');
  await page.getByRole('button', { name: '검색 결과 전환', exact: true }).click();
  await expect(column.locator('[data-list-item]')).toHaveCount(0);
  await expect(column.getByText('검색 결과', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '검색 결과 전환', exact: true }).click();
  await expect(column.locator('[data-list-item]')).toHaveCount(25);
  await page.getByRole('button', { name: '목록 비우기', exact: true }).click();
  await expect(column.getByText('아직 기록이 없습니다. 새 기록을 시작해 보세요.')).toBeVisible();
});

test('할 일의 날짜 갱신·완료와 검색/종류 전환은 유지된다', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 8, 8, 23, 59, 0) });
  await openHarness(page, 25, true);
  const column = page.locator('[data-note-column]');
  await column.getByRole('button', { name: /^할 일/ }).click();
  const todo = column.locator('[data-list-item="기록 0001"]');
  await expect(todo.locator('[aria-hidden="true"]')).toHaveText('마감 9월 8일');
  await expect(todo.locator('[aria-hidden="true"]')).toHaveClass(/text-blue-600/);
  await page.clock.fastForward(120_000);
  await page.getByRole('button', { name: '무관 상태 변경', exact: true }).click();
  await expect(todo.locator('[aria-hidden="true"]')).toHaveClass(/text-red-500/);
  await todo.getByRole('button', { name: '기록 0001 완료', exact: true }).press('Space');
  await expect(page.locator('[data-event]')).toHaveText('toggle:1:note-1');
  await expect(todo.getByRole('button', { name: '기록 0001', exact: true })).toHaveClass(/line-through/);
  await page.getByRole('button', { name: '검색 결과 전환', exact: true }).click();
  await expect(column.locator('[data-list-item]')).toHaveCount(0);
  await page.getByRole('button', { name: '검색 결과 전환', exact: true }).click();
  await expect(column.locator('[data-list-item]')).toHaveCount(25);
  await column.getByRole('button', { name: '기록', exact: true }).click();
  await expect(column.locator('[data-list-item]')).toHaveCount(0);
});
