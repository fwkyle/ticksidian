/**
 * folder-tree.ts — 폴더 선택과 노트 필터의 순수 규칙 (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/사이드바-3열-레이아웃.md
 * Node QA: app/qa-folder-tree.mjs
 *
 * Why: 볼트 전체 스캔 이후 노트 537개가 한 열에 쏟아져 목록이 끝나지 않는다.
 * 폴더 열에서 폴더를 고르면 노트 열에 그 폴더 것만 보이게 한다.
 *
 * React/DOM 없이 입출력만 다룬다.
 */

import type { FolderNode, NoteListItem } from "../types/note";

/** 폴더 선택 상태. `null`이면 "전체"(볼트의 모든 노트). */
export type FolderSelection = string | null;

/** "전체" 항목의 화면 라벨. */
export const ALL_NOTES_LABEL = "전체";
export const INBOX_FOLDER = "inbox";
export const INBOX_LABEL = "기본함";

/**
 * 폴더 경로가 선택한 폴더의 자신이거나 하위인가.
 *
 * **경로 세그먼트 단위로 비교한다.** 단순 문자열 접두 비교를 쓰면
 * `lectures-old`가 `lectures`의 하위로 잘못 잡힌다.
 *
 * - `isWithinFolder("lectures", "lectures")` → true (자신)
 * - `isWithinFolder("lectures/OS", "lectures")` → true (하위)
 * - `isWithinFolder("lectures-old", "lectures")` → false (다른 폴더)
 * - selection이 null이면 언제나 true("전체")
 */
export function isWithinFolder(folderPath: string, selection: FolderSelection): boolean {
  if (selection === null) return true;
  if (selection === "") return true; // 볼트 루트 선택은 전체와 같다
  if (folderPath === selection) return true;
  return folderPath.startsWith(`${selection}/`);
}

/**
 * 선택한 폴더에 속한 노트만 고른다(하위 폴더 포함).
 *
 * 하위 폴더를 포함하는 이유: 옵시디언 볼트는 `lectures/OS/source/text/...`처럼 깊다.
 * 상위 폴더를 골랐을 때 아무것도 안 보이면 폴더 열을 계속 파고 들어가야 한다.
 */
export function selectNotesForFolder(
  notes: readonly NoteListItem[],
  selection: FolderSelection,
): NoteListItem[] {
  if (selection === null) return [...notes];
  return notes.filter((note) => isWithinFolder(note.folder ?? "", selection));
}

/**
 * 폴더 경로 → 그 폴더에 속한 노트 수(하위 폴더 포함).
 *
 * 노트 배열을 1회 순회하면서 각 노트의 폴더와 그 조상 폴더 전부에 1을 더한다.
 * (예: `a/b/c`의 노트는 `a`, `a/b`, `a/b/c` 세 항목을 올린다.)
 */
export function countNotesByFolder(notes: readonly NoteListItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const folder = note.folder ?? "";
    if (folder === "") continue; // 루트 노트는 폴더 집계 대상이 아니다
    const segments = folder.split("/");
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

/** 폴더 경로에서 화면에 보여줄 이름(마지막 세그먼트). 빈 값이면 "전체". */
export function folderDisplayName(selection: FolderSelection): string {
  if (selection === INBOX_FOLDER) return INBOX_LABEL;
  if (selection === null || selection === "") return ALL_NOTES_LABEL;
  const segments = selection.split("/");
  return segments[segments.length - 1] || ALL_NOTES_LABEL;
}

/**
 * 선택한 폴더가 지워졌거나 볼트가 바뀌어 더 이상 없을 때 쓸 대체 선택.
 * 존재하지 않는 폴더가 선택된 채로 남으면 노트 열이 영원히 비어 보인다.
 */
export function resolveFolderSelection(
  selection: FolderSelection,
  knownFolderPaths: readonly string[],
): FolderSelection {
  // 기본함은 첫 기록 전 폴더가 없어도 선택 가능한 입구다.
  if (selection === INBOX_FOLDER) return INBOX_FOLDER;
  if (selection === null || selection === "") return null;
  return knownFolderPaths.includes(selection) ? selection : null;
}

/** 폴더 트리를 평평한 경로 목록으로 편다(선택 복구 검사용). */
export function collectFolderPaths(nodes: readonly FolderNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    paths.push(node.path);
    paths.push(...collectFolderPaths(node.children));
  }
  return paths;
}
