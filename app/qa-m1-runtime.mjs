// Ticksidian M1 QA 검증기 (파일 시스템 + 위키링크 인덱스 레이어)
//
// 역할
//   - M1 QA 시드(`qa-alias-20260414/`, `qa-m1-20260418/`)에 대한 strict assertion
//   - 실볼트 일반 상태는 요약 리포트로만 출력(검증 결과에 영향 없음)
//
// 사용법
//   VAULT_PATH=/path/to/vault node qa-m1-runtime.mjs
//   또는: node qa-m1-runtime.mjs /path/to/vault
//
// 종료 코드
//   0  — 모든 assertion 통과
//   1  — assertion 1건 이상 실패
//   2  — 사용법/환경 오류(볼트 경로 누락, notes 디렉터리 없음 등)
//
// 주의
//   `parseFrontmatter`, 위키링크 파서/리졸버/인덱스 로직을 원본 TS
//   (`app/src/lib/markdown-import.ts`, `app/src/lib/wiki-links/*`)와 동일
//   알고리즘으로 복제한 "회귀 미러"다. 원본 규칙(정규식/normalize)이 바뀌면
//   이 파일도 같이 수정해야 drift가 생기지 않는다.

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

/* ---------------- 환경 ---------------- */

const VAULT = process.env.VAULT_PATH || process.argv[2];
if (!VAULT) {
  console.error('Usage: VAULT_PATH=/path/to/vault node qa-m1-runtime.mjs');
  console.error('   or: node qa-m1-runtime.mjs /path/to/vault');
  process.exit(2);
}
const NOTES_DIR = path.join(VAULT, 'notes');
try {
  const st = await fs.stat(NOTES_DIR);
  if (!st.isDirectory()) throw new Error('not a directory');
} catch (err) {
  console.error(`notes 디렉터리 접근 실패: ${NOTES_DIR} (${err?.message || err})`);
  process.exit(2);
}

/* ---------------- 원본 미러 로직 ---------------- */

function parseFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { frontmatter: {}, body: content };
  let frontmatter = {};
  try {
    const parsed = yaml.load(m[1], { schema: yaml.CORE_SCHEMA });
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frontmatter = parsed;
  } catch { /* ignore */ }
  return { frontmatter, body: content.slice(m[0].length) };
}

function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content;
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) return content;
  return content.slice(endIndex + 4);
}

const WIKI_LINK_REGEX = /\[\[([^\]\|]+?)(?:\|([^\]]+))?\]\]/g;
function maskCodeBlocks(text) {
  let r = text.replace(/(^|\n)(```|~~~)[\s\S]*?\n\2/g, (m) => ' '.repeat(m.length));
  r = r.replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
  return r;
}
function parseWikiLinks(body) {
  const tokens = [];
  const masked = maskCodeBlocks(body);
  const regex = new RegExp(WIKI_LINK_REGEX.source, 'g');
  let m;
  while ((m = regex.exec(masked)) !== null) {
    const raw = body.slice(m.index, m.index + m[0].length);
    const ref = m[1].trim();
    if (!ref) continue;
    const mode = ref.startsWith('id:') ? 'id' : 'title';
    tokens.push({
      raw, ref,
      displayText: m[2]?.trim() ?? null,
      mode,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tokens;
}

function normalizeLinkKey(v) { return v.trim().replace(/\s+/g, ' ').toLowerCase(); }

async function scanNoteFiles() {
  const notes = [];
  async function scan(dir, rel) {
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (ent.name.startsWith('.')) continue;
      if (ent.isDirectory()) {
        await scan(path.join(dir, ent.name), rel ? `${rel}/${ent.name}` : ent.name);
        continue;
      }
      if (!ent.name.endsWith('.md')) continue;
      const full = path.join(dir, ent.name);
      const content = await fs.readFile(full, 'utf8');
      const { frontmatter } = parseFrontmatter(content);
      const id = ent.name.replace('.md', '');
      const title = (typeof frontmatter.title === 'string' && frontmatter.title.length > 0)
        ? frontmatter.title
        : (content.match(/^#\s+(.+)$/m)?.[1]?.trim() || id);
      const aliases = Array.isArray(frontmatter.aliases)
        ? frontmatter.aliases.filter((x) => typeof x === 'string') : [];
      const st = await fs.stat(full);
      notes.push({
        id, title, aliases,
        folder: rel,
        filePath: rel ? `${rel}/${ent.name}` : ent.name,
        updatedAt: (typeof frontmatter.updatedAt === 'string'
          ? new Date(frontmatter.updatedAt).getTime()
          : st.mtimeMs),
        content,
        fmType: frontmatter.type,
        fmDone: frontmatter.done,
        fmDueDate: frontmatter.dueDate,
        fmPriority: frontmatter.priority,
        fmTags: frontmatter.tags,
      });
    }
  }
  await scan(NOTES_DIR, '');
  return notes;
}

function buildTitleKeyMap(notes) {
  const map = new Map();
  for (const n of notes) {
    const tk = normalizeLinkKey(n.title);
    if (tk) {
      const ex = map.get(tk);
      if (ex) { if (!ex.includes(n.id)) ex.push(n.id); }
      else map.set(tk, [n.id]);
    }
    for (const a of n.aliases) {
      const ak = normalizeLinkKey(a);
      if (!ak) continue;
      const ex = map.get(ak);
      if (ex) { if (!ex.includes(n.id)) ex.push(n.id); }
      else map.set(ak, [n.id]);
    }
  }
  return map;
}

function buildLinkIndex(notes) {
  const notesById = new Map(notes.map((n) => [n.id, n]));
  const titleKeyMap = buildTitleKeyMap(notes);
  const backlinks = new Map();
  const outgoing = new Map();
  for (const src of notes) {
    const body = stripFrontmatter(src.content);
    const tokens = parseWikiLinks(body);
    const resolved = [];
    for (const t of tokens) {
      let resolution; let targetId = null; let candidates = [];
      if (t.mode === 'id') {
        const id = t.ref.slice(3);
        if (notesById.has(id)) { resolution = 'resolved'; targetId = id; candidates = [id]; }
        else resolution = 'unresolved';
      } else {
        candidates = titleKeyMap.get(normalizeLinkKey(t.ref)) ?? [];
        if (candidates.length === 0) resolution = 'unresolved';
        else if (candidates.length === 1) { resolution = 'resolved'; targetId = candidates[0]; }
        else resolution = 'ambiguous';
      }
      resolved.push({ ref: t.ref, raw: t.raw, resolution, targetId, candidates: [...candidates] });
      if (resolution === 'resolved' && targetId) {
        const arr = backlinks.get(targetId) ?? [];
        arr.push({ sourceId: src.id, sourceTitle: src.title, ref: t.ref, raw: t.raw });
        backlinks.set(targetId, arr);
      }
    }
    outgoing.set(src.id, resolved);
  }
  return { notesById, titleKeyMap, outgoing, backlinks };
}

/* ---------------- 검증 프레임워크 (최소) ---------------- */

const results = [];
function expect(name, cond, detail = '') {
  const pass = !!cond;
  results.push({ name, pass, detail });
  const marker = pass ? 'PASS' : 'FAIL';
  console.log(`  ${marker}  ${name}${!pass && detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n[ ${title} ]`); }
function arraysEqualAsSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = [...a].sort(); const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/* ---------------- 검증 ---------------- */

const notes = await scanNoteFiles();
const index = buildLinkIndex(notes);

section('A. 볼트 스캔');
expect('A1 notes 디렉터리에서 .md 최소 1건 이상 스캔됨',
  notes.length > 0, `scanned=${notes.length}`);
expect('A2 M1 QA 시드 폴더 qa-m1-20260418 스캔됨',
  notes.some((n) => n.folder === 'qa-m1-20260418'),
  'seed folder missing; expected qa-m1-20260418/');
expect('A3 alias QA 시드 폴더 qa-alias-20260414 스캔됨',
  notes.some((n) => n.folder === 'qa-alias-20260414'),
  'seed folder missing; expected qa-alias-20260414/');

section('B. 기존 외부 .md 로드 (m1-existing-external-20260418)');
const existing = notes.find((n) => n.id === 'm1-existing-external-20260418');
expect('B1 시드 파일 인식됨', !!existing, 'seed missing');
expect('B2 frontmatter title 정확',
  existing?.title === 'M1 Existing External Note',
  `got "${existing?.title}"`);
expect('B3 본문에 H1 헤더 포함',
  existing?.content.includes('# M1 Existing External Note'),
  'H1 heading not found in body');

section('C. 투두 frontmatter 보존');
const todos = notes.filter((n) => n.fmType === 'todo');
expect('C1 type:"todo" 노트 최소 1건 존재',
  todos.length >= 1, `count=${todos.length}`);
expect('C2 모든 투두 노트가 done(boolean) 필드 보유',
  todos.every((t) => typeof t.fmDone === 'boolean'),
  `missing done on: ${todos.filter((t) => typeof t.fmDone !== 'boolean').map((t) => t.id).join(', ')}`);

section('D. alias 경로 백링크 (qa-alias-a/b)');
const aliasA = notes.find((n) => n.id === 'qa-alias-a-20260414');
const aliasB = notes.find((n) => n.id === 'qa-alias-b-20260414');
expect('D1 qa-alias-a 시드 존재', !!aliasA);
expect('D2 qa-alias-b 시드 존재', !!aliasB);
expect('D3 qa-alias-a.aliases에 "회의록 초안" 포함',
  aliasA?.aliases.includes('회의록 초안'),
  `aliases=${JSON.stringify(aliasA?.aliases)}`);
expect('D4 qa-alias-a.aliases에 "킥오프" 포함',
  aliasA?.aliases.includes('킥오프'),
  `aliases=${JSON.stringify(aliasA?.aliases)}`);
const aBacklinks = index.backlinks.get('qa-alias-a-20260414') ?? [];
expect('D5 qa-alias-a 백링크 정확히 2건',
  aBacklinks.length === 2, `count=${aBacklinks.length}`);
expect('D6 백링크 source가 모두 qa-alias-b',
  aBacklinks.every((b) => b.sourceId === 'qa-alias-b-20260414'),
  `sources=${JSON.stringify(aBacklinks.map((b) => b.sourceId))}`);

section('E. ambiguous 해석 (M1 범위: 인덱스 레벨)');
const amKey = normalizeLinkKey('M1 Ambiguous Target');
const amCand = index.titleKeyMap.get(amKey) ?? [];
expect('E1 titleKey "m1 ambiguous target" 후보 정확히 2건',
  amCand.length === 2, `candidates=${JSON.stringify(amCand)}`);
expect('E2 후보 id가 m1-ambiguous-a/b와 일치',
  arraysEqualAsSet(amCand, ['m1-ambiguous-a-20260418', 'm1-ambiguous-b-20260418']),
  `got=${JSON.stringify(amCand)}`);
const linkerOut = index.outgoing.get('m1-ambiguous-linker-20260418') ?? [];
const amToken = linkerOut.find(
  (o) => normalizeLinkKey(o.ref) === amKey,
);
expect('E3 linker 노트에서 ambiguous 토큰 발견', !!amToken,
  'no [[M1 Ambiguous Target]] token in linker outgoing');
expect('E4 토큰 resolution === "ambiguous"',
  amToken?.resolution === 'ambiguous',
  `resolution=${amToken?.resolution}`);
expect('E5 토큰 candidates 개수 === 2',
  amToken?.candidates?.length === 2,
  `candidates=${JSON.stringify(amToken?.candidates)}`);
expect('E6 ambiguous 토큰의 targetId는 null (resolved 아님)',
  amToken?.targetId === null,
  `targetId=${amToken?.targetId}`);

/* ---------------- 실볼트 요약 리포트 (검증 아님) ---------------- */

section('Report (실볼트 스냅샷, 검증 영향 없음)');
const folders = new Set(notes.map((n) => n.folder || '(root)'));
console.log('  notes 총수:', notes.length);
console.log('  폴더:', [...folders]);
console.log('  투두 .md:', todos.length);
console.log('  aliases 보유 노트:', notes.filter((n) => n.aliases.length > 0).length);

/* ---------------- 종료 처리 ---------------- */

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n=== 요약 ===`);
console.log(`  PASS ${passed} / ${results.length}`);
if (failed > 0) {
  console.log(`  FAIL ${failed} 건:`);
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`    - ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  process.exit(1);
} else {
  console.log('  all assertions passed.');
  process.exit(0);
}
