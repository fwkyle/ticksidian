/**
 * local-fs.ts — 재export 전용 barrel
 *
 * 구현은 ./local-fs/ 하위 모듈에 분리돼 있다.
 * 이 파일은 기존 import 경로(`./lib/local-fs`)를 깨지 않기 위한 barrel이다.
 *
 * 모듈 구성:
 *   vault-paths.ts   — 경로 관리 + 범용 IO
 *   note-scan.ts     — 볼트 스캔
 *   note-crud.ts     — 노트 CRUD + 폴더 관리
 *   todos-migration.ts — todos.json 1회 마이그레이션
 *   initialize.ts    — 볼트 초기화 조립
 */

export {
  getVaultPath,
  setVaultPath,
  selectVaultFolder,
  registerVaultPath,
  ensureNotesDirectory,
  readTextFile,
  writeTextFile,
  getVaultFileModifiedAt,
  readBinaryFile,
  writeBinaryFile,
  deleteVaultFile,
} from './local-fs/vault-paths';

export {
  scanNoteFiles,
} from './local-fs/note-scan';

export {
  scanVaultImageFiles,
} from './local-fs/image-scan';

export {
  deleteDrawingFile,
  readNoteFile,
  getNoteAbsolutePath,
  getNoteFileModifiedAt,
  getNoteFileSize,
  writeNoteFile,
  updateNoteFrontmatter,
  deleteNoteFile,
  moveNoteFile,
  renameNoteFile,
  createWelcomeNote,
  scanFolderTree,
  createNoteFolder,
  renameNoteFolder,
  trashNoteFolder,
  setFolderAsProject,
} from './local-fs/note-crud';

export {
  migrateTodosToMarkdown,
  blocksToSimpleMarkdown,
  decideMigrationMarkDone,
  type MigrationResult,
} from './local-fs/todos-migration';

export {
  initializeVault,
} from './local-fs/initialize';
