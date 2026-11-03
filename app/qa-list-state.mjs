// Why: 목록의 같은 제목/별칭 통지가 상태와 수정순서를 흔들지 않게 한다.
// 실제 useNotes 콜백 AST를 실행한다. (렌더 전 변경 순서는 실제 React 훅 시험 tests/browser/notes-updater.spec.ts가 잠근다.)
// 실제 useNotes 콜백 AST를 실행한다. 제품의 갱신 규칙을 검사에 복사하지 않는다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const filename = new URL('./src/hooks/useNotes.ts', import.meta.url);
const source = ts.createSourceFile(filename.pathname, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);

function callback(name, previous) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      assert.ok(node.initializer && ts.isCallExpression(node.initializer));
      found = node.initializer.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `실제 콜백 없음: ${name}`);
  let next = previous;
  let setCalls = 0;
  const js = ts.transpileModule(`const update = ${found};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const latestNotesRef = { current: previous };
  const context = vm.createContext({
    setNotes: update => { setCalls++; next = update(next); latestNotesRef.current = next; },
    latestNotesRef,
    Date,
  });
  vm.runInContext(js, context);
  return {
    run: (...args) => { context.args = args; vm.runInContext('update(...args)', context); return next; },
    get setCalls() { return setCalls; },
  };
}

function notes() {
  return [
    { id: 'a', title: '가', aliases: ['별칭', 'alias'], updatedAt: new Date(0) },
    { id: 'b', title: '나', updatedAt: new Date(1) },
  ];
}

test('별칭 동일/없는 대상/undefined와 빈 배열은 같은 목록을 반환한다', () => {
  const previous = notes();
  const update = callback('updateNoteAliases', previous);
  assert.equal(update.run('a', ['별칭', 'alias']), previous);
  assert.equal(update.run('missing', ['새 별칭']), previous);
  assert.equal(update.run('b', []), previous);
});

test('실제 별칭 변경은 대상만 교체하며 순서/수정일/다른 행 참조를 보존한다', () => {
  const previous = notes();
  const next = callback('updateNoteAliases', previous).run('a', ['alias', '별칭']);
  assert.notEqual(next, previous);
  assert.notEqual(next[0], previous[0]);
  assert.equal(next[1], previous[1]);
  assert.equal(next[0].updatedAt, previous[0].updatedAt);
  assert.equal(JSON.stringify(next[0].aliases), JSON.stringify(['alias', '별칭']));
});

test('제목 동일/없는 대상은 수정순서를 바꾸지 않는다', () => {
  const previous = notes();
  const update = callback('updateNoteTitle', previous);
  assert.equal(update.run('a', '가'), previous);
  assert.equal(update.run('missing', '새 제목'), previous);
});

test('제목 변경은 대상/수정일만 바꾸고 별칭과 다른 행을 보존한다', () => {
  const previous = notes();
  const next = callback('updateNoteTitle', previous).run('a', '새 제목');
  assert.notEqual(next, previous);
  assert.equal(next[0].title, '새 제목');
  assert.ok(next[0].updatedAt > previous[0].updatedAt);
  assert.equal(next[0].aliases, previous[0].aliases);
  assert.equal(next[1], previous[1]);
});

// 2026-10-20 inbox-first 멈춤: 바뀐 게 없는 알림도 setNotes를 부르면 App 렌더가 일어나 편집기 알림 → 렌더 고리가 된다.
test('같은 제목/별칭/없는 대상 알림은 setNotes를 부르지 않는다', () => {
  const title = callback('updateNoteTitle', notes());
  title.run('a', '가'); title.run('missing', 'x');
  assert.equal(title.setCalls, 0);
  const aliases = callback('updateNoteAliases', notes());
  aliases.run('a', ['별칭', 'alias']); aliases.run('b', []); aliases.run('missing', ['x']);
  assert.equal(aliases.setCalls, 0);
});

test('실제로 바뀐 제목/별칭 알림은 setNotes를 한 번 부른다', () => {
  const title = callback('updateNoteTitle', notes());
  title.run('a', '새 제목');
  assert.equal(title.setCalls, 1);
  const aliases = callback('updateNoteAliases', notes());
  aliases.run('a', ['다른']);
  assert.equal(aliases.setCalls, 1);
});
