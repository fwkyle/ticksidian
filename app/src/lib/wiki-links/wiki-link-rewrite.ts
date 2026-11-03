/**
 * Wiki Link Rewrite
 *
 * ambiguous 후보 선택으로 본문의 `[[ref]]` 또는 `[[ref|label]]`를
 * 확정 링크 `[[id:<noteId>|<label or ref>]]`로 바꾸는 헬퍼.
 *
 * 안전 경계:
 *   - 코드 블록(block.type === "codeBlock")은 건드리지 않는다. 파서가
 *     본문 파싱 시 마스킹하는 영역과 동일.
 *   - `id:`로 시작하는 ref(이미 확정된 링크)는 건드리지 않는다.
 *   - ref 비교는 `normalizeLinkKey` 기준(트림 + 연속 공백 1칸 + 소문자).
 *     이렇게 하면 본문에 `[[ 중복 제목 ]]`/`[[중복제목]]` 같은 표기 차이도
 *     같은 타겟으로 묶여 일관되게 확정된다.
 *   - displayText가 있으면 그 값을 유지, 없으면 원래 ref를 display로 쓴다.
 *   - BlockNote inline content 중 `type === "text"`만 본다.
 *     link 인라인이나 커스텀 인라인은 건드리지 않는다.
 */

import { normalizeLinkKey } from "./wiki-link-utils";

/** BlockNote가 외부로 내보내는 block 구조 최소 타입. */
interface MinimalBlock {
  id?: string;
  type?: string;
  content?: unknown;
  children?: MinimalBlock[];
}

interface InlineTextLike {
  type?: string;
  text?: string;
}

const BLOCK_TYPES_TO_SKIP = new Set(["codeBlock"]);

const WIKI_LINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

function rewriteInText(
  text: string,
  normalizedTargetRef: string,
  chosenNoteId: string,
): { text: string; changed: boolean } {
  let changed = false;
  const next = text.replace(WIKI_LINK_REGEX, (full, matchedRef: string, label?: string) => {
    const trimmedRef = matchedRef.trim();
    if (trimmedRef.startsWith("id:")) return full;
    if (normalizeLinkKey(trimmedRef) !== normalizedTargetRef) return full;
    const display = label !== undefined ? label.trim() : trimmedRef;
    changed = true;
    return `[[id:${chosenNoteId}|${display}]]`;
  });
  return { text: next, changed };
}

export interface RewriteResult<B> {
  blocks: B[];
  changedCount: number;
}

/**
 * 블록 배열 안의 inline text를 훑으며 ambiguous `[[ref]]`/`[[ref|label]]`을
 * `[[id:chosenNoteId|label or ref]]`로 rewrite한다.
 *
 * 반환은 새 배열이다. 변경이 하나도 없으면 원본을 그대로 반환한다(참조 비교 안전).
 */
export function rewriteAmbiguousLinkInBlocks<B extends MinimalBlock>(
  blocks: B[],
  ref: string,
  chosenNoteId: string,
): RewriteResult<B> {
  const normalizedTarget = normalizeLinkKey(ref);
  if (normalizedTarget.length === 0) {
    return { blocks, changedCount: 0 };
  }

  let changedCount = 0;

  const visit = (list: B[]): B[] => {
    let listChanged = false;
    const next: B[] = list.map((block) => {
      let blockChanged = false;
      let nextBlock: B = block;

      // 본인이 skip 대상이면 inline content만 건드리지 않고 children은 그대로 재귀
      const skipContent = Boolean(block.type && BLOCK_TYPES_TO_SKIP.has(block.type));

      if (!skipContent && Array.isArray(block.content)) {
        const contentList = block.content as InlineTextLike[];
        let contentChanged = false;
        const newContent = contentList.map((inline) => {
          if (
            inline &&
            inline.type === "text" &&
            typeof inline.text === "string"
          ) {
            const { text, changed } = rewriteInText(
              inline.text,
              normalizedTarget,
              chosenNoteId,
            );
            if (changed) {
              contentChanged = true;
              changedCount += 1;
              return { ...inline, text };
            }
          }
          return inline;
        });
        if (contentChanged) {
          nextBlock = { ...block, content: newContent } as B;
          blockChanged = true;
        }
      }

      if (Array.isArray(block.children) && block.children.length > 0) {
        const newChildren = visit(block.children as B[]);
        if (newChildren !== block.children) {
          nextBlock = { ...nextBlock, children: newChildren } as B;
          blockChanged = true;
        }
      }

      if (blockChanged) listChanged = true;
      return nextBlock;
    });

    return listChanged ? next : list;
  };

  const newBlocks = visit(blocks);
  return { blocks: newBlocks, changedCount };
}
