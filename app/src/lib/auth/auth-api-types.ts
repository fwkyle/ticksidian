import type { AuthErrorCode } from "./auth-types";

/**
 * M3-1d 인증 API 계약 타입.
 *
 * 이 파일은 **타입 계약만** 고정한다. 이 파일을 import해서 실제 fetch를
 * 호출하는 코드는 M3-1d 범위에 없다. 실제 호출은 후속 단계(M3-1e+)에서
 * `realAuthAdapter`가 생기면서 같이 들어온다.
 *
 * 설계 근거:
 *  - docs/waterfall/03-상세설계/M3-인증-설계.md §8 최소 API 범위 + §12 API 계약
 *  - docs/waterfall/03-상세설계/M3-서버-동기화-인증-개요.md §7.6 인증 최소 범위
 *
 * 원칙:
 *  - 비밀번호는 request body에만 들어가고, response나 server-side 로그에 절대
 *    돌려보내지 않는다.
 *  - access token은 메모리에만 둔다. response shape에서는 그냥 문자열로 다룬다.
 *  - refresh token은 OS secure storage / Tauri secure storage 후보로 보고 어떤
 *    플러그인을 쓸지는 M3-1e로 분리한다. **이 타입은 그 결정에 의존하지 않는다.**
 *  - 모든 endpoint의 오류 응답은 `AuthApiErrorResponse` 한 형태로 통일한다.
 *  - 4xx/5xx는 HTTP status로도 분리되지만, body의 `code`가 1차 진실이다.
 *    (예: 401 + invalid_credentials, 401 + session_expired는 다르게 처리해야 함.)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 공통
// ─────────────────────────────────────────────────────────────────────────────

/** 모든 인증 API의 표준 오류 응답 body. */
export interface AuthApiErrorResponse {
  code: AuthErrorCode;
  /** 사용자에게 보여줘도 안전한 한 줄 메시지 (민감 정보 금지). */
  message: string;
}

/** 발급된 토큰 쌍. access는 메모리, refresh는 secure storage 후보. */
export interface AuthTokenPair {
  /** 짧은 수명(설계 §4.1 = 15분). 메모리에만 보관. */
  accessToken: string;
  /** 긴 수명(설계 §4.1 = 7일). secure storage 후보. localStorage 금지. */
  refreshToken: string;
  /** access token의 남은 수명 (초). 클라이언트가 만료 추적할 때 사용. */
  expiresInSec: number;
}

/** 서버가 돌려주는 사용자 프로필 최소 묶음. */
export interface AuthApiUser {
  accountId: string;
  email: string;
  /** 가입 시각 (ISO-8601 UTC). */
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/signup
// ─────────────────────────────────────────────────────────────────────────────

export interface SignupRequest {
  email: string;
  /** 평문 비밀번호. 서버가 해싱 후 저장한다. response/log에 다시 돌려주지 않는다. */
  password: string;
}

export type SignupResponse = AuthSuccess<{ user: AuthApiUser; tokens: AuthTokenPair }>;

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export type LoginResponse = AuthSuccess<{ user: AuthApiUser; tokens: AuthTokenPair }>;

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/refresh
// ─────────────────────────────────────────────────────────────────────────────

export interface RefreshRequest {
  /** 클라이언트가 secure storage에서 꺼낸 refresh token. */
  refreshToken: string;
}

/**
 * 성공 시 access token을 새로 발급한다. refresh token rotation 정책은
 * 서버 결정이지만 (a) 동일 refresh token 유지 또는 (b) 새 refresh token
 * 발급 둘 다 client는 같은 코드 경로로 처리한다 — `tokens.refreshToken`을
 * 그대로 secure storage에 다시 저장.
 */
export type RefreshResponse = AuthSuccess<{ tokens: AuthTokenPair }>;

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────────────────────────────────────

export interface LogoutRequest {
  /** 서버가 폐기할 refresh token. 없으면 서버는 access token으로만 식별한다. */
  refreshToken?: string;
}

export type LogoutResponse = AuthSuccess<Record<string, never>>;

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/me
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authorization: Bearer {accessToken} 헤더로 호출.
 * access token이 만료됐으면 서버는 401 + `code: "session_expired"`로 응답한다.
 * 클라이언트는 이 코드를 보고 refresh를 시도한다.
 */
export type MeResponse = AuthSuccess<{ user: AuthApiUser }>;

// ─────────────────────────────────────────────────────────────────────────────
// 결과 합 타입
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 모든 API 호출은 이 합 타입으로 결과를 돌려준다고 본다. fetch 자체는
 * `realAuthAdapter`가 try/catch + status code → AuthApiErrorResponse 매핑을
 * 책임진다. 호출 측은 throw를 다루지 않는다.
 */
export type AuthSuccess<T> =
  | { ok: true; data: T }
  | { ok: false; error: AuthApiErrorResponse };
