// 검토 큐 항목 AI 분류 — gemini-3.8-flash (TICK-P0-007 3차).
//
// - 프롬프트/응답 파싱은 순수 함수로 두고 단위 테스트로 고정한다.
// - API 키는 Rust 안에서만 쓰고 프론트로 절대 전달하지 않는다.
//   (2026-08-16 F2) 키는 URL이 아니라 x-goog-api-key 헤더로 보낸다. 상세는 gemini_http.rs.
// - thinkingLevel=low: 3.8이 지원하는 낮은 사고 수준. 숫자 예산/temperature는 보내지 않는다.
// - 모델 응답은 마크다운 코드펜스로 올 수 있어 첫 JSON 객체를 추출해 파싱한다.
// - 분류 7종 밖 응답은 fail-closed(에러). 프론트가 임의로 해석하지 않는다.

use serde::{Deserialize, Serialize};

use super::error::RagError;
use super::gemini_http::{
    action_url, http_client, network_error_message, API_KEY_HEADER, GEMINI_OVERALL_DEADLINE,
};

const CLASSIFY_MODEL: &str = "gemini-3.8-flash";
const VALID_CLASSIFICATIONS: [&str; 7] = [
    "실행",
    "아이디어",
    "참고",
    "일반 메모",
    "중복 의심",
    "정리 후보",
    "수동 검토",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewClassification {
    pub classification: String,
    pub reason: String,
    pub confidence: f64,
}

pub fn build_classify_prompt(title: &str, content: &str) -> String {
    format!(
        "다음 항목을 7개 분류 중 하나로 분류하고 JSON으로만 답하라.\n\n\
분류:\n\
- 실행: 당장 수행할 행동이나 작업\n\
- 아이디어: 아직 구체화되지 않은 가능성이나 구상\n\
- 참고: 나중에 찾아볼 참고자료나 학습 자료\n\
- 일반 메모: 특별히 나누지 않아도 보존할 기록\n\
- 중복 의심: 기존 항목과 중복될 가능성이 큰 항목\n\
- 정리 후보: 여러 주제가 섞였거나 다시 정리가 필요한 항목\n\
- 수동 검토: 민감정보(비밀키/비밀번호/계정), 파괴적 명령(삭제/종료), 금융/투자 판단 등 자동 처리 금지 항목\n\n\
출력 형식(JSON만, 다른 텍스트 없음):\n\
{{\"classification\": \"<분류>\", \"reason\": \"<한 문장 이유>\", \"confidence\": <0.0~1.0 사이 숫자>}}\n\n\
항목 제목: {title}\n\
항목 내용: {content}"
    )
}

/// 모델 원문 텍스트에서 첫 JSON 객체를 추출해 분류 결과로 파싱한다.
/// 코드펜스(```json ... ```)와 설명 문장이 섞여도 첫 {..} 블록을 쓴다.
pub fn parse_classification_text(text: &str) -> Result<ReviewClassification, RagError> {
    let start = text
        .find('{')
        .ok_or_else(|| RagError::Classification("모델 응답에 JSON이 없습니다.".to_string()))?;
    let end = text.rfind('}').ok_or_else(|| {
        RagError::Classification("모델 응답의 JSON이 완결되지 않았습니다.".to_string())
    })?;
    if end <= start {
        return Err(RagError::Classification(
            "모델 응답의 JSON이 완결되지 않았습니다.".to_string(),
        ));
    }
    let json_slice = &text[start..=end];
    let parsed: RawClassification = serde_json::from_str(json_slice)
        .map_err(|e| RagError::Classification(format!("모델 응답 JSON 파싱 실패: {e}")))?;

    let classification = parsed.classification;
    if !VALID_CLASSIFICATIONS.contains(&classification.as_str()) {
        return Err(RagError::Classification(format!(
            "알 수 없는 분류가 왔습니다: {classification}"
        )));
    }
    let confidence = if parsed.confidence.is_finite() {
        parsed.confidence.clamp(0.0, 1.0)
    } else {
        0.0
    };
    Ok(ReviewClassification {
        classification,
        reason: parsed.reason,
        confidence,
    })
}

#[derive(Deserialize)]
struct RawClassification {
    classification: String,
    reason: String,
    confidence: f64,
}

#[derive(Deserialize)]
struct GenerateContentResponse {
    #[serde(default)]
    candidates: Vec<GenerateContentCandidate>,
}

#[derive(Deserialize)]
struct GenerateContentCandidate {
    content: GenerateContentContent,
}

#[derive(Deserialize)]
struct GenerateContentContent {
    #[serde(default)]
    parts: Vec<GenerateContentPart>,
}

#[derive(Deserialize)]
struct GenerateContentPart {
    #[serde(default)]
    text: String,
}

/// Gemini 분류 호출. 검색 임베딩과 같은 재시도 정책(429/503/5xx 지수 백오프 5회).
pub async fn classify_review_item_api(
    api_key: &str,
    title: &str,
    content: &str,
) -> Result<ReviewClassification, RagError> {
    let text = generate_review_text(api_key, &build_classify_prompt(title, content), 5).await?;
    parse_classification_text(&text)
}

fn build_generation_body(prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": {
            "maxOutputTokens": 2000,
            "thinkingConfig": { "thinkingLevel": "low" },
        },
    })
}

/// 공유 운반 경계. 기본함 추천은 재시도 0으로 호출하고 전체 45초 제한을 별도로 둔다.
pub async fn generate_review_text(
    api_key: &str,
    prompt: &str,
    retries: u32,
) -> Result<String, RagError> {
    let url = action_url(CLASSIFY_MODEL, "generateContent");
    generate_review_text_at(&url, api_key, prompt, retries, GEMINI_OVERALL_DEADLINE).await
}

/// 재시도·대기를 포함해 `deadline` 안에 끝나지 않으면 오류로 끝낸다(DEF-QUAL-001).
async fn generate_review_text_at(
    url: &str,
    api_key: &str,
    prompt: &str,
    retries: u32,
    deadline: std::time::Duration,
) -> Result<String, RagError> {
    if api_key.is_empty() {
        return Err(RagError::MissingApiKey);
    }
    tokio::time::timeout(
        deadline,
        generate_review_text_attempts(url, api_key, prompt, retries),
    )
    .await
    .map_err(|_| {
        RagError::Classification(
            "Gemini 응답이 늦어 중단했습니다. 잠시 뒤 다시 시도해 주세요.".to_string(),
        )
    })?
}

async fn generate_review_text_attempts(
    url: &str,
    api_key: &str,
    prompt: &str,
    retries: u32,
) -> Result<String, RagError> {
    let client = http_client().map_err(|_| {
        RagError::Classification("HTTP 클라이언트를 만들지 못했습니다.".to_string())
    })?;

    let mut last_error: Option<RagError> = None;
    for attempt in 0..=retries {
        let body = build_generation_body(prompt);
        let res = client
            .post(url)
            .header(API_KEY_HEADER, api_key)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await;

        match res {
            Ok(resp) if resp.status().is_success() => {
                let parsed: GenerateContentResponse = resp
                    .json()
                    .await
                    .map_err(|_| RagError::Classification("응답 파싱 실패".to_string()))?;
                let text = parsed
                    .candidates
                    .first()
                    .and_then(|c| c.content.parts.first())
                    .map(|p| p.text.as_str())
                    .unwrap_or("");
                if text.is_empty() {
                    return Err(RagError::Classification(
                        "모델이 빈 응답을 반환했습니다.".to_string(),
                    ));
                }
                return Ok(text.to_string());
            }
            Ok(resp) => {
                let status = resp.status();
                let retryable = status.as_u16() == 429
                    || status.as_u16() == 503
                    || (status.as_u16() >= 500 && status.as_u16() < 600);
                if !retryable || attempt == retries {
                    return Err(RagError::Classification(format!(
                        "Gemini 요청 실패 (HTTP {})",
                        status.as_u16()
                    )));
                }
                let wait_ms = (1000u64 * 2u64.pow(attempt)).min(30_000);
                last_error = Some(RagError::Classification(format!(
                    "Gemini 재시도 {}/6 (status {})",
                    attempt + 1,
                    status.as_u16()
                )));
                tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
            }
            Err(e) => {
                last_error = Some(RagError::Classification(format!(
                    "네트워크 오류: {}",
                    network_error_message(e)
                )));
                if attempt == retries {
                    break;
                }
                let wait_ms = (1000u64 * 2u64.pow(attempt)).min(30_000);
                tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
            }
        }
    }
    Err(last_error.unwrap_or(RagError::Classification("재시도 전부 실패".to_string())))
}

// ---------------------------------------------------------------------------
// 단위 테스트
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_model_is_gemini_3_8_flash() {
        assert_eq!(CLASSIFY_MODEL, "gemini-3.8-flash");
    }

    #[test]
    fn generation_body_uses_supported_3_8_settings_for_both_flows() {
        let prompts = [
            build_classify_prompt("분류 검사", "학습 아이디어"),
            crate::rag::inbox_folders::build_folder_prompt("앱 설계", &["개발/앱".into()]),
        ];
        for prompt in prompts {
            let body = build_generation_body(&prompt);
            assert_eq!(body["contents"][0]["parts"][0]["text"], prompt);
            assert_eq!(body["generationConfig"]["maxOutputTokens"], 2000);
            assert_eq!(
                body["generationConfig"]["thinkingConfig"]["thinkingLevel"],
                "low"
            );
            assert!(body["generationConfig"]["thinkingConfig"]
                .get("thinkingBudget")
                .is_none());
            for field in ["temperature", "topP", "topK", "candidateCount"] {
                assert!(body["generationConfig"].get(field).is_none());
            }
        }
    }

    #[test]
    fn prompt_contains_titles_and_all_classes() {
        let prompt = build_classify_prompt("제목", "내용");
        assert!(prompt.contains("항목 제목: 제목"));
        assert!(prompt.contains("항목 내용: 내용"));
        for classification in VALID_CLASSIFICATIONS {
            assert!(prompt.contains(classification));
        }
    }

    #[test]
    fn parse_plain_json() {
        let parsed = parse_classification_text(
            "{\"classification\":\"실행\",\"reason\":\"r\",\"confidence\":0.8}",
        )
        .expect("parse");
        assert_eq!(parsed.classification, "실행");
        assert_eq!(parsed.confidence, 0.8);
    }

    #[test]
    fn parse_fenced_json_with_prose() {
        let text = "```json\n{\"classification\": \"아이디어\", \"reason\": \"이유\", \"confidence\": 0.95}\n```";
        let parsed = parse_classification_text(text).expect("parse");
        assert_eq!(parsed.classification, "아이디어");
    }

    #[test]
    fn parse_clamps_out_of_range_confidence() {
        let parsed = parse_classification_text(
            "{\"classification\":\"참고\",\"reason\":\"r\",\"confidence\":3.0}",
        )
        .expect("parse");
        assert_eq!(parsed.confidence, 1.0);
    }

    #[test]
    fn parse_rejects_unknown_classification() {
        let result = parse_classification_text(
            "{\"classification\":\"없는분류\",\"reason\":\"r\",\"confidence\":0.5}",
        );
        assert!(result.is_err());
    }

    #[test]
    fn parse_rejects_text_without_json() {
        assert!(parse_classification_text("JSON 없는 응답").is_err());
        assert!(parse_classification_text("{ 잘린 JSON").is_err());
    }

    #[test]
    fn generate_review_text_ends_with_error_when_server_never_responds() {
        let url = crate::rag::gemini_http::tests::silent_server_url();
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let started = std::time::Instant::now();
        let outcome = rt.block_on(async {
            tokio::time::timeout(
                std::time::Duration::from_secs(5),
                generate_review_text_at(
                    &url,
                    "test-key",
                    "프롬프트",
                    5,
                    std::time::Duration::from_millis(800),
                ),
            )
            .await
        });
        let result = outcome.expect("무응답이어도 마감 안에 오류로 끝나야 한다");
        assert!(matches!(result, Err(RagError::Classification(_))));
        assert!(started.elapsed() < std::time::Duration::from_secs(4));
    }
}
