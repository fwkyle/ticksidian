// 제목 검색 결과 목록 — SearchBar에서 분리(2026-08-15 앱 2단계 리팩토링).

import type { RefObject } from "react";
import type { SearchHit } from "../../../hooks/useSearch";
import { folderLocationLabel } from '../../../lib/note-info';
import { isNoteDraggable, setNoteDragData } from '../../../lib/dnd-types';

const FIELD_LABEL: Record<SearchHit["matchField"], string> = {
  title: "제목",
  alias: "별칭",
  tag: "태그",
  body: "본문",
};

interface SearchResultsListProps {
  readonly hits: readonly SearchHit[];
  readonly activeIndex: number;
  readonly listRef: RefObject<HTMLDivElement>;
  readonly onSelectHit: (hit: SearchHit) => void;
  readonly onActivateHit: (idx: number) => void;
}

export function SearchResultsList({
  hits,
  activeIndex,
  listRef,
  onSelectHit,
  onActivateHit,
}: SearchResultsListProps) {
  return (
    <div
      ref={listRef}
      className="px-2 pb-2"
      role="listbox"
    >
      {hits.length === 0 ? (
        <div className="px-2 py-3 text-xs text-gray-400 dark:text-zinc-500">
          결과가 없습니다.
        </div>
      ) : (
        hits.map((hit, idx) => (
          <SearchHitRow
            key={`${hit.note.id}:${hit.matchField}:${hit.matchText}`}
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

interface SearchHitRowProps {
  readonly hit: SearchHit;
  readonly idx: number;
  readonly isActiveHit: boolean;
  readonly onSelectHit: (hit: SearchHit) => void;
  readonly onActivateHit: (idx: number) => void;
}

function SearchHitRow({
  hit,
  idx,
  isActiveHit,
  onSelectHit,
  onActivateHit,
}: SearchHitRowProps) {
  const draggable = isNoteDraggable(hit.note);
  // 끌기는 바깥 행이 맡고 안쪽 버튼은 클릭만 받는다(NoteItem과 같은 구조 — WebKit에서 버튼 자체 끌기에 기대지 않는다).
  return (
    <div
      id={`search-hit-${idx}`}
      role="option"
      aria-selected={isActiveHit}
      data-search-index={idx}
      data-search-item={hit.note.title || "제목 없음"}
      draggable={draggable}
      onDragStart={draggable ? (event) => setNoteDragData(event.dataTransfer, hit.note.id) : undefined}
      onMouseEnter={() => onActivateHit(idx)}
      className={`rounded ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${
        isActiveHit
          ? "bg-blue-50 dark:bg-blue-900/30"
          : "hover:bg-gray-100 dark:hover:bg-zinc-700"
      }`}
      style={draggable ? ({ WebkitUserDrag: "element" } as React.CSSProperties) : undefined}
    >
      <button
        type="button"
        draggable={false}
        onClick={() => onSelectHit(hit)}
        className="w-full text-left px-2 py-1.5 rounded text-sm text-gray-700 dark:text-zinc-200 flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate">
            {hit.note.title || "제목 없음"}
            {hit.note.type === "todo" && (
              <span className="ml-1 text-xs text-blue-500 dark:text-blue-400">
                (할 일)
              </span>
            )}
          </div>
          <div className="truncate text-xs text-gray-500 dark:text-zinc-400">{folderLocationLabel(hit.note.folder)}</div>
          {hit.matchField !== "title" && (
            <div className="truncate text-xs text-gray-400 dark:text-zinc-500">
              {FIELD_LABEL[hit.matchField]}: {hit.matchText}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
