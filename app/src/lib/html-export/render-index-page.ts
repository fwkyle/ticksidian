/**
 * Render Index Page
 *
 * 전체 노트 목록을 표시하는 index.html을 생성한다.
 * 검색 입력란 + 노트 리스트 포함.
 * XSS: 모든 텍스트 삽입은 escapeHtml 경유.
 * IO 없음 — 순수 함수.
 */

import { escapeHtml } from "./html-escape.ts";
import { notePageFileName } from "./note-page-file-name.ts";
import type { SearchIndexEntry } from "./build-search-index.ts";

export interface RenderIndexPageOptions {
  searchEntries: SearchIndexEntry[];
  /** 사이트 이름 */
  siteName?: string;
}

/**
 * index.html 전체 HTML 문서 문자열을 반환한다.
 */
export function renderIndexPage(opts: RenderIndexPageOptions): string {
  const { searchEntries, siteName = "Ticksidian" } = opts;

  const escapedSiteName = escapeHtml(siteName);

  const listItems = searchEntries
    .map((entry) => {
      const href = escapeHtml(`notes/${notePageFileName(entry.id)}`);
      const title = escapeHtml(entry.title);
      const snippet = escapeHtml(entry.snippet);
      const safeId = escapeHtml(entry.id);
      return `<li data-note-id="${safeId}">
      <a href="${href}">
        <span class="note-title">${title}</span>
        ${snippet ? `<span class="note-snippet">${snippet}</span>` : ""}
      </a>
    </li>`;
    })
    .join("\n    ");

  const emptyListMsg =
    searchEntries.length === 0
      ? `<p style="color: #9ca3af; text-align: center; padding: 2rem 0;">노트가 없습니다.</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedSiteName}</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <div class="page-wrapper">
    <header class="site-header">
      <a href="index.html">${escapedSiteName}</a>
    </header>
    <main>
      <div class="search-wrapper">
        <input
          type="search"
          id="search-input"
          placeholder="노트 검색…"
          aria-label="노트 검색"
          autocomplete="off"
        >
      </div>
      ${emptyListMsg}
      <ul class="notes-list" role="list" aria-label="노트 목록">
        ${listItems}
      </ul>
      <p id="search-empty" role="status" aria-live="polite">검색 결과가 없습니다.</p>
    </main>
  </div>
  <script src="assets/search-index.js"></script>
  <script src="assets/app.js"></script>
</body>
</html>`;
}
