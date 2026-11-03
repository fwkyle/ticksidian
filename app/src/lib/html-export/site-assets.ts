/**
 * Site Assets
 *
 * 내보내기 산출물에 포함될 CSS와 JS 소스 문자열.
 * 신규 npm 의존성 없음 — 정적 상수로 관리한다.
 *
 * style.css 설계 원칙:
 *   - 시스템 폰트 우선
 *   - max-width 48rem (가독성)
 *   - line-height 1.7 (가독 간격)
 *   - 44px 터치 타깃 (버튼/링크)
 *   - 모바일 폭 우선 (뷰포트 meta는 render-note-page.ts에서 삽입)
 *
 * app.js 설계 원칙:
 *   - 외부 의존 0
 *   - window.__SEARCH_INDEX__ 전역(search-index.js에서 주입)을 읽어 검색
 *   - 제목/alias/태그/snippet 부분일치 필터
 *   - DOM 삽입은 textContent 사용 (innerHTML 금지 — XSS 방어)
 *   - file:// 호환 (fetch 없음)
 */

export const STYLE_CSS = `
/* Ticksidian Static Export — style.css */

*, *::before, *::after {
  box-sizing: border-box;
}

:root {
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Courier New", monospace;
  --color-text: #1a1a1a;
  --color-text-muted: #6b7280;
  --color-bg: #ffffff;
  --color-bg-code: #f3f4f6;
  --color-border: #e5e7eb;
  --color-link: #2563eb;
  --color-link-inactive: #9ca3af;
  --color-accent: #3b82f6;
  --max-width: 48rem;
}

body {
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.7;
  color: var(--color-text);
  background: var(--color-bg);
  margin: 0;
  padding: 0;
}

.page-wrapper {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 2rem 1rem;
}

/* ── 헤더 ── */
.site-header {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 1rem;
  margin-bottom: 2rem;
}

.site-header a {
  color: var(--color-text);
  text-decoration: none;
  font-weight: 600;
  font-size: 1.125rem;
}

/* ── 헤딩 ── */
h1, h2, h3 {
  font-weight: 700;
  line-height: 1.3;
  margin: 1.5rem 0 0.5rem;
}

h1 { font-size: 1.875rem; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }

/* ── 문단 ── */
p {
  margin: 0.75rem 0;
}

/* ── 링크 ── */
a {
  color: var(--color-link);
  text-decoration: underline;
  text-underline-offset: 2px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}

a:hover {
  text-decoration: none;
}

.wiki-link-inactive {
  color: var(--color-link-inactive);
  border-bottom: 1px dashed currentColor;
  cursor: default;
}

/* ── 코드 ── */
code {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  background: var(--color-bg-code);
  padding: 0.1em 0.35em;
  border-radius: 3px;
}

pre {
  background: var(--color-bg-code);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
  margin: 1rem 0;
}

pre code {
  background: none;
  padding: 0;
  font-size: 0.875rem;
}

/* ── 인용 ── */
blockquote {
  border-left: 3px solid var(--color-accent);
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  color: var(--color-text-muted);
  background: #f9fafb;
}

/* ── 리스트 ── */
ul, ol {
  padding-left: 1.5rem;
  margin: 0.75rem 0;
}

li {
  margin: 0.25rem 0;
}

.task-item {
  list-style: none;
  margin-left: -1rem;
}

.task-item input[type="checkbox"] {
  margin-right: 0.5rem;
}

/* ── 구분선 ── */
hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 2rem 0;
}

/* ── 노트 메타 ── */
.note-meta {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-bottom: 2rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

/* ── 백링크 섹션 ── */
.backlinks-section {
  border-top: 1px solid var(--color-border);
  margin-top: 3rem;
  padding-top: 1.5rem;
}

.backlinks-section h2 {
  font-size: 1rem;
  color: var(--color-text-muted);
  margin-bottom: 0.75rem;
}

.backlink-item {
  margin: 0.5rem 0;
  font-size: 0.9375rem;
}

.backlink-context {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-top: 0.125rem;
}

/* ── 인덱스 페이지 ── */
.notes-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.notes-list li {
  border-bottom: 1px solid var(--color-border);
  padding: 0.75rem 0;
}

.notes-list a {
  display: block;
  min-height: 44px;
  align-items: flex-start;
  flex-direction: column;
  gap: 0.125rem;
  text-decoration: none;
  color: var(--color-text);
}

.notes-list a:hover .note-title {
  color: var(--color-link);
  text-decoration: underline;
}

.note-title {
  font-weight: 500;
}

.note-snippet {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── 검색 ── */
.search-wrapper {
  margin-bottom: 1.5rem;
}

#search-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  min-height: 44px;
  font-size: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  outline: none;
  font-family: var(--font-body);
}

#search-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}

#search-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: 2rem 0;
  display: none;
}

/* ── 반응형 ── */
@media (max-width: 640px) {
  .page-wrapper {
    padding: 1.25rem 0.75rem;
  }

  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.25rem; }
}
`.trim();

/**
 * app.js — 검색 기능.
 *
 * window.__SEARCH_INDEX__ (search-index.js에서 주입)를 읽어
 * #search-input 입력에 따라 .notes-list li를 필터한다.
 *
 * XSS 방어: 모든 DOM 삽입은 textContent 사용. innerHTML 없음.
 * file:// 호환: fetch 없음.
 */
export const APP_JS = `
(function () {
  'use strict';

  function initSearch() {
    var index = window.__SEARCH_INDEX__;
    var input = document.getElementById('search-input');
    var listEl = document.querySelector('.notes-list');
    var emptyEl = document.getElementById('search-empty');

    if (!input || !listEl || !index) return;

    var items = Array.from(listEl.querySelectorAll('li[data-note-id]'));

    function normalize(s) {
      return (s || '').toLowerCase();
    }

    function matchEntry(entry, q) {
      if (normalize(entry.title).indexOf(q) !== -1) return true;
      for (var i = 0; i < (entry.aliases || []).length; i++) {
        if (normalize(entry.aliases[i]).indexOf(q) !== -1) return true;
      }
      for (var j = 0; j < (entry.tags || []).length; j++) {
        if (normalize(entry.tags[j]).indexOf(q) !== -1) return true;
      }
      if (normalize(entry.snippet).indexOf(q) !== -1) return true;
      return false;
    }

    var timer = null;

    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        var q = normalize(input.value.trim());

        if (!q) {
          items.forEach(function (li) { li.style.display = ''; });
          if (emptyEl) emptyEl.style.display = 'none';
          return;
        }

        var visibleCount = 0;
        items.forEach(function (li) {
          var noteId = li.getAttribute('data-note-id');
          var entry = null;
          for (var k = 0; k < index.length; k++) {
            if (index[k].id === noteId) { entry = index[k]; break; }
          }
          if (entry && matchEntry(entry, q)) {
            li.style.display = '';
            visibleCount++;
          } else {
            li.style.display = 'none';
          }
        });

        if (emptyEl) {
          emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
        }
      }, 150);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearch);
  } else {
    initSearch();
  }
})();
`.trim();
