/**
 * image-embed-attachment-cleanup.ts — 노트 삭제 시 전용 이미지 판정 (2026-08-19 TICK-IMG-002).
 *
 * "이 노트만 참조하는 이미지"만 정리 대상이다. 다른 노트도 참조하면 남기고,
 * 판정이 불확실하면(다른 노트 읽기 실패) 아무것도 돌려주지 않는다(fail-closed).
 * 설계: docs/waterfall/03-상세설계/이미지-넣기-노션-체감형.md 2-D.
 */

import {
  parseImageEmbeds,
  resolveImageEmbedTarget,
} from "./image-embeds.ts";

export interface OtherNoteContent {
  noteId: string;
  folder: string;
  content: string;
}

export interface FindExclusiveImageReferencesInput {
  /** 삭제 대상 노트의 마크다운 전체(frontmatter 포함). */
  targetNoteContent: string;
  /** 대상 노트의 볼트 상대 폴더. */
  targetNoteFolder: string;
  /** 다른 모든 노트의 내용. null이 하나라도 있으면 판정 불확실(fail-closed → 빈 배열). */
  otherNotes: readonly (OtherNoteContent | null)[];
  /** 볼트 루트 절대경로. */
  vaultRootPath: string;
  /** 볼트 안 이미지 파일 절대경로 목록. */
  imageFiles: readonly string[];
}

function stripFrontmatterForEmbeds(content: string): string {
  if (!content.startsWith("---")) return content;
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return content;
  return content.slice(endIndex + 4);
}

function resolveAllImages(
  content: string,
  folder: string,
  vaultRootPath: string,
  imageFiles: readonly string[],
): Set<string> {
  const resolved = new Set<string>();
  for (const token of parseImageEmbeds(stripFrontmatterForEmbeds(content))) {
    const target = resolveImageEmbedTarget(token.target, {
      noteFolderPath: folder,
      vaultRootPath,
      imageFiles,
    });
    if (target !== null) resolved.add(target);
  }
  return resolved;
}

/**
 * 대상 노트만 참조하는 이미지 절대경로 목록을 돌려준다.
 *
 * - 다른 노트 하나라도 읽기 실패(null) → 빈 배열(판정 불확실, 아무것도 지우지 않음).
 * - 다른 노트의 임베드가 같은 이미지로 resolve되면 그 이미지는 제외(공유).
 */
export function findExclusiveImageReferences(
  input: FindExclusiveImageReferencesInput,
): string[] {
  const { targetNoteContent, targetNoteFolder, otherNotes, vaultRootPath, imageFiles } = input;

  // 판정 불확실 조건 먼저 — fail-closed.
  if (otherNotes.some((note) => note === null)) return [];

  const targetImages = resolveAllImages(
    targetNoteContent,
    targetNoteFolder,
    vaultRootPath,
    imageFiles,
  );
  if (targetImages.size === 0) return [];

  const shared = new Set<string>();
  for (const note of otherNotes) {
    if (note === null) continue;
    for (const image of resolveAllImages(note.content, note.folder, vaultRootPath, imageFiles)) {
      if (targetImages.has(image)) shared.add(image);
    }
  }

  return [...targetImages].filter((image) => !shared.has(image)).sort();
}

