#!/usr/bin/env node
import { resolve } from "node:path";
import { GeminiEmbeddingProvider, RagSearcher } from "./rag-index-lib.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}
const vault = option("--vault");
const query = option("--query");
if (!vault || !query) {
  console.error("사용법: node scripts/rag-search.mjs --vault /절대/볼트/경로 --query '검색 질문'");
  console.error("  임베딩: Gemini gemini-embedding-001 (768차원). DB 차원과 일치해야 한다.");
  process.exitCode = 2;
} else {
  const results = await new RagSearcher({
    databasePath: resolve(vault, ".ticksidian", "rag.sqlite"),
    embeddingProvider: new GeminiEmbeddingProvider(),
  }).search(query);
  console.log(JSON.stringify({ query, results }, null, 2));
}
