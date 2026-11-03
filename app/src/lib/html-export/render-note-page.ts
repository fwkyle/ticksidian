/**
 * Render Note Page
 *
 * 단일 노트를 완전한 HTML 문서로 렌더한다.
 * lang="ko", viewport meta 포함.
 * XSS: 모든 텍스트 삽입은 escapeHtml 경유.
 * IO 없음 — 순수 함수.
 */

import { escapeHtml } from "./html-escape.ts";
import { notePageFileName } from "./note-page-file-name.ts";
import { markdownToHtml } from "./markdown-to-html.ts";
import type { ResolvedWikiLink, BacklinkItem } from "../wiki-links/wiki-link-types.ts";
import { parseFrontmatter } from "../markdown-import.ts";

export interface RenderNotePageOptions {
  noteId: string;
  title: string;
  markdownContent: string;
  /** 이 노트의 outgoing 링크 (위키링크 → 앵커 변환용) */
  outgoingLinks: ResolvedWikiLink[];
  /** 이 노트를 참조하는 백링크 목록 */
  backlinks: BacklinkItem[];
  /** 사이트 이름 (헤더에 표시) */
  siteName?: string;
}

/**
 * 백링크 섹션 HTML을 생성한다.
 */
function renderBacklinksSection(backlinks: BacklinkItem[]): string {
  if (backlinks.length === 0) return "";

  const items = backlinks
    .map((bl) => {
      const href = escapeHtml(notePageFileName(bl.sourceNoteId));
      const title = escapeHtml(bl.sourceTitle);
      const context = escapeHtml(bl.context);
      return `<div class="backlink-item">
  <a href="${href}">${title}</a>
  ${context ? `<div class="backlink-context">${context}</div>` : ""}
</div>`;
    })
    .join("\n");

  return `<section class="backlinks-section" aria-label="이 노트를 참조하는 노트">
  <h2>백링크 (${backlinks.length})</h2>
  ${items}
</section>`;
}

/**
 * 노트 한 페이지의 완전한 HTML 문서 문자열을 반환한다.
 */
export function renderNotePage(opts: RenderNotePageOptions): string {
  const {
    noteId,
    title,
    markdownContent,
    outgoingLinks,
    backlinks,
    siteName = "Ticksidian",
  } = opts;

  // frontmatter 제거 후 본문만 변환
  const { body } = parseFrontmatter(markdownContent);
  const bodyHtml = markdownToHtml(body, { resolvedLinks: outgoingLinks });
  const backlinksHtml = renderBacklinksSection(backlinks);

  const escapedTitle = escapeHtml(title);
  const escapedSiteName = escapeHtml(siteName);
  const indexHref = "../index.html";
  const noteHtmlId = encodeURIComponent(noteId);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle} — ${escapedSiteName}</title>
  <link rel="stylesheet" href="../assets/style.css">
</head>
<body>
  <div class="page-wrapper">
    <header class="site-header">
      <a href="${indexHref}">${escapedSiteName}</a>
    </header>
    <main id="note-${noteHtmlId}">
      <h1>${escapedTitle}</h1>
      ${bodyHtml}
      ${backlinksHtml}
    </main>
  </div>
  <script src="../assets/search-index.js"></script>
  <script src="../assets/app.js"></script>
</body>
</html>`;
}
