// RAG 인덱스 빌더 — 전체 빌드(build)와 증분 색인(incremental).
// 원래 scripts/rag-index-lib.mjs(898줄)의 빌더 책임 분리(2026-08-15 리팩토링).
// incremental은 probe → 임시 복사본 갱신 → 원자 교체 단계로 나눈다.
//
// 계약 (docs/waterfall/03-상세설계/Markdown-FTS5-sqlite-vec-RAG-설계.md §4):
// - 파일 해시가 바뀌면 해당 문서의 청크만 교체한다.
// - 삭제된 파일의 문서·FTS·벡터 행은 제거한다.
// - 같은 content_hash(=임베딩 입력 해시) + embedding_model이면 임베딩을 재사용한다.
// - 실패 시 기존 정상 DB를 한 글자도 수정하지 않는다(원본 보존).
// - 변경 대상이 전체의 30%를 넘으면 full rebuild로 안내한다.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { collectVaultRecords, embeddingInputText, sha256, walkMarkdown } from "./text.mjs";
import { GeminiEmbeddingProvider } from "./embedding-provider.mjs";
import {
  SCHEMA_VERSION,
  createSchema,
  discardIncrementalTemp,
  openVectorDatabase,
  replaceDatabaseFailureSafe,
  setMeta,
} from "./db.mjs";
import { applyDocumentChanges, copyAndEmbedVectors, embedAndInsertVectors } from "./incremental-operations.mjs";

export class RagIndexBuilder {
  constructor({ vaultPath, databasePath = null, embeddingProvider = new GeminiEmbeddingProvider() }) {
    this.vaultPath = resolve(vaultPath);
    this.databasePath = resolve(databasePath ?? resolve(this.vaultPath, ".ticksidian", "rag.sqlite"));
    this.embeddingProvider = embeddingProvider;
  }

  async build() {
    if (!existsSync(this.vaultPath)) throw new Error(`볼트를 찾지 못했습니다: ${this.vaultPath}`);
    if (!isAbsolute(this.databasePath)) throw new Error("RAG DB 경로는 절대경로여야 합니다.");
    mkdirSync(dirname(this.databasePath), { recursive: true });
    const temporaryPath = `${this.databasePath}.building-${process.pid}`;
    if (existsSync(temporaryPath)) throw new Error(`기존 임시 DB를 덮어쓰지 않습니다: ${temporaryPath}`);

    const { records, skippedSensitiveFiles, skippedOversizedFiles } =
      collectVaultRecords(walkMarkdown(this.vaultPath));
    const expectedChunkCount = records.reduce((sum, record) => sum + record.parsed.chunks.length, 0);

    const db = openVectorDatabase(temporaryPath);
    try {
      createSchema(db, this.embeddingProvider.dimensions);
      setMeta(db, "schema_version", SCHEMA_VERSION);
      setMeta(db, "embedding_model", this.embeddingProvider.model ?? "fixture");
      setMeta(db, "embedding_dimensions", this.embeddingProvider.dimensions);
      setMeta(db, "sqlite_vec_version", db.prepare("SELECT vec_version() AS version").get().version);
      setMeta(db, "index_complete", 0);
      setMeta(db, "skipped_sensitive_count", skippedSensitiveFiles.length);
      setMeta(db, "skipped_oversized_count", skippedOversizedFiles.length);
      db.exec("BEGIN");
      try {
        let chunkCursor = 0;
        for (let documentIndex = 0; documentIndex < records.length; documentIndex += 1) {
          const record = records[documentIndex];
          const documentId = BigInt(documentIndex + 1);
          db.prepare(`INSERT INTO documents(id,file_path,note_id,title,tags_json,file_hash,modified_at_ms)
            VALUES(?,?,?,?,?,?,?)`).run(
            documentId, record.relativePath, record.noteId, record.title, JSON.stringify(record.tags),
            sha256(record.markdown), BigInt(Math.trunc(record.stats.mtimeMs)),
          );
          for (let index = 0; index < record.parsed.chunks.length; index += 1) {
            const chunk = record.parsed.chunks[index];
            const chunkId = BigInt(chunkCursor + 1);
            db.prepare("INSERT INTO chunks(id,document_id,chunk_index,heading,content,content_hash) VALUES(?,?,?,?,?,?)")
              .run(chunkId, documentId, index, chunk.heading, chunk.content, sha256(embeddingInputText(record.title, chunk.heading, chunk.content)));
            db.prepare("INSERT INTO chunks_search_content(chunk_id,title,heading,content,tags) VALUES(?,?,?,?,?)")
              .run(chunkId, record.title, chunk.heading, chunk.content, record.tags.join(" "));
            db.prepare("INSERT INTO chunks_fts(rowid,title,heading,content,tags) VALUES(?,?,?,?,?)")
              .run(chunkId, record.title, chunk.heading, chunk.content, record.tags.join(" "));
            chunkCursor += 1;
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      await embedAndInsertVectors(
        db,
        this.embeddingProvider,
        db.prepare(`
          SELECT c.id AS chunk_id,d.title,c.heading,c.content
          FROM chunks c JOIN documents d ON d.id=c.document_id
          ORDER BY c.id
        `).all().map((row) => ({ chunkId: Number(row.chunk_id), ...row })),
      );
      const counts = this.#verifyCounts(db, records.length, expectedChunkCount);
      setMeta(db, "document_count", counts.documents);
      setMeta(db, "chunk_count", counts.chunks);
      setMeta(db, "built_at", new Date().toISOString());
      setMeta(db, "index_complete", 1);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();

      // 원자 교체: 원본을 .staging으로 백업한 뒤 임시 DB를 원본 자리로 옮긴다.
      // 교체 도중 실패하면 헬퍼가 백업을 원본 자리로 복원한다(원본 자리가 비는 일 방지).
      replaceDatabaseFailureSafe(temporaryPath, this.databasePath, this.vaultPath, "rag");
      return { databasePath: this.databasePath, skippedSensitiveFiles, skippedOversizedFiles, ...counts };
    } catch (error) {
      try { db.close(); } catch {}
      throw error;
    }
  }

  /**
   * 증분 인덱싱 — 변경/추가/삭제된 Markdown 파일만 다시 색인한다.
   * 흐름: (1) 읽기 전용 probe 계획 → (2) 원본을 임시 복사본으로 복제 →
   * (3) 문서/청크/FTS 갱신 → (4) 벡터 복사/임베딩 → (5) 검증/영수증 → (6) 원자 교체.
   * 어떤 단계에서 실패해도 원본 DB는 한 글자도 수정되지 않는다.
   */
  async incremental() {
    if (!existsSync(this.vaultPath)) throw new Error(`볼트를 찾지 못했습니다: ${this.vaultPath}`);
    if (!isAbsolute(this.databasePath)) throw new Error("RAG DB 경로는 절대경로여야 합니다.");
    if (!existsSync(this.databasePath)) {
      throw new Error("기존 RAG DB가 없습니다. 전체 빌드(rag:build)를 먼저 실행하세요.");
    }

    const plan = await this.#probeIncrementalPlan();
    if (plan.noChanges) return plan.unchangedResult;

    // 2) 변경이 확정됐으니 원본을 임시 복사본으로 복제. 이후 갱신/임베딩은 임시 DB에서만.
    //    실패 시 임시 DB를 .staging으로 옮기고 원본은 그대로 둔다(rm 금지 규칙).
    const temporaryPath = `${this.databasePath}.incremental-${process.pid}`;
    if (existsSync(temporaryPath)) throw new Error(`기존 증분 임시 DB를 덮어쓰지 않습니다: ${temporaryPath}`);
    copyFileSync(this.databasePath, temporaryPath);
    const db = openVectorDatabase(temporaryPath);
    try {
      // 임시 복사본도 완료 영수증을 재확인한다(복사 직후 원본과 동일해야 한다).
      const completeCopy = db.prepare("SELECT value FROM index_meta WHERE key='index_complete'").get()?.value;
      if (completeCopy !== "1") {
        throw new Error("임시 복사된 RAG DB가 완료 상태가 아닙니다. 전체 빌드(rag:build)로 다시 만드세요.");
      }
      const { newChunks, copiedChunks, reusedEmbeddings } = applyDocumentChanges(db, plan);
      const newEmbeddings = await copyAndEmbedVectors(
        db, this.embeddingProvider, newChunks, copiedChunks, plan.reusableById,
      );

      // 5) 개수 검증 + 완료 영수증
      const counts = this.#verifyCounts(db, null, null);
      setMeta(db, "document_count", counts.documents);
      setMeta(db, "chunk_count", counts.chunks);
      setMeta(db, "built_at", new Date().toISOString());
      setMeta(db, "index_complete", 1);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();

      // 6) 원자 교체: 두 번째 rename이 실패하면 백업이 원본 자리로 복원된다.
      replaceDatabaseFailureSafe(temporaryPath, this.databasePath, this.vaultPath, "rag-incremental");
      return {
        databasePath: this.databasePath,
        changed: plan.records.filter((r) => r.documentId !== null).length,
        added: plan.records.filter((r) => r.documentId === null).length,
        removed: plan.removedPaths.length,
        unchanged: plan.filesCount - plan.records.length,
        reusedEmbeddings,
        newEmbeddings,
        documents: counts.documents,
        chunks: counts.chunks,
        skippedSensitiveFiles: plan.skippedSensitiveFiles,
        skippedOversizedFiles: plan.skippedOversizedFiles,
        oldChunkCount: plan.oldChunkCount,
      };
    } catch (error) {
      try { db.close(); } catch {}
      // 원본은 수정한 적이 없다. 임시 DB만 .staging으로 옮긴다(rm 금지 규칙).
      discardIncrementalTemp(temporaryPath, this.vaultPath);
      throw error;
    }
  }

  /**
   * 1) 읽기 전용 probe: 완료/차원/모델 검증, 파일 diff, 30% 가드, 재사용 후보 수집.
   *    원본은 한 글자도 수정하지 않는다(readOnly + query_only).
   *    변경이 없으면 { noChanges: true, unchangedResult }로 조기 반환 계획을 만든다.
   */
  async #probeIncrementalPlan() {
    const probe = openVectorDatabase(this.databasePath, { readOnly: true });
    try {
      const complete = probe.prepare("SELECT value FROM index_meta WHERE key='index_complete'").get()?.value;
      if (complete !== "1") {
        throw new Error("완료되지 않은 RAG DB입니다. 전체 빌드(rag:build)로 다시 만드세요.");
      }
      const dbDims = Number(probe.prepare("SELECT value FROM index_meta WHERE key='embedding_dimensions'").get()?.value);
      const dbModel = probe.prepare("SELECT value FROM index_meta WHERE key='embedding_model'").get()?.value;
      if (!Number.isInteger(dbDims) || dbDims !== this.embeddingProvider.dimensions) {
        throw new Error(`RAG DB 차원(${dbDims})과 임베딩 프로바이더 차원(${this.embeddingProvider.dimensions})이 다릅니다. 같은 프로바이더로 전체 빌드 후 증분하세요.`);
      }
      if (dbModel && this.embeddingProvider.model && dbModel !== this.embeddingProvider.model) {
        throw new Error(`RAG DB 모델(${dbModel})과 임베딩 프로바이더 모델(${this.embeddingProvider.model})이 다릅니다. 같은 프로바이더로 전체 빌드 후 증분하세요.`);
      }

      const files = walkMarkdown(this.vaultPath);
      const filesCount = files.length;
      const existing = new Map(
        probe.prepare("SELECT file_path, file_hash, id FROM documents").all()
          .map((row) => [row.file_path, { hash: row.file_hash, id: row.id }]),
      );
      const { records, skippedSensitiveFiles, skippedOversizedFiles, unchangedPaths } =
        collectVaultRecords(files, existing);
      // currentPaths = 민감/대형으로 제외되지 않은 현재 파일(unchanged 포함)
      const currentPaths = new Set([...unchangedPaths, ...records.map((r) => r.relativePath)]);
      const removedPaths = [...existing.keys()].filter((path) => !currentPaths.has(path));
      const changeCount = records.length + removedPaths.length;
      // 결함 수정: 분모는 기존 DB 경로와 현재 파일 경로의 합집합(같은 경로 이중 카운트 방지).
      const totalCount = new Set([...existing.keys(), ...files.map((f) => f.relativePath)]).size;
      if (changeCount === 0) {
        const counts = {
          documents: Number(probe.prepare("SELECT count(*) AS count FROM documents").get().count),
          chunks: Number(probe.prepare("SELECT count(*) AS count FROM chunks").get().count),
        };
        return {
          noChanges: true,
          unchangedResult: { databasePath: this.databasePath, changed: 0, added: 0, removed: 0, unchanged: filesCount, reusedEmbeddings: 0, newEmbeddings: 0, ...counts },
        };
      }
      // 변경 비율이 크면 증분 이득이 없으므로 full rebuild 안내 (원본 미수정, 임시 DB 미생성)
      if (changeCount / Math.max(1, totalCount) > 0.3) {
        throw new Error(`변경 파일이 전체의 30%를 초과합니다 (${changeCount}/${totalCount}). '--force'로 전체 빌드(rag:build)를 실행하세요.`);
      }

      // 1-b) 재사용 후보 수집. content_hash는 이제 임베딩 입력(title+heading+content) 해시다.
      //    그래야 제목/헤딩만 바뀐 경우 벡터가 새로 발급된다(과거 content-only 해시 회귀 방지).
      const oldChunkCount = Number(probe.prepare("SELECT count(*) AS count FROM chunks").get().count);
      const reusableByHash = new Map(); // content_hash -> 기존 chunk_id (모든 기존 청크)
      for (const row of probe.prepare("SELECT content_hash, id AS chunk_id FROM chunks").all()) {
        if (!reusableByHash.has(row.content_hash)) reusableByHash.set(row.content_hash, row.chunk_id);
      }
      // 변경/삭제 문서의 기존 청크 벡터는 단계3에서 삭제되므로 미리 메모리에 로드한다.
      // (probe를 닫아도 메모리 벡터는 살아 있어 단계4 복사에 쓸 수 있다.)
      const changedDocIds = records.map((r) => r.documentId).filter((id) => id !== null);
      const removedDocIds = removedPaths
        .map((p) => existing.get(p)?.id)
        .filter((id) => id !== undefined && id !== null);
      const preloadDocIds = [...new Set(
        [...changedDocIds.map((id) => Number(id)), ...removedDocIds.map((id) => Number(id))],
      )];
      const reusableById = new Map(); // 기존 chunk_id -> Float32Array (삭제 전 벡터)
      if (preloadDocIds.length > 0) {
        const placeholders = preloadDocIds.map(() => "?").join(",");
        const rows = probe.prepare(
          `SELECT c.id AS chunk_id FROM chunks c WHERE c.document_id IN (${placeholders})`,
        ).all(...preloadDocIds);
        for (const row of rows) {
          const vec = probe.prepare("SELECT embedding FROM chunk_vectors WHERE rowid = ?").get(BigInt(row.chunk_id));
          if (vec?.embedding) reusableById.set(row.chunk_id, vec.embedding);
        }
      }
      return {
        noChanges: false,
        records,
        removedPaths,
        reusableByHash,
        reusableById,
        skippedSensitiveFiles,
        skippedOversizedFiles,
        oldChunkCount,
        filesCount,
      };
    } finally {
      try { probe.close(); } catch {}
    }
  }

  /**
   * 개수 검증. build는 기대 문서/청크 수와 정확 비교, incremental은 fts/vectors 가 chunks 와
   * 일치하는지만 본다(expected가 null이면 완화 검증).
   */
  #verifyCounts(db, expectedDocuments, expectedChunks) {
    const counts = {
      documents: Number(db.prepare("SELECT count(*) AS count FROM documents").get().count),
      chunks: Number(db.prepare("SELECT count(*) AS count FROM chunks").get().count),
      fts: Number(db.prepare("SELECT count(*) AS count FROM chunks_fts").get().count),
      vectors: Number(db.prepare("SELECT count(*) AS count FROM chunk_vectors").get().count),
    };
    if (expectedDocuments !== null && expectedChunks !== null) {
      if (counts.documents !== expectedDocuments || counts.chunks !== expectedChunks
        || counts.fts !== expectedChunks || counts.vectors !== expectedChunks) {
        throw new Error(`RAG 인덱스 개수 검증 실패: ${JSON.stringify(counts)}`);
      }
    } else if (counts.fts !== counts.chunks || counts.vectors !== counts.chunks) {
      throw new Error(`RAG 증분 개수 검증 실패: ${JSON.stringify(counts)}`);
    }
    return counts;
  }
}
