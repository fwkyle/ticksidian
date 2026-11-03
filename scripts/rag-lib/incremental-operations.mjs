// RAG 인덱스 갱신 연산 — 문서/청크/FTS 트랜잭션과 벡터 복사/임베딩.
// RagIndexBuilder의 메서드에서 추출한 모듈 함수들(2026-08-15 리팩토링).
// 상태는 인자로만 받는다(db, embeddingProvider 주입).

import { embeddingInputText, sha256 } from "./text.mjs";

const VECTOR_BATCH_SIZE = 4;

/**
 * 증분 단계 3) 문서/청크/FTS 갱신 — 단일 트랜잭션.
 * chunks_fts는 external content FTS5(content=chunks_search_content)라
 * content 행 삭제 + FTS 'delete' 명령 둘 다 필요하다. 'delete' 명령의 값은
 * 인덱스에 저장된 값과 정확히 일치해야 하므로 content 테이블에서 읽는다.
 * 같은 content_hash 청크는 벡터 재사용 대상으로 copiedChunks에 남긴다.
 */
export function applyDocumentChanges(db, plan) {
  const { records, removedPaths, reusableByHash } = plan;
  const deleteFtsByDoc = db.prepare(`
    INSERT INTO chunks_fts(chunks_fts, rowid, title, heading, content, tags)
    SELECT 'delete', sc.chunk_id, sc.title, sc.heading, sc.content, sc.tags
    FROM chunks_search_content sc
    JOIN chunks c ON c.id = sc.chunk_id
    WHERE c.document_id = ?
  `);
  const deleteFtsByPath = db.prepare(`
    INSERT INTO chunks_fts(chunks_fts, rowid, title, heading, content, tags)
    SELECT 'delete', sc.chunk_id, sc.title, sc.heading, sc.content, sc.tags
    FROM chunks_search_content sc
    JOIN chunks c ON c.id = sc.chunk_id
    JOIN documents d ON d.id = c.document_id
    WHERE d.file_path = ?
  `);
  const deleteSearchContentByDoc = db.prepare(`
    DELETE FROM chunks_search_content WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)
  `);
  const deleteSearchContentByPath = db.prepare(`
    DELETE FROM chunks_search_content WHERE chunk_id IN (
      SELECT c.id FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.file_path = ?
    )
  `);
  const deleteChunksByDoc = db.prepare("DELETE FROM chunks WHERE document_id = ?");
  const deleteVectorsByDoc = db.prepare("DELETE FROM chunk_vectors WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)");
  const deleteVectorsByPath = db.prepare("DELETE FROM chunk_vectors WHERE rowid IN (SELECT c.id FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.file_path = ?)");
  const deleteDoc = db.prepare("DELETE FROM documents WHERE file_path = ?");
  const insertDoc = db.prepare(`INSERT INTO documents(file_path,note_id,title,tags_json,file_hash,modified_at_ms)
    VALUES(?,?,?,?,?,?)`);
  const updateDoc = db.prepare(`UPDATE documents SET note_id=?,title=?,tags_json=?,file_hash=?,modified_at_ms=? WHERE file_path=?`);
  const insertChunk = db.prepare("INSERT INTO chunks(id,document_id,chunk_index,heading,content,content_hash) VALUES(?,?,?,?,?,?)");
  const insertSearchContent = db.prepare("INSERT INTO chunks_search_content(chunk_id,title,heading,content,tags) VALUES(?,?,?,?,?)");
  const insertFts = db.prepare("INSERT INTO chunks_fts(rowid,title,heading,content,tags) VALUES(?,?,?,?,?)");
  const maxChunkId = Number(db.prepare("SELECT COALESCE(MAX(id),0) AS max_id FROM chunks").get().max_id);
  let chunkCursor = maxChunkId;
  const newChunks = []; // { chunkId, title, heading, content } — 벡터 임베딩 대상
  const copiedChunks = []; // { chunkId, sourceChunkId } — 벡터 복사 대상
  let reusedEmbeddings = 0;

  db.exec("BEGIN");
  try {
    let maxDocumentId = Number(db.prepare("SELECT COALESCE(MAX(id),0) AS max_id FROM documents").get().max_id);
    for (const record of records) {
      const isNew = record.documentId === null;
      const documentId = isNew ? maxDocumentId + 1 : Number(record.documentId);
      if (isNew) {
        maxDocumentId = documentId;
        insertDoc.run(record.relativePath, record.noteId, record.title, JSON.stringify(record.tags), sha256(record.markdown), BigInt(Math.trunc(record.stats.mtimeMs)));
      } else {
        updateDoc.run(record.noteId, record.title, JSON.stringify(record.tags), sha256(record.markdown), BigInt(Math.trunc(record.stats.mtimeMs)), record.relativePath);
        // 기존 청크 삭제: FTS 인덱스 'delete' + content 행 + 벡터(명시) + 청크 행
        deleteFtsByDoc.run(BigInt(documentId));
        deleteSearchContentByDoc.run(BigInt(documentId));
        deleteVectorsByDoc.run(BigInt(documentId));
        deleteChunksByDoc.run(BigInt(documentId));
      }
      for (let index = 0; index < record.parsed.chunks.length; index += 1) {
        const chunk = record.parsed.chunks[index];
        const contentHash = sha256(embeddingInputText(record.title, chunk.heading, chunk.content));
        const sourceChunkId = reusableByHash.get(contentHash);
        if (sourceChunkId !== undefined) {
          // 같은 내용 청크의 벡터를 재사용 — 새 청크 행을 만들고 벡터는 복사
          chunkCursor += 1;
          insertChunk.run(BigInt(chunkCursor), BigInt(documentId), index, chunk.heading, chunk.content, contentHash);
          insertSearchContent.run(BigInt(chunkCursor), record.title, chunk.heading, chunk.content, record.tags.join(" "));
          insertFts.run(BigInt(chunkCursor), record.title, chunk.heading, chunk.content, record.tags.join(" "));
          copiedChunks.push({ chunkId: chunkCursor, sourceChunkId });
          reusedEmbeddings += 1;
          continue;
        }
        chunkCursor += 1;
        newChunks.push({ chunkId: chunkCursor, title: record.title, heading: chunk.heading, content: chunk.content });
        insertChunk.run(BigInt(chunkCursor), BigInt(documentId), index, chunk.heading, chunk.content, contentHash);
        insertSearchContent.run(BigInt(chunkCursor), record.title, chunk.heading, chunk.content, record.tags.join(" "));
        insertFts.run(BigInt(chunkCursor), record.title, chunk.heading, chunk.content, record.tags.join(" "));
      }
    }
    // 삭제된 파일 정리 (문서 행 삭제 → FK CASCADE로 청크 삭제, FTS/content/벡터는 명시적으로 먼저 삭제)
    for (const path of removedPaths) {
      deleteFtsByPath.run(path);
      deleteSearchContentByPath.run(path);
      deleteVectorsByPath.run(path);
      deleteDoc.run(path);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { newChunks, copiedChunks, reusedEmbeddings };
}

/**
 * 증분 단계 4) 재사용 청크 벡터 복사 + 새 청크 벡터 임베딩 — 배치당 커밋(build 패턴).
 * 변경 문서의 기존 청크(삭제됨)는 미리 로드한 벡터(reusableById)를,
 * 다른 문서의 청크는 DB에서 조회한다. 새로 발급한 임베딩 수를 반환.
 */
export async function copyAndEmbedVectors(db, embeddingProvider, newChunks, copiedChunks, reusableById) {
  let newEmbeddings = 0;
  const vectorInsert = db.prepare("INSERT INTO chunk_vectors(rowid,embedding) VALUES(?,?)");
  const vectorLookup = db.prepare("SELECT embedding FROM chunk_vectors WHERE rowid = ?");
  for (const copied of copiedChunks) {
    const source = reusableById.get(copied.sourceChunkId)
      ?? vectorLookup.get(BigInt(copied.sourceChunkId))?.embedding;
    if (!source) {
      throw new Error(`RAG 증분: 재사용할 청크 벡터를 찾지 못했습니다 (chunk ${copied.sourceChunkId})`);
    }
    db.exec("BEGIN");
    try {
      vectorInsert.run(BigInt(copied.chunkId), source);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  newEmbeddings += await embedAndInsertVectors(db, embeddingProvider, newChunks);
  return newEmbeddings;
}

/** 청크 목록을 배치 임베딩해 벡터를 삽입한다(build/incremental 공통). 발급 수 반환. */
export async function embedAndInsertVectors(db, embeddingProvider, chunks) {
  const vectorInsert = db.prepare("INSERT INTO chunk_vectors(rowid,embedding) VALUES(?,?)");
  let inserted = 0;
  for (let offset = 0; offset < chunks.length; offset += VECTOR_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + VECTOR_BATCH_SIZE);
    const vectors = await embeddingProvider.embed(
      batch.map((row) => embeddingInputText(row.title, row.heading, row.content)),
      "passage",
      VECTOR_BATCH_SIZE,
    );
    db.exec("BEGIN");
    try {
      for (let index = 0; index < batch.length; index += 1) {
        vectorInsert.run(BigInt(batch[index].chunkId), vectors[index]);
        inserted += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return inserted;
}
