#!/usr/bin/env node
import { resolve } from "node:path";
import { GeminiEmbeddingProvider, RagIndexBuilder } from "./rag-index-lib.mjs";

// 임베딩은 Gemini API(gemini-embedding-001, 768차원)를 기본으로 한다.
// GEMINI_API_KEY 는 환경변수로 준다(키가 든 env 파일을 source 하거나 export).
const vaultIdx = process.argv.indexOf("--vault");
if (vaultIdx < 0 || !process.argv[vaultIdx + 1]) {
  console.error("사용법: node scripts/rag-build.mjs --vault /절대/볼트/경로 [--incremental]");
  console.error("  임베딩: Gemini gemini-embedding-001 (768차원). GEMINI_API_KEY 필요.");
  console.error("  --incremental: 변경/추가/삭제된 파일만 다시 색인 (기존 rag.sqlite 필요).");
  process.exitCode = 2;
} else {
  const vaultPath = resolve(process.argv[vaultIdx + 1]);
  const incremental = process.argv.includes("--incremental");
  const builder = new RagIndexBuilder({ vaultPath, embeddingProvider: new GeminiEmbeddingProvider() });
  const result = incremental ? await builder.incremental() : await builder.build();
  console.log(JSON.stringify(result, null, 2));
}
