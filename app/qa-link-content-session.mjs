import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinkContentSession } from './src/lib/wiki-links/link-content-session.ts';
import { detachLinkText } from './src/lib/wiki-links/wiki-link-utils.ts';

test('보관 문자열 분리는 한글/emoji/escape/짝 없는 surrogate를 그대로 유지한다', () => {
  for (const value of ['[[한글 제목|보기 🐶]]', '줄\n탭\t따옴표"역슬래시\\', '\ud800', '\udc00', '']) {
    assert.equal(detachLinkText(value), value);
  }
});

const item = (id, extra = {}) => ({ id, fileBasename: id, title: id, folder: '',
  filePath: `${id}.md`, fileMtime: 1, createdAt: new Date(0), updatedAt: new Date(0), ...extra });
const notes = (count) => Array.from({ length: count }, (_, i) => item(`note-${i}`));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const run = (session, list, read, vault = '/vault') => session.readMany(session.begin(vault), list, read);

test('본문은12개씩 목록 순서로 소비하고 다음 묶음 전에 이전 본문 계산 완료', async () => {
  const session = new LinkContentSession();
  const list = notes(30);
  const consumed = [];
  let active = 0, maxActive = 0;
  const succeeded = await session.readEach(session.begin('/vault'), list, async note => {
    const i = Number(note.id.slice(5));
    if (i === 12) assert.equal(consumed.length, 12);
    if (i === 24) assert.equal(consumed.length, 23);
    maxActive = Math.max(maxActive, ++active);
    await new Promise(resolve => setTimeout(resolve, (12 - i % 12) % 4));
    active--;
    if (i === 14) throw Error('denied');
    return i === 15 ? '' : note.id;
  }, (note, content) => { consumed.push([note.id, content]); });
  assert.equal(maxActive, 12);
  assert.deepEqual(consumed.map(([id]) => id), list.filter(n => n.id !== 'note-14').map(n => n.id));
  assert.deepEqual([...succeeded], consumed.map(([id]) => id));
  assert.equal(consumed.find(([id]) => id === 'note-15')[1], '');
});

test('본문 소비 도중 취소하면 남은 소비/다음 묶음/결과 게시를 중단한다', async () => {
  const session = new LinkContentSession();
  let reads = 0, consumed = 0;
  const result = await session.readEach(session.begin('/vault'), notes(100),
    async () => { reads++; return '본문'; }, () => { consumed++; session.cancel(); });
  assert.equal(result, null);
  assert.equal(reads, 12);
  assert.equal(consumed, 1);
});

test('600개 캐시 후 단일 추가 1회, 제목/별칭 변경 0회 읽기', async () => {
  const session = new LinkContentSession();
  let reads = 0;
  const read = async note => { reads++; return `# ${note.id}\n[[대상]]`; };
  const list = notes(600);
  assert.equal((await run(session, list, read)).size, 600);
  assert.equal(reads, 600);
  const added = [...list, item('new')];
  assert.equal((await run(session, added, read)).size, 601);
  assert.equal(reads, 601);
  await run(session, added.map((n, i) => i ? n : { ...n, title: '새 제목', aliases: ['별칭'] }), read);
  assert.equal(reads, 601);
});

test('대체된 작업은 시작한 12개 이후 중단하고 늦은 본문을 캐시에 넣지 않는다', async () => {
  const session = new LinkContentSession();
  const gate = deferred();
  let oldReads = 0, newReads = 0;
  const old = run(session, notes(600), async () => { oldReads++; await gate.promise; return 'old'; });
  assert.equal(oldReads, 12);
  const latest = await run(session, notes(1), async () => { newReads++; return 'new'; });
  gate.resolve();
  assert.equal(await old, null);
  assert.equal(oldReads, 12);
  assert.equal(latest.get('note-0'), 'new');
  const cached = await run(session, notes(1), async () => { newReads++; return 'wrong'; });
  assert.equal(cached.get('note-0'), 'new');
  assert.equal(newReads, 1);
});

test('mtime 불명·변경, 실제 basename/폴더/경로 변경은 다시 읽는다', async () => {
  const session = new LinkContentSession();
  let reads = 0;
  const read = async () => String(++reads);
  for (const extra of [{}, { fileMtime: 2 }, { fileMtime: undefined }, { fileMtime: undefined },
    { fileMtime: Number.NaN }, { fileMtime: Number.NaN }, { fileMtime: 2, folder: 'other' },
    { fileMtime: 2, fileBasename: 'other' }, { fileMtime: 2, filePath: 'other.md' }]) {
    await run(session, [item('note', extra)], read);
  }
  assert.equal(reads, 9);
});

test('읽기 실패는 캐시하지 않으며 빈 본문 성공은 캐시한다', async () => {
  const session = new LinkContentSession();
  let reads = 0;
  const read = async () => { if (++reads === 1) throw new Error('denied'); return ''; };
  assert.equal((await run(session, [item('a')], read)).has('a'), false);
  assert.equal((await run(session, [item('a')], read)).get('a'), '');
  await run(session, [item('a')], read);
  assert.equal(reads, 2);
});

test('동명 다른 볼트·초기화 뒤 재진입은 원문을 분리하고 그림을 읽지 않는다', async () => {
  const session = new LinkContentSession();
  let reads = 0;
  const read = async (_note, vault) => { reads++; return vault; };
  const list = [item('a'), item('그림', { drawing: true })];
  assert.equal((await run(session, list, read, '/A')).get('a'), '/A');
  assert.equal((await run(session, list, read, '/B')).get('a'), '/B');
  session.clear();
  assert.equal((await run(session, list, read, '/A')).get('a'), '/A');
  assert.equal(reads, 3);
  assert.equal(await run(session, list, read, null), null);
  assert.equal(reads, 3);
});

test('명시적 무효화는 같은 mtime에서도 읽으며 이전 진행 중 결과를 폐기한다', async () => {
  const session = new LinkContentSession();
  const note = item('a');
  const gate = deferred();
  const old = run(session, [note], async () => { await gate.promise; return 'old'; });
  session.invalidate(note);
  const current = await run(session, [note], async () => 'new');
  gate.resolve();
  assert.equal(await old, null);
  assert.equal(current.get('a'), 'new');
  session.invalidate(note);
  assert.equal((await run(session, [note], async () => 'newest')).get('a'), 'newest');
});

test('취소/초기화는 미시작 IO와 결과 게시를 차단한다', async () => {
  for (const action of ['cancel', 'clear']) {
    const session = new LinkContentSession();
    const gate = deferred();
    let reads = 0;
    const pending = run(session, notes(600), async () => { reads++; await gate.promise; return 'late'; });
    session[action]();
    gate.resolve();
    assert.equal(await pending, null);
    assert.equal(reads, 12);
  }
});

test('총 본문 용량/항목 수 상한, 큰 파일 비캐시, 삭제된 경로 퇴출', async () => {
  const session = new LinkContentSession({ cacheBytes: 180, cacheEntries: 2 });
  let reads = 0;
  const read = async () => { reads++; return '한글'.repeat(10); };
  await run(session, [item('a'), item('b'), item('c')], read);
  assert.ok(session.cacheSize <= 2);
  assert.ok(session.cacheBytes <= 180);
  await run(session, [item('a')], read);
  assert.equal(reads, 4);
  await run(session, [item('big')], async () => 'x'.repeat(181));
  let bigReads = 0;
  await run(session, [item('big')], async () => { bigReads++; return 'x'.repeat(181); });
  assert.equal(bigReads, 1);
  session.retain([]);
  assert.equal(session.cacheSize, 0);
  assert.equal(session.cacheBytes, 0);
});
