import type { AuthAdapter, SignInResult } from "./auth-adapter";
import type { AuthSession } from "./auth-types";
import { createFetchAuth, createRefreshDeduper } from "./auth-fetch.ts";
import type { FetchOutcome } from "./auth-fetch.ts";
import { AUTH_BASE_URL } from "./auth-config";
import { authTokenStore } from "./auth-token-store";
import {
  isUserAndTokens,
  isUserOnly,
  parseAuthSuccess,
} from "./auth-api-validation";
import type { AuthTokenPair } from "./auth-api-types";
import { buildSignInFailure, isAccessExpired } from "./auth-error-mapping";
import { createRefreshRunner, isExplicitRefreshRejection } from "./auth-refresh.ts";

/**
 * Real auth adapter (M3-1f 갱신).
 *
 * 책임:
 *  - `auth-api-types.ts` 계약대로 백엔드와 통신.
 *  - 응답 envelope를 `AuthSuccess<T>`로 type guard 후 좁힘.
 *  - 실패는 throw 대신 `SignInResult` / null로 변환 (어댑터 계약).
 *  - 토큰은 `authTokenStore` 한 곳에 보관(메모리 + secure backend).
 *  - access token이 401/session_expired로 거부되면 한 번만 refresh 후 원
 *    요청을 재시도한다(authedRequest). 무한 retry 차단.
 *
 * 비-범위:
 *  - 노트 업로드/다운로드와 어떤 식으로도 연결되지 않는다.
 *  - access token 만료 사전 추적용 timer는 쓰지 않는다. 401 reactive refresh가
 *    1차 안전망. expiresAtMs는 store에 기록만 하고 UI/디버깅 참고 용도.
 */

const AUTH_PATHS = {
  signup: "/auth/signup",
  login: "/auth/login",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
  me: "/auth/me",
} as const;

const fetchAuth = createFetchAuth(fetch, AUTH_BASE_URL);

/**
 * 401-then-refresh-retry 패턴.
 *
 * 1. access token으로 한 번 호출.
 * 2. 401+session_expired면 refresh 한 번 시도.
 * 3. refresh 성공 시 새 access token으로 같은 요청 정확히 1회 재시도.
 * 4. 그 이상은 재시도하지 않는다(무한 루프 차단).
 *
 * 이 함수는 access token이 필요한 호출(`/auth/me`, 미래의 protected endpoint)
 * 만 감싼다. login/signup/refresh 자체는 access token이 필요 없으니 fetchAuth를
 * 그대로 쓴다.
 */
async function authedRequest(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<FetchOutcome> {
  const access = authTokenStore.getAccessToken();
  const first = await fetchAuth(path, { ...init, accessToken: access ?? undefined });
  if (!isAccessExpired(first)) return first;

  // refresh 1회 시도. 결과는 새 access token이 store에 들어 있는지로 판단.
  const refreshOk = await tryRefreshOnce();
  if (!refreshOk) return first;

  const newAccess = authTokenStore.getAccessToken();
  if (!newAccess) return first;

  // 새 토큰으로 단 한 번만 재시도.
  return fetchAuth(path, { ...init, accessToken: newAccess });
}

/**
 * refresh를 호출하고 토큰을 갱신한다. 성공 = true, 실패 = false.
 * 토큰은 서버의 명시 거부일 때만 비운다(auth-refresh.ts, DEF-SEC-001).
 *
 * 호출 측은 이 결과만 보고 "다시 시도할까 / 포기할까"를 결정한다.
 * useAuthState.refreshSession()과는 다른 경로라 React 상태를 직접 건드리지
 * 않는다. (refresh 후 다음 401에서 useAuthState가 자연스럽게 reauth_required로
 * 전환된다.)
 */
const runRefreshOnce = createRefreshRunner(fetchAuth, authTokenStore, AUTH_PATHS.refresh);
const tryRefreshOnce = createRefreshDeduper(runRefreshOnce);

async function applyTokens(tokens: AuthTokenPair): Promise<void> {
  await authTokenStore.setTokens(
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresInSec,
  );
}

function userToSession(user: { accountId: string; email: string }): AuthSession {
  return { accountId: user.accountId, email: user.email };
}

async function trySignInLike(
  path: typeof AUTH_PATHS.signup | typeof AUTH_PATHS.login,
  email: string,
  password: string,
): Promise<SignInResult> {
  const outcome = await fetchAuth(path, {
    method: "POST",
    body: { email, password },
  });
  const parsed = parseAuthSuccess(outcome.payload, isUserAndTokens);
  if (parsed && parsed.ok) {
    await applyTokens(parsed.data.tokens);
    return { ok: true, session: userToSession(parsed.data.user) };
  }
  return buildSignInFailure(outcome);
}

export const realAuthAdapter: AuthAdapter = {
  async getCurrentSession(): Promise<AuthSession | null> {
    // 앱 시작 시 secure backend에 살아 있는 refresh token이 있으면 1회만 hydrate.
    // hydrate 자체는 idempotent — 두 번째 이후 호출은 즉시 반환.
    await authTokenStore.hydrate();

    // 1. 메모리에 access token이 살아 있으면 /me로 검증 (필요 시 refresh-retry).
    const access = authTokenStore.getAccessToken();
    if (access) {
      const outcome = await authedRequest(AUTH_PATHS.me, { method: "GET" });
      const parsed = parseAuthSuccess(outcome.payload, isUserOnly);
      if (parsed && parsed.ok) return userToSession(parsed.data.user);
      // /me 401 → access 만료. authedRequest가 refresh+retry를 이미 한 번 시도.
      // 그래도 실패면 아래로 떨어져 refresh-only 분기 시도(secure 복구 케이스).
    }

    // 2. access는 없는데 refresh가 있으면(예: secure backend hydrate만 된 직후)
    //    refresh를 한 번 굴려 access를 얻는다.
    const refresh = authTokenStore.getRefreshToken();
    if (!refresh) return null;
    return this.refreshSession();
  },

  async signIn(email: string, password: string): Promise<SignInResult> {
    return trySignInLike(AUTH_PATHS.login, email, password);
  },

  async signUp(email: string, password: string): Promise<SignInResult> {
    return trySignInLike(AUTH_PATHS.signup, email, password);
  },

  async signOut(): Promise<void> {
    const refresh = authTokenStore.getRefreshToken();
    const access = authTokenStore.getAccessToken();
    try {
      await fetchAuth(AUTH_PATHS.logout, {
        method: "POST",
        body: { refreshToken: refresh ?? undefined },
        accessToken: access ?? undefined,
      });
    } catch {
      // best-effort.
    }
    await authTokenStore.clear();
  },

  async refreshSession(): Promise<AuthSession | null> {
    await authTokenStore.hydrate();
    const refresh = authTokenStore.getRefreshToken();
    if (!refresh) return null;

    const refreshOk = await tryRefreshOnce();
    if (!refreshOk) return null;

    // 새 access로 /me 확인. 실패하면 세션 살리지 않음.
    // /me는 authedRequest로 가도 되지만 막 갱신한 직후라 직접 호출이 더 단순.
    const access = authTokenStore.getAccessToken();
    if (!access) return null;
    const meOutcome = await fetchAuth(AUTH_PATHS.me, {
      method: "GET",
      accessToken: access,
    });
    const meParsed = parseAuthSuccess(meOutcome.payload, isUserOnly);
    if (!meParsed || !meParsed.ok) {
      // 명시 거부(401, 400+session_expired)일 때만 지운다. 네트워크·5xx면 토큰을 보존한다(DEF-SEC-001).
      if (isExplicitRefreshRejection(meOutcome)) await authTokenStore.clear();
      return null;
    }
    return userToSession(meParsed.data.user);
  },
};
