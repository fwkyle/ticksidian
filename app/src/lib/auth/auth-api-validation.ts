/**
 * 백엔드 응답 runtime validation.
 *
 * zod 같은 라이브러리를 추가하지 않고 손으로 작성한 type guard만 둔다
 * (frontend dependency 최소화). 검사 범위는 "신뢰할 수 없는 외부 입력을
 * 안전하게 좁히는 정도" — 모든 필드를 강하게 검사하지는 않는다.
 *
 * 모든 함수는 throw하지 않고 boolean을 돌려준다.
 */

import type {
  AuthApiErrorResponse,
  AuthApiUser,
  AuthSuccess,
  AuthTokenPair,
} from "./auth-api-types";
import type { AuthErrorCode } from "./auth-types";

const KNOWN_ERROR_CODES: ReadonlySet<AuthErrorCode> = new Set([
  "invalid_credentials",
  "email_already_exists",
  "session_expired",
  "rate_limited",
  "network",
  "server",
  "unknown",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return isString(value) && KNOWN_ERROR_CODES.has(value as AuthErrorCode);
}

export function isAuthApiErrorResponse(
  value: unknown,
): value is AuthApiErrorResponse {
  if (!isObject(value)) return false;
  return isAuthErrorCode(value["code"]) && isString(value["message"]);
}

export function isAuthTokenPair(value: unknown): value is AuthTokenPair {
  if (!isObject(value)) return false;
  return (
    isString(value["accessToken"]) &&
    isString(value["refreshToken"]) &&
    typeof value["expiresInSec"] === "number" &&
    Number.isFinite(value["expiresInSec"])
  );
}

export function isAuthApiUser(value: unknown): value is AuthApiUser {
  if (!isObject(value)) return false;
  return (
    isString(value["accountId"]) &&
    isString(value["email"]) &&
    isString(value["createdAt"])
  );
}

/**
 * `AuthSuccess<T>` envelope 통과 후 내부 `data`만 좁히는 helper.
 * `dataGuard`가 통과해야 ok=true 분기로 들어간다.
 */
export function parseAuthSuccess<T>(
  raw: unknown,
  dataGuard: (data: unknown) => data is T,
): AuthSuccess<T> | null {
  if (!isObject(raw)) return null;
  if (raw["ok"] === true) {
    if (!dataGuard(raw["data"])) return null;
    return { ok: true, data: raw["data"] };
  }
  if (raw["ok"] === false) {
    if (!isAuthApiErrorResponse(raw["error"])) return null;
    return { ok: false, error: raw["error"] };
  }
  return null;
}

// 자주 쓰는 data shape용 dedicated guard.
export function isUserAndTokens(
  data: unknown,
): data is { user: AuthApiUser; tokens: AuthTokenPair } {
  if (!isObject(data)) return false;
  return isAuthApiUser(data["user"]) && isAuthTokenPair(data["tokens"]);
}

export function isTokensOnly(
  data: unknown,
): data is { tokens: AuthTokenPair } {
  if (!isObject(data)) return false;
  return isAuthTokenPair(data["tokens"]);
}

export function isUserOnly(data: unknown): data is { user: AuthApiUser } {
  if (!isObject(data)) return false;
  return isAuthApiUser(data["user"]);
}

export function isEmptyObject(data: unknown): data is Record<string, never> {
  return isObject(data) && Object.keys(data).length === 0;
}
