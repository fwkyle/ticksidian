import { newAccountId } from "../lib/tokens.js";
import { getDb } from "../db/index.js";

/**
 * SQLite-backed user store (M3-1f).
 *
 * 인터페이스는 메모리 store 시절(M3-1e)과 동일. 호출 측은 변경 없음.
 *
 * 의도적으로 안 한 것:
 *  - email verification, password reset, MFA
 *  - persistent/production-grade rate limiting
 *  - DB-backed 사용자 lockout
 */

export interface StoredUser {
  accountId: string;
  email: string;
  passwordHash: string;
  createdAt: string; // ISO-8601 UTC
}

interface UserRow {
  account_id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

function rowToUser(row: UserRow): StoredUser {
  return {
    accountId: row.account_id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findUserByEmail(email: string): StoredUser | null {
  const row = getDb()
    .prepare<[string], UserRow>(
      "SELECT account_id, email, password_hash, created_at FROM users WHERE email = ?",
    )
    .get(normalizeEmail(email));
  return row ? rowToUser(row) : null;
}

export function findUserByAccountId(accountId: string): StoredUser | null {
  const row = getDb()
    .prepare<[string], UserRow>(
      "SELECT account_id, email, password_hash, created_at FROM users WHERE account_id = ?",
    )
    .get(accountId);
  return row ? rowToUser(row) : null;
}

/**
 * 새 사용자 생성. 이메일 중복이면 null을 돌려준다 (호출 측이
 * `email_already_exists`로 매핑).
 */
export function createUser(email: string, passwordHash: string): StoredUser | null {
  const normalized = normalizeEmail(email);
  const accountId = newAccountId();
  const createdAt = new Date().toISOString();
  try {
    getDb()
      .prepare(
        "INSERT INTO users (account_id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(accountId, normalized, passwordHash, createdAt);
  } catch (err) {
    // UNIQUE constraint failed → 이미 가입된 이메일.
    if (
      err instanceof Error &&
      /UNIQUE constraint failed: users\.email/.test(err.message)
    ) {
      return null;
    }
    throw err;
  }
  return {
    accountId,
    email: normalized,
    passwordHash,
    createdAt,
  };
}

/** 테스트/스모크 전용. */
export function __resetUserStore(): void {
  getDb().exec("DELETE FROM users");
}
