import type { AuthError, AuthSession } from "./auth-types";

/**
 * 인증 어댑터 인터페이스.
 *
 * 현재 구현체:
 *  - `mockAuthAdapter` (`mock-auth-adapter.ts`) — 앱 기본. 메모리 only,
 *    실제 서버 호출 없음. M3-1c부터 안정 사용.
 *  - `realAuthAdapter` (`real-auth-adapter.ts`) — M3-1e에서 실제 fetch
 *    구현. `VITE_TICKSIDIAN_AUTH_MODE=real`일 때만 App에서 주입한다.
 *
 * 모든 메서드는 throw하지 않고 결과 객체로 성공/실패를 돌려준다.
 * UI가 try/catch 없이 상태 머신 전이를 짤 수 있게 하기 위함이다.
 */
export interface AuthAdapter {
  /**
   * 앱 시작/탭 복귀 시 한 번 호출. 영구 저장된 세션이 있으면 복구한다.
   *  - mock: 메모리 변수에 세션이 살아 있으면 그대로 돌려준다(새 탭/리로드 후엔 항상 null).
   *  - real (M3-1e safe fallback): refresh token이 메모리에만 있으므로 앱
   *    재시작 후엔 항상 null. 실제 secure storage가 붙으면(M3-1f+) refresh
   *    token으로 access token을 새로 발급해 세션 복구를 시도한다.
   */
  getCurrentSession(): Promise<AuthSession | null>;
  signIn(email: string, password: string): Promise<SignInResult>;
  /**
   * 새 계정 생성 + 즉시 로그인 상태 진입. 성공하면 token store에 토큰을
   * 저장하고 `{ ok: true, session }`을 돌려준다 (signIn과 동일 결과 형태).
   *
   *  - mock: 서버 없이 메모리 변수만 갱신. 같은 이메일은 한 번 가입한 뒤
   *    `email_already_exists`로 거른다.
   *  - real: `POST /auth/signup`을 호출. 응답 검증 통과 시 토큰 저장 후
   *    /me 검증 없이 user를 그대로 세션으로 매핑.
   *
   * 실패 코드는 signIn과 같은 `AuthErrorCode` union을 쓰되, 가입 흐름에서는
   * `email_already_exists`가 추가로 발생할 수 있다.
   */
  signUp(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  /**
   * Access token 만료 시 호출. 성공하면 동일/갱신된 세션, 실패하면 null.
   */
  refreshSession(): Promise<AuthSession | null>;
}

export type SignInResult =
  | { ok: true; session: AuthSession }
  | ({ ok: false } & AuthError);
