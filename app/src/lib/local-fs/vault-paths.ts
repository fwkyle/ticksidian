/**
 * vault-paths.ts
 *
 * 볼트 경로 관리 + 범용 파일 IO.
 * - 볼트 경로 get/set
 * - 볼트 폴더 선택 다이얼로그
 * - 경로 등록 (Tauri fs scope)
 * - 노트 뿌리 폴더 경로 계산(2026-08-16부터 볼트 폴더 자체)
 * - 파일 경로 조립
 * - 디렉터리 생성/확인
 * - 범용 readTextFile / writeTextFile
 */

import {
  assertSafeFileName,
  assertSafeFolderPath,
} from '../local-fs-helpers';
import { tauriVaultAdapter } from '../tauri-vault-adapter';

export function getVaultPath(): string | null {
  return tauriVaultAdapter.getVaultPath();
}

export function setVaultPath(path: string | null): void {
  tauriVaultAdapter.setVaultPath(path);
}

// 볼트 폴더 선택 다이얼로그
export async function selectVaultFolder(): Promise<string | null> {
  return tauriVaultAdapter.selectVaultFolder();
}

// 볼트 경로 등록 (Tauri fs scope 허용)
export async function registerVaultPath(path: string): Promise<void> {
  await tauriVaultAdapter.registerVaultPath(path);
}

/**
 * 노트를 스캔하고 저장하는 뿌리 폴더.
 *
 * 2026-08-16부터 **볼트 폴더 자체**다. 이전에는 `{볼트}/notes` 고정이라 옵시디언 볼트를 열어도
 * `notes/` 밖 문서가 하나도 안 보였다([kyle] 결정: 볼트 전체 읽기).
 * 설계: docs/waterfall/03-상세설계/볼트-전체-스캔.md
 *
 * 숨김(dot) 폴더 제외는 스캔 쪽(note-scan.ts)이 담당하므로 `.obsidian`, `.git`,
 * `.ticksidian*`은 여기서 따로 거르지 않는다.
 */
export function getNotesRootDir(): string {
  const currentVaultPath = getVaultPath();
  if (!currentVaultPath) throw new Error('Vault not initialized');
  return currentVaultPath;
}

// 파일 경로 생성 (폴더 지원)
export function getNotePath(fileName: string, folder = ''): string {
  assertSafeFileName(fileName);
  assertSafeFolderPath(folder);
  if (folder) return `${getNotesRootDir()}/${folder}/${fileName}`;
  return `${getNotesRootDir()}/${fileName}`;
}

// 디렉터리 확인 및 생성 (범용)
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await tauriVaultAdapter.createDirectory(dirPath, { recursive: true });
  } catch {
    // 이미 존재하면 무시
  }
}

/**
 * 노트 뿌리 폴더 확인. 볼트 폴더 자체이므로 이미 존재한다(사용자가 고른 폴더).
 * 2026-08-16 전에는 여기서 `notes/`를 자동 생성했지만, 이제 빈 폴더를 만들지 않는다 —
 * "일반 .md 폴더를 그대로 연다"는 것이 볼트의 의미다.
 */
export async function ensureNotesDirectory(): Promise<void> {
  await ensureDirectory(getNotesRootDir());
}

// 범용 파일 읽기/쓰기
export async function readTextFile(path: string): Promise<string> {
  return tauriVaultAdapter.readTextFile(path);
}

// 볼트 안 바이너리 파일(이미지 등) 읽기 — 2026-08-19 이미지 임베드 보기.
// 20MiB 상한은 Rust read_binary_file이 강제한다.
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  return tauriVaultAdapter.readBinaryFile(path);
}

// 볼트 안 바이너리 파일 원자적 쓰기 — 2026-08-19 이미지 넣기.
// 부모 폴더는 Rust write_file_atomic이 만든다(create_dir_all).
export async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  return tauriVaultAdapter.writeBinaryFile(path, bytes);
}

// 볼트 안 파일 삭제(.trash 이동은 Tauri 구현이 담당) — 이미지 정리용.
export async function deleteVaultFile(path: string): Promise<void> {
  return tauriVaultAdapter.deleteFile(path);
 }

/**
 * 볼트 안 임의 경로의 수정 시각(ms). 없거나 실패하면 null.
 * 노트 전용 `getNoteFileModifiedAt`과 달리 basename/folder 규칙을 타지 않는다
 * (그림 파일처럼 `.md`가 아닌 파일용, 2026-08-23 TICK-DRAW-001).
 */
export async function getVaultFileModifiedAt(path: string): Promise<number | null> {
  try {
    const stat = await tauriVaultAdapter.getFileStat(path);
    return stat.modifiedAt;
  } catch {
    return null;
  }
}

export async function writeTextFile(path: string, content: string, expectedMtime?: number): Promise<number> {
  return tauriVaultAdapter.writeTextFile(path, content, expectedMtime);
}
