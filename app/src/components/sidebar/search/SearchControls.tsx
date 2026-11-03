// 검색 범위 선택 + 입력창. 같은 줄에 두되 상태/키보드 흐름은 SearchBar가 소유한다.

import type { KeyboardEvent } from "react";
import type { SearchMode } from "../SearchBar";

export function SearchModeSelect({
  mode,
  onModeChange,
}: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
}) {
  return (
    <select
      aria-label="검색 범위"
      value={mode}
      onChange={(event) => onModeChange(event.target.value === "rag" ? "rag" : "title")}
      title="내 기록: 로컬 제목·본문·태그 / AI: 검색어 외부 전송"
      className="h-11 md:h-9 w-[68px] shrink-0 rounded-l-md border-r border-gray-200 bg-transparent pl-1 text-xs text-gray-600 dark:border-zinc-700 dark:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
    >
      <option value="title">내 기록</option>
      <option value="rag">AI</option>
    </select>
  );
}

interface SearchBarInputProps {
  readonly query: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly activeIndex: number;
  readonly onQueryChange: (q: string) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  readonly onClear: () => void;
  readonly inputRef?: React.RefObject<HTMLInputElement>;
}

export function SearchBarInput({
  query,
  placeholder,
  ariaLabel,
  activeIndex,
  onQueryChange,
  onKeyDown,
  onClear,
  inputRef,
}: SearchBarInputProps) {
  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        ref={inputRef}
        placeholder={placeholder}
        title="↑↓ 결과 이동 · Enter 열기 · Esc 지우기"
        className={`h-11 md:h-9 w-full min-w-0 rounded-r-md bg-transparent pl-2 ${query.length > 0 ? "pr-8" : "pr-2"} text-[13.5px] text-gray-800 dark:text-zinc-100 placeholder:text-gray-500 dark:placeholder:text-zinc-500 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400`}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `search-hit-${activeIndex}` : undefined
        }
      />
      {query.length > 0 && (
        <button
          onClick={onClear}
          className="absolute right-0 top-0 h-11 w-8 md:h-9 text-gray-500 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 flex items-center justify-center text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
          aria-label="검색어 지우기"
          title="검색어 지우기 (Esc)"
        >
          ×
        </button>
      )}
    </div>
  );
}
