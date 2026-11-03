// rag-index-lib.mjs — 재export 전용 barrel.
//
// 구현은 2026-08-15 리팩토링으로 rag-lib/ 하위 6모듈로 분리됐다
// (docs/architecture/script-size-audit-2026-08-15.md 1순위).
// 이 파일은 기존 import 경로(./rag-index-lib.mjs)를 그대로 유지하기 위한 경계다.
//
// 모듈 구성:
//   rag-lib/text.mjs             — 청킹/해시/민감 패턴/마크다운 순회/레코드 수집
//   rag-lib/embedding-provider.mjs — Gemini 임베딩 API 클라이언트
//   rag-lib/db.mjs               — sqlite-vec 연결/스키마/메타/원자 교체
//   rag-lib/incremental-operations.mjs — 문서/청크/FTS 갱신 트랜잭션 + 벡터 복사/임베딩
//   rag-lib/builder.mjs          — RagIndexBuilder (build + incremental)
//   rag-lib/searcher.mjs         — RagSearcher (FTS5 + sqlite-vec + 제목 RRF)

export {
  EMBEDDING_TEXT_MAX_LENGTH,
  MAX_INDEXABLE_MARKDOWN_BYTES,
  chunkMarkdown,
} from "./rag-lib/text.mjs";

export {
  EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  GeminiEmbeddingProvider,
} from "./rag-lib/embedding-provider.mjs";

export { replaceDatabaseFailureSafe } from "./rag-lib/db.mjs";

export { RagIndexBuilder } from "./rag-lib/builder.mjs";

export { RagSearcher } from "./rag-lib/searcher.mjs";
