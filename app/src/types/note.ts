/** @deprecated Use NoteListItem instead */
export interface Note {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteListItem {
  id: string;
  /**
   * 디스크 위 실제 파일명 stem (확장자 제외).
   * id와 다를 수 있음: 같은 stem이 여러 폴더에 있을 때 id는 `stem__folder` 형태로 고유화된다.
   * IO 함수(readNoteFile 등)는 fileBasename + folder 조합으로 경로를 구성한다.
   */
  fileBasename: string;
  title: string;
  createdAt: Date;
  /** 사람에게 보여줄 "수정일". frontmatter.updatedAt이 있으면 그 값, 없으면 파일 mtime. */
  updatedAt: Date;
  /**
   * 파일 시스템이 기록한 마지막 수정 시각(ms).
   * frontmatter.updatedAt과 무관하게 외부 수정을 감지할 때 쓴다.
   * 외부 편집기가 frontmatter.updatedAt을 안 고쳐도 이 값은 바뀐다.
   */
  fileMtime?: number;
  /** notes/ 기준 상대 폴더 경로. 루트면 "" */
  folder: string;
  /** 위키링크 해석용 보조 이름 목록 (제목 변경 시 자동 누적) */
  aliases?: string[];
  /** notes/ 기준 상대 파일 경로 (e.g. "프로젝트/note-123.md") */
  filePath?: string;
  /** "todo"이면 투두 노트, 없으면 일반 노트 */
  type?: "todo";
  /** 투두 완료 여부 */
  done?: boolean;
  /** 마감일 (ISO 날짜 문자열, e.g. "2026-04-10") */
  dueDate?: string;
  /** 우선순위 (e.g. "긴급", "높음", "중간", "낮음") */
  priority?: string;
  /** 태그 목록 */
  tags?: string[];
  /** 즐겨찾기(별표). frontmatter `favorite: true`만 참으로 본다 (2026-09-19 TICK-UX-013) */
  favorite?: boolean;
  /** 기존 가져오기 기록을 별도 그룹으로 보여 주기 위한 출처. */
  externalSource?: string;
  /** 옵시디언 Excalidraw 플러그인 그림 파일(frontmatter excalidraw-plugin) — 편집 보호 대상 */
  excalidrawPlugin?: boolean;
  /**
   * raw JSON 그림 파일(`*.excalidraw`, 2026-08-23 TICK-DRAW-001).
   * 노트가 아니므로 노트 IO(`readNoteFile` 등)를 타지 않고 전용 화면에서 연다.
   * `fileBasename`에 확장자가 포함돼 있다(같은 이름 `.md`와 id가 겹치지 않게).
   */
  drawing?: boolean;
}

/** 폴더 트리 노드 */
export interface FolderNode {
  name: string;
  /** notes/ 기준 상대 경로 (예: "마케팅", "마케팅/캠페인") */
  path: string;
  children: FolderNode[];
  isProject: boolean;
}

export type VaultSyncState =
  | "idle"
  | "syncing"
  | "synced"
  | "local_changed"
  | "conflicted"
  | "preserved_both"
  | "failed";

export type VaultConflictPolicy =
  | "keep-both"
  | "prefer-server"
  | "prefer-local";

export interface VaultSyncMeta {
  noteId: string;
  serverRevision: string | null;
  serverUpdatedAt: number | null;
  localFilePath: string;
  localFileHash: string | null;
  localFileMtime: number | null;
  lastSyncedAt: number | null;
  syncState: VaultSyncState;
  conflictPolicy: VaultConflictPolicy;
  conflictCopyPath: string | null;
  noteTitle: string | null;
  createdAt: number;
  updatedAt: number;
}

export type VaultSyncMode = "local_only" | "sync_enabled";

export type VaultAuthState = "signed_out" | "signed_in" | "reauth_required";

export interface VaultBinding {
  localVaultId: string;
  localVaultPath: string;
  syncMode: VaultSyncMode;
  accountId: string | null;
  remoteVaultId: string | null;
  authState: VaultAuthState;
  lastSyncCursor: string | null;
  lastSyncSummaryJson: string | null;
  /**
   * todos.json → .md 1회 마이그레이션 완료 여부.
   * 1이면 완료, 0이면 미완료(또는 blocked). 기본값 0.
   */
  todosMigrationDone: number;
  createdAt: number;
  updatedAt: number;
}
