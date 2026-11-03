// RAG 검색 모듈 — Node scripts/rag-index-lib.mjs 검색부의 Rust 이식.
//
// - searcher: FTS5 + sqlite-vec + 제목 하이브리드 검색 (RRF 병합, 차원 게이트).
// - embedding: Gemini 쿼리 임베딩 (Rust에서 API 직접 호출).
// - gemini_http: Gemini 엔드포인트 조립 + 오류 문자열 정리(키 노출 차단, 2026-08-16).
// - classifier: 검토 큐 항목 AI 분류 (gemini-3.8-flash, 2026-09-06 모델 변경).
// - commands: Tauri command (rag_index_status / rag_search / classify_review_item).
// - error: RagError.

pub mod classifier;
pub mod commands;
pub mod embedding;
pub mod error;
pub mod gemini_http;
pub mod inbox_folders;
pub mod searcher;

use std::sync::OnceLock;

/// sqlite-vec 확장을 프로세스당 1회 등록한다.
///
/// rusqlite bundled SQLite의 auto_extension으로 vec0 가상 테이블을 읽을 수 있게 한다.
/// Tauri run()에서도 호출되지만, 테스트/예제 등 run() 밖 경로에서도 동작하도록
/// searcher가 DB를 열기 전에 항상 보장한다.
pub fn ensure_sqlite_vec_registered() {
    static REGISTERED: OnceLock<()> = OnceLock::new();
    REGISTERED.get_or_init(|| unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    });
}
