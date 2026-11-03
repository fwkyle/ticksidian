/**
 * Wikilink to Anchor
 *
 * 해석된 위키링크(ResolvedWikiLink)를 HTML 조각으로 변환한다.
 *
 * [kyle] 결정:
 *   - resolved   → <a href="note-{id}.html">
 *   - ambiguous  → <span class="wiki-link-inactive"> (기본값 채택)
 *   - unresolved → <span class="wiki-link-inactive">
 */

import type { ResolvedWikiLink } from "../wiki-links/wiki-link-types.ts";
import { escapeHtml } from "./html-escape.ts";
import { notePageFileName } from "./note-page-file-name.ts";

/**
 * ResolvedWikiLink 하나를 HTML 조각 문자열로 변환한다.
 * label: 표시 텍스트. 없으면 ref를 사용한다.
 */
export function wikilinkToAnchor(link: ResolvedWikiLink): string {
  const label = escapeHtml(link.displayText ?? link.ref);

  if (link.resolution === "resolved" && link.targetNoteId !== null) {
    const href = escapeHtml(notePageFileName(link.targetNoteId));
    return `<a href="${href}" class="wiki-link">${label}</a>`;
  }

  // ambiguous / unresolved → 비활성 span
  return `<span class="wiki-link-inactive">${label}</span>`;
}
