import type { AuthFetch, FetchOutcome } from "./auth-fetch.ts";
import { parseAuthSuccess } from "./auth-api-validation.ts";
import type { AuthTokenPair } from "./auth-api-types.ts";

/**
 * refresh 실행기 (DEF-SEC-001, 2026-10-20).
 *
 * 토큰 저장소를 주입받아 Tauri 의존 없이 Node QA로 검증한다.
 * 설계: docs/waterfall/03-상세설계/M3-인증-설계.md §17.13
 */

export interface RefreshTokenStore {
  getRefreshToken(): string | null;
  setTokens(access: string, refresh: string, expiresInSec: number): Promise<void>;
  clear(): Promise<void>;
}

/**
 * 서버가 refresh token을 명시적으로 거부했는지.
 * 네트워크 실패(status 0)·시간 초과·403·5xx·429·비JSON 응답은 거부가 아니다.
 */
export function isExplicitRefreshRejection(outcome: FetchOutcome): boolean {
  if (outcome.networkError) return false;
  // 서버 계약(server/src/routes/auth.ts): 명시 거부는 401, 또는 400 + session_expired다.
  // 일반 403(프록시·WAF HTML, 서버 오류)은 세션 거부가 아니므로 토큰을 보존한다(DFUB-R001).
  if (outcome.status === 401) return true;
  if (outcome.status !== 400) return false;
  const payload = outcome.payload as { error?: { code?: unknown } } | null;
  return payload?.error?.code === "session_expired";
}

function isTokensPayload(data: unknown): data is { tokens: AuthTokenPair } {
  if (typeof data !== "object" || data === null) return false;
  const t = (data as { tokens?: unknown }).tokens;
  return (
    typeof t === "object" &&
    t !== null &&
    typeof (t as AuthTokenPair).accessToken === "string" &&
    typeof (t as AuthTokenPair).refreshToken === "string" &&
    typeof (t as AuthTokenPair).expiresInSec === "number"
  );
}

/** 성공 = true. 실패 = false (명시 거부일 때만 토큰을 비운다). */
export function createRefreshRunner(
  fetchAuth: AuthFetch,
  store: RefreshTokenStore,
  refreshPath: string,
): () => Promise<boolean> {
  return async function runRefreshOnce(): Promise<boolean> {
    const refresh = store.getRefreshToken();
    if (!refresh) return false;

    const outcome = await fetchAuth(refreshPath, {
      method: "POST",
      body: { refreshToken: refresh },
    });
    const parsed = parseAuthSuccess(outcome.payload, isTokensPayload);
    if (parsed && parsed.ok) {
      const { accessToken, refreshToken, expiresInSec } = parsed.data.tokens;
      await store.setTokens(accessToken, refreshToken, expiresInSec);
      return true;
    }
    if (isExplicitRefreshRejection(outcome)) await store.clear();
    return false;
  };
}
