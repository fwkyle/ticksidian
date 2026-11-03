import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import type { NoteListItem } from "../../types/note";
import {
  folderDisplayName,
  selectNotesForFolder,
  type FolderSelection,
} from "../../lib/folder-tree";
import {
  NOTE_KIND_FILTERS,
  NOTE_KIND_LABELS,
  NOTE_SORT_KEYS,
  NOTE_SORT_LABELS,
  buildNoteListSections,
  formatDueLabel,
  isTodoItem,
  filterNotesByView,
  type NoteListSection,
  type NoteListView,
  type NoteSortKey,
} from "../../lib/note-list-view";
import { NoteItem } from "./NoteItem";
import { PriorityFlag } from "../common/PriorityFlag";
import { isNoteDraggable, setNoteDragData } from "../../lib/dnd-types";
import { folderLocationLabel } from "../../lib/note-info";
import { toLocalDateKey } from "../../lib/local-date";
import { buildTodaySections } from "../../lib/today-todos";

/**
 * 헤더 검색 토글 아이콘(2026-09-22 [kyle] 요청 — 글자 버튼이 잘 안 보인다).
 * rail-icons와 같은 heroicons outline 계열(stroke 1.5)로 맞춘다.
 */
const HEADER_ICON_CLASS = "h-5 w-5";

const SearchToggleIcon = ({ open }: { open: boolean }) => (
  <svg className={HEADER_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d={open
        ? "M6 18L18 6M6 6l12 12"
        : "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"}
    />
  </svg>
);

/**
 * NoteColumn — 3열 레이아웃의 두 번째 열 (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/사이드바-3열-레이아웃.md
 *      docs/waterfall/03-상세설계/노트-투두-통합-목록.md
 *
 * 폴더 열에서 고른 폴더의 항목을 담는다. **노트와 투두를 함께** 보여주고, 위쪽 필터로
 * 좁힌다([kyle] 결정: "한 화면 + 종류 필터"). 폴더는 맥락(회사/개인)만 맡으므로
 * 한 폴더에 노트·메모·투두가 섞여 있어도 된다.
 *
 * 하위 폴더 노트까지 포함하는 이유는 옵시디언 볼트가 `lectures/OS/source/text`처럼
 * 깊어서, 상위를 골랐을 때 빈 목록이 뜨면 계속 파고들어야 하기 때문이다.
 */
export interface NoteColumnProps {
  readonly notes: readonly NoteListItem[];
  readonly selection: FolderSelection;
  readonly activeNoteId: string | null;
  readonly view: NoteListView;
  readonly onViewChange: (view: NoteListView) => void;
  readonly onSelectNote: (id: string) => void;
  readonly onToggleSearch: () => void;
  readonly searchOpen: boolean;
  readonly captureSlot: ReactNode;
  readonly onDeleteNote: (id: string) => void;
  readonly onNoteContextMenu?: (note: NoteListItem, position: { x: number; y: number }) => void;
  /** 목록에서 바로 투두 완료를 토글한다. 열린 투두는 App이 에디터 경유 저장으로 보낸다. */
  readonly onToggleTodo?: (id: string) => void;
  /** 검색 UI(제목/전체 검색). 목록 위에 붙는다. */
  readonly searchSlot?: ReactNode;
  readonly searching?: boolean;
  /**
   * `오늘 할 일` 보기(2026-10-22). 전체 + 할 일 목록에 기한 지남/오늘/날짜 없음 그룹을 얹는다.
   * 안 주면 기존 목록과 같다. 설계: 시작-화면-선택.md
   */
  readonly todayView?: boolean;
}

export function NoteColumn({
  notes,
  selection,
  activeNoteId,
  view,
  onViewChange,
  onSelectNote,
  onToggleSearch,
  searchOpen,
  captureSlot,
  onDeleteNote,
  onNoteContextMenu,
  onToggleTodo,
  searchSlot,
  searching = false,
  todayView = false,
}: NoteColumnProps) {
  // 렌더마다 로컬 날짜를 다시 읽는다. 자정을 넘긴 뒤 재렌더되면 그룹이 새 날짜로 계산된다.
  const todayKey = toLocalDateKey();
  const folderNotes = useMemo(
    () => selectNotesForFolder(notes, selection),
    [notes, selection],
  );
  // 즐겨찾기 고정 섹션 + 우선순위 그룹(2026-09-19 TICK-UX-013/014).
  const sections = useMemo(
    () => todayView
      ? buildTodaySections(folderNotes, view.sort, todayKey)
      : buildNoteListSections(folderNotes, view),
    [folderNotes, view, todayView, todayKey],
  );
  const visibleCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.items.length, 0),
    [sections],
  );

  const title = todayView
    ? '오늘 할 일'
    : selection === null && view.kind === 'todo' ? '할 일' : folderDisplayName(selection);
  const todoCount = useMemo(
    () => filterNotesByView(folderNotes, { ...view, kind: "todo" }).length,
    [folderNotes, view],
  );
  const hiddenDoneCount = useMemo(
    () => !todayView && view.kind === "todo" && view.hideDone
      ? folderNotes.filter((note) => isTodoItem(note) && note.done === true).length
      : 0,
    [folderNotes, view.kind, view.hideDone, todayView],
  );

  // App의 인라인 콜백이 바뀌어도 행 props는 유지하되, 이벤트는 마지막 커밋의 동작을 쓴다.
  const actionsRef = useRef({ onSelectNote, onDeleteNote, onNoteContextMenu, onToggleTodo });
  useLayoutEffect(() => {
    actionsRef.current = { onSelectNote, onDeleteNote, onNoteContextMenu, onToggleTodo };
  }, [onSelectNote, onDeleteNote, onNoteContextMenu, onToggleTodo]);
  const rowActions = useMemo(() => ({
    onSelectNote: (id: string) => actionsRef.current.onSelectNote(id),
    onDeleteNote: (id: string) => actionsRef.current.onDeleteNote(id),
    onNoteContextMenu: (note: NoteListItem, position: { x: number; y: number }) =>
      actionsRef.current.onNoteContextMenu?.(note, position),
    onToggleTodo: (id: string) => actionsRef.current.onToggleTodo?.(id),
  }), []);
  // 다른 상태로 목록이 갱신될 때 날짜가 바뀌었다면 마감일 색상도 다시 계산한다.
  const calendarDay = new Date().toDateString();

  return (
    <section
      data-note-column
      aria-label={`${title} 목록`}
      className="flex h-full w-full flex-col bg-white dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-1 border-b border-gray-200 px-3 py-3 dark:border-zinc-700">
        <div className="flex min-w-0 items-baseline gap-1">
          <h2 className="truncate text-xl font-semibold leading-7 text-gray-800 dark:text-zinc-100">{title}</h2>
          <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-zinc-500">{visibleCount}</span>
        </div>
       <button
         type="button"
         onClick={onToggleSearch}
         aria-label={searchOpen ? '검색 닫기' : '검색 열기'}
         aria-expanded={searchOpen}
         title={searchOpen ? '검색 닫기 (Esc)' : '검색 (⌘K / Ctrl+K)'}
          className="flex h-11 w-11 lg:h-8 lg:w-8 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
       >
          <SearchToggleIcon open={searchOpen} />
       </button>
      </div>

      {captureSlot}
      {searchOpen && searchSlot}

      {/* 종류 필터 + 정렬 */}
      {!searching && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-zinc-700">
        <div role="group" aria-label="종류 필터" className="flex items-center gap-0.5">
          {NOTE_KIND_FILTERS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onViewChange({ ...view, kind })}
              aria-pressed={view.kind === kind}
              aria-label={
                kind === "todo" && todoCount > 0
                  ? `할 일 ${todoCount}`
                  : NOTE_KIND_LABELS[kind]
              }
              className={`min-h-11 lg:min-h-0 shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                view.kind === kind
                  ? "bg-selection font-medium text-gray-800 dark:text-zinc-100"
                  : "text-gray-500 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              {NOTE_KIND_LABELS[kind]}
              {kind === "todo" && todoCount > 0 && (
                <span className="ms-1 text-[10px] tabular-nums opacity-70">{todoCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* 눌림은 보이는 상태와 일치한다. 숨겨진 개수는 목록 위에 따로 안내한다. */}
          {view.kind === "todo" && !todayView && <button
            type="button"
            onClick={() => onViewChange({ ...view, hideDone: !view.hideDone })}
            aria-pressed={!view.hideDone}
            // 접근 이름을 aria-label로 고정한다 — 표시 텍스트("완료")만으로는
            // 상태를 구분할 수 없어 QA가 이름으로 버튼을 못 찾는다.
            aria-label={view.hideDone ? "완료한 할 일 보이기" : "완료한 할 일 숨기기"}
            title={view.hideDone ? "완료한 할 일 보이기" : "완료한 할 일 숨기기"}
            className={`min-h-11 lg:min-h-0 rounded-full px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              view.hideDone
                ? "text-gray-500 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                : "bg-selection font-medium text-gray-800 dark:text-zinc-100"
            }`}
          >
            완료 포함
          </button>}
          <label className="flex shrink-0 items-center gap-1 text-xs text-gray-400 dark:text-zinc-500">
            <span className="sr-only">정렬 기준</span>
            <select
              value={view.sort}
              onChange={(e) => onViewChange({ ...view, sort: e.target.value as NoteSortKey })}
              aria-label="정렬 기준"
              className="min-h-11 lg:min-h-0 rounded border border-gray-200 bg-white px-1 py-0.5 text-xs text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {NOTE_SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {NOTE_SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>}

      {!searching && hiddenDoneCount > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 break-keep break-words px-4
          text-xs text-gray-500 dark:text-zinc-400">
          <span>완료한 할 일 {hiddenDoneCount}개 숨김</span>
          <button
            type="button"
            onClick={() => onViewChange({ ...view, hideDone: false })}
            className="min-h-11 rounded px-2 underline underline-offset-2 focus-visible:outline-none
              focus-visible:ring-2 focus-visible:ring-blue-500 lg:min-h-8"
          >
            보기
          </button>
        </div>
      )}

      {!searching && <NoteRows
        sections={sections} kind={view.kind} activeNoteId={activeNoteId}
        hiddenDoneCount={hiddenDoneCount} todayView={todayView}
        pinnedCollapsed={view.pinnedCollapsed}
        onTogglePinned={() => onViewChange({ ...view, pinnedCollapsed: !view.pinnedCollapsed })}
        calendarDay={calendarDay} {...rowActions}
        onToggleTodo={onToggleTodo ? rowActions.onToggleTodo : undefined}
      />}
    </section>
  );
}

type NoteRowsProps = Pick<NoteColumnProps,
  'activeNoteId' | 'onSelectNote' | 'onDeleteNote' | 'onNoteContextMenu' | 'onToggleTodo'> & {
  sections: readonly NoteListSection[];
  kind: NoteListView['kind'];
  calendarDay: string;
  pinnedCollapsed: boolean;
  hiddenDoneCount: number;
  todayView: boolean;
  onTogglePinned: () => void;
};

/**
 * 목록 본문. 즐겨찾기 고정 섹션과 우선순위 그룹 헤더를 그린다(2026-09-19 TICK-UX-013/014).
 * 입력칸/검색 버튼만 바뀔 때는 행 요소 구성을 건너뛴다.
 */
const NoteRows = memo(function NoteRows({
  sections, kind, activeNoteId, calendarDay, pinnedCollapsed, onTogglePinned, hiddenDoneCount, todayView,
  onSelectNote, onDeleteNote, onNoteContextMenu, onToggleTodo,
}: NoteRowsProps) {
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const renderNote = (note: NoteListItem) => isTodoItem(note) ? (
    <TodoRow key={note.id} note={note} active={note.id === activeNoteId}
      calendarDay={calendarDay} onSelectNote={onSelectNote}
      onNoteContextMenu={onNoteContextMenu} onToggleTodo={onToggleTodo} />
  ) : (
    <NoteItem key={note.id} note={note} depth={0}
      activeNoteId={note.id === activeNoteId ? note.id : null}
      onSelectNote={onSelectNote} onDeleteNote={onDeleteNote}
      onNoteContextMenu={onNoteContextMenu} />
  );
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {total === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-gray-400 dark:text-zinc-500">
          {todayView
            ? "오늘 볼 할 일이 없습니다"
            : kind === "todo"
            ? hiddenDoneCount > 0 ? "남은 할 일이 없습니다" : "이 범위에는 할 일이 없습니다"
            : kind === "record"
              ? "아직 기록이 없습니다. 새 기록을 시작해 보세요."
              : "이 폴더에는 항목이 없습니다"}
        </p>
      ) : (
        sections.map((section) => (
          <div key={section.key} data-list-section={section.key}>
            {section.label !== null && (section.collapsible ? (
              <button
                type="button"
                onClick={onTogglePinned}
                aria-expanded={!pinnedCollapsed}
                aria-label={pinnedCollapsed ? "즐겨찾기 펼치기" : "즐겨찾기 접기"}
                title={pinnedCollapsed ? "즐겨찾기 펼치기" : "즐겨찾기 접기"}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:bg-zinc-700"
              >
                <span aria-hidden="true" className="text-[10px]">{pinnedCollapsed ? "▸" : "▾"}</span>
                <span>{section.label}</span>
                <span className="tabular-nums text-gray-400 dark:text-zinc-500">{section.items.length}</span>
              </button>
            ) : (
              <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 dark:text-zinc-400">
                <span>{section.label}</span>
                <span className="tabular-nums text-gray-400 dark:text-zinc-500">{section.items.length}</span>
              </div>
            ))}
            {!section.collapsible || !pinnedCollapsed ? section.items.map(renderNote) : null}
          </div>
        ))
      )}
    </div>
  );
});
/**
 * 목록 안의 투두 한 줄. 체크박스로 노트와 구분되고, 그 자리에서 완료를 토글한다.
 * 태그 칩은 목록에서 뗐다(2026-08-29 [kyle] 승인 — 칩이 목록 리듬을 깸).
 * 태그는 노트 정보 바에서 확인·편집한다.
 */
const TodoRow = memo(function TodoRow({
  note,
  active,
  onSelectNote,
  onNoteContextMenu,
  onToggleTodo,
}: {
  note: NoteListItem;
  active: boolean;
  /** memo 경계에서도 날짜가 바뀌면 마감 상태를 갱신한다. */
  calendarDay: string;
  onSelectNote: NoteColumnProps['onSelectNote'];
  onNoteContextMenu?: NoteColumnProps['onNoteContextMenu'];
  onToggleTodo?: NoteColumnProps['onToggleTodo'];
}) {
  const done = note.done === true;
  const due = formatDueLabel(note.dueDate);
  const dueClass = due?.state === "overdue" && !done
    ? "font-medium text-red-500 dark:text-red-400"
    : due?.state === "today"
      ? "font-medium text-blue-600 dark:text-blue-300"
      : "text-gray-500 dark:text-zinc-500";
  return (
    <div
      data-list-item={note.title}
      draggable={isNoteDraggable(note)}
      onDragStart={(event) => setNoteDragData(event.dataTransfer, note.id)}
      onContextMenu={(event) => { event.preventDefault(); onNoteContextMenu?.(note, { x: event.clientX, y: event.clientY }); }}
      className={`group flex items-center gap-1 rounded-md pl-0 pr-2.5 mb-1 h-[44px] md:h-[40px] ${
        active ? "bg-selection" : "hover:bg-gray-100 dark:hover:bg-zinc-800"
      }`}
    >
      <button
        type="button"
        onClick={onToggleTodo ? () => onToggleTodo(note.id) : undefined}
        disabled={!onToggleTodo}
        aria-label={`${note.title} ${done ? "완료 취소" : "완료"}`}
        aria-pressed={done}
        className="flex h-[44px] w-[44px] md:h-[40px] md:w-[40px] shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 disabled:cursor-default"
      >
        <span data-todo-check className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-xs text-white ${done ? "border-blue-600 bg-blue-600" : "border-gray-500 dark:border-zinc-400"}`}>
          {done ? "✓" : ""}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onSelectNote(note.id)}
        aria-current={active ? "true" : undefined}
        title={`${note.title || "제목 없음"} · ${folderLocationLabel(note.folder)}`}
        className={`flex h-full min-w-0 flex-1 items-center gap-2 rounded text-left text-sm font-medium leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 ${
          done
            ? "text-gray-400 line-through dark:text-zinc-500"
            : active
              ? "text-gray-800 dark:text-zinc-100"
              : "text-gray-700 dark:text-zinc-200"
        }`}
      >
        {/* 깃발은 값이 있을 때만 그린다. "우선순위 없음"이 대부분인 목록에서 빈 깃발은 소음이다(2026-09-19). */}
        {note.priority && (
          <span className="flex shrink-0 items-center" title={`우선순위 ${note.priority}`}>
            <PriorityFlag value={note.priority} />
          </span>
        )}
        <span className="min-w-[3em] flex-1 truncate font-semibold">{note.title}</span>
        {due && <span aria-hidden="true" title={due.label} className={`min-w-0 max-w-[45%] truncate text-[11.5px] ${dueClass}`}>{due.label}</span>}
      </button>
    </div>
  );
});
