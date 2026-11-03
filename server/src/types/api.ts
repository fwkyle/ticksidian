/**
 * 백엔드용 인증 API 타입.
 *
 * 프론트의 `app/src/lib/auth/auth-api-types.ts`와 같은 계약을 의도적으로
 * 손으로 다시 적는다. monorepo / 공유 패키지를 도입하지 않고도 두 쪽이
 * 같은 shape를 따르는지 코드 리뷰로 확인할 수 있게 한다.
 *
 * 둘 사이가 어긋날 가능성이 있는 자리:
 *  - `AuthErrorCode` union (양쪽 7개 코드 일치 필요)
 *  - `AuthApiUser` 필드 (accountId, email, createdAt)
 *  - `AuthTokenPair` 필드 (accessToken, refreshToken, expiresInSec)
 */

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_already_exists"
  | "session_expired"
  | "rate_limited"
  | "network"
  | "server"
  | "unknown";

export interface AuthApiErrorResponse {
  code: AuthErrorCode;
  /** 사용자에게 보여줘도 안전한 한 줄 (민감 정보 금지). */
  message: string;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

export interface AuthApiUser {
  accountId: string;
  email: string;
  createdAt: string;
}

export interface SignupRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken?: string;
}

export interface SignupResponseData {
  user: AuthApiUser;
  tokens: AuthTokenPair;
}

export interface LoginResponseData {
  user: AuthApiUser;
  tokens: AuthTokenPair;
}

export interface RefreshResponseData {
  tokens: AuthTokenPair;
}

export type LogoutResponseData = Record<string, never>;

export interface MeResponseData {
  user: AuthApiUser;
}
