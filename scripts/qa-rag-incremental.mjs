import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";

import { EMBEDDING_DIMENSIONS, RagIndexBuilder, RagSearcher } from "./rag-index-lib.mjs";

let assertions = 0;
function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(`ASSERTION FAIL: ${message}`);
}

function openReadOnly(path) {
  const db = new DatabaseSync(path, { allowExtension: true, readOnly: true, readBigInts: true });
  db.loadExtension(sqliteVec.getLoadablePath());
  return db;
}

class FixtureEmbeddingProvider {
  constructor() {
    this.model = "fixture-keyword-embedding";
    this.dimensions = EMBEDDING_DIMENSIONS;
  }

  async embed(texts) {
    return texts.map((text) => {
      const vector = new Float32Array(EMBEDDING_DIMENSIONS);
      const normalized = text.toLowerCase();
      if (normalized.includes("인증") || normalized.includes("kc")) vector[0] = 1;
      if (normalized.includes("블로그")) vector[1] = 1;
      if (normalized.includes("운동")) vector[2] = 1;
      if (vector[0] === 0 && vector[1] === 0 && vector[2] === 0) vector[3] = 1;
      return vector;
    });
  }
}

class BatchRecordingProvider extends FixtureEmbeddingProvider {
  constructor() {
    super();
    this.calls = [];
  }

  async embed(texts, kind, batchSize) {
    this.calls.push({ count: texts.length, kind, batchSize });
    return super.embed(texts);
  }
}

const fixtureRoot = mkdtempSync(resolve(tmpdir(), "ticksidian-rag-inc-qa-"));
const notesDir = resolve(fixtureRoot, "notes");
mkdirSync(notesDir, { recursive: true });
writeFileSync(resolve(notesDir, "cert.md"), `---
id: "cert-1"
title: "KC 인증 자동화"
tags: ["인증", "업무"]
---

# KC 인증 자동화

인증 서류와 고객 문의를 자동으로 분류한다.
`, "utf8");
writeFileSync(resolve(notesDir, "blog.md"), `---
id: "blog-1"
title: "블로그 운영"
---

# 블로그 운영

콘텐츠 초안을 사람이 승인하고 발행한다.
`, "utf8");
writeFileSync(resolve(notesDir, "plain.md"), "제목 없는 일반 메모", "utf8");
// 안정 pad 파일: 결함4(union 분모) 수정 후에도 소규모 변경(1건)이 30% 가드에 걸리지 않도록 볼트를 키운다.
writeFileSync(resolve(notesDir, "pad-stable.md"), `---
id: "pad-stable-1"
title: "안정 문서"
---

# 안정 문서

이 파일은 증분 QA 전체에서 변경되지 않는다.
`, "utf8");

const databasePath = resolve(fixtureRoot, ".ticksidian", "rag.sqlite");
const recordingProvider = new BatchRecordingProvider();
const builder = new RagIndexBuilder({ vaultPath: fixtureRoot, databasePath, embeddingProvider: recordingProvider });
const built = await builder.build();
assert(built.documents === 4, "초기 빌드 문서 4개");
assert(built.chunks === 4, "초기 빌드 청크 4개");
recordingProvider.calls = []; // 초기 빌드 호출 기록 리셋

// --- 케이스 1: 변경 문서만 re-embed, 나머지 보존 ---
writeFileSync(resolve(notesDir, "cert.md"), `---
id: "cert-1"
title: "KC 인증 자동화"
tags: ["인증", "업무"]
---

# KC 인증 자동화

인증 서류와 고객 문의를 자동으로 분류한다.
## 추가 섹션

새로 추가된 인증 절차 내용.
`, "utf8");
const inc1 = await builder.incremental();
assert(inc1.changed === 1, "변경 문서 1건");
assert(inc1.added === 0, "추가 문서 0건");
assert(inc1.removed === 0, "삭제 문서 0건");
assert(inc1.unchanged === 3, "미변경 문서 3건");
assert(inc1.reusedEmbeddings >= 1, "같은 내용 청크 임베딩 재사용");
assert(inc1.newEmbeddings >= 1, "새 청크 임베딩 생성");
assert(recordingProvider.calls.length >= 1 && recordingProvider.calls.every((c) => c.count <= 4), "배치당 4개 이하");
const db1 = openReadOnly(databasePath);
assert(Number(db1.prepare("SELECT count(*) AS count FROM documents").get().count) === 4, "문서 수 4 유지");
assert(Number(db1.prepare("SELECT count(*) AS count FROM chunks").get().count) === 5, "청크 수 4→5");
assert(Number(db1.prepare("SELECT count(*) AS count FROM chunks_fts").get().count) === 5, "FTS 수 5");
assert(Number(db1.prepare("SELECT count(*) AS count FROM chunk_vectors").get().count) === 5, "벡터 수 5");
const meta1 = db1.prepare("SELECT value FROM index_meta WHERE key='index_complete'").get().value;
assert(meta1 === "1", "증분 후 완료 영수증 유지");
db1.close();

// --- 케이스 2: 변경 없으면 embed 0회 + skip ---
const embedCallsBefore = recordingProvider.calls.length;
const inc2 = await builder.incremental();
assert(inc2.changed === 0 && inc2.added === 0 && inc2.removed === 0, "변경 0건");
assert(inc2.unchanged === 4, "미변경 4건");
assert(recordingProvider.calls.length === embedCallsBefore, "변경 없으면 임베딩 호출 0회");
assert(inc2.reusedEmbeddings === 0 && inc2.newEmbeddings === 0, "임베딩 0건");

// --- 케이스 3: 추가 문서 ---
writeFileSync(resolve(notesDir, "exercise.md"), `---
id: "exercise-1"
title: "운동 루틴"
---

# 운동 루틴

매일 아침 스트레칭과 근력 운동을 한다.
`, "utf8");
const inc3 = await builder.incremental();
assert(inc3.added === 1, "추가 문서 1건");
assert(inc3.changed === 0, "변경 0건");
assert(inc3.documents === 5, "문서 수 5");
assert(inc3.chunks === 6, "청크 수 6");
const db3 = openReadOnly(databasePath);
assert(Number(db3.prepare("SELECT count(*) AS count FROM documents").get().count) === 5, "DB 문서 수 5");
assert(Number(db3.prepare("SELECT count(*) AS count FROM chunk_vectors").get().count) === 6, "DB 벡터 수 6");
db3.close();

// --- 케이스 4: 삭제 문서 반영 ---
const removedPath = resolve(notesDir, "plain.md");
// (rm 금지 규칙 때문에 파일을 볼트 밖 .staging으로 옮긴다)
const staging = resolve(fixtureRoot, ".staging");
mkdirSync(staging, { recursive: true });
renameSync(removedPath, resolve(staging, "plain.md"));
const inc4 = await builder.incremental();
assert(inc4.removed === 1, "삭제 문서 1건");
assert(inc4.documents === 4, "문서 수 4");
assert(inc4.chunks === 5, "청크 수 5 (삭제 반영)");
const db4 = openReadOnly(databasePath);
assert(Number(db4.prepare("SELECT count(*) AS count FROM documents").get().count) === 4, "DB 문서 수 4");
assert(Number(db4.prepare("SELECT count(*) AS count FROM chunk_vectors").get().count) === 5, "DB 벡터 수 5");
const removedRow = db4.prepare("SELECT count(*) AS count FROM documents WHERE file_path='notes/plain.md'").get().count;
assert(Number(removedRow) === 0, "삭제된 문서 행 제거");
db4.close();

// --- 케이스 5: 임베딩 실패 시 원본 DB 완전 보존 (결함3 수정 계약) ---
// embeddingProvider를 실패하는 프로바이더로 바꿔 새 청크 임베딩에서 실패를 유도한다.
// 실패 전후로 모든 테이블 행과 메타를 스냅샷 비교해 원본이 한 글자도 안 바뀌었는지 확인한다.
class FailingProvider extends FixtureEmbeddingProvider {
  constructor() {
    super();
    this.failNext = false;
  }

  async embed(texts, kind, batchSize) {
    if (this.failNext) throw new Error("시뮬레이션된 임베딩 실패");
    return super.embed(texts, kind, batchSize);
  }
}
const failingProvider = new FailingProvider();
const failingBuilder = new RagIndexBuilder({ vaultPath: fixtureRoot, databasePath, embeddingProvider: failingProvider });
writeFileSync(resolve(notesDir, "new-fail.md"), "# 실패 유도 문서\n\n이 문서는 임베딩 실패를 유도한다.\n", "utf8");
function snapshotDb() {
  const sdb = openReadOnly(databasePath);
  const snap = {
    documents: sdb.prepare("SELECT id,file_path,note_id,title,tags_json,file_hash,modified_at_ms FROM documents ORDER BY id").all(),
    chunks: sdb.prepare("SELECT id,document_id,chunk_index,heading,content,content_hash FROM chunks ORDER BY id").all(),
    fts: Number(sdb.prepare("SELECT count(*) AS count FROM chunks_fts").get().count),
    vectors: Number(sdb.prepare("SELECT count(*) AS count FROM chunk_vectors").get().count),
    meta: sdb.prepare("SELECT key,value FROM index_meta ORDER BY key").all(),
  };
  sdb.close();
  return snap;
}
const beforeFail = snapshotDb();
failingProvider.failNext = true;
let failureCaught = false;
try {
  await failingBuilder.incremental();
} catch (e) {
  failureCaught = /실패|embedding/i.test(e.message);
}
assert(failureCaught, "임베딩 실패 시 에러 전파");
const afterFail = openReadOnly(databasePath);
assert(afterFail.prepare("SELECT value FROM index_meta WHERE key='index_complete'").get().value === "1", "임베딩 실패 시에도 원본 index_complete=1 유지(완전 보존)");
assert(Number(afterFail.prepare("SELECT count(*) AS count FROM documents").get().count) === beforeFail.documents.length, "실패 시 문서 수 불변");
assert(Number(afterFail.prepare("SELECT count(*) AS count FROM chunks").get().count) === beforeFail.chunks.length, "실패 시 청크 수 불변");
assert(Number(afterFail.prepare("SELECT count(*) AS count FROM chunks_fts").get().count) === beforeFail.fts, "실패 시 FTS 수 불변");
assert(Number(afterFail.prepare("SELECT count(*) AS count FROM chunk_vectors").get().count) === beforeFail.vectors, "실패 시 벡터 수 불변");
const afterMeta = afterFail.prepare("SELECT key,value FROM index_meta ORDER BY key").all();
assert(JSON.stringify(afterMeta) === JSON.stringify(beforeFail.meta), "실패 시 메타 행 내용 불변");
afterFail.close();
assert(!existsSync(`${databasePath}.incremental-${process.pid}`), "실패 시 임시 DB가 원본 자리에 남지 않음(원자 교체 미발생)");

// 실패 유도 파일을 .staging으로 이동 후 전체 빌드로 정상 상태 복구
renameSync(resolve(notesDir, "new-fail.md"), resolve(staging, "new-fail.md"));
const recoverProvider = new BatchRecordingProvider();
const recoverBuilder = new RagIndexBuilder({ vaultPath: fixtureRoot, databasePath, embeddingProvider: recoverProvider });
const fullRecover = await recoverBuilder.build();
assert(fullRecover.documents === 4, "전체 빌드 복구 후 문서 수 4");
const inc5 = await recoverBuilder.incremental();
assert(inc5.changed === 0 && inc5.added === 0 && inc5.removed === 0, "복구 후 변경 0건");
assert(inc5.documents === 4, "복구 후 문서 수 4");

// --- 케이스 6: 증분 결과 == 전체 재빌드 결과 (멱등성/동일성) ---
const fullProvider = new FixtureEmbeddingProvider();
const fullRebuild = await new RagIndexBuilder({ vaultPath: fixtureRoot, databasePath, embeddingProvider: fullProvider }).build();
assert(fullRebuild.documents === inc5.documents, "재빌드 문서 수 일치");
assert(fullRebuild.chunks === inc5.chunks, "재빌드 청크 수 일치");

// --- 케이스 7: 차원/모델 불일치 DB에 증분 시도 → 거부 ---
const wrongProvider = new FixtureEmbeddingProvider();
wrongProvider.dimensions = EMBEDDING_DIMENSIONS * 2;
let dimCaught = false;
try {
  await new RagIndexBuilder({ vaultPath: fixtureRoot, databasePath, embeddingProvider: wrongProvider }).incremental();
} catch (e) {
  dimCaught = /차원/.test(e.message);
}
assert(dimCaught, "차원 불일치 시 증분 거부");

// --- 케이스 8: 증분 후 검색 정상 동작 ---
const searcher = new RagSearcher({ databasePath, embeddingProvider: new FixtureEmbeddingProvider() });
const search = await searcher.search("인증", { limit: 2 });
assert(search.length >= 1, "증분 후 검색 결과 존재");
assert(search.some((h) => h.title === "KC 인증 자동화"), "증분 후 인증 문서 검색 적중");

// --- 케이스 9: 삭제 파일의 청크 내용이 변경 파일에서 재사용되어도 증분이 성공 ---
//    회귀: 삭제될 문서의 벡터가 단계3 삭제 전에 미리 로드되지 않으면
//    단계4 복사에서 "재사용할 청크 벡터를 찾지 못했습니다"로 깨지던 결함.
{
  const regRoot = mkdtempSync(resolve(tmpdir(), "ticksidian-rag-inc-reg-"));
  const regNotes = resolve(regRoot, "notes");
  const regStaging = resolve(regRoot, ".staging");
  mkdirSync(regNotes, { recursive: true });
  mkdirSync(regStaging, { recursive: true });
  const regShared = "## 공통섹션\n\n삭제 파일과 변경 파일이 공유하는 동일 청크 본문이다.";
  writeFileSync(resolve(regNotes, "keep.md"), "# keep\n\n" + regShared + "\n\n## 고유\n\n원래내용\n", "utf8");
  writeFileSync(resolve(regNotes, "gonedel.md"), "# gone\n\n" + regShared + "\n", "utf8");
  for (let i = 0; i < 10; i += 1) {
    writeFileSync(resolve(regNotes, "pad" + i + ".md"), "# pad " + i + "\n\n고유내용" + i + "\n", "utf8");
  }
  const regDb = resolve(regRoot, ".ticksidian", "rag.sqlite");
  const regProvider = new BatchRecordingProvider();
  const regBuilder = new RagIndexBuilder({ vaultPath: regRoot, databasePath: regDb, embeddingProvider: regProvider });
  await regBuilder.build();
  renameSync(resolve(regNotes, "gonedel.md"), resolve(regStaging, "gonedel.md"));
  writeFileSync(resolve(regNotes, "keep.md"), "# keep\n\n" + regShared + "\n\n## 고유\n\n바뀐내용\n", "utf8");
  const regInc = await regBuilder.incremental();
  assert(regInc.removed === 1, "회귀: 삭제 문서 1건");
  assert(regInc.changed === 1, "회귀: 변경 문서 1건");
  assert(regInc.reusedEmbeddings >= 1, "회귀: 삭제 파일 청크 벡터 재사용 성공");
  const regDb2 = openReadOnly(regDb);
  assert(Number(regDb2.prepare("SELECT count(*) AS count FROM chunks").get().count)
    === Number(regDb2.prepare("SELECT count(*) AS count FROM chunk_vectors").get().count), "회귀: 청크/벡터 수 일치");
  regDb2.close();
}

console.log(`qa-rag-incremental: ${assertions} assertions PASS`);
console.log(`qa-artifact: ${fixtureRoot}`);
