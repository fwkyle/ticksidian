/**
 * Wiki Link Resolver
 *
 * 파서가 추출한 토큰을 노트 메타데이터와 대조하여
 * resolved / ambiguous / unresolved를 판정한다.
 */

import type {
  WikiLinkToken,
  LinkableNoteMeta,
  ResolvedWikiLink,
} from "./wiki-link-types";
import { normalizeLinkKey, extractNoteIdFromRef, detachLinkText } from "./wiki-link-utils";

/**
 * title key → noteId[] 매핑을 미리 만들어 두는 헬퍼.
 * title과 aliases를 모두 포함한다.
 */
export function buildTitleKeyMap(
  notes: LinkableNoteMeta[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const note of notes) {
    // 현재 제목
    const titleKey = normalizeLinkKey(note.title);
    if (titleKey.length > 0) {
      const existing = map.get(titleKey);
      if (existing) {
        if (!existing.includes(note.noteId)) existing.push(note.noteId);
      } else {
        map.set(titleKey, [note.noteId]);
      }
    }

    // 별칭
    for (const alias of note.aliases) {
      const aliasKey = normalizeLinkKey(alias);
      if (aliasKey.length === 0) continue;
      const existing = map.get(aliasKey);
      if (existing) {
        if (!existing.includes(note.noteId)) existing.push(note.noteId);
      } else {
        map.set(aliasKey, [note.noteId]);
      }
    }
  }

  return map;
}

/**
 * 주어진 ref로 title/alias 후보 noteId를 수집한다.
 */
export function collectTitleCandidates(
  ref: string,
  titleKeyMap: Map<string, string[]>,
): string[] {
  const key = normalizeLinkKey(ref);
  return titleKeyMap.get(key) ?? [];
}

/**
 * 단일 위키링크 토큰을 해석한다.
 */
export function resolveWikiLink(
  token: WikiLinkToken,
  sourceNoteId: string,
  sourceFilePath: string,
  notesById: Map<string, LinkableNoteMeta>,
  titleKeyMap: Map<string, string[]>,
): ResolvedWikiLink {
  const base: Omit<ResolvedWikiLink, "resolution" | "candidateNoteIds" | "targetNoteId" | "targetTitle"> = {
    sourceNoteId,
    sourceFilePath,
    raw: detachLinkText(token.raw),
    ref: detachLinkText(token.ref),
    displayText: token.displayText === null ? null : detachLinkText(token.displayText),
  };

  // id: 모드 해석
  if (token.mode === "id") {
    const noteId = extractNoteIdFromRef(base.ref);
    const note = notesById.get(noteId);

    if (note) {
      return {
        ...base,
        resolution: "resolved",
        candidateNoteIds: [noteId],
        targetNoteId: noteId,
        targetTitle: note.title,
      };
    }

    return {
      ...base,
      resolution: "unresolved",
      candidateNoteIds: [],
      targetNoteId: null,
      targetTitle: null,
    };
  }

  // title 모드 해석
  const candidates = collectTitleCandidates(token.ref, titleKeyMap);

  if (candidates.length === 0) {
    return {
      ...base,
      resolution: "unresolved",
      candidateNoteIds: [],
      targetNoteId: null,
      targetTitle: null,
    };
  }

  if (candidates.length === 1) {
    const targetId = candidates[0];
    const note = notesById.get(targetId);
    return {
      ...base,
      resolution: "resolved",
      candidateNoteIds: candidates,
      targetNoteId: targetId,
      targetTitle: note?.title ?? null,
    };
  }

  // 2개 이상 → ambiguous
  return {
    ...base,
    resolution: "ambiguous",
    candidateNoteIds: [...candidates],
    targetNoteId: null,
    targetTitle: null,
  };
}
