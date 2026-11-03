import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewQueueSession } from './src/lib/review-queue/session.ts';
import { createReviewQueueOperations } from './src/lib/review-queue/operations.ts';

function fixture() {
  const writes = [];
  const state = { vault: '/A', read: async () => '{"schemaVersion":1,"cards":[]}' };
  const store = {
    getVaultPath: () => state.vault,
    readTextFile: (path) => state.read(path),
    createDirectory: async () => {},
    writeTextFile: async (path, content) => { writes.push({ path, content }); },
  };
  return { state, writes, store };
}

test('큐 읽기 중 볼트 전환은 후속 저장을 중단한다', async () => {
  const { state, store, writes } = fixture();
  let release;
  state.read = () => new Promise(resolve => { release = resolve; });
  const session = new ReviewQueueSession('/A', store);
  const op = createReviewQueueOperations({ store: session.store });
  const mutation = op.importSnapshot([]);
  state.vault = '/B';
  release('{"schemaVersion":1,"cards":[]}');
  await assert.rejects(mutation, /볼트가 바뀌어/);
  assert.equal(writes.length, 0);
});

test('A→B→A에서 이전 세션은 재사용되지 않는다', async () => {
  const { store, state } = fixture();
  const old = new ReviewQueueSession('/A', store);
  let release;
  const waiting = old.checked(() => new Promise(resolve => { release = resolve; }));
  old.cancel();
  state.vault = '/B';
  state.vault = '/A';
  const current = new ReviewQueueSession('/A', store);
  assert.equal(current.start(), true);
  release('old AI response');
  await assert.rejects(waiting, /볼트가 바뀌어/);
  old.finish();
  assert.equal(current.start(), false, '이전 finally는 새 busy 잠금을 풀지 않는다');
  current.finish();
  assert.equal(current.start(), true);
});

test('이미 전달한 쓰기 경로는 시작 볼트에 고정된다', async () => {
  const { store, state, writes } = fixture();
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  store.writeTextFile = async (path, content) => {
    started();
    await new Promise(resolve => { release = resolve; });
    writes.push({ path, content });
  };
  const session = new ReviewQueueSession('/A', store);
  const op = createReviewQueueOperations({ store: session.store });
  const pending = op.importSnapshot([]);
  await startedPromise;
  state.vault = '/B';
  release();
  await assert.rejects(pending, /볼트가 바뀌어/);
  assert.deepEqual(writes.map(w => w.path), ['/A/.ticksidian-review-queue/queue.json']);
});

test('정상 세션은 저장하며 중복 실행과 종료 후 작업은 거부한다', async () => {
  const { store, writes } = fixture();
  const session = new ReviewQueueSession('/A', store);
  assert.equal(session.start(), true);
  assert.equal(session.start(), false);
  await createReviewQueueOperations({ store: session.store }).importSnapshot([]);
  assert.equal(writes.length, 1);
  session.finish();
  session.cancel();
  assert.equal(session.start(), false);
  await assert.rejects(session.checked(async () => 'late'), /볼트가 바뀌어/);
});
