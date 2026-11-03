// 실제 훅 소스를 실행하되 React effect/타이머/IO만 제어하는 격리 검사다.
// 브라우저/네이티브 검증이 아니며 폴러의 판정 로직은 복제하지 않는다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as rules from './src/hooks/useNoteEditor.helpers.ts';

const source = await readFile(new URL('./src/hooks/useExternalNotePoller.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
let failures = 0;
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}

function fixture() {
  let tick;
  let cleanup;
  let release;
  let root = '/vault-a';
  let baseline = 10;
  const seen = [];
  const events = [];
  const read = path => {
    seen.push(path);
    return new Promise(resolve => { release = resolve; });
  };
  const fakeWindow = { setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {} };
  const exports = {};
  new Function('require', 'exports', 'window', compiled)(name => {
    if (name === 'react') return { useEffect: callback => { cleanup = callback(); } };
    if (name.includes('useNoteEditor.helpers')) return rules;
    if (name.includes('local-fs')) return {
      getNoteFileModifiedAt: () => read(`${root}/notes/a.md`),
      getVaultFileModifiedAt: path => read(path),
    };
    throw new Error(`unexpected import ${name}`);
  }, exports, fakeWindow);
  exports.useExternalNotePoller({
    fileKey: 'a', filePath: '/vault-a/notes/a.md', resolvedFileBasename: 'a', folder: 'notes',
    enabled: true, isSaving: false,
    syncState: {
      hasLoaded: () => true, hasLocalChanges: () => true, saveTimer: () => null,
      lastKnownFileMtime: () => baseline, pendingExternalMtime: () => null,
      setLastKnownFileMtime: value => events.push(['baseline', value]),
      deferExternalChange: value => events.push(['pending', value]),
    },
    onExternalChange: value => events.push(['reload', value]),
    onPendingExternalChange: value => events.push(['notice', value]),
  });
  return { tick: () => tick(), cleanup: () => cleanup(), release: value => release(value),
    switchRoot: () => { root = '/vault-b'; }, saved: () => { baseline = 20; }, seen, events };
}

await check('폴러: cleanup 뒤 늦은 stat은 상태/콜백을 바꾸지 않는다', async () => {
  const f = fixture();
  const pending = f.tick();
  f.cleanup();
  f.release(30);
  await pending;
  assert.deepEqual(f.events, []);
});
await check('폴러: 전역 볼트 변경과 무관하게 고정 절대경로를 읽는다', async () => {
  const f = fixture();
  f.switchRoot();
  const pending = f.tick();
  f.release(30);
  await pending;
  assert.deepEqual(f.seen, ['/vault-a/notes/a.md']);
});
await check('폴러: stat 대기 중 저장 기준선이 바뀌면 낡은 응답을 버린다', async () => {
  const f = fixture();
  const pending = f.tick();
  f.saved();
  f.release(30);
  await pending;
  assert.deepEqual(f.events, []);
});
await check('폴러: 느린 stat 동안 다음 tick은 중복 IO를 시작하지 않는다', async () => {
  const f = fixture();
  const pending = f.tick();
  await f.tick();
  assert.equal(f.seen.length, 1);
  f.release(10);
  await pending;
});
await check('편집기 키: 같은 ID도 볼트가 바뀌면 새 편집기로 분리한다', async () => {
  const app = await readFile(new URL('./src/App.tsx', import.meta.url), 'utf8');
  assert.ok(/<NoteEditor\s+key=\{`\$\{vaultPath\}:\$\{editorNoteId\}`\}/.test(app), 'NoteEditor key must include vaultPath and editorNoteId');
});
if (failures) throw new Error(`${failures} poller boundary failures`);
