// RAG DB 하부 — sqlite-vec 연결/스키마/메타/원자 교체.
// 원래 scripts/rag-index-lib.mjs(898줄)의 DB 책임 분리(2026-08-15 리팩토링).

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as sqliteVec from "sqlite-vec";

export const SCHEMA_VERSION = 1;

export function openVectorDatabase(path, { readOnly = false } = {}) {
  const db = new DatabaseSync(path, { allowExtension: true, readBigInts: true, readOnly });
  db.loadExtension(sqliteVec.getLoadablePath());
  if (readOnly) {
    db.exec("PRAGMA query_only=ON;");
  } else {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  }
  return db;
}

export function createSchema(db, dimensions) {
  db.exec(`
    CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      note_id TEXT NOT NULL,
      title TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      modified_at_ms INTEGER NOT NULL
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      UNIQUE(document_id, chunk_index)
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      title, heading, content, tags,
      content='chunks_search_content', content_rowid='chunk_id',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TABLE chunks_search_content (
      chunk_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE chunk_vectors USING vec0(embedding float[${dimensions}]);
  `);
}

export function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO index_meta(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, String(value));
}

/**
 * 원본 DB를 임시 후보 DB로 원자 교체하되, 교체 도중 실패하면 원본을 원래 자리로 복원한다.
 *
 * 순서:
 * 1) 원본(targetPath)이 있으면 {vault}/.staging/<prefix>-<stamp>.sqlite 로 옮긴다(백업).
 * 2) 임시(tempPath) -> targetPath 로 옮긴다(성공).
 * 3) 단계 2가 실패하면 백업을 targetPath 로 다시 옮겨 원본을 복원하고 원래 에러를 다시 던진다.
 *    복원마저 실패하면 백업 경로를 에러 메시지에 남기고 원래 에러를 우선 전파한다.
 *
 * 어떤 경로에서든 targetPath 자리가 비는 일이 없게 한다(rm 금지 규칙 유지).
 * rename 동작은 { rename } 옵션으로 주입 가능해 결함 주입 회귀가 결정적이다.
 * 성공 시 교체된 구 원본 백업 경로를, 원본이 없었으면 null 을 반환한다.
 */
export function replaceDatabaseFailureSafe(tempPath, targetPath, vaultPath, prefix, { rename = renameSync } = {}) {
  let backupPath = null;
  if (existsSync(targetPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    backupPath = resolve(vaultPath, ".staging", `${prefix}-${stamp}.sqlite`);
    mkdirSync(dirname(backupPath), { recursive: true });
    rename(targetPath, backupPath);
  }
  try {
    rename(tempPath, targetPath);
  } catch (error) {
    if (backupPath !== null) {
      try {
        rename(backupPath, targetPath);
      } catch (restoreError) {
        const wrapped = new Error(
          "RAG DB 원자 교체 실패 후 복원도 실패. 원본 백업 위치: " + backupPath
          + " (교체 에러: " + (error && error.message) + "; 복원 에러: " + (restoreError && restoreError.message) + ")",
        );
        wrapped.cause = error;
        throw wrapped;
      }
    }
    throw error;
  }
  return backupPath;
}

/**
 * 증분 임시 DB를 .staging으로 옮긴다. 임시 DB는 파생 캐시라 원본과 무관하다.
 * 이동에 실패해도 원본 보존이 본질이므로 예외는 삼킨다(임시 파일이 남으면 다음 증분이 거부).
 */
export function discardIncrementalTemp(tempPath, vaultPath) {
  try {
    if (!existsSync(tempPath)) return;
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const dest = resolve(vaultPath, ".staging", `rag-incremental-failed-${stamp}.sqlite`);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(tempPath, dest);
  } catch {
    // 원본 보존이 본질. 이동 실패 시 임시 파일이 남아 다음 증분을 거부하게 둔다.
  }
}
