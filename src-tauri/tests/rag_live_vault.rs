// 실제 볼트 RAG DB로 검색 검증 (Tauri 런타임과 같은 코드 경로).
//
// 이 테스트는 TICKSIDIAN_LIVE_VAULT(볼트 루트 경로)와 GEMINI_API_KEY가 있을 때만 동작한다.
// 없으면 SKIP으로 통과 처리한다 — CI/개발 환경에서 실패하지 않도록.
// 실제 Tauri 창 UI 클릭 검증은 TICK-P0-001 게이트(수동)에서 수행한다.

use ticksidian_desktop_lib::rag::embedding::{embed_query, normalize_l2, vector_to_bytes};
use ticksidian_desktop_lib::rag::searcher::RagSearcher;

#[test]
fn live_vault_rag_search_works() {
    let Ok(vault_root) = std::env::var("TICKSIDIAN_LIVE_VAULT") else {
        eprintln!("SKIP: TICKSIDIAN_LIVE_VAULT 환경변수 없음");
        return;
    };
    let db_path_buf = std::path::Path::new(&vault_root).join(".ticksidian/rag.sqlite");
    let db_path = db_path_buf.to_string_lossy().into_owned();
    let db_path = db_path.as_str();
    if !db_path_buf.exists() {
        eprintln!("SKIP: 실제 볼트 RAG DB 없음 ({db_path})");
        return;
    }
    let api_key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        eprintln!("SKIP: GEMINI_API_KEY 환경변수 없음");
        return;
    }

    // DB 차원 읽기 (차원 게이트 확인)
    let conn =
        rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open rag db");
    let db_dims: usize = conn
        .query_row(
            "SELECT value FROM index_meta WHERE key='embedding_dimensions'",
            [],
            |r| r.get::<_, String>(0),
        )
        .expect("read dimensions")
        .parse()
        .expect("parse dimensions");
    drop(conn);
    eprintln!("DB dimensions: {db_dims}");

    // Gemini 쿼리 임베딩 (네트워크 필요)
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    let vector = rt
        .block_on(embed_query(&api_key, "KC 인증 자동화 아이디어", db_dims))
        .expect("query embedding");
    let bytes = vector_to_bytes(&normalize_l2(&vector));

    // 하이브리드 검색 (FTS5 + sqlite-vec + 제목)
    let searcher = RagSearcher::new(db_path);
    let hits = searcher
        .search("KC 인증 자동화 아이디어", &bytes, 10)
        .expect("search");
    eprintln!("hits: {}", hits.len());
    for hit in hits.iter().take(3) {
        eprintln!("  - {} ({})", hit.title, hit.file_path);
    }
    assert!(!hits.is_empty(), "실제 볼트 검색 결과가 비어 있으면 안 됨");
    assert!(
        hits.iter().all(|h| !h.file_path.is_empty()),
        "모든 결과에 file_path가 있어야 함"
    );
}
