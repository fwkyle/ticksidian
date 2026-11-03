/**
 * Build Search Index
 *
 * 노트 목록과 본문에서 검색 인덱스 항목 배열을 만든다.
 * 순수 함수 — IO 없음.
 *
 * 출력은 search-index.json과 search-index.js 양쪽에 사용된다.
 */

import type { LinkableNoteMeta } from "../wiki-links/wiki-link-types.ts";
import { parseFrontmatter } from "../markdown-import.ts";

export interface SearchIndexEntry {
  /** 노트 ID */
  id: string;
  /** 노트 제목 */
  title: string;
  /** 별칭 목록 */
  aliases: string[];
  /** 태그 목록 */
  tags: string[];
  /** 본문 스니펫 (평문, HTML 태그 없음, 최대 200자) */
  snippet: string;
}

/**
 * 마크다운 본문(frontmatter 포함)에서 평문 스니펫을 추출한다.
 * frontmatter 제거 → 헤딩/마크다운 기호 제거 → 최대 maxLen 글자.
 */
function extractSnippet(markdown: string, maxLen = 200): string {
  const { body } = parseFrontmatter(markdown);

  // 마크다운 기호 제거: 헤딩, 강조, 코드펜스, 위키링크, 체크박스
  const plain = body
    .replace(/^```[\s\S]*?^```/gm, "") // 코드펜스 제거
    .replace(/^#{1,6}\s+/gm, "") // 헤딩
    .replace(/\*\*(.+?)\*\*/g, "$1") // 굵기
    .replace(/\*(.+?)\*/g, "$1") // 이탤릭
    .replace(/`([^`]+)`/g, "$1") // 인라인 코드
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, ref, display) => display ?? ref) // 위키링크
    .replace(/^[-*]\s+\[[ x]\]\s+/gm, "") // 체크박스
    .replace(/^[-*]\s+/gm, "") // 리스트 마커
    .replace(/^\d+\.\s+/gm, "") // 순서 리스트
    .replace(/^>\s+/gm, "") // 인용
    .replace(/\n+/g, " ") // 줄바꿈 → 공백
    .trim();

  return plain.slice(0, maxLen);
}

/**
 * 노트 메타와 마크다운 본문으로 검색 인덱스 항목 배열을 생성한다.
 */
export function buildSearchIndex(
  notes: LinkableNoteMeta[],
  markdownByNoteId: Record<string, string>,
): SearchIndexEntry[] {
  return notes.map((note) => {
    const markdown = markdownByNoteId[note.noteId] ?? "";
    return {
      id: note.noteId,
      title: note.title,
      aliases: [...note.aliases],
      tags: [], // LinkableNoteMeta에는 tags 없음 — 확장 시 추가
      snippet: extractSnippet(markdown),
    };
  });
}

/**
 * 검색 인덱스 배열을 search-index.json 내용 문자열로 직렬화한다.
 */
export function serializeSearchIndexJson(entries: SearchIndexEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * 검색 인덱스 배열을 search-index.js 내용 문자열로 직렬화한다.
 * file:// 환경에서 fetch 없이 <script src> 로드 가능한 형태.
 *
 * XSS 방어:
 *   JSON.stringify 결과의 `<` 를 `<` 로 치환한다.
 *   노트 제목/snippet에 `</script>` 가 들어와도 스크립트 조기 종료 패턴을 막는다.
 *   JSON 파일 직렬화(serializeSearchIndexJson)는 이 처리를 적용하지 않는다.
 */
export function serializeSearchIndexJs(entries: SearchIndexEntry[]): string {
  const json = JSON.stringify(entries).replace(/</g, "\\u003c");
  return `window.__SEARCH_INDEX__ = ${json};`;
}
