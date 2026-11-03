import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { chunkMarkdown, EMBEDDING_DIMENSIONS, MAX_INDEXABLE_MARKDOWN_BYTES, RagIndexBuilder, RagSearcher } from "./rag-index-lib.mjs";
import { sensitiveTitlesToMarkdown, taskToTicksidianMarkdown } from "./ticktick-import-lib.mjs";

let assertions = 0;
function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(`ASSERTION FAIL: ${message}`);
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

const fixtureRoot = mkdtempSync(resolve(tmpdir(), "ticksidian-rag-qa-"));
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
const fakeGoogleKey = `AI${"za"}${"A".repeat(31)}`;
writeFileSync(resolve(notesDir, "secret.md"), `# 비밀\n\n${fakeGoogleKey}\n`, "utf8");
writeFileSync(resolve(notesDir, "plain.md"), "제목 없는 일반 메모", "utf8");
writeFileSync(resolve(notesDir, "oversized.md"), "x".repeat(MAX_INDEXABLE_MARKDOWN_BYTES + 1), "utf8");

const chunked = chunkMarkdown("# 제목\n\n짧은 본문\n\n## 다음\n\n두 번째 본문");
assert(chunked.chunks.length === 2, "헤딩별 청크 2개");
assert(chunked.chunks[1].heading === "다음", "두 번째 헤딩 보존");
const importedChunks = chunkMarkdown("# 실행 아이디어\n\n실제 본문\n\n## 가져오기 정보\n\nTickTick 원본 ID: 123");
assert(importedChunks.chunks.length === 1, "가져오기 정보 검색 청크 제외");
assert(!importedChunks.chunks[0].content.includes("원본 ID"), "반복 이관 메타 검색 오염 차단");

const importedAt = "2026-08-13T00:00:00.000Z";
const fixtureTask = {
  sourceId: "task-1",
  title: "인증 문의 확인",
  content: "문의 내용을 검토한다.",
  description: "",
  createdAt: importedAt,
  modifiedAt: importedAt,
  ticksidianDueDateCandidate: "2026-08-14T00:00:00.000Z",
  priority: { label: "높음" },
  tags: ["업무"],
  project: { name: "기본함", isInbox: true },
  checklistItems: [],
  safety: { action: "agent-review-allowed" },
};
const importedMarkdown = taskToTicksidianMarkdown(fixtureTask, importedAt);
assert(importedMarkdown.includes('id: "ticktick-task-1"'), "TickTick ID 기반 문서 ID");
assert(importedMarkdown.includes('externalSource: "ticktick"'), "외부 원본 표기");
assert(importedMarkdown.includes('type: "todo"'), "Ticksidian 투두 형식");
assert(importedMarkdown.includes('dueDate: "2026-08-14"'), "마감일 날짜 변환");

const sensitive = sensitiveTitlesToMarkdown([
  { title: "비밀 항목 B" },
  { title: "비밀 항목 A" },
], importedAt);
assert(sensitive.includes("비밀 항목 A"), "민감 제목 포함");
assert(sensitive.indexOf("비밀 항목 A") < sensitive.indexOf("비밀 항목 B"), "민감 제목 정렬");
assert(!sensitive.includes("token"), "민감 값 미포함");

const embeddingProvider = new FixtureEmbeddingProvider();
const databasePath = resolve(fixtureRoot, ".ticksidian", "rag.sqlite");
const built = await new RagIndexBuilder({ fixtureRoot, vaultPath: fixtureRoot, databasePath, embeddingProvider }).build();
assert(built.documents === 3, "문서 3개 인덱싱");
assert(built.skippedSensitiveFiles.length === 1, "민감 문서 1개 제외");
assert(built.skippedSensitiveFiles[0] === "notes/secret.md", "민감 문서 경로 보고");
assert(built.skippedOversizedFiles.length === 1, "대형 문서 1개 제외");
assert(built.skippedOversizedFiles[0].filePath === "notes/oversized.md", "대형 문서 경로 보고");
assert(built.chunks === 3, "청크 3개 인덱싱");
assert(built.fts === built.chunks, "FTS 행 수 일치");
assert(built.vectors === built.chunks, "벡터 행 수 일치");

const db = new DatabaseSync(databasePath, { readOnly: true, readBigInts: true });
const complete = db.prepare("SELECT value FROM index_meta WHERE key='index_complete'").get().value;
assert(complete === "1", "완료 영수증 마지막 기록");
assert(Number(db.prepare("SELECT count(*) AS count FROM documents").get().count) === 3, "DB 문서 수");
assert(db.prepare("SELECT title FROM documents WHERE file_path='notes/plain.md'").get().title === "plain", "frontmatter 없는 파일명 제목 fallback");
db.close();

const searcher = new RagSearcher({ databasePath, embeddingProvider });
const hashBeforeSearch = createHash("sha256").update(readFileSync(databasePath)).digest("hex");
const exact = await searcher.search("인증", { limit: 2 });
assert(exact[0].title === "KC 인증 자동화", "FTS/벡터 인증 검색 적중");
assert(exact[0].sources.includes("fts5"), "정확 검색 근거 포함");
assert(exact[0].sources.includes("sqlite-vec"), "벡터 검색 근거 포함");
const semantic = await searcher.search("KC 업무", { limit: 2 });
assert(semantic[0].title === "KC 인증 자동화", "의미 검색 적중");
assert(semantic[0].sources.includes("fts5"), "다단어 정확 검색 0개면 OR fallback");
assert(new Set(semantic.map((item) => item.filePath)).size === semantic.length, "같은 문서 청크 중복 제거");
const particleQuery = await searcher.search("인증에서 자동화 아이디어", { limit: 2 });
assert(particleQuery[0].title === "KC 인증 자동화", "한국어 조사 제거 제목 검색");
assert(particleQuery[0].sources.includes("title"), "제목 검색 근거 포함");
const hashAfterSearch = createHash("sha256").update(readFileSync(databasePath)).digest("hex");
assert(hashAfterSearch === hashBeforeSearch, "검색 전후 RAG DB 해시 불변");

// 차원 불일치 검증: DB(384)와 다른 차원(768) 프로바이더로 검색하면 fail-closed
let dimensionMismatchCaught = false;
try {
  const wrongProvider = new FixtureEmbeddingProvider();
  wrongProvider.dimensions = EMBEDDING_DIMENSIONS * 2;
  await new RagSearcher({ databasePath, embeddingProvider: wrongProvider }).search("인증");
} catch (e) {
  dimensionMismatchCaught = /차원/.test(e.message);
}
assert(dimensionMismatchCaught, "DB와 프로바이더 차원 불일치 시 검색 차단");

const rebuilt = await new RagIndexBuilder({ vaultPath: fixtureRoot, databasePath, embeddingProvider }).build();
assert(rebuilt.documents === built.documents, "재생성 문서 수 동일");
assert(rebuilt.chunks === built.chunks, "재생성 청크 수 동일");

console.log(`qa-rag-index: ${assertions} assertions PASS`);
console.log(`qa-artifact: ${fixtureRoot}`);
