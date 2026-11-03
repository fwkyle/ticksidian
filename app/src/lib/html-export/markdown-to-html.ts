/**
 * Markdown to HTML (부분집합)
 *
 * BlockNote blocksToMarkdownLossy 부분집합을 HTML로 변환한다.
 * 신규 npm 의존성 없음 — 직접 구현.
 *
 * 지원 블록:
 *   h1~h3, ul/ol, 체크박스, blockquote, 코드펜스, 위키링크, 일반 문단
 *
 * 미지원 인라인(굵기, 이탤릭, 외부 링크, 이미지):
 *   escape된 평문으로 통과 (보수적).
 *
 * XSS 정책: 모든 텍스트 노드는 escapeHtml 후 래핑한다.
 *            코드펜스 내용도 escape한다.
 *
 * 위키링크 처리: 본문 내 [[...]]를 resolvedLinks 맵을 통해 앵커로 교체한다.
 *   resolvedLinks가 없으면 모든 위키링크가 비활성 span으로 처리된다.
 */

import { escapeHtml } from "./html-escape.ts";
import type { ResolvedWikiLink } from "../wiki-links/wiki-link-types.ts";
import { wikilinkToAnchor } from "./wikilink-to-anchor.ts";

/**
 * 텍스트 안의 [[...]] 위키링크 raw 문자열을 HTML 조각으로 치환한다.
 * rawToLink: raw 문자열 → ResolvedWikiLink 맵.
 * 치환되지 않은 텍스트 부분은 escapeHtml 적용한다.
 */
function substituteWikiLinksInText(
  text: string,
  rawToLink: Map<string, ResolvedWikiLink>,
): string {
  if (rawToLink.size === 0) return escapeHtml(text);

  // [[...]] 패턴을 찾아 치환
  const WIKI_RE = /\[\[[^\]]+?\]\]/g;
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = WIKI_RE.exec(text)) !== null) {
    // 이전 텍스트 escape
    if (match.index > cursor) {
      result += escapeHtml(text.slice(cursor, match.index));
    }

    const raw = match[0];
    const link = rawToLink.get(raw);
    if (link) {
      result += wikilinkToAnchor(link);
    } else {
      // 인덱스에 없는 위키링크 → 비활성 span
      const innerText = raw.slice(2, -2).split("|").pop() ?? raw.slice(2, -2);
      result += `<span class="wiki-link-inactive">${escapeHtml(innerText)}</span>`;
    }

    cursor = match.index + raw.length;
  }

  if (cursor < text.length) {
    result += escapeHtml(text.slice(cursor));
  }

  return result;
}

export interface MarkdownToHtmlOptions {
  /**
   * 이 노트의 해석된 outgoing 링크 목록.
   * 본문 안의 [[...]]를 앵커로 바꾸는 데 사용한다.
   * 없으면 모든 위키링크가 비활성 span으로 처리된다.
   */
  resolvedLinks?: ResolvedWikiLink[];
}

/**
 * Markdown 본문(frontmatter 제거 후)을 HTML body 조각으로 변환한다.
 * 반환값은 <body> 안에 삽입할 HTML이다 (<!DOCTYPE> / <html> 포함 안 됨).
 */
export function markdownToHtml(
  body: string,
  options: MarkdownToHtmlOptions = {},
): string {
  const { resolvedLinks = [] } = options;

  // raw 문자열 → link 맵 구축 (O(1) 조회)
  const rawToLink = new Map<string, ResolvedWikiLink>();
  for (const link of resolvedLinks) {
    rawToLink.set(link.raw, link);
  }

  const lines = body.split("\n");
  const output: string[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── 코드펜스 ──────────────────────────────────────────────────────────────
    if (/^```/.test(line) || /^~~~/.test(line)) {
      const fence = line.slice(0, 3);
      const lang = escapeHtml(line.slice(3).trim());
      const langAttr = lang ? ` class="language-${lang}"` : "";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith(fence)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      output.push(
        `<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // ── 제목 ─────────────────────────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = substituteWikiLinksInText(headingMatch[2], rawToLink);
      output.push(`<h${level}>${text}</h${level}>`);
      i += 1;
      continue;
    }

    // ── 인용 ─────────────────────────────────────────────────────────────────
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      const inner = quoteLines
        .map((l) => substituteWikiLinksInText(l, rawToLink))
        .join("<br>");
      output.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // ── 리스트 (ul / ol / 체크박스) ───────────────────────────────────────────
    const ulMatch = line.match(/^[-*]\s(.*)/);
    const olMatch = line.match(/^\d+\.\s(.*)/);
    if (ulMatch || olMatch) {
      const isOrdered = Boolean(olMatch);
      const tag = isOrdered ? "ol" : "ul";
      const listItems: string[] = [];

      while (i < lines.length) {
        const l = lines[i];
        const ulItem = l.match(/^[-*]\s(.*)/);
        const olItem = l.match(/^\d+\.\s(.*)/);
        const item = ulItem ?? olItem;
        if (!item) break;

        const itemText = item[1];

        // 체크박스
        const checkMatch = itemText.match(/^\[([ x])\]\s?(.*)/);
        if (checkMatch) {
          const checked = checkMatch[1] === "x";
          const label = substituteWikiLinksInText(checkMatch[2], rawToLink);
          const checkedAttr = checked ? " checked" : "";
          listItems.push(
            `<li class="task-item"><input type="checkbox" disabled${checkedAttr}> ${label}</li>`,
          );
        } else {
          const label = substituteWikiLinksInText(itemText, rawToLink);
          listItems.push(`<li>${label}</li>`);
        }

        i += 1;
      }

      output.push(`<${tag}>${listItems.join("")}</${tag}>`);
      continue;
    }

    // ── 빈 줄 ────────────────────────────────────────────────────────────────
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // ── 일반 문단 ─────────────────────────────────────────────────────────────
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^(#{1,3}|[-*]|\d+\.|```|~~~|>)/)
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }

    if (paraLines.length > 0) {
      const combined = paraLines.join(" ");
      const rendered = substituteWikiLinksInText(combined, rawToLink);
      output.push(`<p>${rendered}</p>`);
    } else {
      i += 1;
    }
  }

  return output.join("\n");
}
