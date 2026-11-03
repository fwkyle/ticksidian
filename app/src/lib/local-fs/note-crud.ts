/**
 * note-crud.ts
 *
 * 개별 노트 파일 읽기/쓰기/삭제/이동 + 폴더 관리 + 파일 메타 조회.
 */

import type { FolderNode } from '../../types/note';
import { parseFrontmatter } from '../markdown-import';
import { formatYamlKey, formatYamlValueStrict } from '../frontmatter-yaml';
import { assertSafeFileName, assertSafeFolderPath, extractTitleFromMarkdown } from '../local-fs-helpers';
import { tauriVaultAdapter } from '../tauri-vault-adapter';
import { moveMarkdownFile, renameMarkdownFile } from '../tauri-commands';
import {
  ensureDirectory,
  ensureNotesDirectory,
  getNotesRootDir,
  getNotePath,
  readTextFile,
  writeTextFile,
} from './vault-paths';

const WELCOME_FILE = 'welcome.md';
const PROJECT_META_FILE = '.project.json';
const EXTERNAL_CHANGE_MESSAGE = '기록이 외부에서 바뀌어 표시 변경을 멈췄습니다. 다시 확인해 주세요.';
const FRONTMATTER_UNREADABLE_MESSAGE =
  '머리말(frontmatter)을 읽을 수 없어 변경을 멈췄습니다. 노트 파일의 머리말을 고친 뒤 다시 시도해 주세요.';

function isExternalModificationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'fileModifiedExternally';
}

// 노트 파일 읽기
export async function readNoteFile(noteId: string, folder = ''): Promise<{ content: string; title: string }> {
  assertSafeFileName(noteId);
  assertSafeFolderPath(folder);
  const path = getNotePath(`${noteId}.md`, folder);
  const content = await readTextFile(path);
  const title = extractTitleFromMarkdown(content, noteId);
  return { content, title };
}

export function getNoteAbsolutePath(noteId: string, folder = ''): string {
  assertSafeFileName(noteId);
  assertSafeFolderPath(folder);
  return getNotePath(`${noteId}.md`, folder);
}

export async function getNoteFileModifiedAt(noteId: string, folder = ''): Promise<number | null> {
  assertSafeFileName(noteId);
  assertSafeFolderPath(folder);
  try {
    const stat = await tauriVaultAdapter.getFileStat(getNoteAbsolutePath(noteId, folder));
    return stat.modifiedAt;
  } catch {
    return null;
  }
}

/** 자동 오픈 후보 판정용 파일 크기(byte). 후보만 호출한다. */
export async function getNoteFileSize(noteId: string, folder = ''): Promise<number | null> {
  assertSafeFileName(noteId);
  try {
    const stat = await tauriVaultAdapter.getFileStat(getNoteAbsolutePath(noteId, folder));
    return stat.size;
  } catch {
    return null;
  }
}

// 노트 파일 쓰기
export async function writeNoteFile(noteId: string, content: string, folder = ''): Promise<void> {
  assertSafeFileName(noteId);
  assertSafeFolderPath(folder);
  const path = getNotePath(`${noteId}.md`, folder);
  if (folder) {
    await ensureDirectory(`${getNotesRootDir()}/${folder}`);
  } else {
    await ensureNotesDirectory();
  }
  await writeTextFile(path, content);
}

// 노트 frontmatter 업데이트 (본문 유지, frontmatter만 교체)
export async function updateNoteFrontmatter(
  noteId: string,
  folder: string,
  updates: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
): Promise<void> {
  assertSafeFileName(noteId);
  assertSafeFolderPath(folder);
  const path = getNotePath(`${noteId}.md`, folder);
  const baseline = (await tauriVaultAdapter.getFileStat(path)).modifiedAt;
  if (baseline === null) throw new Error('기록의 수정 시각을 확인할 수 없습니다.');
  const content = await readTextFile(path);
  const { frontmatter, body, error } = parseFrontmatter(content);
  // 머리말을 읽지 못했는데 다시 쓰면 원본 머리말이 사라진다(DEF-DATA-002). 파일은 건드리지 않는다.
  if (error !== undefined) throw new Error(FRONTMATTER_UNREADABLE_MESSAGE);

  for (const [key, value] of Object.entries(defaults)) {
    if (frontmatter[key] === undefined) frontmatter[key] = value;
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null) {
      delete frontmatter[key];
    } else {
      frontmatter[key] = value;
    }
  }

  const fmLines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    // 편집기 저장과 같은 직렬화 규칙. 직렬화할 수 없으면 여기서 던져 파일을 쓰지 않는다.
    fmLines.push(`${formatYamlKey(key)}: ${formatYamlValueStrict(key, value)}`);
  }
  fmLines.push('---');

  const newContent = fmLines.join('\n') + '\n' + body;
  if ((await tauriVaultAdapter.getFileStat(path)).modifiedAt !== baseline) {
    throw new Error(EXTERNAL_CHANGE_MESSAGE);
  }
  // 쓰기 직전 native가 한 번 더 비교한다(DEF-CONC-004). 외부 프로세스와의 완전한 CAS는 아니다.
  try {
    await writeTextFile(path, newContent, baseline);
  } catch (error) {
    if (isExternalModificationError(error)) throw new Error(EXTERNAL_CHANGE_MESSAGE);
    throw error;
  }
}

// 노트 파일 삭제
export async function deleteNoteFile(noteId: string, folder = ''): Promise<void> {
  assertSafeFileName(noteId);
  assertSafeFolderPath(folder);
  const path = getNotePath(`${noteId}.md`, folder);
  await tauriVaultAdapter.deleteFile(path);
}

/**
 * 그림 파일 삭제 (2026-08-23 TICK-BUG-004).
 *
 * `deleteNoteFile`은 basename 뒤에 `.md`를 붙인다. 그림(`*.excalidraw`)의 `fileBasename`은
 * 이미 확장자를 포함한 실제 파일명이므로 그대로 써야 한다. 삭제 자체는 노트와 같은 경로
 * (`.trash` 이동)를 탄다.
 */
export async function deleteDrawingFile(fileName: string, folder = ''): Promise<void> {
  assertSafeFileName(fileName);
  assertSafeFolderPath(folder);
  await tauriVaultAdapter.deleteFile(getNotePath(fileName, folder));
}

// 노트 파일 이동: 등록 볼트·mtime·경로를 확인한 뒤 덮어쓰기 없는 이름 이동.
export async function moveNoteFile(noteId: string, fromFolder: string, toFolder: string): Promise<void> {
  assertSafeFileName(noteId);
  assertSafeFolderPath(fromFolder);
  assertSafeFolderPath(toFolder);
  if (fromFolder === toFolder) return;

  const srcPath = getNotePath(`${noteId}.md`, fromFolder);
  const root = getNotesRootDir();
  const destination = toFolder ? `${root}/${toFolder}` : root;
  const stat = await tauriVaultAdapter.getFileStat(srcPath);
  if (stat.modifiedAt === null) throw new Error('원본 수정 시각을 확인할 수 없습니다.');
  await moveMarkdownFile(root, srcPath, destination, stat.modifiedAt);
}

/**
 * 노트 파일명 변경 (같은 폴더 안, 덮어쓰기 금지 원자적 이동 한 번).
 *
 * 읽기→검사→쓰기→삭제로 나뉘던 4단계를 `rename_markdown_file` 한 번으로 줄여,
 * 확인 뒤 목적지가 생겨도 덮지 않고 중간에 두 파일이 보이지 않는다(DEF-CONC-003).
 * 바이트·mtime이 보존되며 원본 `.trash` 사본은 생기지 않는다.
 * 설계: docs/waterfall/03-상세설계/파일명-제목-동기화.md
 */
export async function renameNoteFile(
  fromBasename: string,
  toBasename: string,
  folder = '',
): Promise<void> {
  assertSafeFileName(fromBasename);
  assertSafeFileName(toBasename);
  assertSafeFolderPath(folder);
  if (fromBasename === toBasename) return;

  const srcPath = getNotePath(`${fromBasename}.md`, folder);
  const stat = await tauriVaultAdapter.getFileStat(srcPath);
  if (stat.modifiedAt === null) throw new Error('원본 수정 시각을 확인할 수 없습니다.');
  await renameMarkdownFile(getNotesRootDir(), srcPath, `${toBasename}.md`, stat.modifiedAt);
}

// welcome.md 생성
export async function createWelcomeNote(): Promise<void> {
  const welcomeContent = `---
id: "welcome"
title: "Welcome to Ticksidian"
createdAt: "${new Date().toISOString()}"
updatedAt: "${new Date().toISOString()}"
source: "ticksidian"
---

# Welcome to Ticksidian

노션처럼 **/** 를 입력해서 블록을 추가핟보세요.

**/database** — 노션 스타일 DB 테이블 삽입

**/todo** — 투두 아이템 삽입

- [ ] 첫 번째 할 일
`;

  const path = getNotePath(WELCOME_FILE);
  await ensureNotesDirectory();

  try {
    await readTextFile(path);
    // 이미 존재하면 스킵
    return;
  } catch {
    // 없으면 생성
    await writeTextFile(path, welcomeContent);
  }
}

/* ──────────────── Folders ──────────────── */

/** notes/ 하위 폴더 목록을 트리로 스캔 */
export async function scanFolderTree(): Promise<FolderNode[]> {
  const notesDir = getNotesRootDir();

  async function buildTree(dir: string, relPath: string): Promise<FolderNode[]> {
    let entries: Awaited<ReturnType<typeof tauriVaultAdapter.listDirectoryEntries>>;
    try {
      entries = await tauriVaultAdapter.listDirectoryEntries(dir);
    } catch {
      return [];
    }

    const folders: FolderNode[] = [];
    for (const entry of entries) {
      const { name, path: entryPath, isDir } = entry;
      if (name.startsWith('.')) continue;
      if (!isDir) continue;

      const childRel = relPath ? `${relPath}/${name}` : name;
      const children = await buildTree(entryPath, childRel);
      const isProject = await checkIsProject(entryPath);
      folders.push({ name, path: childRel, children, isProject });
    }
    return folders;
  }

  return buildTree(notesDir, '');
}

/** 폴더 생성 */
export async function createNoteFolder(folderPath: string): Promise<void> {
  assertSafeFolderPath(folderPath);
  const fullPath = `${getNotesRootDir()}/${folderPath}`;
  await ensureDirectory(fullPath);
}

/** 폴더 이름 변경. 새 이름은 마지막 segment만 바꾼다. */
export async function renameNoteFolder(folderPath: string, newName: string): Promise<void> {
  assertSafeFolderPath(folderPath);
  const fullPath = `${getNotesRootDir()}/${folderPath}`;
  await tauriVaultAdapter.renameDirectory(fullPath, newName);
}

/** 폴더 삭제 대신 볼트 내부 .trash/ticksidian/ 아래로 옮긴다. */
export async function trashNoteFolder(folderPath: string): Promise<void> {
  assertSafeFolderPath(folderPath);
  const fullPath = `${getNotesRootDir()}/${folderPath}`;
  await tauriVaultAdapter.trashDirectory(fullPath);
}

/** 프로젝트 메타 확인 */
async function checkIsProject(dirPath: string): Promise<boolean> {
  try {
    await readTextFile(`${dirPath}/${PROJECT_META_FILE}`);
    return true;
  } catch {
    return false;
  }
}

/** 폴더를 프로젝트로 설정/해제 */
export async function setFolderAsProject(folderPath: string, isProject: boolean): Promise<void> {
  assertSafeFolderPath(folderPath);
  const fullDir = `${getNotesRootDir()}/${folderPath}`;
  const metaPath = `${fullDir}/${PROJECT_META_FILE}`;

  if (isProject) {
    const meta = JSON.stringify({ isProject: true, createdAt: Date.now() }, null, 2);
    await writeTextFile(metaPath, meta);
  } else {
    try {
      await tauriVaultAdapter.deleteFile(metaPath);
    } catch {
      // 없으면 무시
    }
  }
}
