// GLM-5.2 결함 회귀 테스트 (RAG 인덱스 라이브러리)
//   결함2: 제목/헤딩만 바뀌면 벡터가 재사용되지 않고 새로 발급된다 (전체 재빌드와 동일).
//   결함3: 임베딩 실패 시 원본 DB의 모든 테이블/메타/파일이 보존된다.
//   결함4: 변경 4/10 은 30% 초과로 증분이 거부된다 (분모는 경로 합집합).
//   결함2b: 헤딩만 바뀌어도 벡터가 재사용되지 않고 새로 발급된다 (전체 재빌드와 동일).
//   결함5: 원자 교체 도중 두 번째 rename이 실패해도 원본 DB가 원래 자리에 보존된다.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import { EMBEDDING_DIMENSIONS, RagIndexBuilder, replaceDatabaseFailureSafe } from "./rag-index-lib.mjs";

let assertions = 0;
function assert(cond, msg) { assertions += 1; if (!cond) throw new Error(`ASSERTION FAIL: ${msg}`); }

function openReadOnly(path) {
  const db = new DatabaseSync(path, { allowExtension: true, readOnly: true, readBigInts: true });
  db.loadExtension(sqliteVec.getLoadablePath());
  return db;
}
function fileHash(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }

// ── 결함2: 제목만 변경 → 벡터 재발급, 전체 재빌드와 동일 ──────────────────────
{
  const root = mkdtempSync(resolve(tmpdir(), "glm-reg-title-"));
  const notes = resolve(root, "notes");
  mkdirSync(notes, { recursive: true });
  const writeA = (title) => writeFileSync(resolve(notes, "a.md"),
    `---\nid: "x1"\ntitle: "${title}"\n---\n\n# 고정헤딩\n\n고정 본문 내용이다.\n`, "utf8");
  writeA("원제목");
  for (let i = 0; i < 4; i += 1) writeFileSync(resolve(notes, `p${i}.md`),
    `---\nid: "p${i}"\ntitle: "pad${i}"\n---\n\n# pad${i}\n\n패드 본문 ${i}\n`, "utf8");

  const dbPath = resolve(root, ".ticksidian", "rag.sqlite");
  class TitleProv {
    constructor() { this.model = "fixture"; this.dimensions = EMBEDDING_DIMENSIONS; }
    async embed(texts) {
      return texts.map((t) => {
        const v = new Float32Array(EMBEDDING_DIMENSIONS);
        const s = t.toLowerCase();
        if (s.includes("원제목")) v[0] = 1;
        else if (s.includes("바뀐제목")) v[1] = 1;
        else v[2] = 1;
        return v;
      });
    }
  }
  const b = new RagIndexBuilder({ vaultPath: root, databasePath: dbPath, embeddingProvider: new TitleProv() });
  await b.build();

  const vectorForA = (path) => {
    const d = openReadOnly(path);
    const cid = d.prepare("SELECT c.id AS cid FROM chunks c JOIN documents dd ON dd.id=c.document_id WHERE dd.file_path='notes/a.md' ORDER BY c.id LIMIT 1").get().cid;
    const emb = d.prepare("SELECT embedding FROM chunk_vectors WHERE rowid=?").get(BigInt(cid)).embedding;
    d.close();
    return Buffer.from(emb);
  };
  const V0 = vectorForA(dbPath);

  writeA("바뀐제목"); // 제목만 변경 (헤딩/본문 동일)
  const inc = await b.incremental();
  assert(inc.changed === 1, "결함2: 제목 변경 1건 감지");
  assert(inc.newEmbeddings >= 1, "결함2: 제목만 바뀌어도 벡터 재발급(newEmbeddings>=1)");
  const V_inc = vectorForA(dbPath);
  assert(!V_inc.equals(V0), "결함2: 제목 변경 전후 벡터가 다르다 (잘못 재사용 아님)");

  // 전체 재빌드(별도 DB)의 동일 청크 벡터와 비교 → 증분이 재발급한 벡터와 동일해야 한다.
  const rbRoot = mkdtempSync(resolve(tmpdir(), "glm-reg-title-rebuild-"));
  const rbNotes = resolve(rbRoot, "notes");
  mkdirSync(rbNotes, { recursive: true });
  writeFileSync(resolve(rbNotes, "a.md"), `---\nid: "x1"\ntitle: "바뀐제목"\n---\n\n# 고정헤딩\n\n고정 본문 내용이다.\n`, "utf8");
  for (let i = 0; i < 4; i += 1) writeFileSync(resolve(rbNotes, `p${i}.md`),
    `---\nid: "p${i}"\ntitle: "pad${i}"\n---\n\n# pad${i}\n\n패드 본문 ${i}\n`, "utf8");
  const rbDb = resolve(rbRoot, ".ticksidian", "rag.sqlite");
  await new RagIndexBuilder({ vaultPath: rbRoot, databasePath: rbDb, embeddingProvider: new TitleProv() }).build();
  const V_full = vectorForA(rbDb);
  assert(V_inc.equals(V_full), "결함2: 제목 변경 후 증분 벡터 == 전체 재빌드 벡터");
}

// ── 결함2b: 헤딩만 변경 → 벡터 재발급, 전체 재빌드와 동일 ─────────────────────
{
  const root = mkdtempSync(resolve(tmpdir(), "glm-reg-heading-"));
  const notes = resolve(root, "notes");
  mkdirSync(notes, { recursive: true });
  const writeA = (heading) => writeFileSync(resolve(notes, "a.md"),
    `---\nid: "x1"\ntitle: "고정제목"\n---\n\n# ${heading}\n\n고정 본문 내용이다.\n`, "utf8");
  writeA("원헤딩");
  for (let i = 0; i < 4; i += 1) writeFileSync(resolve(notes, `p${i}.md`),
    `---\nid: "p${i}"\ntitle: "pad${i}"\n---\n\n# pad${i}\n\n패드 본문 ${i}\n`, "utf8");

  const dbPath = resolve(root, ".ticksidian", "rag.sqlite");
  class HeadingProv {
    constructor() { this.model = "fixture"; this.dimensions = EMBEDDING_DIMENSIONS; }
    async embed(texts) {
      return texts.map((t) => {
        const v = new Float32Array(EMBEDDING_DIMENSIONS);
        const s = t.toLowerCase();
        if (s.includes("원헤딩")) v[0] = 1;
        else if (s.includes("바뀐헤딩")) v[1] = 1;
        else v[2] = 1;
        return v;
      });
    }
  }
  const b = new RagIndexBuilder({ vaultPath: root, databasePath: dbPath, embeddingProvider: new HeadingProv() });
  await b.build();

  const vectorForA = (path) => {
    const d = openReadOnly(path);
    const cid = d.prepare("SELECT c.id AS cid FROM chunks c JOIN documents dd ON dd.id=c.document_id WHERE dd.file_path='notes/a.md' ORDER BY c.id LIMIT 1").get().cid;
    const emb = d.prepare("SELECT embedding FROM chunk_vectors WHERE rowid=?").get(BigInt(cid)).embedding;
    d.close();
    return Buffer.from(emb);
  };
  const V0 = vectorForA(dbPath);

  writeA("바뀐헤딩"); // 헤딩만 변경 (제목/본문 동일)
  const inc = await b.incremental();
  assert(inc.changed === 1, "결함2b: 헤딩 변경 1건 감지");
  assert(inc.newEmbeddings >= 1, "결함2b: 헤딩만 바뀌어도 벡터 재발급(newEmbeddings>=1)");
  const V_inc = vectorForA(dbPath);
  assert(!V_inc.equals(V0), "결함2b: 헤딩 변경 전후 벡터가 다르다 (잘못 재사용 아님)");

  // 전체 재빌드(별도 DB)의 동일 청크 벡터와 비교 → 증분이 재발급한 벡터와 동일해야 한다.
  const rbRoot = mkdtempSync(resolve(tmpdir(), "glm-reg-heading-rebuild-"));
  const rbNotes = resolve(rbRoot, "notes");
  mkdirSync(rbNotes, { recursive: true });
  writeFileSync(resolve(rbNotes, "a.md"), `---\nid: "x1"\ntitle: "고정제목"\n---\n\n# 바뀐헤딩\n\n고정 본문 내용이다.\n`, "utf8");
  for (let i = 0; i < 4; i += 1) writeFileSync(resolve(rbNotes, `p${i}.md`),
    `---\nid: "p${i}"\ntitle: "pad${i}"\n---\n\n# pad${i}\n\n패드 본문 ${i}\n`, "utf8");
  const rbDb = resolve(rbRoot, ".ticksidian", "rag.sqlite");
  await new RagIndexBuilder({ vaultPath: rbRoot, databasePath: rbDb, embeddingProvider: new HeadingProv() }).build();
  const V_full = vectorForA(rbDb);
  assert(V_inc.equals(V_full), "결함2b: 헤딩 변경 후 증분 벡터 == 전체 재빌드 벡터");
}

// ── 결함4: 변경 4/10 은 30% 초과로 거부 ──────────────────────────────────────
{
  const root = mkdtempSync(resolve(tmpdir(), "glm-reg-guard-"));
  const notes = resolve(root, "notes");
  mkdirSync(notes, { recursive: true });
  for (let i = 0; i < 10; i += 1) writeFileSync(resolve(notes, `n${i}.md`),
    `---\nid: "n${i}"\ntitle: "노트${i}"\n---\n\n# 노트${i}\n\n본문 ${i}\n`, "utf8");
  const dbPath = resolve(root, ".ticksidian", "rag.sqlite");
  class GuardProv {
    constructor() { this.model = "fixture"; this.dimensions = EMBEDDING_DIMENSIONS; }
    async embed(texts) { return texts.map(() => { const v = new Float32Array(EMBEDDING_DIMENSIONS); v[0] = 1; return v; }); }
  }
  const b = new RagIndexBuilder({ vaultPath: root, databasePath: dbPath, embeddingProvider: new GuardProv() });
  await b.build();
  for (let i = 0; i < 4; i += 1) writeFileSync(resolve(notes, `n${i}.md`),
    `---\nid: "n${i}"\ntitle: "노트${i}"\n---\n\n# 노트${i}\n\n바뀐 본문 ${i}\n`, "utf8");
  const beforeHash = fileHash(dbPath);
  let rejected = false;
  try { await b.incremental(); } catch (e) { rejected = /30%/.test(e.message); }
  assert(rejected, "결함4: 4/10 변경은 30% 초과로 증분 거부");
  assert(fileHash(dbPath) === beforeHash, "결함4: 거부 후 원본 DB 파일 불변");
  const d = openReadOnly(dbPath);
  assert(Number(d.prepare("SELECT count(*) AS count FROM documents").get().count) === 10, "결함4: 거부 후 문서 수 10 유지");
  assert(d.prepare("SELECT value FROM index_meta WHERE key='index_complete'").get().value === "1", "결함4: 거부 후 index_complete=1 유지");
  d.close();
}

// ── 결함3: 임베딩 실패 시 원본 DB 모든 테이블/메타/파일 보존 ──────────────────
{
  const root = mkdtempSync(resolve(tmpdir(), "glm-reg-fail-"));
  const notes = resolve(root, "notes");
  mkdirSync(notes, { recursive: true });
  for (let i = 0; i < 5; i += 1) writeFileSync(resolve(notes, `d${i}.md`),
    `---\nid: "d${i}"\ntitle: "문서${i}"\n---\n\n# 문서${i}\n\n본문 ${i}\n`, "utf8");
  const dbPath = resolve(root, ".ticksidian", "rag.sqlite");
  class FailProv {
    constructor() { this.model = "fixture"; this.dimensions = EMBEDDING_DIMENSIONS; this.fail = false; }
    async embed(texts) {
      if (this.fail) throw new Error("embedding failure simulated");
      return texts.map(() => { const v = new Float32Array(EMBEDDING_DIMENSIONS); v[0] = 1; return v; });
    }
  }
  const prov = new FailProv();
  const b = new RagIndexBuilder({ vaultPath: root, databasePath: dbPath, embeddingProvider: prov });
  await b.build();
  writeFileSync(resolve(notes, "new.md"), `---\nid: "new"\ntitle: "신규"\n---\n\n# 신규\n\n새 본문\n`, "utf8");
  const beforeHash = fileHash(dbPath);
 const snap = () => {
   const d = openReadOnly(dbPath);
    const J = (v) => JSON.stringify(v, (k, x) => typeof x === "bigint" ? x.toString() : x);
    const s = {
      docs: J(d.prepare("SELECT id,file_path,note_id,title,tags_json,file_hash,modified_at_ms FROM documents ORDER BY id").all()),
      chunks: J(d.prepare("SELECT id,document_id,chunk_index,heading,content,content_hash FROM chunks ORDER BY id").all()),
      fts: Number(d.prepare("SELECT count(*) AS count FROM chunks_fts").get().count),
      vec: Number(d.prepare("SELECT count(*) AS count FROM chunk_vectors").get().count),
      meta: J(d.prepare("SELECT key,value FROM index_meta ORDER BY key").all()),
    };
    d.close();
    return s;
  };
  const before = snap();
  prov.fail = true;
  let caught = false;
  try { await b.incremental(); } catch (e) { caught = /fail|embedding|실패/i.test(e.message); }
  assert(caught, "결함3: 임베딩 실패 에러 전파");
  assert(fileHash(dbPath) === beforeHash, "결함3: 실패 후 원본 DB 파일 바이트 불변");
  const after = snap();
  assert(after.docs === before.docs, "결함3: documents 행 내용 불변");
  assert(after.chunks === before.chunks, "결함3: chunks 행 내용 불변");
  assert(after.fts === before.fts, "결함3: FTS 수 불변");
  assert(after.vec === before.vec, "결함3: 벡터 수 불변");
  assert(after.meta === before.meta, "결함3: index_meta 행 내용 불변(index_complete=1 포함)");
}

// ── 결함5: 원자 교체 두 번째 rename 실패 → 원본 DB 원래 자리 보존 ──────────────
//   결정적 결함 주입: rename 주입 함수가 첫 rename(원본→백업)은 성공시키고
//   둘째 rename(임시→원본)은 실패시킨다. 헬퍼가 백업을 원본 자리로 복원해야 한다.
{
  const root = mkdtempSync(resolve(tmpdir(), "glm-reg-replace-"));
  const stagingDir = resolve(root, ".staging");
  const makePlainDb = (p, tag) => {
    const d = new DatabaseSync(p);
    d.exec("CREATE TABLE documents(id INTEGER PRIMARY KEY, title TEXT NOT NULL);");
    d.prepare("INSERT INTO documents(id,title) VALUES(?,?)").run(1, tag);
    d.close();
  };
  const readTitle = (p) => {
    const d = new DatabaseSync(p, { readOnly: true });
    const row = d.prepare("SELECT title FROM documents WHERE id=1").get();
    d.close();
    return row.title;
  };

  // 케이스 A: 두 번째 rename(임시→원본) 실패 → 원본 복원.
  const target = resolve(root, "rag.sqlite");
  makePlainDb(target, "ORIGINAL");
  const originalHash = fileHash(target);
  const candidate = resolve(root, "candidate.sqlite");
  makePlainDb(candidate, "CANDIDATE");
  let renameCalls = 0;
  const injectFailOnSecond = (src, dest) => {
    renameCalls += 1;
    if (renameCalls === 2) throw new Error("FAULT: simulated temp->target rename failure");
    renameSync(src, dest);
  };
  let thrown = null;
  try {
    replaceDatabaseFailureSafe(candidate, target, root, "rag-incremental", { rename: injectFailOnSecond });
  } catch (e) { thrown = e; }
  assert(thrown !== null && /FAULT/.test(thrown.message), "결함5: 교체 실패 시 에러 전파");
  assert(existsSync(target), "결함5: 실패 후 원본 경로에 파일 존재(빈 자리 아님)");
  assert(fileHash(target) === originalHash, "결함5: 실패 후 원본 DB 바이트 불변(복원됨)");
  assert(readTitle(target) === "ORIGINAL", "결함5: 복원된 원본 documents/내용 intact (ORIGINAL)");
  assert(!existsSync(stagingDir) || readdirSync(stagingDir).length === 0, "결함5: 복원 후 .staging 백업 잔류 없음");
  assert(existsSync(candidate), "결함5: 임시 후보는 이동되지 않고 제자리에 남음(rm 없음)");

  // 케이스 B: 정상 경로 → 후보가 원본 자리로, 구 원본은 .staging 백업.
  renameCalls = 0;
  const candidate2 = resolve(root, "candidate2.sqlite");
  makePlainDb(candidate2, "CANDIDATE2");
  const backupPath = replaceDatabaseFailureSafe(candidate2, target, root, "rag-incremental");
  assert(backupPath !== null && existsSync(backupPath), "결함5: 정상 교체 시 구 원본이 .staging에 백업됨");
  assert(fileHash(target) !== originalHash, "결함5: 정상 교체 후 원본 자리는 후보로 교체됨");
  assert(readTitle(target) === "CANDIDATE2", "결함5: 정상 교체 후 내용은 CANDIDATE2");
  assert(readTitle(backupPath) === "ORIGINAL", "결함5: .staging 백업은 구 원본(ORIGINAL)");
  assert(!existsSync(candidate2), "결함5: 정상 교체 후 임시 후보는 원본 자리로 옮겨짐");
}

console.log(`qa-rag-regression-glm: ${assertions} assertions PASS`);
