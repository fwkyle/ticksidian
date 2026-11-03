// RAG 검색 — 순수 로직 (Tauri State 비의존, 단위 테스트 대상)
//
// scripts/rag-index-lib.mjs 의 RagSearcher/RRF 병합 로직을 Rust로 이식했다.
// - FTS5 정확 검색 + sqlite-vec KNN + 제목 LIKE 매칭을 RRF로 합친다.
// - 차원 게이트(fail-closed): DB embedding_dimensions ≠ 요청 차원이면 즉시 거부.
// - 검색은 readOnly + PRAGMA query_only=ON 으로 연다 (DB 해시 불변 계약).

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde::Serialize;

use super::error::RagError;

// ---------------------------------------------------------------------------
// 결과 타입
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchHit {
    pub file_path: String,
    pub title: String,
    pub heading: String,
    pub preview: String,
    pub sources: Vec<String>,
    pub score: f64,
}

// ---------------------------------------------------------------------------
// 한국어 조사 정규화 (scripts normalizeSearchTerm 이식)
// ---------------------------------------------------------------------------

const PARTICLE_SUFFIXES: &[&str] = &[
    "에서", "으로", "에게", "한테", "부터", "까지", "와", "과", "을", "를", "이", "가", "은", "는",
    "에", "의",
];

pub fn normalize_search_term(value: &str) -> String {
    let mut normalized = value.to_lowercase();
    for suffix in PARTICLE_SUFFIXES {
        if let Some(stripped) = normalized.strip_suffix(suffix) {
            normalized = stripped.to_string();
            break;
        }
    }
    // [^a-z0-9가-힣] 제거
    normalized
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || ('가'..='힣').contains(c))
        .collect::<String>()
        .trim()
        .to_string()
}

// ---------------------------------------------------------------------------
// RRF 병합 (scripts rrfMerge 이식)
// ---------------------------------------------------------------------------

struct MergeRow {
    chunk_id: i64,
    file_path: String,
    title: String,
    heading: String,
    content: String,
    score: f64,
    sources: Vec<String>,
}

const RRF_K: f64 = 60.0;

fn add_ranked(rows: Vec<MergeRow>, source: &str, scores: &mut HashMap<i64, MergeRow>) {
    for (index, row) in rows.into_iter().enumerate() {
        let entry = scores.entry(row.chunk_id).or_insert_with(|| MergeRow {
            chunk_id: row.chunk_id,
            file_path: row.file_path.clone(),
            title: row.title.clone(),
            heading: row.heading.clone(),
            content: row.content.clone(),
            score: 0.0,
            sources: Vec::new(),
        });
        entry.score += 1.0 / (RRF_K + index as f64 + 1.0);
        entry.sources.push(source.to_string());
    }
}

fn apply_title_bonus(query: &str, scores: &mut HashMap<i64, MergeRow>) {
    let normalized_query = normalize_search_term(query);
    let query_terms: Vec<String> = query
        .split_whitespace()
        .map(normalize_search_term)
        .filter(|t| t.len() >= 2)
        .collect();
    for row in scores.values_mut() {
        let title = normalize_search_term(&row.title);
        if !normalized_query.is_empty()
            && (normalized_query.contains(&title) || title.contains(&normalized_query))
        {
            row.score += 0.05;
        }
        let matched = query_terms.iter().filter(|t| title.contains(*t)).count();
        row.score += matched as f64 * 0.04;
    }
}

fn dedupe_by_document(rows: Vec<MergeRow>, limit: usize) -> Vec<MergeRow> {
    let mut ordered = rows;
    ordered.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for row in ordered {
        if seen.contains(&row.file_path) {
            continue;
        }
        seen.insert(row.file_path.clone());
        result.push(row);
        if result.len() >= limit {
            break;
        }
    }
    result
}

// ---------------------------------------------------------------------------
// 검색 실행
// ---------------------------------------------------------------------------

pub struct RagSearcher {
    database_path: std::path::PathBuf,
}

impl RagSearcher {
    pub fn new(database_path: impl Into<std::path::PathBuf>) -> Self {
        Self {
            database_path: database_path.into(),
        }
    }

    /// readOnly + query_only=ON 으로 RAG DB를 연다.
    fn open_readonly(&self) -> Result<Connection, RagError> {
        let db_path = self.database_path.as_path();
        if !db_path.exists() {
            return Err(RagError::MissingDatabase(db_path.display().to_string()));
        }
        // vec0 가상 테이블을 읽으려면 sqlite-vec 확장이 등록되어 있어야 한다.
        // (auto_extension은 DB open 시점에 적용되므로 open 전에 보장)
        super::ensure_sqlite_vec_registered();
        let conn = Connection::open_with_flags(
            db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.pragma_update(None, "query_only", "ON")?;
        Ok(conn)
    }

    /// index_complete=1 + embedding_dimensions 게이트 검사.
    fn validate_meta(&self, conn: &Connection, expected_dimensions: usize) -> Result<(), RagError> {
        let complete: Option<String> = conn
            .query_row(
                "SELECT value FROM index_meta WHERE key = 'index_complete'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if complete.as_deref() != Some("1") {
            return Err(RagError::IncompleteIndex);
        }
        // embedding_dimensions는 TEXT("768")로 저장되어 있다 — String으로 읽고 parse.
        let db_dims: Option<String> = conn
            .query_row(
                "SELECT value FROM index_meta WHERE key = 'embedding_dimensions'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let db_dims = db_dims
            .as_deref()
            .and_then(|v| v.parse::<usize>().ok())
            .ok_or(RagError::IncompleteIndex)?;
        if db_dims != expected_dimensions {
            return Err(RagError::DimensionMismatch {
                db: db_dims,
                expected: expected_dimensions,
            });
        }
        Ok(())
    }

    /// FTS5 MATCH — 실패 시 OR fallback (scripts fallbackFtsQuery 이식).
    fn fts_rows(
        &self,
        conn: &Connection,
        query: &str,
        candidates: i64,
    ) -> Result<Vec<MergeRow>, RagError> {
        let base_sql = r#"
            SELECT c.id AS chunk_id, d.file_path, d.title, c.heading, c.content
            FROM chunks_fts
            JOIN chunks c ON c.id = chunks_fts.rowid
            JOIN documents d ON d.id = c.document_id
            WHERE chunks_fts MATCH ?
            ORDER BY bm25(chunks_fts)
            LIMIT ?
        "#;
        // 1차: 원문 쿼리
        if let Ok(rows) = self.query_fts(conn, base_sql, query, candidates) {
            if !rows.is_empty() {
                return Ok(rows);
            }
        }
        // 2차: OR fallback
        let fallback = query
            .split_whitespace()
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" OR ");
        if fallback.is_empty() || fallback == query {
            return Ok(Vec::new());
        }
        Ok(self.query_fts(conn, base_sql, &fallback, candidates)?)
    }

    fn query_fts(
        &self,
        conn: &Connection,
        sql: &str,
        match_query: &str,
        candidates: i64,
    ) -> Result<Vec<MergeRow>, RagError> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([match_query, &candidates.to_string()], |row| {
            Ok(MergeRow {
                chunk_id: row.get(0)?,
                file_path: row.get(1)?,
                title: row.get(2)?,
                heading: row.get(3)?,
                content: row.get(4)?,
                score: 0.0,
                sources: Vec::new(),
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// sqlite-vec KNN — 쿼리 벡터(바이트)로 최근접 k개.
    fn vector_rows(
        &self,
        conn: &Connection,
        query_vector: &[u8],
        candidates: i64,
    ) -> Result<Vec<MergeRow>, RagError> {
        let sql = r#"
            SELECT c.id AS chunk_id, d.file_path, d.title, c.heading, c.content
            FROM chunk_vectors v
            JOIN chunks c ON c.id = v.rowid
            JOIN documents d ON d.id = c.document_id
            WHERE v.embedding MATCH ? AND k = ?
            ORDER BY v.distance
        "#;
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params![query_vector, candidates], |row| {
            Ok(MergeRow {
                chunk_id: row.get(0)?,
                file_path: row.get(1)?,
                title: row.get(2)?,
                heading: row.get(3)?,
                content: row.get(4)?,
                score: 0.0,
                sources: Vec::new(),
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// 제목 LIKE 매칭.
    fn title_rows(
        &self,
        conn: &Connection,
        query: &str,
        candidates: i64,
    ) -> Result<Vec<MergeRow>, RagError> {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(normalize_search_term)
            .filter(|t| t.len() >= 2)
            .collect();
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = terms
            .iter()
            .map(|_| "lower(d.title) LIKE ?")
            .collect::<Vec<_>>()
            .join(" OR ");
        let sql = format!(
            "SELECT c.id AS chunk_id, d.file_path, d.title, c.heading, c.content \
             FROM documents d JOIN chunks c ON c.document_id = d.id \
             WHERE {placeholders} GROUP BY d.id ORDER BY d.title LIMIT ?"
        );
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = terms
            .iter()
            .map(|t| Box::new(format!("%{t}%")) as Box<dyn rusqlite::ToSql>)
            .collect();
        params.push(Box::new(candidates));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| {
                Ok(MergeRow {
                    chunk_id: row.get(0)?,
                    file_path: row.get(1)?,
                    title: row.get(2)?,
                    heading: row.get(3)?,
                    content: row.get(4)?,
                    score: 0.0,
                    sources: Vec::new(),
                })
            },
        )?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// 하이브리드 검색 실행.
    ///
    /// `query_vector`는 쿼리 임베딩 결과(차원 게이트 통과한 bytes). FTS5/벡터/제목
    /// 결과를 RRF로 합치고 문서 중복을 제거한다.
    pub fn search(
        &self,
        query: &str,
        query_vector: &[u8],
        limit: usize,
    ) -> Result<Vec<RagSearchHit>, RagError> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Err(RagError::EmptyQuery);
        }
        let conn = self.open_readonly()?;
        // 차원 게이트: 쿼리 벡터 길이(바이트) → f32 개수
        let dims = query_vector.len() / 4;
        self.validate_meta(&conn, dims)?;

        let candidates = (limit * 3).max(20) as i64;
        let fts_rows = self.fts_rows(&conn, trimmed, candidates)?;
        let vector_rows = self.vector_rows(&conn, query_vector, candidates)?;
        let title_rows = self.title_rows(&conn, trimmed, candidates)?;

        let mut scores: HashMap<i64, MergeRow> = HashMap::new();
        add_ranked(fts_rows, "fts5", &mut scores);
        add_ranked(vector_rows, "sqlite-vec", &mut scores);
        add_ranked(title_rows, "title", &mut scores);
        apply_title_bonus(trimmed, &mut scores);
        let merged = dedupe_by_document(scores.into_values().collect(), limit);

        Ok(merged
            .into_iter()
            .map(|row| RagSearchHit {
                file_path: row.file_path,
                title: row.title,
                heading: row.heading,
                preview: row
                    .content
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(280)
                    .collect(),
                sources: row.sources,
                score: row.score,
            })
            .collect())
    }
}

// ---------------------------------------------------------------------------
// 단위 테스트
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_removes_korean_particles() {
        assert_eq!(normalize_search_term("인증에서"), "인증");
        assert_eq!(normalize_search_term("자동화를"), "자동화");
        assert_eq!(normalize_search_term("아이디어의"), "아이디어");
        // 비알파벳/한글(공백 포함) 제거 — Node normalizeSearchTerm과 동일
        assert_eq!(normalize_search_term("KC 인증"), "kc인증");
    }

    #[test]
    fn normalize_strips_non_alphanumeric() {
        assert_eq!(normalize_search_term("블로그!"), "블로그");
        assert_eq!(normalize_search_term("  hello  "), "hello");
    }

    fn mk_row(chunk_id: i64, file_path: &str, title: &str) -> MergeRow {
        MergeRow {
            chunk_id,
            file_path: file_path.to_string(),
            title: title.to_string(),
            heading: String::new(),
            content: String::new(),
            score: 0.0,
            sources: Vec::new(),
        }
    }

    #[test]
    fn rrf_merges_and_dedupes_by_document() {
        let mut scores: HashMap<i64, MergeRow> = HashMap::new();
        add_ranked(
            vec![mk_row(1, "a.md", "A"), mk_row(2, "b.md", "B")],
            "fts5",
            &mut scores,
        );
        add_ranked(
            vec![mk_row(2, "b.md", "B"), mk_row(3, "c.md", "C")],
            "sqlite-vec",
            &mut scores,
        );
        // 쿼리를 제목과 무관하게 해 보너스 없이 순수 RRF 합산 확인
        apply_title_bonus("xyz", &mut scores);
        let merged = dedupe_by_document(scores.into_values().collect(), 10);
        assert_eq!(merged.len(), 3, "3개 문서");
        // b.md는 두 소스에서 합산되어 최상위
        assert_eq!(merged[0].file_path, "b.md", "RRF 합산 문서 1위");
        assert_eq!(merged[0].sources.len(), 2, "두 소스 근거");
    }

    #[test]
    fn rrf_title_bonus_can_win() {
        // a.md가 fts 1위 + 제목 보너스면 b.md(벡터 1위)를 이길 수 있다.
        let mut scores: HashMap<i64, MergeRow> = HashMap::new();
        add_ranked(
            vec![mk_row(1, "a.md", "A"), mk_row(2, "b.md", "B")],
            "fts5",
            &mut scores,
        );
        add_ranked(vec![mk_row(2, "b.md", "B")], "sqlite-vec", &mut scores);
        apply_title_bonus("A", &mut scores);
        let merged = dedupe_by_document(scores.into_values().collect(), 10);
        assert_eq!(merged[0].file_path, "a.md", "제목 보너스로 a.md 1위");
    }

    #[test]
    fn rrf_respects_limit_and_dedupes() {
        let mut scores: HashMap<i64, MergeRow> = HashMap::new();
        add_ranked(
            vec![
                mk_row(1, "a.md", "a"),
                mk_row(11, "a.md", "a"),
                mk_row(2, "b.md", "b"),
            ],
            "fts5",
            &mut scores,
        );
        let merged = dedupe_by_document(scores.into_values().collect(), 2);
        assert_eq!(merged.len(), 2, "limit 2");
        assert_eq!(merged[0].file_path, "a.md", "같은 문서 첫 청크만");
    }
}
