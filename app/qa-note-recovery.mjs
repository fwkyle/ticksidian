import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoteRecoveryStore } from './src/lib/note-recovery.ts';
import { draftMetaOrigin, isDraftMetaUntrusted, isFrontmatterWriteBlocked, resolveLoadGuard } from './src/lib/frontmatter-write-guard.ts';
const input = { path: '/one/note.md', baselineMtime: 100, blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '내 글' }] }], meta: { aliases: [], todoMeta: { type: 'todo', done: true }, tags: ['중요'], favorite: true, frontmatter: { custom: '보존' } } };
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null, getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
}

test('선택한 버전만 제거하고 재시작 뒤에도 현재 작성본과 다른 노트는 유지한다', () => {
  const disk = storage();
  const log = new NoteRecoveryStore(() => disk);
  const draft = log.writeDraft(input);
  log.archiveExternal(input.path, '제거할 글', 200);
  log.archiveExternal('/other/note.md', '다른 글', 200);
  const version = log.listVersions(input.path)[0];
  assert.equal(log.removeVersion('/other/note.md', version.id), false);
  assert.equal(log.removeVersion(input.path, version.id), true);
  assert.equal(log.listVersions(input.path).length, 0);
  const restarted = new NoteRecoveryStore(() => disk);
  assert.equal(restarted.listVersions(input.path).length, 0);
  assert.equal(restarted.listVersions('/other/note.md').length, 1);
  assert.equal(restarted.getDraft(input.path).id, draft.id);
  assert.equal(JSON.parse(disk.getItem('ticksidian.note-recovery.v1..trash.' + version.id)).content, '제거할 글');
});

test('제거 사본/목록 제거가 실패하면 보관 버전과 현재 작성본을 유지한다', () => {
  for (const failure of ['backup', 'remove']) {
    const disk = storage();
    const log = new NoteRecoveryStore(() => disk);
    const draft = log.writeDraft(input);
    log.archiveDraft(input.path);
    const version = log.listVersions(input.path)[0];
    if (failure === 'backup') disk.setItem = () => { throw Error('quota'); };
    else disk.removeItem = () => { throw Error('denied'); };
    assert.equal(log.removeVersion(input.path, version.id), false);
    assert.equal(log.listVersions(input.path).length, 1);
    assert.equal(new NoteRecoveryStore(() => disk).listVersions(input.path).length, 1);
    assert.equal(log.getDraft(input.path).id, draft.id);
  }
});

test('작성본 본문/메타를 재시작 뒤 복원하고 전체 경로로 격리한다', () => {
  const disk = storage();
  const log = new NoteRecoveryStore(() => disk);
  const draft = log.writeDraft(input);
  input.meta.tags.push('후속');
  assert.deepEqual(draft.meta.tags, ['중요']);
  input.meta.tags.pop();
  const restarted = new NoteRecoveryStore(() => disk);
  assert.equal(restarted.getDraft(input.path).blocks[0].content[0].text, '내 글');
  assert.equal(restarted.getDraft(input.path).meta.favorite, true);
  assert.equal(restarted.getDraft('/other/note.md'), null);
});

test('옛 저장 완료는 쓰기 중 새 입력을 완료 처리하지 않는다', () => {
  const log = new NoteRecoveryStore(storage);
  const first = log.writeDraft(input);
  const second = log.writeDraft({ ...input, blocks: [{ type: 'paragraph', content: '새 글' }] });
  log.markSaved(input.path, first.id);
  assert.equal(log.getDraft(input.path).id, second.id);
  log.markSaved(input.path, second.id);
  assert.equal(log.getDraft(input.path), null);
});

test('내 글/외부 글을 보관하고 외부 읽기 실패 전에는 작성본을 완료 처리하지 않는다', () => {
  const disk = storage();
  const log = new NoteRecoveryStore(() => disk);
  const draft = log.writeDraft(input);
  assert.equal(log.archiveDraft(input.path), true);
  assert.equal(log.getDraft(input.path).id, draft.id);
  assert.equal(log.archiveExternal(input.path, '외부 글', 200), true);
  log.markArchived(input.path, draft.id);
  const restarted = new NoteRecoveryStore(() => disk);
  assert.equal(restarted.getDraft(input.path), null);
  const versions = restarted.listVersions(input.path);
  assert.equal(versions.length, 2);
  assert.equal(versions.find(v => v.kind === 'external').content, '외부 글');
  assert.equal(versions.find(v => v.kind === 'draft').draft.blocks[0].content[0].text, '내 글');
});

test('보관 공간이 없어도 메모리 사본 유지, 성공으로 표시/사본 자동 퇴출 금지', () => {
  const log = new NoteRecoveryStore(() => { throw Error('denied'); });
  const draft = log.writeDraft(input);
  assert.equal(log.getDraft(input.path).id, draft.id);
  assert.equal(log.isProtected(input.path), false);
  assert.equal(log.archiveDraft(input.path), false);
  assert.equal(log.archiveExternal(input.path, 'external', 200), false);
  assert.equal(log.getDraft(input.path).id, draft.id);
});

test('손상된 작성본을 빈 파일로 복원하지 않고 정상 보관 버전은 유지한다', () => {
  const disk = storage();
  const log = new NoteRecoveryStore(() => disk);
  log.writeDraft(input);
  log.archiveDraft(input.path);
  disk.setItem(disk.key(0), '{');
  const restarted = new NoteRecoveryStore(() => disk);
  assert.equal(restarted.getDraft(input.path), null);
  assert.equal(restarted.isProtected(input.path), false);
  assert.equal(restarted.listVersions(input.path).length, 1);
});

test('완료 상태 영속 보관 성공 뒤 사본 해제, 재열기/재시작 판정과 버전 유지', () => {
  for (const method of ['markSaved', 'markArchived']) {
    const disk = storage();
    const log = new NoteRecoveryStore(() => disk);
    const draft = log.writeDraft(input);
    assert.equal(log.archiveDraft(input.path), true);
    log[method](input.path, draft.id);
    // 점유량 진단: TS private Map을 QA에서만 관찰한다. 제품 API는 추가하지 않는다.
    assert.equal(log.memory.size, 0);
    assert.equal(log.getDraft(input.path), null);
    assert.equal(log.memory.size, 0);
    const restarted = new NoteRecoveryStore(() => disk);
    assert.equal(restarted.getDraft(input.path), null);
    assert.equal(restarted.listVersions(input.path)[0].draft.blocks[0].content[0].text, '내 글');
  }
});

test('완료 상태 보관 실패와 미저장/다른 경로는 메모리 안전망 해제 금지', () => {
  for (const method of ['markSaved', 'markArchived']) {
    const disk = storage();
    const log = new NoteRecoveryStore(() => disk);
    const first = log.writeDraft(input);
    const other = log.writeDraft({ ...input, path: '/other.md' });
    disk.setItem = () => { throw Error('quota'); };
    log[method](input.path, first.id);
    assert.equal(log.memory.size, 2);
    assert.deepEqual(log.memory.get(input.path).blocks, first.blocks);
    assert.equal(log.isProtected(input.path), false);
    assert.equal(log.getDraft('/other.md').id, other.id);
    // 기존 영속 작성본도 그대로여서 재시작 때 보수적으로 복원할 수 있다.
    assert.equal(new NoteRecoveryStore(() => disk).getDraft(input.path).id, first.id);
  }
});

test('옛 저장/보관 완료는 새 입력 사본을 해제하지 않는다', () => {
  const disk = storage();
  const log = new NoteRecoveryStore(() => disk);
  const old = log.writeDraft(input);
  const latest = log.writeDraft({ ...input, blocks: [{ type: 'paragraph', content: '이어 쓴 글' }] });
  log.markSaved(input.path, old.id);
  log.markArchived(input.path, old.id);
  assert.equal(log.getDraft(input.path).id, latest.id);
  assert.equal(log.memory.size, 1);
  assert.equal(new NoteRecoveryStore(() => disk).getDraft(input.path).id, latest.id);
});

test('머리말 쓰기 보호: 표시(metaUnreadable)는 작성본에 저장되고 표시 없는 기존 작성본도 읽힌다 (DFXR-005)', () => {
  const disk = storage();
  const marked = new NoteRecoveryStore(() => disk).writeDraft({ ...input, metaUnreadable: true });
  assert.equal(new NoteRecoveryStore(() => disk).getDraft(input.path).metaUnreadable, true);
  assert.equal(marked.metaUnreadable, true);
  const legacyDisk = storage();
  legacyDisk.setItem('ticksidian.note-recovery.v1.active.' + encodeURIComponent(input.path), JSON.stringify({ ...input, id: 'legacy', at: 1, status: 'draft' }));
  const legacy = new NoteRecoveryStore(() => legacyDisk).getDraft(input.path);
  assert.equal(legacy.id, 'legacy');
  assert.equal(legacy.metaUnreadable, undefined);
});

test('머리말 쓰기 보호: 로드 규칙 행렬 — 작성본 × 표시 × 디스크{읽음, 깨짐, 읽기 실패} (DFXR-004·005·006)', () => {
  const rule = (disk, draft) => resolveLoadGuard({ disk, draft });
  const row = (useDiskMeta, metaUnreadable, diskUnreadable, droppedLocalMeta) => ({ useDiskMeta, metaUnreadable, diskUnreadable, droppedLocalMeta });
  // 작성본 없음
  assert.deepEqual(rule('readable', null), row(true, false, false, false));
  assert.deepEqual(rule('unreadable', null), row(true, true, true, false));
  assert.deepEqual(rule('read-failed', null), row(false, true, true, false));
  // 작성본 있음, 표시 없음
  assert.deepEqual(rule('readable', {}), row(false, false, false, false));
  assert.deepEqual(rule('unreadable', {}), row(false, false, true, false));
  assert.deepEqual(rule('read-failed', {}), row(false, false, true, false));
  // 작성본 있음, 표시 있음 — 읽기 실패는 표시를 끄지 않는다
  assert.deepEqual(rule('readable', { metaUnreadable: true }), row(true, false, false, true));
  assert.deepEqual(rule('unreadable', { metaUnreadable: true }), row(false, true, true, false));
  assert.deepEqual(rule('read-failed', { metaUnreadable: true }), row(false, true, true, false));
  assert.equal(isFrontmatterWriteBlocked({ writeGranted: true, diskUnreadable: false, metaUnreadable: false }), false);
  assert.equal(isFrontmatterWriteBlocked({ writeGranted: true, diskUnreadable: true, metaUnreadable: false }), true);
  assert.equal(isFrontmatterWriteBlocked({ writeGranted: true, diskUnreadable: false, metaUnreadable: true }), true);
  // 허용 기록 없음(DFXR-007): 다른 표시가 모두 꺼져 있어도 기본 거부다.
  assert.equal(isFrontmatterWriteBlocked({ writeGranted: false, diskUnreadable: false, metaUnreadable: false }), true);
  assert.equal(isFrontmatterWriteBlocked({ writeGranted: false, diskUnreadable: true, metaUnreadable: true }), true);
});

test('메타 출처 긍정 증거: metaFromDisk 저장·옛 작성본 호환·로드 규칙 행렬 (DFXR-007)', () => {
  const disk = storage();
  const store = new NoteRecoveryStore(() => disk);
  assert.equal(store.writeDraft({ ...input, metaFromDisk: false }).metaFromDisk, false);
  assert.equal(new NoteRecoveryStore(() => disk).getDraft(input.path).metaFromDisk, false);
  assert.equal(store.writeDraft({ ...input, metaFromDisk: true }).metaFromDisk, true);
  // 필드 없는 옛 작성본은 정상 메타로 취급한다(호환).
  assert.equal(isDraftMetaUntrusted({}), false);
  assert.equal(isDraftMetaUntrusted({ metaFromDisk: true }), false);
  assert.equal(isDraftMetaUntrusted({ metaFromDisk: false }), true);
  assert.equal(isDraftMetaUntrusted({ metaUnreadable: true }), true);
  const rule = (d, draft) => resolveLoadGuard({ disk: d, draft });
  const row = (useDiskMeta, metaUnreadable, diskUnreadable, droppedLocalMeta) => ({ useDiskMeta, metaUnreadable, diskUnreadable, droppedLocalMeta });
  // metaFromDisk:false는 옛 metaUnreadable:true와 같은 행을 낸다.
  for (const [d, expected] of [['readable', row(true, false, false, true)], ['unreadable', row(false, true, true, false)], ['read-failed', row(false, true, true, false)]]) {
    assert.deepEqual(rule(d, { metaFromDisk: false }), expected);
  }
  // metaFromDisk:true는 표시 없음과 같은 행이다.
  for (const d of ['readable', 'unreadable', 'read-failed']) assert.deepEqual(rule(d, { metaFromDisk: true }), rule(d, {}));
  // 다른 작성본으로 옮길 때 표시를 있는 그대로 전달한다.
  assert.deepEqual(draftMetaOrigin({}), {});
  assert.deepEqual(draftMetaOrigin({ metaFromDisk: false }), { metaFromDisk: false });
  assert.deepEqual(draftMetaOrigin({ metaFromDisk: true, metaUnreadable: true }), { metaFromDisk: true, metaUnreadable: true });
});
