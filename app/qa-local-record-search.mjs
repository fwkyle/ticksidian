import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalRecordSearch, LOCAL_SEARCH_LIMITS } from './src/lib/local-record-search.ts';

const item = (id, extra = {}) => ({ id, fileBasename: id, title: id, folder: '', createdAt: new Date(0), updatedAt: new Date(0), ...extra });
function fixture(content = '# 문서\n\n본문 바늘') {
  let reads = 0, concurrent = 0, peak = 0, mtime = 1;
  const io = {
    async getFileStat(path) { return { path, size: content.length, modifiedAt: mtime, createdAt: 0 }; },
    async readTextFile() { reads++; concurrent++; peak = Math.max(peak, concurrent); await new Promise(resolve => setTimeout(resolve, 2)); concurrent--; return content; },
  };
  return { io, engine: new LocalRecordSearch('/vault', io), reads: () => reads, peak: () => peak,
    edit(next) { content = next; mtime++; } };
}
test('빈 검색어는 IO 없음, 본문/제목/태그/별칭을 검색하고 캐시를 재사용', async () => {
  const f = fixture();
  const notes = [item('본문기록'), item('바늘 제목'), item('태그', { tags: ['바늘'] }), item('별칭', { aliases: ['바늘'] })];
  await f.engine.search(notes, ''); assert.equal(f.reads(), 0);
  const result = await f.engine.search(notes, '바늘');
  assert.equal(result.hits.length, 4); assert.equal(f.reads(), 1);
  assert.equal(result.hits.find(hit => hit.note.id === '본문기록').matchField, 'body');
  await f.engine.search(notes, '본문'); assert.equal(f.reads(), 4);
  await f.engine.search(notes, '바늘'); assert.equal(f.reads(), 4);
  f.edit('바뀐 원문'); assert.equal((await f.engine.search([notes[0]], '바늘')).hits.length, 0);
});
test('그림·불안전 경로·대형 파일은 읽지 않고 제한/권한 실패를 알린다', async () => {
  const f = fixture();
  const result = await f.engine.search([item('그림', { drawing: true }), item('위험', { folder: '..' })], '바늘');
  assert.equal(f.reads(), 0); assert.equal(result.skipped, 1);
  f.edit('x'.repeat(LOCAL_SEARCH_LIMITS.fileBytes + 1));
  assert.equal((await f.engine.search([item('대형')], '바늘')).skipped, 1); assert.equal(f.reads(), 0);
  const denied = new LocalRecordSearch('/vault', { ...f.io, async getFileStat() { throw new Error('denied'); } });
  assert.equal((await denied.search([item('거부')], '바늘')).skipped, 1);
});
test('동시 읽기 4개 상한, 취소 결과 폐기, 볼트별 캐시 격리', async () => {
  const f = fixture();
  const notes = Array.from({ length: 12 }, (_, index) => item(`문서${index}`));
  await f.engine.search(notes, '바늘'); assert.ok(f.peak() <= 4);
  let alive = true;
  const next = f.engine.search(notes, '바늘', () => alive); alive = false;
  assert.deepEqual(await next, { hits: [], skipped: 0 });
  const second = fixture('다른 볼트');
  assert.equal((await second.engine.search(notes, '바늘')).hits.length, 0);
});

test('쿼리 총 읽기와 캐시 상한을 넘지 않으며 오래된 캐시는 다시 읽는다', async () => {
  const content = 'x'.repeat(500_000);
  let reads = 0;
  const io = { async getFileStat(path) { return { path, size: content.length, modifiedAt: 1 }; },
    async readTextFile() { reads++; return content; } };
  const engine = new LocalRecordSearch('/vault', io);
  const notes = Array.from({ length: 40 }, (_, i) => item(`기록${i}`));
  const result = await engine.search(notes, '없음');
  assert.equal(reads, Math.floor(LOCAL_SEARCH_LIMITS.queryBytes / content.length));
  assert.equal(result.skipped, notes.length - reads);
  const before = reads;
  await engine.search([notes[0]], '없음');
  assert.equal(reads, before + 1); // 첫 항목은 제한된 메모리에서 이미 퇴출됨
});

test('읽는 사이 외부 수정은 결과에서 제외하고 50개 결과 상한을 지킨다', async () => {
  let statCalls = 0;
  const engine = new LocalRecordSearch('/vault', {
    async getFileStat(path) { return { path, size: 4, modifiedAt: ++statCalls }; },
    async readTextFile() { return '바늘'; },
  });
  const changed = await engine.search([item('원문')], '바늘');
  assert.deepEqual(changed, { hits: [], skipped: 1 });
  const many = await engine.search(Array.from({ length: 80 }, (_, i) => item(`바늘${i}`)), '바늘');
  assert.equal(many.hits.length, LOCAL_SEARCH_LIMITS.hits);
});

const at = (iso) => new Date(iso);
test('최신순: 일치도가 더 좋아도 오래된 기록은 최근 기록 뒤에 오고 일치 필드는 유지한다', async () => {
  const f = fixture('# 문서\n\n본문 바늘');
  const notes = [item('바늘', { updatedAt: at('2026-01-01T00:00:00Z') }),
    item('최근본문', { updatedAt: at('2026-10-30T00:00:00Z') }),
    item('중간태그', { tags: ['바늘'], updatedAt: at('2026-06-01T00:00:00Z') })];
  const { hits } = await f.engine.search(notes, '바늘');
  assert.deepEqual(hits.map(hit => [hit.note.id, hit.matchField]), [['최근본문', 'body'], ['중간태그', 'tag'], ['바늘', 'title']]);
});
test('최신순: 50개를 넘으면 자르기 전에 정렬해 최신 50개가 남는다', async () => {
  const f = fixture('본문 없음');
  // 앞 30개는 제목이 정확히 일치(점수 최상)하지만 가장 오래됐다.
  const exact = Array.from({ length: 30 }, (_, i) => item(`정확${i}`, { title: '바늘', updatedAt: at(`2026-01-01T00:00:${String(i).padStart(2, '0')}Z`) }));
  const recent = Array.from({ length: 50 }, (_, i) => item(`최근${i}`, { title: `가 바늘 ${i}`, updatedAt: at(`2026-10-01T00:${String(i).padStart(2, '0')}:00Z`) }));
  const { hits } = await f.engine.search([...exact, ...recent], '바늘');
  assert.equal(hits.length, LOCAL_SEARCH_LIMITS.hits);
  assert.ok(hits.every(hit => hit.note.id.startsWith('최근')));
  assert.equal(hits[0].note.id, '최근49');
});
test('최신순: 수정 시각이 같으면 기존 일치도 순', async () => {
  const f = fixture('# 문서\n\n본문 바늘');
  const same = at('2026-10-30T00:00:00Z');
  const notes = [item('본문만', { updatedAt: same }), item('가 바늘', { updatedAt: same }), item('바늘', { updatedAt: same })];
  const { hits } = await f.engine.search(notes, '바늘');
  assert.deepEqual(hits.map(hit => hit.note.id), ['바늘', '가 바늘', '본문만']);
});
