import type { FolderNode } from "../types/note";

/** 보관 폴더의 확정 이름. dot 폴더가 아니라 일반 폴더다. */
export const ARCHIVE_FOLDER = "archive";

/** 이미지 첨부 루트 폴더(2026-08-19 TICK-IMG-002 노션 체감형). */
export const ATTACHMENTS_FOLDER = "attachments";

/** 최상위 archive 폴더만 보관 폴더다. */
export function isArchiveFolder(path: string): boolean {
  return path === ARCHIVE_FOLDER;
}

/** 최상위 attachments 폴더만 첨부 폴더다. */
export function isAttachmentsFolder(path: string): boolean {
  return path === ATTACHMENTS_FOLDER;
 }

/** 폴더 열 표시용 정렬: 보관 폴더와 첨부 폴더를 맨 아래로 보낸다(archive가 마지막). */
export function sortFolderNodesForDisplay(
  folders: readonly FolderNode[],
): FolderNode[] {
  const regular: FolderNode[] = [];
  const attachments: FolderNode[] = [];
  const archive: FolderNode[] = [];
  for (const folder of folders) {
    if (isArchiveFolder(folder.path)) archive.push(folder);
    else if (isAttachmentsFolder(folder.path)) attachments.push(folder);
    else regular.push(folder);
  }
  return [...regular, ...attachments, ...archive];
}
