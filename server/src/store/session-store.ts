import {
  ACCESS_TOKEN_TTL_SEC,
  newOpaqueToken,
  REFRESH_TOKEN_TTL_SEC,
} from "../lib/tokens.js";
import type { AuthTokenPair } from "../types/api.js";
import { getDb } from "../db/index.js";

/**
 * SQLite-backed session store (M3-1f).
 *
 * 인터페이스는 메모리 store 시절(M3-1e)과 동일.
 *
 *  - access tokens : token → (account_id, expires_at_ms). 만료 시 lazy delete.
 *  - refresh tokens: token → (account_id, expires_at_ms, revoked).
 *
 * 폐기된 refresh token도 한동안 row를 남긴다(revoked=1). 같은 token으로 두 번
 * 호출 오는 replay를 명확히 `session_expired`로 거르기 위함. 실 운영에서는
 * 별도 청소 작업 필요.
 *
 * 트랜잭션:
 *  - rotateRefreshToken은 "revoke 옛 + insert 새 access/refresh"가 한 묶음이라
 *    BEGIN ... COMMIT으로 감싼다.
 */

export type RefreshLookup =
  | { ok: true; accountId: string }
  | { ok: false; reason: "unknown" | "expired" | "revoked" };

interface AccessRow {
  account_id: string;
  expires_at_ms: number;
}

interface RefreshRow {
  account_id: string;
  expires_at_ms: number;
  revoked: number;
}

function nowMs(): number {
  return Date.now();
}

function insertAccessToken(
  token: string,
  accountId: string,
  expiresAtMs: number,
): void {
  getDb()
    .prepare(
      "INSERT INTO access_tokens (token, account_id, expires_at_ms) VALUES (?, ?, ?)",
    )
    .run(token, accountId, expiresAtMs);
}

function insertRefreshToken(
  token: string,
  accountId: string,
  expiresAtMs: number,
): void {
  getDb()
    .prepare(
      "INSERT INTO refresh_tokens (token, account_id, expires_at_ms, revoked) VALUES (?, ?, ?, 0)",
    )
    .run(token, accountId, expiresAtMs);
}

export function issueTokenPair(accountId: string): AuthTokenPair {
  const accessToken = newOpaqueToken();
  const refreshToken = newOpaqueToken();
  const now = nowMs();
  const accessExp = now + ACCESS_TOKEN_TTL_SEC * 1000;
  const refreshExp = now + REFRESH_TOKEN_TTL_SEC * 1000;

  const trx = getDb().transaction(() => {
    insertAccessToken(accessToken, accountId, accessExp);
    insertRefreshToken(refreshToken, accountId, refreshExp);
  });
  trx();

  return {
    accessToken,
    refreshToken,
    expiresInSec: ACCESS_TOKEN_TTL_SEC,
  };
}

export function lookupAccessToken(token: string): string | null {
  const db = getDb();
  const row = db
    .prepare<[string], AccessRow>(
      "SELECT account_id, expires_at_ms FROM access_tokens WHERE token = ?",
    )
    .get(token);
  if (!row) return null;
  if (row.expires_at_ms < nowMs()) {
    db.prepare("DELETE FROM access_tokens WHERE token = ?").run(token);
    return null;
  }
  return row.account_id;
}

export function lookupRefreshToken(token: string): RefreshLookup {
  const row = getDb()
    .prepare<[string], RefreshRow>(
      "SELECT account_id, expires_at_ms, revoked FROM refresh_tokens WHERE token = ?",
    )
    .get(token);
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revoked === 1) return { ok: false, reason: "revoked" };
  if (row.expires_at_ms < nowMs()) return { ok: false, reason: "expired" };
  return { ok: true, accountId: row.account_id };
}

/**
 * Refresh token rotation: 기존 token을 revoked로 표시하고 새 pair 발급.
 * 회전된 옛 token은 row가 남아 있으므로 같은 token이 다시 들어오면
 * `session_expired`로 분류한다 (replay 검출).
 *
 * 보안(H-1): 회전 시 해당 계정의 옛 access token을 모두 삭제한다. 그렇지 않으면
 * 탈취된 access token이 정상 refresh 회전 뒤에도 만료(15분)까지 살아 있어 회전이
 * "세션 도난 대응" 역할을 못 한다. logout의 revokeAllAccessTokensFor와 동일한
 * 계정 단위 무효화를 회전에도 적용한다.
 *
 * 트랜잭션 안에서 revoke + 옛 access 삭제 + insert를 묶어 race로 두 번 발급되거나
 * 중간 상태가 노출되지 않게 한다.
 */
export function rotateRefreshToken(oldToken: string): AuthTokenPair | null {
  const db = getDb();

  // 함수 외부에서 만든 token strings를 트랜잭션 안에서 그대로 쓰기 위해 미리 생성.
  const newAccess = newOpaqueToken();
  const newRefresh = newOpaqueToken();
  const now = nowMs();
  const accessExp = now + ACCESS_TOKEN_TTL_SEC * 1000;
  const refreshExp = now + REFRESH_TOKEN_TTL_SEC * 1000;

  let accountId: string | null = null;

  const trx = db.transaction(() => {
    const row = db
      .prepare<[string], RefreshRow>(
        "SELECT account_id, expires_at_ms, revoked FROM refresh_tokens WHERE token = ?",
      )
      .get(oldToken);
    if (!row) return;
    if (row.revoked === 1) return;
    if (row.expires_at_ms < nowMs()) return;
    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token = ?").run(oldToken);
    // H-1: 회전 전에 발급된 옛 access token을 모두 무효화한다.
    db.prepare("DELETE FROM access_tokens WHERE account_id = ?").run(row.account_id);
    insertAccessToken(newAccess, row.account_id, accessExp);
    insertRefreshToken(newRefresh, row.account_id, refreshExp);
    accountId = row.account_id;
  });
  trx();

  if (accountId === null) return null;

  return {
    accessToken: newAccess,
    refreshToken: newRefresh,
    expiresInSec: ACCESS_TOKEN_TTL_SEC,
  };
}

export function revokeRefreshToken(token: string): void {
  getDb()
    .prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token = ?")
    .run(token);
}

/**
 * accountId의 모든 access token을 즉시 무효화 (logout 시 호출).
 * refresh token revoke와 합쳐 사용자 입장에서 "현재 기기 로그아웃"이
 * 즉시 일어나게 한다.
 */
export function revokeAllAccessTokensFor(accountId: string): void {
  getDb()
    .prepare("DELETE FROM access_tokens WHERE account_id = ?")
    .run(accountId);
}

/** 테스트/스모크 전용. */
export function __resetSessionStore(): void {
  const db = getDb();
  db.exec("DELETE FROM access_tokens; DELETE FROM refresh_tokens;");
}
