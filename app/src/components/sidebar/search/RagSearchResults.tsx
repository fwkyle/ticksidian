// RAG 전체 검색 결과 목록 + 인덱스 상태 안내 — SearchBar에서 분리(2026-08-15 앱 2단계 리팩토링).

import type { RefObject } from "react";
import type { RagSearchHit } from "../../../hooks/useRagSearch";
import type { RagIndexStatus } from "../../../lib/tauri-commands";

const SOURCE_LABEL: Record<RagSearchHit["sources"][number], string> = {
  fts5: "본문 일치",
  "sqlite-vec": "의미 유사",
  title: "제목",
};

interface RagResultsListProps {
  readonly hits: readonly RagSearchHit[];
  readonly activeIndex: number;
  readonly listRef: RefObject<HTMLDivElement>;
  readonly onSelectHit: (hit: RagSearchHit) => void;
  readonly onActivateHit: (idx: number) => void;
}

export function RagResultsList({
  hits,
  activeIndex,
  listRef,
  onSelectHit,
  onActivateHit,
}: RagResultsListProps) {
  return (
    <div
      ref={listRef}
      className="max-h-80 overflow-y-auto px-2 pb-2"
      role="listbox"
    >
      {hits.length === 0 ? (
        <div className="px-2 py-3 text-xs text-gray-400 dark:text-zinc-500">
          결과가 없습니다.
        </div>
      ) : (
        hits.map((hit, idx) => (
          <RagHitRow
            key={`${hit.filePath}:${idx}`}
            hit={hit}
            idx={idx}
            isActiveHit={idx === activeIndex}
            onSelectHit={onSelectHit}
            onActivateHit={onActivateHit}
          />
        ))
      )}
    </div>
  );
}

interface RagHitRowProps {
  readonly hit: RagSearchHit;
  readonly idx: number;
  readonly isActiveHit: boolean;
  readonly onSelectHit: (hit: RagSearchHit) => void;
  readonly onActivateHit: (idx: number) => void;
}

function RagHitRow({
  hit,
  idx,
  isActiveHit,
  onSelectHit,
  onActivateHit,
}: RagHitRowProps) {
  return (
    <button
      id={`search-hit-${idx}`}
      role="option"
      aria-selected={isActiveHit}
      data-search-index={idx}
      onClick={() => onSelectHit(hit)}
      onMouseEnter={() => onActivateHit(idx)}
      className={`w-full text-left px-2 py-1.5 rounded text-sm text-gray-700 dark:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        isActiveHit
          ? "bg-blue-50 dark:bg-blue-900/30"
          : "hover:bg-gray-100 dark:hover:bg-zinc-700"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {hit.title || "제목 없음"}
          {hit.heading && (
            <span className="ml-1 text-xs text-gray-400 dark:text-zinc-500">
              ▸ {hit.heading}
            </span>
          )}
        </div>
        {hit.preview && (
          <div className="truncate text-xs text-gray-400 dark:text-zinc-500">
            {hit.preview}
          </div>
        )}
        <div className="mt-0.5 flex gap-1">
          {hit.sources.map((source) => (
            <span
              key={source}
              className="rounded bg-gray-100 dark:bg-zinc-700 px-1 text-[10px] text-gray-500 dark:text-zinc-400"
            >
              {SOURCE_LABEL[source] ?? source}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

/* ── RAG 인덱스 상태 안내 ── */

export function RagIndexNotice({
  indexStatus,
}: {
  indexStatus: RagIndexStatus | null;
}) {
  if (!indexStatus) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 dark:text-zinc-500">
        AI 검색 준비 상태를 확인하는 중…
      </div>
    );
  }
  if (!indexStatus.exists) {
    return (
      <div className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-400">
        AI 검색 준비가 필요합니다. ‘내 기록’ 검색은 지금 바로 쓸 수 있습니다.
        <details className="mt-2"><summary className="cursor-pointer py-2">AI 검색 준비 도움말</summary>
        <p>색인을 만들 때 노트 내용을 Gemini에 보냅니다. 비밀정보를 확인한 뒤 터미널에서 실행해 주세요.</p>
        <code className="block break-all rounded bg-gray-100 dark:bg-zinc-700 px-1">
          npm run rag:build -- --vault &lt;볼트 경로&gt;
        </code></details>
      </div>
    );
  }
  if (!indexStatus.indexComplete) {
    return (
      <div className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-400">
        AI 검색 준비가 끝나지 않았습니다. 우선 ‘내 기록’ 검색을 이용해 주세요.
        <details className="mt-2"><summary className="cursor-pointer py-2">AI 검색 준비 도움말</summary>색인 전체 재빌드가 필요합니다. 노트 내용을 Gemini에 보내므로 비밀정보를 확인한 뒤 실행하세요.</details>
      </div>
    );
  }
  return (
    <div className="px-3 py-2 text-xs text-gray-400 dark:text-zinc-500">
      AI 검색 준비됨 — 기록 {indexStatus.documentCount ?? "?"}개
    </div>
  );
}
