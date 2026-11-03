// RAG Tauri commands.
//
// - rag_index_status: 인덱스 존재/완료/차원/문서수/청크수/빌드시각 (읽기 전용, Gemini 호출 없음).
// - rag_search: 쿼리 임베딩(Gemini) + 하이브리드 검색 (FTS5 + sqlite-vec + 제목).
//
// 둘 다 등록된 vault 경계 안의 {vault}/.ticksidian/rag.sqlite만 대상으로 한다.
// API 키는 Rust 프로세스 env에서만 읽는다 — 프론트로 전달하지 않는다.

use std::path::PathBuf;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::commands::vault_guard::ensure_path_in_registered_vault;
use crate::RegisteredVaults;

use super::embedding::{bytes_to_vector, embed_query, vector_to_bytes};
use super::error::RagError;
use super::searcher::RagSearcher;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexStatus {
    pub exists: bool,
    pub index_complete: bool,
    pub embedding_model: Option<String>,
    pub embedding_dimensions: Option<usize>,
    pub document_count: Option<u64>,
    pub chunk_count: Option<u64>,
    pub built_at: Option<String>,
}

fn read_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM index_meta WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

/// {vault}/.ticksidian/rag.sqlite 경로를 검증한다 (vault 경계 안).
fn rag_db_path(vault_path: &str) -> Result<PathBuf, RagError> {
    let path = PathBuf::from(vault_path)
        .join(".ticksidian")
        .join("rag.sqlite");
    Ok(path)
}

#[tauri::command]
pub fn rag_index_status(
    vault_path: String,
    vaults: State<'_, RegisteredVaults>,
) -> Result<RagIndexStatus, RagError> {
    // vault 경계 검증 (등록된 볼트 안 경로만)
    let _ = ensure_path_in_registered_vault(&vaults, std::path::Path::new(&vault_path))?;
    let db_path = rag_db_path(&vault_path)?;
    if !db_path.exists() {
        return Ok(RagIndexStatus {
            exists: false,
            index_complete: false,
            embedding_model: None,
            embedding_dimensions: None,
            document_count: None,
            chunk_count: None,
            built_at: None,
        });
    }
    let conn = Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let index_complete = read_meta(&conn, "index_complete").as_deref() == Some("1");
    let embedding_model = read_meta(&conn, "embedding_model");
    let embedding_dimensions =
        read_meta(&conn, "embedding_dimensions").and_then(|v| v.parse::<usize>().ok());
    let document_count = read_meta(&conn, "document_count").and_then(|v| v.parse::<u64>().ok());
    let chunk_count = read_meta(&conn, "chunk_count").and_then(|v| v.parse::<u64>().ok());
    let built_at = read_meta(&conn, "built_at");
    drop(conn);
    Ok(RagIndexStatus {
        exists: true,
        index_complete,
        embedding_model,
        embedding_dimensions,
        document_count,
        chunk_count,
        built_at,
    })
}

#[tauri::command]
pub async fn rag_search(
    vault_path: String,
    query: String,
    limit: Option<usize>,
    vaults: State<'_, RegisteredVaults>,
    secrets: State<'_, crate::SecretsViewerState>,
) -> Result<Vec<crate::rag::searcher::RagSearchHit>, RagError> {
    let _ = ensure_path_in_registered_vault(&vaults, std::path::Path::new(&vault_path))?;
    let db_path = rag_db_path(&vault_path)?;
    let limit = limit.unwrap_or(10).clamp(1, 50);
    let trimmed = query.trim().to_string();
    if trimmed.is_empty() {
        return Err(RagError::EmptyQuery);
    }

    // DB 차원을 읽어 쿼리 임베딩 차원 결정
    let conn = Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let dims: Option<i64> = read_meta(&conn, "embedding_dimensions").and_then(|v| v.parse().ok());
    drop(conn);
    let dims = dims.ok_or(RagError::IncompleteIndex)? as usize;

    // API 키: env 우선, 없으면 사용자가 고른 비밀 폴더 안 Gemini 키 파일(기본 gemini.env)
    let api_key = crate::commands::secrets_viewer::resolve_gemini_api_key(&secrets, &vaults);
    let query_vector = embed_query(&api_key, &trimmed, dims).await?;
    let vector_bytes = vector_to_bytes(&query_vector);

    let searcher = RagSearcher::new(db_path);
    searcher.search(&trimmed, &vector_bytes, limit)
}

/// 쿼리 임베딩 결과를 검증용으로 변환 (테스트에서 사용).
#[allow(dead_code)]
fn _query_vector_debug(values: &[f32]) -> Vec<f32> {
    bytes_to_vector(&vector_to_bytes(values))
}

/// 검토 큐 항목 AI 분류 (TICK-P0-007 3차). gemini-3.8-flash.
/// 볼트 IO가 없어 vault 검증은 하지 않고, 입력 길이만 가드한다.
/// API 키는 env 우선, 없으면 비밀 폴더에서 읽는다(secrets_viewer::resolve_gemini_api_key).
#[tauri::command]
pub async fn classify_review_item(
    title: String,
    content: String,
    secrets: State<'_, crate::SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> Result<crate::rag::classifier::ReviewClassification, RagError> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(RagError::Classification(
            "제목이 비어 있습니다.".to_string(),
        ));
    }
    let content = content.trim().to_string();
    if content.chars().count() > 8_000 {
        return Err(RagError::Classification(
            "항목 내용이 너무 깁니다 (최대 8,000자).".to_string(),
        ));
    }
    let api_key = crate::commands::secrets_viewer::resolve_gemini_api_key(&secrets, &vaults);
    crate::rag::classifier::classify_review_item_api(&api_key, &title, &content).await
}
