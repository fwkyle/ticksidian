import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SearchHit } from "../../hooks/useSearch";
import type { RagSearchHit, RagSearchStatus } from "../../hooks/useRagSearch";
import type { RagIndexStatus } from "../../lib/tauri-commands";
import { SearchModeSelect, SearchBarInput } from "./search/SearchControls";
import { SearchResultsList } from "./search/TitleSearchResults";
import { RagIndexNotice, RagResultsList } from "./search/RagSearchResults";

export type SearchMode = "title" | "rag";

interface SearchBarProps {
  readonly mode: SearchMode;
  readonly onModeChange: (mode: SearchMode) => void;
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  readonly hits: readonly SearchHit[];
  readonly isActive: boolean;
  readonly searching?: boolean;
  readonly skipped?: number;
  readonly onSelectHit: (hit: SearchHit) => void;
  // RAG 모드 전용
  readonly ragQuery: string;
  readonly onRagQueryChange: (q: string) => void;
  readonly ragHits: readonly RagSearchHit[];
  readonly ragStatus: RagSearchStatus;
  readonly ragError: string | null;
  readonly ragIndexStatus: RagIndexStatus | null;
  readonly onSelectRagHit: (hit: RagSearchHit) => void;
  /** Cmd+K 등 외부 단축키로 검색창을 깨울 때 쓰는 신호. 값이 바뀌면 입력창에 포커스한다. */
  readonly focusSignal?: number;
  readonly onClose: () => void;
}

export function SearchBar({
  mode,
  onModeChange,
  query,
  onQueryChange,
  hits,
  isActive,
  searching = false,
  skipped = 0,
  onSelectHit,
  ragQuery,
  onRagQueryChange,
  ragHits,
  ragStatus,
  ragError,
  ragIndexStatus,
  onSelectRagHit,
  focusSignal = 0,
  onClose,
}: SearchBarProps) {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 외부 포커스 신호(Cmd+K). 0이 아니고 값이 변할 때만 반응한다.
  useEffect(() => {
    if (focusSignal <= 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  // hits가 바뀌면 첫 결과에 포커스 (결과 없으면 -1).
  // 같은 검색어에서 결과만 갱신되면(이동 뒤 재검색 등) 같은 노트·일치 필드 행을 계속 활성으로 둔다.
  const lastHitsRef = useRef<readonly SearchHit[]>(hits);
  const lastQueryRef = useRef(query);
  useEffect(() => {
    const previous = lastHitsRef.current;
    const sameQuery = lastQueryRef.current === query;
    lastHitsRef.current = hits;
    lastQueryRef.current = query;
    const timer = window.setTimeout(() => {
      setActiveIndex((index) => {
        const before = mode === "title" && sameQuery ? previous[index] : undefined;
        const kept = before ? hits.findIndex((hit) => isSameHit(hit, before)) : -1;
        if (kept >= 0) return kept;
        return hits.length > 0 ? 0 : -1;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hits, mode, query]);

  const handleClear = useCallback(() => {
    onQueryChange("");
    if (mode === "rag") onRagQueryChange("");
  }, [mode, onQueryChange, onRagQueryChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
      const currentHits = mode === "rag" ? ragHits : hits;
      if (e.key === "ArrowDown") {
        if (currentHits.length === 0) return;
        e.preventDefault();
        setActiveIndex((i) => (i + 1 + currentHits.length) % currentHits.length);
      } else if (e.key === "ArrowUp") {
        if (currentHits.length === 0) return;
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + currentHits.length) % currentHits.length);
      } else if (e.key === "Enter") {
        if (currentHits.length === 0) return;
        e.preventDefault();
        const idx = activeIndex >= 0 ? activeIndex : 0;
        const hit = currentHits[idx];
        if (hit) {
          if (mode === "rag") {
            onSelectRagHit(hit as RagSearchHit);
          } else {
            onSelectHit(hit as SearchHit);
          }
        }
      }
    },
    [activeIndex, hits, ragHits, mode, onSelectHit, onSelectRagHit],
  );

  // activeIndex 변경 시 스크롤 맞추기
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-search-index="${activeIndex}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex, mode]);

  const isRagMode = mode === "rag";
  const currentQuery = isRagMode ? ragQuery : query;
  const currentIsActive = isRagMode ? ragQuery.trim().length > 0 : isActive;

  return (
    <div
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      className={`border-b border-gray-200 dark:border-zinc-700 ${currentIsActive ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>
      <div className="mx-3 my-2 flex min-w-0 items-center rounded-md border border-gray-200 bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800">
        <SearchModeSelect mode={mode} onModeChange={onModeChange} />
        <SearchBarInput
          query={currentQuery}
          placeholder="검색"
          ariaLabel={isRagMode ? "전체 검색" : "노트 검색"}
          activeIndex={activeIndex}
          onQueryChange={isRagMode ? onRagQueryChange : onQueryChange}
          onKeyDown={handleKeyDown}
          onClear={handleClear}
          inputRef={inputRef}
        />
      </div>

      {currentIsActive && <p className="px-3 py-1 text-xs text-gray-500 dark:text-zinc-400">모든 폴더 · {isRagMode ? 'AI 의미 검색' : '제목·본문·태그'}</p>}
      {isRagMode && <p className="px-3 py-1 text-xs leading-relaxed text-gray-500 dark:text-zinc-400">입력한 검색어를 Gemini에 보내 의미를 찾습니다. 일반 검색은 ‘내 기록’을 선택하세요.</p>}
      {!isRagMode && searching && <p role="status" className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-400">기록을 찾는 중…</p>}
      {!isRagMode && skipped > 0 && <p role="status" className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-400">{skipped}개는 크기·읽기 제한 또는 외부 변경 때문에 본문을 검색하지 못했습니다. 검색 결과는 최대 50개입니다.</p>}

      {isRagMode ? (
        <>
          {ragStatus === "searching" && (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-zinc-500">
              검색 중…
            </div>
          )}
          {ragError && (
            <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {ragError}
            </div>
          )}
          {currentIsActive && ragStatus !== "searching" && !ragError && (
            <RagResultsList
              hits={ragHits}
              activeIndex={activeIndex}
              listRef={listRef}
              onSelectHit={onSelectRagHit}
              onActivateHit={setActiveIndex}
            />
          )}
          {!currentIsActive && <RagIndexNotice indexStatus={ragIndexStatus} />}
        </>
      ) : (
        currentIsActive && !searching && (
          <SearchResultsList
            hits={hits}
            activeIndex={activeIndex}
            listRef={listRef}
            onSelectHit={onSelectHit}
            onActivateHit={setActiveIndex}
          />
        )
      )}
    </div>
  );
}

function isSameHit(a: SearchHit, b: SearchHit): boolean {
  return a.note.id === b.note.id && a.matchField === b.matchField;
}
