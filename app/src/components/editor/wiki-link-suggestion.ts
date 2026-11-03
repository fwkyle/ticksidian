// 위키링크 자동완성 순수 규칙 — NoteEditor에서 추출(2026-08-15 앱 2단계 리팩토링).
// 랭킹/삽입 텍스트 생성은 UI 없이 계산만 한다.

import type { DefaultReactSuggestionItem } from "@blocknote/react";

import type { LinkableNoteMeta } from "../../lib/wiki-links";
import { normalizeLinkKey } from "../../lib/wiki-links";

// 공통 슬래시 메뉴 아이템 필터 함수
export function filterSlashMenuItems(
  items: DefaultReactSuggestionItem[],
  query: string
) {
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      (item.aliases?.some((a: string) =>
        a.toLowerCase().includes(query.toLowerCase())
      ) ?? false)
  );
}

// `[[` 입력 뒤에 오는 title/alias로 후보를 점수화. normalizeLinkKey로 공백/대소문자 정규화.
// 최대 8개, 자기 자신은 제외.
export const MAX_WIKI_LINK_ITEMS = 8;

export function rankWikiLinkCandidates(
  notes: LinkableNoteMeta[],
  query: string,
  excludeNoteId: string | null,
): { meta: LinkableNoteMeta; matchText: string; score: number }[] {
  const q = normalizeLinkKey(query);
  const out: { meta: LinkableNoteMeta; matchText: string; score: number }[] = [];

  for (const meta of notes) {
    if (excludeNoteId && meta.noteId === excludeNoteId) continue;

    const attempts: string[] = [meta.title, ...meta.aliases];
    let best: { text: string; score: number } | null = null;
    for (const text of attempts) {
      const norm = normalizeLinkKey(text);
      if (norm.length === 0) continue;
      if (q.length === 0) {
        // 빈 쿼리: 최근 수정 우선
        if (!best) best = { text, score: 10 };
        continue;
      }
      let score: number | null = null;
      if (norm === q) score = 0;
      else if (norm.startsWith(q)) score = 1;
      else {
        const idx = norm.indexOf(q);
        if (idx >= 0) score = 2 + idx;
      }
      if (score !== null && (best === null || score < best.score)) {
        best = { text, score };
      }
    }
    if (best) out.push({ meta, matchText: best.text, score: best.score });
  }

  out.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return b.meta.updatedAt - a.meta.updatedAt;
  });

  return out.slice(0, MAX_WIKI_LINK_ITEMS);
}

// 제목에 `|` 또는 `]`가 있으면 title 모드 파서가 못 잡으므로 id 모드로 fallback.
export function buildWikiLinkInsertText(meta: LinkableNoteMeta, typedQuery: string): string {
  const unsafe = /[\]|]/.test(meta.title);
  if (unsafe) {
    const display = typedQuery.trim().length > 0 ? typedQuery.trim() : meta.title;
    return `[[id:${meta.noteId}|${display}]]`;
  }
  return `[[${meta.title}]]`;
}
