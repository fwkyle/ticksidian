/**
 * Wiki Link Index
 *
 * 전체 볼트의 노트 메타데이터와 본문을 기반으로
 * outgoing links / backlinks 인덱스를 계산한다.
 *
 * 1차 버전은 전체 재스캔 방식이지만,
 * 구조는 증분 갱신이 가능하도록 입력/출력을 분리해 둔다.
 */

import type {
  LinkableNoteMeta,
  LinkIndex,
  BacklinkItem,
  ResolvedWikiLink,
} from "./wiki-link-types";
import { parseWikiLinks } from "./wiki-link-parser";
import { resolveWikiLink, buildTitleKeyMap } from "./wiki-link-resolver";
import { extractContext, normalizeLinkKey, detachLinkText } from "./wiki-link-utils";

/**
 * 파일 전체 내용에서 YAML frontmatter를 제거하고 본문만 반환한다.
 * parseFrontmatter를 import하지 않고 경량으로 직접 처리한다.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return content;
  return content.slice(endIndex + 4);
}

export interface BuildLinkIndexInput {
  /** 볼트 내 모든 노트 메타데이터 */
  notes: LinkableNoteMeta[];
  /** noteId → 해당 노트의 마크다운 본문 (frontmatter 포함 전체) */
  markdownByNoteId: Record<string, string>;
}

/** 전체 메타 기준을 먼저 만들고 본문은 노트 하나씩 소비한다. */
export class LinkIndexBuilder {
  private readonly index: LinkIndex;

  constructor(notes: LinkableNoteMeta[]) {
    this.index = {
      notesById: new Map(notes.map(note => [note.noteId, note])),
      noteIdsByTitleKey: buildTitleKeyMap(notes),
      outgoingBySourceId: new Map(),
      backlinksByTargetId: new Map(),
    };
  }

  addNote(noteId: string, fullContent: string): void {
    const note = this.index.notesById.get(noteId);
    if (!note || !fullContent) return;
    const { notesById, noteIdsByTitleKey, outgoingBySourceId, backlinksByTargetId } = this.index;
    // frontmatter를 제거한 본문만 파싱 (frontmatter 안의 [[...]]를 무시)
    const body = stripFrontmatter(fullContent);
    // 임베드(![[…]])는 링크가 아니라 포함이다 — outgoing/backlink에서 제외한다.
    const tokens = parseWikiLinks(body).filter((token) => !token.isEmbed);
    const resolved: ResolvedWikiLink[] = [];

    for (const token of tokens) {
      const link = resolveWikiLink(
        token,
        note.noteId,
        note.filePath,
        notesById,
        noteIdsByTitleKey,
      );

      resolved.push(link);

      // resolved 링크만 backlink에 누적
      if (link.resolution === "resolved" && link.targetNoteId) {
        const context = detachLinkText(extractContext(body, token.start, token.end));

        const backlinkItem: BacklinkItem = {
          targetNoteId: link.targetNoteId,
          sourceNoteId: note.noteId,
          sourceTitle: note.title,
          sourceFolder: note.folder,
          sourceUpdatedAt: note.updatedAt,
          raw: link.raw,
          displayText: link.displayText,
          context,
        };

        const existing = backlinksByTargetId.get(link.targetNoteId);
        if (existing) {
          existing.push(backlinkItem);
        } else {
          backlinksByTargetId.set(link.targetNoteId, [backlinkItem]);
        }
      }
    }

    outgoingBySourceId.set(note.noteId, resolved);
  }

  finish(): LinkIndex {
    const { backlinksByTargetId } = this.index;
    // 4. backlink 정렬: 최근 수정 우선, 같으면 제목 오름차순
    for (const [, items] of backlinksByTargetId) {
      items.sort((a, b) => {
        const timeDiff = b.sourceUpdatedAt - a.sourceUpdatedAt;
        if (timeDiff !== 0) return timeDiff;
        return a.sourceTitle.localeCompare(b.sourceTitle);
      });
    }
    return this.index;
  }
}

/** 전체 볼트 기준 링크 인덱스를 빌드한다. 순수 호출자의 기존 API를 유지한다. */
export function buildLinkIndex(input: BuildLinkIndexInput): LinkIndex {
  const builder = new LinkIndexBuilder(input.notes);
  for (const note of input.notes) {
    const content = input.markdownByNoteId[note.noteId];
    if (content !== undefined) builder.addNote(note.noteId, content);
  }
  return builder.finish();
}

/**
 * 특정 noteId의 백링크를 가져온다.
 */
export function getBacklinksForNote(
  index: LinkIndex,
  noteId: string,
): BacklinkItem[] {
  return index.backlinksByTargetId.get(noteId) ?? [];
}

// ─────────────────────────────────────────────────────────────────────────
// 증분 갱신 API (M2)
// 설계: docs/waterfall/03-상세설계/검색-링크-인덱싱-전략.md §6.4
// ─────────────────────────────────────────────────────────────────────────

export type NoteChangeAction = "upsert" | "remove";

export interface NoteChangeInput {
  action: NoteChangeAction;
  noteId: string;
  /** upsert 시 필수. remove 시 무시. */
  meta?: LinkableNoteMeta;
  /** upsert 시 필수. frontmatter 포함 전체 본문. */
  content?: string;
}

/**
 * 한 노트의 변경을 기존 LinkIndex에 증분 반영한다.
 *
 * 동작:
 * 1. 대상 노트의 기존 outgoing을 제거.
 * 2. 그 outgoing이 만든 다른 노트의 backlink 항목을 제거.
 * 3. title-key 맵에서 대상 noteId 항목 제거.
 * 4. remove면 notesById와 target backlink 엔트리까지 제거하고 종료.
 * 5. upsert면 새 meta/content로 outgoing을 재해석하고, backlink/title-key/notesById를 재삽입.
 * 6. 영향받은 타겟의 backlink 배열만 재정렬.
 *
 * 반환: 새 LinkIndex (내부 Map들도 모두 새 인스턴스).
 *
 * **안전 경계 (중요)**:
 * 이 함수는 "변경된 노트 자신"의 outgoing/backlink만 재계산한다.
 * 다른 노트가 "이 노트를 타겟으로" 하는 해석(resolved/ambiguous/unresolved)은
 * 재계산되지 않는다. 따라서 아래 변경은 증분으로 반영하면 stale해진다:
 *   - title / aliases 변경 → 기존 unresolved가 resolved로 바뀌어야 하는데 안 바뀜
 *   - 노트 추가 → 기존 unresolved가 resolved로 바뀌어야 하는데 안 바뀜
 *   - 노트 삭제 → 기존 resolved가 unresolved가 되어야 하는데 안 바뀜
 *
 * 호출자는 이런 케이스에서는 `buildLinkIndex`로 full rebuild해야 한다.
 * `useLinkIndex`가 이 규칙을 따른다.
 */
export function applyNoteChange(
  index: LinkIndex,
  input: NoteChangeInput,
): LinkIndex {
  const { action, noteId } = input;

  const notesById = new Map(index.notesById);
  const noteIdsByTitleKey = new Map<string, string[]>();
  for (const [k, v] of index.noteIdsByTitleKey) {
    noteIdsByTitleKey.set(k, [...v]);
  }
  const outgoingBySourceId = new Map(index.outgoingBySourceId);
  const backlinksByTargetId = new Map<string, BacklinkItem[]>();
  for (const [k, v] of index.backlinksByTargetId) {
    backlinksByTargetId.set(k, [...v]);
  }

  const prevOutgoing = outgoingBySourceId.get(noteId) ?? [];
  const affectedTargets = new Set<string>();

  for (const prev of prevOutgoing) {
    if (prev.resolution === "resolved" && prev.targetNoteId) {
      affectedTargets.add(prev.targetNoteId);
      const list = backlinksByTargetId.get(prev.targetNoteId);
      if (list) {
        const filtered = list.filter((item) => item.sourceNoteId !== noteId);
        if (filtered.length === 0) {
          backlinksByTargetId.delete(prev.targetNoteId);
        } else {
          backlinksByTargetId.set(prev.targetNoteId, filtered);
        }
      }
    }
  }

  for (const [key, ids] of Array.from(noteIdsByTitleKey.entries())) {
    const filtered = ids.filter((id) => id !== noteId);
    if (filtered.length === 0) {
      noteIdsByTitleKey.delete(key);
    } else if (filtered.length !== ids.length) {
      noteIdsByTitleKey.set(key, filtered);
    }
  }

  outgoingBySourceId.delete(noteId);

  if (action === "remove") {
    notesById.delete(noteId);
    backlinksByTargetId.delete(noteId);
    return { notesById, noteIdsByTitleKey, outgoingBySourceId, backlinksByTargetId };
  }

  if (!input.meta) {
    throw new Error("applyNoteChange: meta required for upsert");
  }
  if (input.content === undefined) {
    throw new Error("applyNoteChange: content required for upsert");
  }

  const meta = input.meta;
  notesById.set(noteId, meta);

  const addTitleKey = (value: string) => {
    const key = normalizeLinkKey(value);
    if (key.length === 0) return;
    const list = noteIdsByTitleKey.get(key);
    if (list) {
      if (!list.includes(noteId)) list.push(noteId);
    } else {
      noteIdsByTitleKey.set(key, [noteId]);
    }
  };
  addTitleKey(meta.title);
  for (const alias of meta.aliases) addTitleKey(alias);

  const body = stripFrontmatter(input.content);
  const tokens = parseWikiLinks(body).filter((token) => !token.isEmbed);
  const resolved: ResolvedWikiLink[] = [];

  for (const token of tokens) {
    const link = resolveWikiLink(
      token,
      noteId,
      meta.filePath,
      notesById,
      noteIdsByTitleKey,
    );
    resolved.push(link);

    if (link.resolution === "resolved" && link.targetNoteId) {
      affectedTargets.add(link.targetNoteId);
      const context = detachLinkText(extractContext(body, token.start, token.end));
      const backlinkItem: BacklinkItem = {
        targetNoteId: link.targetNoteId,
        sourceNoteId: noteId,
        sourceTitle: meta.title,
        sourceFolder: meta.folder,
        sourceUpdatedAt: meta.updatedAt,
        raw: link.raw,
        displayText: link.displayText,
        context,
      };
      const existing = backlinksByTargetId.get(link.targetNoteId);
      if (existing) {
        existing.push(backlinkItem);
      } else {
        backlinksByTargetId.set(link.targetNoteId, [backlinkItem]);
      }
    }
  }

  outgoingBySourceId.set(noteId, resolved);

  for (const targetId of affectedTargets) {
    const list = backlinksByTargetId.get(targetId);
    if (!list) continue;
    list.sort((a, b) => {
      const timeDiff = b.sourceUpdatedAt - a.sourceUpdatedAt;
      if (timeDiff !== 0) return timeDiff;
      return a.sourceTitle.localeCompare(b.sourceTitle);
    });
  }

  return { notesById, noteIdsByTitleKey, outgoingBySourceId, backlinksByTargetId };
}
