import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  VaultSyncState,
  VaultConflictPolicy,
  VaultSyncMeta,
  VaultBinding,
  VaultSyncMode,
  VaultAuthState,
} from '../types/note';

import {
  toRagIndexStatus,
  toRagSearchHit,
  type RagIndexStatus,
  type RagSearchHit,
  type RawRagIndexStatus,
  type RawRagSearchHit,
} from './rag-conversion';

// 하위 호환: 기존 임포트 경로(hooks/useRagSearch)에서 그대로 쓸 수 있도록 재노출.
export type { RagIndexStatus, RagSearchHit } from './rag-conversion';

// Rust schema.rs serializes VaultSyncState as snake_case via serde;
// app types use camelCase.  Raw ↔ camelCase mapping at this boundary.

interface RawVaultSyncMeta {
  note_id: string;
  server_revision: string | null;
  server_updated_at: number | null;
  local_file_path: string;
  local_file_hash: string | null;
  local_file_mtime: number | null;
  last_synced_at: number | null;
  sync_state: string;
  conflict_policy: string;
  conflict_copy_path: string | null;
  note_title: string | null;
  created_at: number;
  updated_at: number;
}

interface RawVaultBinding {
  local_vault_id: string;
  local_vault_path: string;
  sync_mode: string;
  account_id: string | null;
  remote_vault_id: string | null;
  auth_state: string;
  last_sync_cursor: string | null;
  last_sync_summary_json: string | null;
  todos_migration_done: number;
  created_at: number;
  updated_at: number;
}

function toVaultSyncMeta(raw: RawVaultSyncMeta): VaultSyncMeta {
  return {
    noteId: raw.note_id,
    serverRevision: raw.server_revision,
    serverUpdatedAt: raw.server_updated_at,
    localFilePath: raw.local_file_path,
    localFileHash: raw.local_file_hash,
    localFileMtime: raw.local_file_mtime,
    lastSyncedAt: raw.last_synced_at,
    syncState: raw.sync_state as VaultSyncState,
    conflictPolicy: raw.conflict_policy as VaultConflictPolicy,
    conflictCopyPath: raw.conflict_copy_path,
    noteTitle: raw.note_title,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function toRaw(meta: VaultSyncMeta): RawVaultSyncMeta {
  return {
    note_id: meta.noteId,
    server_revision: meta.serverRevision,
    server_updated_at: meta.serverUpdatedAt,
    local_file_path: meta.localFilePath,
    local_file_hash: meta.localFileHash,
    local_file_mtime: meta.localFileMtime,
    last_synced_at: meta.lastSyncedAt,
    sync_state: meta.syncState,
    conflict_policy: meta.conflictPolicy,
    conflict_copy_path: meta.conflictCopyPath,
    note_title: meta.noteTitle,
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
  };
}

function toVaultBinding(raw: RawVaultBinding): VaultBinding {
  return {
    localVaultId: raw.local_vault_id,
    localVaultPath: raw.local_vault_path,
    syncMode: raw.sync_mode as VaultSyncMode,
    accountId: raw.account_id,
    remoteVaultId: raw.remote_vault_id,
    authState: raw.auth_state as VaultAuthState,
    lastSyncCursor: raw.last_sync_cursor,
    lastSyncSummaryJson: raw.last_sync_summary_json,
    todosMigrationDone: raw.todos_migration_done ?? 0,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function toRawVaultBinding(binding: VaultBinding): RawVaultBinding {
  return {
    local_vault_id: binding.localVaultId,
    local_vault_path: binding.localVaultPath,
    sync_mode: binding.syncMode,
    account_id: binding.accountId,
    remote_vault_id: binding.remoteVaultId,
    auth_state: binding.authState,
    last_sync_cursor: binding.lastSyncCursor,
    last_sync_summary_json: binding.lastSyncSummaryJson,
    todos_migration_done: binding.todosMigrationDone ?? 0,
    created_at: binding.createdAt,
    updated_at: binding.updatedAt,
  };
}

export async function readMarkdownFile(path: string): Promise<string> {
  return invoke<string>('read_markdown_file', { path });
}

export async function writeMarkdownFile(
  path: string,
  content: string,
): Promise<void> {
  return invoke('write_markdown_file', { path, content });
}

/** 완성 파일을 빈 이름에만 게시한다. 기존 파일은 읽기 가능 여부와 무관하게 보존한다. */
export async function createMarkdownFileIfAbsent(path: string, content: string): Promise<boolean> {
  return invoke<boolean>('create_markdown_file_if_absent', { path, content });
}

/** 등록 볼트 안 원본을 덮어쓰기 없이 이동한다. 종류·본문·mtime은 바꾸지 않는다. */
export async function moveMarkdownFile(vaultPath: string, path: string, toFolder: string, expectedMtime: number): Promise<void> {
  return invoke('move_markdown_file', { vaultPath, path, toFolder, expectedMtime });
}

/** 같은 폴더 안 파일명 변경: 덮어쓰기 금지 원자적 이동 한 번(DEF-CONC-003). */
export async function renameMarkdownFile(vaultPath: string, path: string, newName: string, expectedMtime: number): Promise<void> {
  return invoke('rename_markdown_file', { vaultPath, path, newName, expectedMtime });
}

export async function getSyncMeta(
  noteId: string,
): Promise<VaultSyncMeta | null> {
  const raw = await invoke<RawVaultSyncMeta | null>('get_sync_meta', {
    noteId,
  });
  return raw ? toVaultSyncMeta(raw) : null;
}

export async function upsertSyncMeta(meta: VaultSyncMeta): Promise<void> {
  return invoke('upsert_sync_meta', { state: toRaw(meta) });
}

export async function deleteSyncMeta(noteId: string): Promise<void> {
  return invoke('delete_sync_meta', { noteId });
}

export async function listSyncMetaByState(
  state: VaultSyncState,
): Promise<VaultSyncMeta[]> {
  const raws = await invoke<RawVaultSyncMeta[]>('list_sync_meta_by_state', {
    state,
  });
  return raws.map(toVaultSyncMeta);
}

export async function getVaultBinding(
  localVaultId: string,
): Promise<VaultBinding | null> {
  const raw = await invoke<RawVaultBinding | null>('get_vault_binding', {
    localVaultId,
  });
  return raw ? toVaultBinding(raw) : null;
}

export async function upsertVaultBinding(
  binding: VaultBinding,
): Promise<void> {
  return invoke('upsert_vault_binding', {
    binding: toRawVaultBinding(binding),
  });
}

export async function listVaultBindings(): Promise<VaultBinding[]> {
  const raws = await invoke<RawVaultBinding[]>('list_vault_bindings');
  return raws.map(toVaultBinding);
}

export async function selectVaultFolder(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title: '볼트 폴더 선택',
  });
  // open() returns string | string[] | null; with multiple:false it is string | null
  if (result === null) return null;
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export async function registerVaultPath(vaultPath: string): Promise<void> {
  return invoke('register_vault_path', { vaultPath });
}

export async function listVaultNotes(vaultPath: string): Promise<string[]> {
  return invoke<string[]>('list_vault_notes', { vaultPath });
}

// 볼트 파일 시스템 push watcher (TICK-P1-006).
// Rust notify가 변경 시 'vault-fs-changed' 이벤트를 emit한다. 폴링은 fallback으로
// 유지하므로 이 호출들이 실패해도 앱은 정상 동작한다.

/** 볼트 루트 재귀 감시 시작(이전 감시는 교체). 등록된 vault 경계 안만 허용. */
export async function startVaultWatch(vaultPath: string): Promise<void> {
  return invoke('start_vault_watch', { path: vaultPath });
}

/** 감시 중지. */
export async function stopVaultWatch(): Promise<void> {
  return invoke('stop_vault_watch');
}

/** 'vault-fs-changed' 이벤트 구독. 반환된 함수를 호출하면 구독 해제. */
export async function subscribeVaultChanges(
  onChange: () => void,
): Promise<UnlistenFn> {
  return listen('vault-fs-changed', () => onChange());
}

// 마이그레이션용 명령어

export async function checkFileExists(filePath: string): Promise<boolean> {
  return invoke<boolean>('check_file_exists', { filePath });
}

export async function createDirectory(
  dirPath: string,
  recursive = true
): Promise<void> {
  return invoke('create_directory', { dirPath, recursive });
}

// 범용 파일 읽기/쓰기

export async function readTextFile(path: string): Promise<string> {
  return invoke<string>('read_text_file', { path });
}

/**
 * 볼트 안 바이너리 파일(이미지 등) 읽기 — 2026-08-19 이미지 임베드 보기.
 * Rust가 tauri::ipc::Response(raw)로 주면 JS는 ArrayBuffer로 받는다(설계 §1-3).
 */
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>('read_binary_file', { path });
  return new Uint8Array(buffer);
}

/**
 * 볼트 안 바이너리 파일(이미지 등) 원자적 쓰기 — 2026-08-19 이미지 넣기.
 * raw body로 바이트를 보내고 경로는 커스텀 헤더로 전달한다(설계 1-3).
 */
export async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  // HTTP 헤더는 ASCII 밖 문자를 실을 수 없다(한글 경로에서 JS Headers가 ByteString
  // 예외 — 2026-08-20 검수 실측). encodeURIComponent로 싣고 Rust가 percent-decode한다.
  return invoke('write_binary_file', bytes, {
    headers: { 'x-ticksidian-path': encodeURIComponent(path) },
  });
}

/**
 * 텍스트 원자적 쓰기. 반환값은 "내가 쓴 내용의 mtime"(epoch ms)이다 — Rust가 게시 전
 * 임시 파일에서 읽어 돌려주므로 저장 직후 재조회와 달리 외부 쓰기가 섞이지 않는다(DEF-CONC-002).
 */
export async function writeTextFile(path: string, content: string, expectedMtime?: number): Promise<number> {
  return invoke<number>('write_text_file', { path, content, expectedMtime });
}

export async function listDirectory(dirPath: string): Promise<string[]> {
  return invoke<string[]>('list_directory', { dirPath });
}

export interface DirectoryEntry {
  path: string;
  name: string;
  isDir: boolean;
  isFile: boolean;
  /** 파일 수정 시각 (epoch milliseconds). 디렉터리 항목 또는 metadata 조회 실패 시 null/undefined. */
  modifiedAt?: number | null;
  /** 파일 생성 시각(birthtime, epoch ms). 디렉터리/미지원 FS면 null/undefined (2026-08-23 TICK-UX-006). */
  createdAt?: number | null;
}

export async function listDirectoryEntries(
  dirPath: string,
): Promise<DirectoryEntry[]> {
  return invoke<DirectoryEntry[]>('list_directory_entries', { dirPath });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke('delete_file', { path });
}

export async function renameDirectory(path: string, newName: string): Promise<void> {
  return invoke('rename_directory', { path, newName });
}

export async function trashDirectory(path: string): Promise<void> {
  return invoke('trash_directory', { path });
}

// Rust에서 반환하는 snake_case를 camelCase로 변환
interface RawFileStat {
  path: string;
  size: number;
  modified_at: number | null;
  created_at: number | null;
}

export interface FileStat {
  path: string;
  size: number;
  modifiedAt: number | null;
  createdAt: number | null;
}

function toFileStat(raw: RawFileStat): FileStat {
  return {
    path: raw.path,
    size: raw.size,
    modifiedAt: raw.modified_at,
    createdAt: raw.created_at,
  };
}

export async function getFileStat(path: string): Promise<FileStat> {
  const raw = await invoke<RawFileStat>('get_file_stat', { path });
  return toFileStat(raw);
}

// M3-1f secure refresh token storage (OS keychain via keyring crate).
// access token은 절대 디스크에 저장하지 않으므로 wrapper도 만들지 않는다.

export async function secureGetRefreshToken(): Promise<string | null> {
  return invoke<string | null>('secure_get_refresh_token');
}

export async function secureSetRefreshToken(token: string): Promise<void> {
  return invoke('secure_set_refresh_token', { token });
}

export async function secureClearRefreshToken(): Promise<void> {
  return invoke('secure_clear_refresh_token');
}

// RAG 검색 (TICK-P0-008) — Rust에서 sqlite-vec/FTS5 검색 + Gemini 쿼리 임베딩.
// API 키는 Rust 프로세스 env(GEMINI_API_KEY)에서만 읽는다.

/** RAG 인덱스 상태 조회 (읽기 전용, Gemini 호출 없음). */
export async function getRagIndexStatus(
  vaultPath: string,
): Promise<RagIndexStatus> {
  const raw = await invoke<RawRagIndexStatus>('rag_index_status', { vaultPath });
  // Rust는 serde(rename_all = "camelCase")로 보내므로 원형이 이미 camelCase다.
  return toRagIndexStatus(raw);
}

/** 하이브리드 RAG 검색 (FTS5 + sqlite-vec + 제목). 쿼리 임베딩은 Gemini API. */
export async function ragSearch(
  vaultPath: string,
  query: string,
  limit = 10,
): Promise<RagSearchHit[]> {
  const raws = await invoke<RawRagSearchHit[]>('rag_search', { vaultPath, query, limit });
  // Rust 원형이 camelCase(filePath 등)이므로 매핑은 1:1이지만 계약 고정용으로 둔다.
  return raws.map(toRagSearchHit);
}

/** 검토 큐 항목 AI 분류 결과 (TICK-P0-007 3차). Rust classify_review_item. */
export interface ReviewClassificationResult {
  classification: string;
  reason: string;
  confidence: number;
}

/** 검토 큐 항목 AI 분류 (gemini-3.8-flash, Rust API 키). 분류 7종 검증은 Rust가 담당(fail-closed). */
export async function classifyReviewItem(
  title: string,
  content: string,
): Promise<ReviewClassificationResult> {
  return invoke<ReviewClassificationResult>('classify_review_item', { title, content });
}

/** 보안 메모 파일 정보 (Rust list_secret_files, 읽기 전용). */
export interface SecretFileMeta {
  path: string;
  sizeBytes: number;
  modifiedMs: number;
}

/** 비밀 폴더 설정 상태. 경로는 표시용이며 선택 명령은 경로 인자를 받지 않는다. */
export interface SecretsFolderStatus {
  configured: boolean;
  path: string | null;
  /** 설정이 있지만 허용되지 않아 무시했을 때의 이유(없으면 null). */
  reason?: string | null;
}

/** 현재 비밀 폴더 설정 상태(읽기 전용). */
export async function getSecretsFolderStatus(): Promise<SecretsFolderStatus> {
  return invoke<SecretsFolderStatus>('get_secrets_folder_status');
}

/**
 * 비밀 폴더 고르기. Rust가 네이티브 선택 창을 열고 검증·저장한다(경로 인자 없음).
 * 취소하면 null, 너무 넓거나 잘못된 폴더면 오류.
 */
export async function selectSecretsFolder(): Promise<SecretsFolderStatus | null> {
  return invoke<SecretsFolderStatus | null>('select_secrets_folder');
}

/** 비밀 폴더 하위 파일 목록(읽기 전용, 노이즈 제외). */
export async function listSecretFiles(): Promise<SecretFileMeta[]> {
  return invoke<SecretFileMeta[]>('list_secret_files');
}

/** 지정한 보안 메모 파일 내용(읽기 전용, 512KB 상한). */
export async function readSecretFile(relPath: string): Promise<string> {
  return invoke<string>('read_secret_file', { relPath });
}

/** 보안 메모 쓰기 결과(TICK-SEC-002). */
export interface SecretWriteResult {
  path: string;
  sizeBytes: number;
  modifiedMs: number;
}

/** 새 보안 메모 생성(존재하면 거부, 원자적 쓰기, 생성 직후 chmod 600). */
export async function createSecretFile(
  relPath: string,
  content: string,
): Promise<SecretWriteResult> {
  return invoke<SecretWriteResult>('create_secret_file', { relPath, content });
}

/** 편집 진입('수정' 버튼 클릭 시점): 원본 백업 생성 후 현재 mtime 토큰 반환(나노초 정확도 문자열). */
export async function beginSecretEdit(relPath: string): Promise<string> {
  return invoke<string>('begin_secret_edit', { relPath });
}

/** 편집 저장(mtime 토큰 불일치 거부, 원자적 쓰기, 600 유지). 새 mtime 토큰 반환. */
export async function writeSecretFile(
  relPath: string,
  content: string,
  expectedMtime: string,
): Promise<string> {
  return invoke<string>('write_secret_file', { relPath, content, expectedMtime });
}

/** macOS Finder에서 원본 파일 하이라이트(Rust 명령 경유 — plugin 직접 호출 금지). */
export async function revealSecretInFinder(relPath: string): Promise<void> {
  return invoke<void>('reveal_secret_in_finder', { relPath });
}
