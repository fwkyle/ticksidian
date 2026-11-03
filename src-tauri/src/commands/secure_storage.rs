//! M3-1f secure refresh token storage.
//!
//! 책임: refresh token 한 개만 OS-level secure storage(keyring)에 보관한다.
//!
//! - macOS: Keychain Services
//! - Windows: Credential Manager
//! - Linux: Secret Service (D-Bus, libsecret 호환)
//!
//! access token은 절대 디스크에 두지 않는다(메모리 only). 이 명령은 access
//! token을 모른다.
//!
//! 보안 약속:
//!  - 평문 파일 저장 금지. 실패 시 사용자에게는 "저장하지 못함"만 알리고
//!    fallback으로 메모리만 사용.
//!  - 로깅 시 토큰 값을 절대 출력하지 않는다 (length만).
//!  - 명령 응답에 토큰 자체는 string으로 담지만, 이 응답은 IPC 채널에서만
//!    돌아가고 디스크에 남지 않는다.
//!
//! 네임스페이스:
//!  - service: `com.ticksidian.auth`
//!  - account: `refresh_token`
//!
//! 같은 OS 사용자 계정의 다른 프로세스가 같은 service+account 조합으로
//! 접근하면 토큰을 읽을 수 있다(OS 기본 access control). 다중 사용자/멀티
//! 계정 분리는 후속 단계에서 service 이름에 vault id를 붙여 구분한다.

use serde::Serialize;
use thiserror::Error;

const SERVICE: &str = "com.ticksidian.auth";
const ACCOUNT_REFRESH: &str = "refresh_token";

/// 서버가 발급하는 opaque token은 `randomBytes(32).toString("hex")` 형식이다.
/// 즉 길이 64, 모두 ASCII hex(0-9 a-f). 다른 형태는 호출 측 버그로 보고 거부한다.
const REFRESH_TOKEN_HEX_LEN: usize = 64;

#[derive(Debug, Error)]
pub enum SecureStorageError {
    #[error("keyring backend unavailable: {0}")]
    BackendUnavailable(String),
    #[error("keyring io error: {0}")]
    Io(String),
    #[error("invalid refresh token format")]
    InvalidToken,
}

impl Serialize for SecureStorageError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let code = match self {
            Self::BackendUnavailable(_) => "backendUnavailable",
            Self::Io(_) => "io",
            Self::InvalidToken => "invalidToken",
        };
        let mut state = serializer.serialize_struct("SecureStorageError", 2)?;
        state.serialize_field("code", code)?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

/// refresh token 형식 검증 (TICK-P0-004).
///
/// 키체인에 들어가기 전에 호출 측 실수(빈 문자열, 잘못된 길이, 비-hex 문자)를
/// 막는다. 검증 실패 시 keyring 호출 자체를 시도하지 않으므로 단위 테스트가
/// 키체인 권한 없이도 분기를 잡을 수 있다.
///
/// 받아들이는 형식: 정확히 64자, 모두 ASCII hex. 대문자도 허용한다(서버는 소문자만
/// 발급하지만, 검증은 양쪽 모두 통과시켜 후속 변경에 강건하다).
pub fn validate_refresh_token(token: &str) -> Result<(), SecureStorageError> {
    if token.len() != REFRESH_TOKEN_HEX_LEN {
        return Err(SecureStorageError::InvalidToken);
    }
    if !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(SecureStorageError::InvalidToken);
    }
    Ok(())
}

fn entry() -> Result<keyring::Entry, SecureStorageError> {
    keyring::Entry::new(SERVICE, ACCOUNT_REFRESH)
        .map_err(|e| SecureStorageError::BackendUnavailable(e.to_string()))
}

/// 저장된 refresh token이 있으면 돌려준다. 없으면 None.
///
/// keyring backend 자체가 비어 있는 정상 케이스(`NoEntry`)와 backend
/// 접근 실패(권한, D-Bus 미동작 등)를 분리한다. 정상 빈 케이스는 None,
/// backend 실패는 Err로 올린다.
#[tauri::command]
pub fn secure_get_refresh_token() -> Result<Option<String>, SecureStorageError> {
    let entry = entry()?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(SecureStorageError::Io(e.to_string())),
    }
}

/// refresh token 저장.
///
/// 형식 검증을 먼저 돌려 빈 문자열/잘못된 길이/비-hex 입력은 keyring에 닿기 전에
/// 거부한다(TICK-P0-004). 형식이 맞으면 OS 키체인에 저장한다.
#[tauri::command]
pub fn secure_set_refresh_token(token: String) -> Result<(), SecureStorageError> {
    validate_refresh_token(&token)?;
    let entry = entry()?;
    entry
        .set_password(&token)
        .map_err(|e| SecureStorageError::Io(e.to_string()))
}

/// refresh token 제거. 이미 없으면 조용히 성공으로 본다(idempotent).
#[tauri::command]
pub fn secure_clear_refresh_token() -> Result<(), SecureStorageError> {
    let entry = entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SecureStorageError::Io(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// keyring backend가 CI 환경(macOS sandbox 등)에서 막혀 있을 수 있어
    /// 단위 테스트에서는 Entry 생성만 검증한다. 실제 read/write는 dev
    /// 환경 + 사용자 게이트로 확인.
    #[test]
    fn entry_creation_does_not_panic() {
        // 결과는 환경에 따라 Ok/Err 둘 다 가능. 단지 panic이 없으면 충분.
        let _ = entry();
    }

    /// 정상 형식: 정확히 64자, 모두 ASCII hex. 서버 발급 토큰을 그대로 모사.
    #[test]
    fn validate_accepts_64_hex_lowercase() {
        let token = "0123456789abcdef".repeat(4);
        assert_eq!(token.len(), 64);
        assert!(validate_refresh_token(&token).is_ok());
    }

    /// 대문자 hex도 허용 (서버는 소문자만 발급하지만 검증은 강건하게).
    #[test]
    fn validate_accepts_64_hex_uppercase() {
        let token = "0123456789ABCDEF".repeat(4);
        assert_eq!(token.len(), 64);
        assert!(validate_refresh_token(&token).is_ok());
    }

    /// 빈 문자열은 이전부터 막혔다. InvalidToken으로 통일.
    #[test]
    fn validate_rejects_empty_string() {
        assert!(matches!(
            validate_refresh_token(""),
            Err(SecureStorageError::InvalidToken)
        ));
    }

    /// 길이 불일치 (63자, 65자) 둘 다 거부.
    #[test]
    fn validate_rejects_wrong_length() {
        let short = "a".repeat(63);
        let long = "a".repeat(65);
        assert!(matches!(
            validate_refresh_token(&short),
            Err(SecureStorageError::InvalidToken)
        ));
        assert!(matches!(
            validate_refresh_token(&long),
            Err(SecureStorageError::InvalidToken)
        ));
    }

    /// 길이는 64인데 비-hex 문자가 섞인 경우 (`g`는 hex가 아님).
    #[test]
    fn validate_rejects_non_hex_chars() {
        let token = format!("{}g", "a".repeat(63));
        assert_eq!(token.len(), 64);
        assert!(matches!(
            validate_refresh_token(&token),
            Err(SecureStorageError::InvalidToken)
        ));
    }

    /// 길이는 64인데 multibyte 문자가 들어가서 char 64 != byte 64인 경우.
    /// ASCII hex만 허용해야 하므로 거부.
    #[test]
    fn validate_rejects_multibyte_chars() {
        // "한" + 'a' * 61 → byte 길이 64, char 길이 62. byte 길이가 어떻든
        // ASCII hex 검사를 통과 못 한다.
        let token = format!("한{}", "a".repeat(61));
        assert!(matches!(
            validate_refresh_token(&token),
            Err(SecureStorageError::InvalidToken)
        ));
    }
}
