/**
 * M3-1c 인증 상태 타입.
 *
 * 설계 근거:
 *  - docs/waterfall/03-상세설계/M3-인증-설계.md §5 인증 상태 머신
 *
 * 핵심 분리:
 *  - `AuthRuntimeState`: UI에서 보이는 6개 상태 (signed_out / signing_in /
 *    signed_in / refreshing / reauth_required / signing_out).
 *  - `VaultAuthState` (types/note.ts): SQLite `vault_binding.auth_state`에
 *    저장 가능한 3개 영구 상태 (signed_out / signed_in / reauth_required).
 *
 * `signing_in`, `refreshing`, `signing_out` 같은 일시 상태는 React runtime
 * state에서만 다루고, DB에는 쓰지 않는다. 앱이 재시작되면 자연스럽게
 * `getCurrentSession()` 결과로 다시 계산한다.
 */
export type AuthRuntimeState =
  | "signed_out"
  | "signing_in"
  | "signed_in"
  | "refreshing"
  | "reauth_required"
  | "signing_out";

/**
 * 로그인된 사용자의 세션 정보 (UI용 최소 묶음).
 * M3-1c는 mock adapter라 실제 토큰을 만들지 않거나 더미 문자열만 메모리에 둔다.
 */
export interface AuthSession {
  accountId: string;
  email: string;
}

/**
 * AuthAdapter / API 응답에서 사용자 표시용으로 돌려주는 실패 코드 union.
 *
 * M3-1d에서 실제 서버 인증 API 계약을 고정하면서 코드를 7개로 확장했다.
 * 모든 코드는 `mockAuthAdapter` 또는 `realAuthAdapter` 둘 다에서 발생할 수
 * 있다고 보고 UI가 한 곳에서 처리한다.
 *
 *  - `invalid_credentials`  : 로그인 시 이메일/비밀번호 불일치
 *  - `email_already_exists` : 회원가입 시 이미 같은 이메일이 있음 (signup용)
 *  - `session_expired`      : refresh token 만료/폐기 → reauth_required로 전환
 *  - `rate_limited`         : 로그인/가입/refresh 시도가 너무 많아 잠시 차단됨
 *  - `network`              : 서버에 도달하지 못함 (오프라인/DNS/타임아웃)
 *  - `server`               : 5xx 또는 알 수 없는 서버 측 오류
 *  - `unknown`              : 그 외 분류 불가
 *
 * 비밀번호/토큰 같은 민감 정보는 `message`에도 절대 담지 않는다.
 */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_already_exists"
  | "session_expired"
  | "rate_limited"
  | "network"
  | "server"
  | "unknown";

export interface AuthError {
  code: AuthErrorCode;
  message: string;
  retryAfterSec?: number;
}
