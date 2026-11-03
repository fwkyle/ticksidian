import { chmodSync, mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { DB_DIR_MODE, DB_FILE_MODE, secureDbFiles } from "./file-permissions.js";

/**
 * M3-1f dev auth server SQLite persistence.
 *
 * 왜 SQLite (better-sqlite3):
 *  - 메모리 store가 재시작 = 데이터 사라짐 문제 해결.
 *  - JSON file fallback은 atomic write/race가 까다로움. SQL이 더 안전.
 *  - native dep이지만 prebuilt binaries라 npm install 시 native compile 위험 없음.
 *
 * 여전히 production은 아니다:
 *  - HTTPS / persistent rate limit / email verification 없음.
 *  - 단일 프로세스 가정.
 *
 * 위치 정책:
 *  - default: `<server>/data/auth.db` (server 디렉토리 안. .gitignore에 잡힘)
 *  - `TICKSIDIAN_AUTH_DB_PATH`로 override 가능.
 *  - in-memory mode: `:memory:` 전달하면 휘발 store. smoke test/CI용.
 */

let dbInstance: Database.Database | null = null;

function resolveDbPath(): string {
  const raw = process.env["TICKSIDIAN_AUTH_DB_PATH"];
  if (raw && raw.trim().length > 0) {
    if (raw === ":memory:") return raw;
    return resolve(raw);
  }
  // server/dist/index.js 기준으로 server/data/auth.db
  return resolve(process.cwd(), "data", "auth.db");
}

function applyMigrations(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      account_id    TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_tokens (
      token         TEXT PRIMARY KEY,
      account_id    TEXT NOT NULL REFERENCES users(account_id) ON DELETE CASCADE,
      expires_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_access_tokens_account
      ON access_tokens(account_id);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token         TEXT PRIMARY KEY,
      account_id    TEXT NOT NULL REFERENCES users(account_id) ON DELETE CASCADE,
      expires_at_ms INTEGER NOT NULL,
      revoked       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_account
      ON refresh_tokens(account_id);
  `);
}

/**
 * 폴더 0700·DB 0600으로 준비한다 (DEF-SEC-002).
 * 서버가 새로 만든 폴더와 기본 경로(server/data)만 0700으로 둔다. 환경변수로 지정한
 * 이미 있는 폴더(공용 폴더일 수 있음)의 권한은 바꾸지 않는다.
 */
function prepareDbLocation(path: string): void {
  const dir = dirname(path);
  const created = mkdirSync(dir, { recursive: true, mode: DB_DIR_MODE });
  if (created !== undefined || dir === resolve(process.cwd(), "data")) {
    chmodSync(dir, DB_DIR_MODE);
  }
  // 새 DB가 0644로 생기지 않게 0600 빈 파일을 먼저 만든다(빈 파일은 유효한 SQLite 시작점).
  closeSync(openSync(path, "a", DB_FILE_MODE));
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const path = resolveDbPath();
  if (path !== ":memory:") prepareDbLocation(path);
  const db = new Database(path);
  applyMigrations(db);
  if (path !== ":memory:") secureDbFiles(path);
  dbInstance = db;
  return db;
}

/** 테스트/스모크 전용. close + clear singleton. */
export function __closeDbForTests(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
