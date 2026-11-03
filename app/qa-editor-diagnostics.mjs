import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorDiagnostics, EDITOR_DIAGNOSTICS_KEY, MAX_DIAGNOSTIC_EVENTS } from './src/lib/editor-diagnostics.ts';
const context = { path: '/fixture/note.md', baselineMtime: 100, observedMtime: 200, pendingMtime: null, dirty: true, timerPending: false, mounted: true, stage: 'stat' };
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const entries = store => JSON.parse(store.exportJson()).entries;

test('충돌 수정 시각/상태를 기록하고 재시작 뒤 복원한다', () => {
  const disk = storage();
  const log = new EditorDiagnostics(() => disk, 'first-session');
  log.record('save-blocked', context, { code: 'fileModifiedExternally' });
  const restored = new EditorDiagnostics(() => disk, 'next-session');
  assert.equal(restored.count, 1);
  assert.equal(entries(restored)[0].baselineMtime, 100);
  assert.equal(entries(restored)[0].observedMtime, 200);
  assert.equal(entries(restored)[0].session, 'first-session');
  assert.equal(entries(restored)[0].errorCode, 'fileModifiedExternally');
});

test('원문 에러/stack/본문/임의 추가 필드는 저장하거나 다시 내보내지 않는다', () => {
  const disk = storage();
  const log = new EditorDiagnostics(() => disk, 'session');
  log.record('save-failed', { ...context, content: 'PRIVATE_BODY', token: 'SECRET_TOKEN' }, { code: 'SECRET_CODE', message: 'PRIVATE_MESSAGE', stack: 'PRIVATE_STACK' });
  disk.setItem(EDITOR_DIAGNOSTICS_KEY, JSON.stringify([{ ...entries(log)[0], content: 'INJECTED_BODY', token: 'INJECTED_TOKEN' }]));
  const restored = new EditorDiagnostics(() => disk, 'session');
  assert.doesNotMatch(log.exportJson() + restored.exportJson(), /PRIVATE_|SECRET_|INJECTED_/);
  assert.equal(entries(restored)[0].errorCode, 'unknown');
});

test('같은 사건은 반복 횟수로 합치고 다른 수정 시각은 별도로 남긴다', () => {
  const disk = storage();
  const log = new EditorDiagnostics(() => disk, 'session');
  log.record('save-blocked', context);
  log.record('save-blocked', context);
  log.record('save-blocked', { ...context, observedMtime: 201 });
  assert.equal(log.count, 2);
  assert.equal(entries(log)[0].repeats, 2);
});

test('기록과 복원 모두 200건 한도를 지킨다', () => {
  const disk = storage();
  const log = new EditorDiagnostics(() => disk, 'session');
  for (let i = 0; i < MAX_DIAGNOSTIC_EVENTS + 10; i++) log.record('save-blocked', { ...context, observedMtime: i });
  assert.equal(log.count, MAX_DIAGNOSTIC_EVENTS);
  assert.equal(entries(log)[0].observedMtime, 10);
  disk.setItem(EDITOR_DIAGNOSTICS_KEY, JSON.stringify([...entries(log), ...entries(log)]));
  assert.equal(new EditorDiagnostics(() => disk, 'session').count, MAX_DIAGNOSTIC_EVENTS);
});

test('저장소 접근/용량/손상 오류와 구독자 실패가 저장 흐름에 전파되지 않는다', () => {
  for (const disk of [() => { throw Error('denied'); }, () => ({ getItem: () => '{', setItem: () => { throw Error('quota'); } })]) {
    const log = new EditorDiagnostics(disk, 'session');
    log.subscribe(() => { throw Error('subscriber'); });
    assert.doesNotThrow(() => log.record('save-failed', context));
    assert.equal(log.count, 1);
    assert.equal(JSON.parse(log.exportJson()).persisted, false);
  }
});
