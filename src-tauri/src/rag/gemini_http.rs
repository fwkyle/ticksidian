// Gemini HTTP 경계 — 엔드포인트 조립과 오류 문자열 정리.
//
// Why (2026-08-16 F2 수정):
// 이전에는 API 키를 `...:embedContent?key={api_key}` 형태로 URL에 넣었다.
// reqwest는 네트워크 단계 실패 시 에러에 요청 URL을 붙이고(`Error::with_url`),
// `Display for Error`가 ` for url ({url})`를 출력한다(reqwest 0.12 기준).
// 그 문자열이 `RagError`에 담겨 webview로 직렬화되면서 API 키가 프론트로 나갔다.
// (잠긴 계약: 키는 Rust 안에서만 쓰고 webview로 전달하지 않는다.)
//
// 방어는 두 겹이다.
//  1) 1차(근본): 키를 URL이 아니라 `x-goog-api-key` 헤더로 보낸다 → URL에 키가 없다.
//     2026-08-16 실측: 임베딩(gemini-embedding-001)과 분류(gemini-3.7-flash) 모두 HTTP 200.
//  2) 2차(방어적): 네트워크 오류 문자열은 `without_url()`로 URL을 떼고 만든다.
//
// embedding.rs와 classifier.rs가 이 모듈을 공유한다(중복 금지).

/// Gemini Generative Language API v1beta 모델 베이스 경로.
pub const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// API 키 전달 헤더. 쿼리 파라미터(`?key=`) 대신 이 헤더만 사용한다.
pub const API_KEY_HEADER: &str = "x-goog-api-key";

use std::time::Duration;

/// 재시도·대기를 포함한 Gemini 호출 1건의 전체 마감(DEF-QUAL-001). 기본함 추천의 45초와 같다.
pub const GEMINI_OVERALL_DEADLINE: Duration = Duration::from_secs(45);
const GEMINI_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const GEMINI_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// 시간 제한이 있는 공용 HTTP 클라이언트. 접속 10초, 요청 1건 30초.
pub fn http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(GEMINI_CONNECT_TIMEOUT)
        .timeout(GEMINI_REQUEST_TIMEOUT)
        .build()
}

/// 모델 액션 URL을 만든다. **API 키를 절대 포함하지 않는다.**
pub fn action_url(model: &str, action: &str) -> String {
    format!("{GEMINI_API_BASE}/{model}:{action}")
}

/// reqwest 오류를 프론트에 보여줄 문자열로 정리한다.
/// URL(과거에는 키가 붙어 있던 자리)을 제거한 뒤 문자열화한다.
pub fn network_error_message(error: reqwest::Error) -> String {
    error.without_url().to_string()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn action_url_never_carries_api_key() {
        let url = action_url("gemini-embedding-001", "embedContent");
        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"
        );
        // 키가 URL에 실릴 수 있는 형태를 구조적으로 차단한다.
        assert!(!url.contains('?'), "URL에 쿼리 문자열이 있으면 안 된다");
        assert!(
            !url.contains("key="),
            "URL에 key= 파라미터가 있으면 안 된다"
        );
    }

    #[test]
    fn action_url_supports_generate_content() {
        assert_eq!(
            action_url("gemini-3.8-flash", "generateContent"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
        );
    }

    #[test]
    fn api_key_header_is_google_standard() {
        assert_eq!(API_KEY_HEADER, "x-goog-api-key");
    }

    /// 접속만 받고 아무 응답도 하지 않는 로컬 서버. 반환한 URL로 요청하면 응답이 오지 않는다.
    /// 실제 Gemini를 호출하지 않는다(DEF-QUAL-001 잠금 테스트 공용).
    pub(crate) fn silent_server_url() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("로컬 포트 바인딩");
        let url = format!("http://{}/silent", listener.local_addr().expect("주소"));
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for stream in listener.incoming().flatten() {
                held.push(stream);
            }
        });
        url
    }
}
