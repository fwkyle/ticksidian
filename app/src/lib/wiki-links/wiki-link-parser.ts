/**
 * Wiki Link Parser
 *
 * Markdown 본문에서 [[...]] 위키링크 토큰을 추출한다.
 * 지원 문법:
 *   [[노트 제목]]
 *   [[노트 제목|표시 텍스트]]
 *   [[id:note-123]]
 *   [[id:note-123|표시 텍스트]]
 */

import type { WikiLinkToken } from "./wiki-link-types";
import { isIdModeRef } from "./wiki-link-utils.ts";

/**
 * 위키링크 정규식.
 * 첫 번째 그룹: ref (제목 또는 id:xxx)
 * 두 번째 그룹: 선택적 displayText (| 뒤)
 *
 * 주의: 중첩 링크, 닫히지 않은 링크, 헤딩 앵커는 1차 범위에서 지원하지 않는다.
 */
const WIKI_LINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

/**
 * fenced code block (``` 또는 ~~~) 과 inline code (`) 영역을
 * 같은 길이의 공백으로 치환하여 [[...]]가 파싱되지 않게 마스킹한다.
 * 원문 길이를 유지하므로 start/end 인덱스가 보존된다.
 */
export function maskCodeBlocks(text: string): string {
  // fenced code blocks (```, ~~~)
  let result = text.replace(
    /(^|\n)(```|~~~)[\s\S]*?\n\2/g,
    (match) => " ".repeat(match.length),
  );
  // inline code (`...`)
  result = result.replace(
    /`[^`\n]+`/g,
    (match) => " ".repeat(match.length),
  );
  return result;
}

/**
 * 본문(body)에서 위키링크 토큰을 추출한다.
 * frontmatter가 제거된 body를 받아야 하며,
 * 코드 블록 안의 [[...]]는 무시한다.
 */
export function parseWikiLinks(body: string): WikiLinkToken[] {
  const tokens: WikiLinkToken[] = [];

  // 코드 블록을 마스킹해서 코드 안의 [[...]]를 무시
  const masked = maskCodeBlocks(body);

  const regex = new RegExp(WIKI_LINK_REGEX.source, "g");

  let match: RegExpExecArray | null;
  while ((match = regex.exec(masked)) !== null) {
    // 원문에서 실제 텍스트를 추출 (마스킹 전 원문 기준)
    const raw = body.slice(match.index, match.index + match[0].length);
    const ref = match[1].trim();
    const displayText = match[2]?.trim() ?? null;

    if (ref.length === 0) continue;

    const mode = isIdModeRef(ref) ? "id" : "title";
    const isEmbed = match.index > 0 && masked[match.index - 1] === "!";

    tokens.push({
      raw,
      ref,
      displayText,
      mode,
      start: match.index,
      end: match.index + match[0].length,
      isEmbed,
    });
  }

  return tokens;
}

/**
 * 단일 위키링크 문자열을 파싱한다.
 * 입력이 [[...]] 형태가 아니면 null을 반환한다.
 */
export function parseSingleWikiLink(raw: string): WikiLinkToken | null {
  const regex = new RegExp(WIKI_LINK_REGEX.source);
  const match = regex.exec(raw);
  if (!match) return null;

  const ref = match[1].trim();
  const displayText = match[2]?.trim() ?? null;

  if (ref.length === 0) return null;

  const mode = isIdModeRef(ref) ? "id" : "title";

  return {
    raw: match[0],
    ref,
    displayText,
    mode,
    start: 0,
    end: match[0].length,
    isEmbed: false,
  };
}
