import { chmodSync, existsSync } from "node:fs";

/**
 * 인증 DB 파일 권한 (DEF-SEC-002, 2026-10-20).
 * 설계: docs/waterfall/03-상세설계/M3-인증-설계.md §17.14
 */

export const DB_DIR_MODE = 0o700;
export const DB_FILE_MODE = 0o600;

/** SQLite 본 파일과 WAL/SHM 보조 파일의 권한을 0600으로 맞춘다. 없는 파일은 건너뛴다. */
export function secureDbFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(file)) chmodSync(file, DB_FILE_MODE);
  }
}
