// RAG 검색 — FTS5 + sqlite-vec + 제목 하이브리드 검색(RRF 병합).
// 원래 scripts/rag-index-lib.mjs(898줄)의 검색 책임 분리(2026-08-15 리팩토링).

import { resolve } from "node:path";

import { openVectorDatabase } from "./db.mjs";
import { GeminiEmbeddingProvider } from "./embedding-provider.mjs";

function normalizeSearchTerm(value) {
  return value
    .toLocaleLowerCase("ko")
    .replace(/(?:에서|으로|에게|한테|부터|까지|와|과|을|를|이|가|은|는|에|의)$/u, "")
    .replace(/[^a-z0-9가-힣]+/gu, "")
    .trim();
}

function rrfMerge(ftsRows, vectorRows, titleRows, limit, query) {
  const scores = new Map();
  const add = (rows, source) => rows.forEach((row, index) => {
    const key = String(row.chunk_id);
    const current = scores.get(key) ?? { ...row, score: 0, sources: [] };
    current.score += 1 / (60 + index + 1);
    current.sources.push(source);
    scores.set(key, current);
  });
  add(ftsRows, "fts5");
  add(vectorRows, "sqlite-vec");
  add(titleRows, "title");
  const normalizedQuery = normalizeSearchTerm(query);
  const queryTerms = query.split(/\s+/u).map(normalizeSearchTerm).filter((term) => term.length >= 2);
  for (const item of scores.values()) {
    const title = normalizeSearchTerm(String(item.title ?? ""));
    if (normalizedQuery.includes(title) || title.includes(normalizedQuery)) item.score += 0.05;
    const matchedTitleTerms = queryTerms.filter((term) => title.includes(term)).length;
    item.score += matchedTitleTerms * 0.04;
  }
  const ordered = [...scores.values()].sort((a, b) => b.score - a.score);
  const uniqueDocuments = [];
  const seenPaths = new Set();
  for (const item of ordered) {
    if (seenPaths.has(item.file_path)) continue;
    seenPaths.add(item.file_path);
    uniqueDocuments.push(item);
    if (uniqueDocuments.length >= limit) break;
  }
  return uniqueDocuments;
}

export class RagSearcher {
  constructor({ databasePath, embeddingProvider = new GeminiEmbeddingProvider() }) {
    this.databasePath = resolve(databasePath);
    this.embeddingProvider = embeddingProvider;
  }

  async search(query, { limit = 10 } = {}) {
    if (!query.trim()) throw new Error("검색어가 비어 있습니다.");
    const db = openVectorDatabase(this.databasePath, { readOnly: true });
    try {
      const complete = db.prepare("SELECT value FROM index_meta WHERE key='index_complete'").get()?.value;
      if (complete !== "1") throw new Error("완료되지 않은 RAG DB입니다.");
      const dbDims = Number(db.prepare("SELECT value FROM index_meta WHERE key='embedding_dimensions'").get()?.value);
      if (!Number.isInteger(dbDims) || dbDims !== this.embeddingProvider.dimensions) {
        throw new Error(`RAG DB 차원(${dbDims})과 임베딩 프로바이더 차원(${this.embeddingProvider.dimensions})이 다릅니다. 같은 프로바이더로 만든 DB인지 확인하세요.`);
      }
      const candidates = Math.max(limit * 3, 20);
      let ftsRows = [];
      const fallbackFtsQuery = () => query.split(/\s+/u)
        .filter(Boolean)
        .map((term) => `"${term.replaceAll('"', '""')}"`)
        .join(" OR ");
      try {
        ftsRows = db.prepare(`
          SELECT c.id AS chunk_id,d.file_path,d.title,c.heading,c.content,bm25(chunks_fts) AS rank
          FROM chunks_fts
          JOIN chunks c ON c.id=chunks_fts.rowid
          JOIN documents d ON d.id=c.document_id
          WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?
        `).all(query, candidates);
      } catch {
        const safeQuery = fallbackFtsQuery();
        if (safeQuery) ftsRows = db.prepare(`
          SELECT c.id AS chunk_id,d.file_path,d.title,c.heading,c.content,bm25(chunks_fts) AS rank
          FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.document_id
          WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?
        `).all(safeQuery, candidates);
      }
      if (ftsRows.length === 0) {
        const safeQuery = fallbackFtsQuery();
        if (safeQuery && safeQuery !== query) ftsRows = db.prepare(`
          SELECT c.id AS chunk_id,d.file_path,d.title,c.heading,c.content,bm25(chunks_fts) AS rank
          FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.document_id
          WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?
        `).all(safeQuery, candidates);
      }
      const [queryVector] = await this.embeddingProvider.embed([query], "query");
      const vectorRows = db.prepare(`
        SELECT c.id AS chunk_id,d.file_path,d.title,c.heading,c.content,v.distance
        FROM chunk_vectors v JOIN chunks c ON c.id=v.rowid JOIN documents d ON d.id=c.document_id
        WHERE v.embedding MATCH ? AND k=? ORDER BY v.distance
      `).all(queryVector, BigInt(candidates));
      const titleTerms = query.split(/\s+/u).map(normalizeSearchTerm).filter((term) => term.length >= 2);
      const titleRows = titleTerms.length === 0 ? [] : db.prepare(`
        SELECT c.id AS chunk_id,d.file_path,d.title,c.heading,c.content
        FROM documents d JOIN chunks c ON c.document_id=d.id
        WHERE ${titleTerms.map(() => "lower(d.title) LIKE ?").join(" OR ")}
        GROUP BY d.id ORDER BY d.title LIMIT ?
      `).all(...titleTerms.map((term) => `%${term}%`), candidates);
      return rrfMerge(ftsRows, vectorRows, titleRows, limit, query).map((row) => ({
        filePath: row.file_path,
        title: row.title,
        heading: row.heading,
        preview: row.content.replace(/\s+/gu, " ").slice(0, 280),
        sources: row.sources,
        score: row.score,
      }));
    } finally {
      db.close();
    }
  }
}
