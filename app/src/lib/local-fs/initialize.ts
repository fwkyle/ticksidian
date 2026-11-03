/**
 * initialize.ts
 *
 * 볼트 초기화 흐름을 조립한다.
 *
 * B-2 migration hot path 제거:
 *   - VaultBinding.todosMigrationDone === 1 이면 migrateTodosToMarkdown을 호출하지 않는다.
 *   - 미완료면 실행 후 'blocked'가 아닐 때만 todosMigrationDone: 1 로 upsert 한다.
 *   - 'blocked'이면 절대 1로 표시하지 않는다 — 미해결 충돌 영구 무시 방지.
 */

import { getVaultBinding, upsertVaultBinding } from '../tauri-commands';
import { registerVaultPath, ensureNotesDirectory, getVaultPath } from './vault-paths';
import { scanNoteFiles } from './note-scan';
import { createWelcomeNote } from './note-crud';
import { migrateTodosToMarkdown, decideMigrationMarkDone } from './todos-migration';

/**
 * 볼트 초기화:
 * 1. 경로 등록 + notes/ 디렉터리 확인
 * 2. todosMigrationDone 플래그를 SQLite VaultBinding에서 읽어,
 *    아직 완료되지 않은 경우에만 migrateTodosToMarkdown을 실행한다.
 * 3. 마이그레이션 결과가 'blocked'가 아니면 binding을 done:1 로 upsert 한다.
 * 4. 노트가 하나도 없으면 welcome.md 생성.
 */
export async function initializeVault(path: string): Promise<void> {
  await registerVaultPath(path);
  await ensureNotesDirectory();

  // VaultBinding에서 todosMigrationDone 플래그 확인
  const vaultPath = getVaultPath();
  if (vaultPath) {
    let migrationDone = false;
    try {
      const binding = await getVaultBinding(vaultPath);
      migrationDone = (binding?.todosMigrationDone ?? 0) === 1;
    } catch {
      // DB 접근 실패 시 안전하게 migration 실행 경로로 진행
    }

    if (!migrationDone) {
      const result = await migrateTodosToMarkdown();
      if (decideMigrationMarkDone(result)) {
        try {
          const binding = await getVaultBinding(vaultPath);
          const now = Date.now();
          if (binding) {
            await upsertVaultBinding({
              ...binding,
              todosMigrationDone: 1,
              updatedAt: now,
            });
          } else {
            // 처음 보는 볼트 — local_only 기본형 + done:1
            await upsertVaultBinding({
              localVaultId: vaultPath,
              localVaultPath: vaultPath,
              syncMode: 'local_only',
              accountId: null,
              remoteVaultId: null,
              authState: 'signed_out',
              lastSyncCursor: null,
              lastSyncSummaryJson: null,
              todosMigrationDone: 1,
              createdAt: now,
              updatedAt: now,
            });
          }
        } catch {
          // DB 업데이트 실패해도 로컬 편집 흐름은 유지
          console.warn('[initializeVault] failed to mark todosMigrationDone=1');
        }
      }
    }
  }

  // 노트가 하나도 없으면 welcome.md 생성
  const notes = await scanNoteFiles();
  if (notes.length === 0) {
    await createWelcomeNote();
  }
}
