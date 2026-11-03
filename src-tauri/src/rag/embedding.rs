// Gemini 쿼리 임베딩 — Rust에서 Gemini API를 직접 호출.
//
// scripts/rag-index-lib.mjs 의 GeminiEmbeddingProvider.embed(query) 로직 이식:
// - taskType=RETRIEVAL_QUERY, outputDimensionality는 DB index_meta에서 읽은 차원.
// - L2 재정규화, 429/503/5xx 지수 백오프 최대 5회, Retry-After 존중(최대 30초).
// - API 키는 Rust 안에서만 쓰고 프론트로 절대 전달하지 않는다.
//   (2026-08-16 F2) 키는 URL이 아니라 x-goog-api-key 헤더로 보낸다 — 오류 문자열에
//   요청 URL이 붙어도 키가 새지 않는다. 상세는 gemini_http.rs 주석.

use std::time::Duration;

use serde::Deserialize;

use super::error::RagError;
use super::gemini_http::{
    action_url, http_client, network_error_message, API_KEY_HEADER, GEMINI_OVERALL_DEADLINE,
};

const GEMINI_MODEL: &str = "gemini-embedding-001";
const MAX_RETRIES: u32 = 5;
const MAX_RETRY_AFTER_MS: u64 = 30_000;

#[derive(Deserialize)]
struct EmbedResponse {
    embedding: Embedding,
}

#[derive(Deserialize)]
struct Embedding {
    values: Vec<f32>,
}

/// 쿼리 벡터를 L2 정규화된 Float32Array 바이트로 반환한다.
pub fn normalize_l2(values: &[f32]) -> Vec<f32> {
    let norm: f32 = values.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm = if norm == 0.0 { 1.0 } else { norm };
    values.iter().map(|x| x / norm).collect()
}

/// f32 벡터를 SQLite blob용 LE 바이트로 직렬화한다.
pub fn vector_to_bytes(values: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// f32 LE 바이트를 벡터로 역직렬화한다.
pub fn bytes_to_vector(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Gemini 쿼리 임베딩 생성. API 키는 GEMINI_API_KEY env.
pub async fn embed_query(
    api_key: &str,
    query: &str,
    dimensions: usize,
) -> Result<Vec<f32>, RagError> {
    let url = action_url(GEMINI_MODEL, "embedContent");
    embed_query_at(&url, api_key, query, dimensions, GEMINI_OVERALL_DEADLINE).await
}

/// 재시도·대기를 포함해 `deadline` 안에 끝나지 않으면 오류로 끝낸다(DEF-QUAL-001).
async fn embed_query_at(
    url: &str,
    api_key: &str,
    query: &str,
    dimensions: usize,
    deadline: Duration,
) -> Result<Vec<f32>, RagError> {
    if api_key.is_empty() {
        return Err(RagError::MissingApiKey);
    }
    tokio::time::timeout(
        deadline,
        embed_query_attempts(url, api_key, query, dimensions),
    )
    .await
    .map_err(|_| {
        RagError::Embedding(
            "Gemini 응답이 늦어 중단했습니다. 잠시 뒤 다시 시도해 주세요.".to_string(),
        )
    })?
}

async fn embed_query_attempts(
    url: &str,
    api_key: &str,
    query: &str,
    dimensions: usize,
) -> Result<Vec<f32>, RagError> {
    let client = http_client()
        .map_err(|_| RagError::Embedding("HTTP 클라이언트를 만들지 못했습니다.".to_string()))?;

    let mut last_error: Option<RagError> = None;
    for attempt in 0..=MAX_RETRIES {
        let body = serde_json::json!({
            "content": { "parts": [{ "text": query }] },
            "taskType": "RETRIEVAL_QUERY",
            "outputDimensionality": dimensions,
        });
        let res = client
            .post(url)
            .header(API_KEY_HEADER, api_key)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await;

        match res {
            Ok(resp) if resp.status().is_success() => {
                let parsed: EmbedResponse = resp
                    .json()
                    .await
                    .map_err(|_| RagError::Embedding("응답 파싱 실패".to_string()))?;
                if parsed.embedding.values.len() != dimensions {
                    return Err(RagError::DimensionMismatch {
                        db: parsed.embedding.values.len(),
                        expected: dimensions,
                    });
                }
                return Ok(normalize_l2(&parsed.embedding.values));
            }
            Ok(resp) => {
                let status = resp.status();
                let retryable = status.as_u16() == 429
                    || status.as_u16() == 503
                    || (status.as_u16() >= 500 && status.as_u16() < 600);
                if !retryable {
                    return Err(RagError::Embedding(format!(
                        "Gemini 실패 {}: {}",
                        status.as_u16(),
                        resp.text()
                            .await
                            .unwrap_or_default()
                            .chars()
                            .take(200)
                            .collect::<String>()
                    )));
                }
                let retry_after_ms = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .map(|secs| (secs * 1000).min(MAX_RETRY_AFTER_MS));
                let wait_ms = retry_after_ms
                    .unwrap_or_else(|| (1000u64 * 2u64.pow(attempt)).min(MAX_RETRY_AFTER_MS));
                last_error = Some(RagError::Embedding(format!(
                    "Gemini 재시도 {}/{} (status {})",
                    attempt + 1,
                    MAX_RETRIES + 1,
                    status.as_u16()
                )));
                tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            }
            Err(e) => {
                last_error = Some(RagError::Embedding(format!(
                    "네트워크 오류: {}",
                    network_error_message(e)
                )));
                let wait_ms = (1000u64 * 2u64.pow(attempt)).min(MAX_RETRY_AFTER_MS);
                tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            }
        }
    }
    Err(last_error.unwrap_or(RagError::Embedding("재시도 전부 실패".to_string())))
}

// ---------------------------------------------------------------------------
// 단위 테스트
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_l2_makes_unit_length() {
        let v = vec![3.0, 4.0];
        let n = normalize_l2(&v);
        assert!((n[0] * n[0] + n[1] * n[1]).sqrt() - 1.0 < 1e-6);
    }

    #[test]
    fn vector_bytes_roundtrip() {
        let v = vec![0.1, -2.5, 3.0];
        let bytes = vector_to_bytes(&v);
        assert_eq!(bytes.len(), 12);
        assert_eq!(bytes_to_vector(&bytes), v);
    }

    #[test]
    fn embed_query_ends_with_error_when_server_never_responds() {
        let url = crate::rag::gemini_http::tests::silent_server_url();
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let started = std::time::Instant::now();
        let outcome = rt.block_on(async {
            tokio::time::timeout(
                Duration::from_secs(5),
                embed_query_at(&url, "test-key", "질문", 8, Duration::from_millis(800)),
            )
            .await
        });
        let result = outcome.expect("무응답이어도 마감 안에 오류로 끝나야 한다");
        assert!(matches!(result, Err(RagError::Embedding(_))));
        assert!(started.elapsed() < Duration::from_secs(4));
    }
}
