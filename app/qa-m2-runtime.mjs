// M2 런타임 QA 보강 검증기
//
// 역할
//   - .codex-artifacts/qa-2026-04-28/vault-A 픽스처에 대해
//     `scanNoteFiles`의 핵심 동작(파일 basename + folder + 충돌 id +
//     dot 폴더 스캔 + .trash 제외 + tag 인덱싱)을 Node 레벨로 미러링해
//     A4(같은 stem 다른 폴더 별도 항목)·A6(dot 폴더 스캔)·A5 일부
//     (.trash 노트 비노출)를 직접 증거로 남긴다.
//   - 원본은 `app/src/lib/local-fs.ts scanNoteFiles`. 인덱스 source
//     구성 규칙이 바뀌면 이 파일도 같이 갱신해야 drift가 생기지 않는다.
//
// 사용법
//   cd app && node qa-m2-runtime.mjs
//   또는: cd app && VAULT=/path/to/vault-A node qa-m2-runtime.mjs
//
// 종료 코드
//   0  — 모든 assertion 통과
//   1  — assertion 1건 이상 실패

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

// 스크립트는 app/ 아래에 있으므로 repo root는 한 단계만 올라간다.
const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const DEFAULT_VAULT = path.join(
  REPO_ROOT,
  '.codex-artifacts/qa-2026-04-28/vault-A',
);
const VAULT = process.env.VAULT || DEFAULT_VAULT;
const NOTES_DIR = path.join(VAULT, 'notes');

let assertions = 0;
let failures = 0;
function check(label, condition, detail) {
  assertions += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

function parseFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { frontmatter: {}, body: content };
  let frontmatter = {};
  try {
    const parsed = yaml.load(m[1], { schema: yaml.CORE_SCHEMA });
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed;
    }
  } catch {
    /* ignore */
  }
  return { frontmatter, body: content.slice(m[0].length) };
}

function slugifyFolder(folder) {
  return encodeURIComponent(folder);
}

async function scanNoteFiles() {
  const notes = [];

  async function walk(dir, relFolder) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.')) continue; // 숨김 파일/폴더(.trash, .ticksidian-sync 등) 제외
      if (name === '.project.json') continue;
      const entryPath = path.join(dir, name);
      if (entry.isDirectory()) {
        const childFolder = relFolder ? `${relFolder}/${name}` : name;
        await walk(entryPath, childFolder);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entryPath.endsWith('.md')) continue;
      const stem = name.replace(/\.md$/, '');
      let content;
      try {
        content = await fs.readFile(entryPath, 'utf8');
      } catch {
        continue;
      }
      const { frontmatter } = parseFrontmatter(content);
      const aliases = Array.isArray(frontmatter.aliases)
        ? frontmatter.aliases.filter((x) => typeof x === 'string')
        : undefined;
      const tags = Array.isArray(frontmatter.tags)
        ? frontmatter.tags.filter((x) => typeof x === 'string')
        : undefined;
      const relFilePath = relFolder ? `${relFolder}/${name}` : name;
      notes.push({
        id: stem,
        fileBasename: stem,
        folder: relFolder,
        filePath: relFilePath,
        title: typeof frontmatter.title === 'string' ? frontmatter.title : stem,
        aliases,
        tags,
      });
    }
  }
  await walk(NOTES_DIR, '');

  // stem 충돌 deterministic id 재계산
  const groups = new Map();
  for (const item of notes) {
    const arr = groups.get(item.fileBasename) ?? [];
    arr.push(item);
    groups.set(item.fileBasename, arr);
  }
  for (const arr of groups.values()) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => a.folder.localeCompare(b.folder));
    for (let i = 1; i < arr.length; i++) {
      const item = arr[i];
      item.id = `${item.fileBasename}__${slugifyFolder(item.folder)}`;
    }
  }

  // 전역 unique 보장
  const used = new Set();
  const ordered = [...notes].sort((a, b) =>
    (a.filePath ?? '').localeCompare(b.filePath ?? ''),
  );
  for (const item of ordered) {
    if (!used.has(item.id)) {
      used.add(item.id);
      continue;
    }
    let n = 2;
    while (used.has(`${item.id}__${n}`)) n += 1;
    item.id = `${item.id}__${n}`;
    used.add(item.id);
  }
  return notes;
}

const notes = await scanNoteFiles();

// === A4. fileBasename 충돌 — 4개 노트 모두 unique한 id로 분리 ===
const fooGroup = notes.filter((n) => n.fileBasename === 'foo');
check(
  'A4 fileBasename "foo" 그룹: 3 notes (root + a/b + a__b) 모두 인식',
  fooGroup.length === 3,
  `expected 3, got ${fooGroup.length}`,
);

const allFooLikeIds = notes
  .filter((n) =>
    ['foo', 'foo__a%2Fb', 'foo__a__b'].some(
      (target) => n.id === target || n.fileBasename === target,
    ),
  )
  .map((n) => n.id);
const uniqueFooIds = new Set(allFooLikeIds);
check(
  'A4 모든 foo 계열 노트의 id 가 unique',
  uniqueFooIds.size === allFooLikeIds.length,
  `ids: ${JSON.stringify(allFooLikeIds)}`,
);

// foo, a/b/foo, a__b/foo, foo__a%2Fb (root) 의 id가 모두 다른지 확인
const fooRoot = notes.find(
  (n) => n.fileBasename === 'foo' && n.folder === '',
);
const fooAB = notes.find(
  (n) => n.fileBasename === 'foo' && n.folder === 'a/b',
);
const fooFlat = notes.find(
  (n) => n.fileBasename === 'foo' && n.folder === 'a__b',
);
const fooPre = notes.find(
  (n) => n.fileBasename === 'foo__a%2Fb' && n.folder === '',
);
check(
  'A4 4개 foo 계열 노트 객체가 모두 검출됨',
  Boolean(fooRoot && fooAB && fooFlat && fooPre),
  `root=${!!fooRoot} ab=${!!fooAB} flat=${!!fooFlat} pre=${!!fooPre}`,
);
const ids = [fooRoot?.id, fooAB?.id, fooFlat?.id, fooPre?.id].filter(Boolean);
check(
  'A4 4개 foo 계열 노트의 id 가 서로 다름',
  new Set(ids).size === ids.length,
  `ids=${JSON.stringify(ids)}`,
);

// === A6. dot 폴더 스캔 — project.v1/Alpha.md 포함 + tag/alias 살아있음 ===
const alpha = notes.find(
  (n) => n.fileBasename === 'Alpha' && n.folder === 'project.v1',
);
check(
  'A6 dot 폴더 project.v1/Alpha.md 가 스캔됨',
  Boolean(alpha),
  `alpha=${alpha ? alpha.id : 'missing'}`,
);
check(
  'A6 Alpha 노트의 alias 가 frontmatter 에서 읽힘',
  Array.isArray(alpha?.aliases) && alpha.aliases.includes('alpha-alias'),
  `aliases=${JSON.stringify(alpha?.aliases)}`,
);
check(
  'A6 Alpha 노트의 tag (`dot-folder`) 가 인덱스에 잡힘',
  Array.isArray(alpha?.tags) && alpha.tags.includes('dot-folder'),
  `tags=${JSON.stringify(alpha?.tags)}`,
);

// === A5(부분). .trash/ 안 노트는 목록에 노출되지 않음 ===
const hidden = notes.find((n) => n.fileBasename === 'Hidden');
check(
  'A5 .trash 내부 Hidden.md 는 노트 목록에 노출되지 않음',
  !hidden,
  hidden ? `unexpected id=${hidden.id}` : undefined,
);

// === A7 사전 조건. move-conflict/a/Same.md, move-conflict/b/Same.md 가 모두 인식됨 ===
const sames = notes.filter((n) => n.fileBasename === 'Same');
check(
  'A7 move-conflict 양쪽 Same.md 가 모두 노트 목록에 있음',
  sames.length === 2,
  `count=${sames.length}`,
);

console.log('---');
console.log(`assertions=${assertions} failures=${failures}`);
console.log(`scanned ${notes.length} notes from ${NOTES_DIR}`);
process.exit(failures === 0 ? 0 : 1);
