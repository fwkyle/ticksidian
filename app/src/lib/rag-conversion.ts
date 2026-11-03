/**
 * RAG Rust 직렬화 계약 변환 (순수 로직, Tauri invoke 비의존).
 *
 * src-tauri/src/rag/commands.rs(RagIndexStatus)와 searcher.rs(RagSearchHit)는
 * 모두 serde(rename_all = "camelCase")로 직렬화한다. 그래서 Rust가 보내는 원형은
 * camelCase(indexComplete, filePath, ...)이고, 이 모듈은 그 원형을 받아 앱이 쓰는
 * camelCase 타입으로 명시적 매핑한다. 매핑을 함수로 두어 계약을 고정하고
 * regression 테스트가 snake_case 가정의 회귀를 잡을 수 있게 한다.
 *
 * 이 모듈은 Tauri에 닿지 않는 순수 변환이다(thin adapter 원칙).
 */

export interface RagIndexStatus {
  exists: boolean;
  indexComplete: boolean;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  documentCount: number | null;
  chunkCount: number | null;
  builtAt: string | null;
}

export interface RagSearchHit {
  filePath: string;
  title: string;
  heading: string;
  preview: string;
  sources: Array<'fts5' | 'sqlite-vec' | 'title'>;
  score: number;
}

/**
 * Rust serde(rename_all = "camelCase")가 보내는 그대로의 원형.
 * 필드명이 camelCase임이 계약의 핵심이다(과거 snake_case 가정 회귀 방지).
 */
export interface RawRagIndexStatus {
  exists: boolean;
  indexComplete: boolean;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  documentCount: number | null;
  chunkCount: number | null;
  builtAt: string | null;
}

export interface RawRagSearchHit {
  filePath: string;
  title: string;
  heading: string;
  preview: string;
  sources: Array<'fts5' | 'sqlite-vec' | 'title'>;
  score: number;
}

export function toRagIndexStatus(raw: RawRagIndexStatus): RagIndexStatus {
  return {
    exists: raw.exists,
    indexComplete: raw.indexComplete,
    embeddingModel: raw.embeddingModel,
    embeddingDimensions: raw.embeddingDimensions,
    documentCount: raw.documentCount,
    chunkCount: raw.chunkCount,
    builtAt: raw.builtAt,
  };
}

export function toRagSearchHit(raw: RawRagSearchHit): RagSearchHit {
  return {
    filePath: raw.filePath,
    title: raw.title,
    heading: raw.heading,
    preview: raw.preview,
    sources: raw.sources,
    score: raw.score,
  };
}
