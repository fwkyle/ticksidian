import { useState, useRef, useCallback } from "react";
import type { NoteListItem } from "../../types/note";
import type { UseTodosReturn, TodoFilter } from "../../hooks/useTodos";
import { DEFAULT_TAG_COLORS } from "../../hooks/useTodos";
import { groupItemsByPriority } from "../../lib/priority";
import { PriorityFlag } from "../common/PriorityFlag";
import { NOTE_DND_TYPE } from "../../lib/dnd-types";
import { DEFAULT_PANEL_WIDTHS } from "../../lib/panel-layout";

/* ── 공통 상수/유틸 ── */

const FILTER_LABELS: Record<TodoFilter, string> = {
  all: "전체",
  today: "오늘",
  upcoming: "예정",
};

function getTagColor(tag: string): string {
  return DEFAULT_TAG_COLORS[tag] ?? "#E3E2E0";
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const targetStr = d.toISOString().slice(0, 10);
  if (targetStr === todayStr) return "오늘";
  const diff = Math.ceil(
    (d.getTime() - today.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)
  );
  if (diff === 1) return "내일";
  if (diff < 0) return `${Math.abs(diff)}일 전`;
  return `${diff}일 후`;
}

function isOverdue(dateStr: string | undefined, done: boolean): boolean {
  if (done || !dateStr) return false;
  const today = new Date().toISOString().slice(0, 10);
  return dateStr.slice(0, 10) < today;
}

/* ── 투두 아이템 (드래그 소스) ── */

interface TodoItemProps {
  todo: NoteListItem;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  selected: boolean;
  compact?: boolean;
}

function TodoItem({
  todo,
  onToggle,
  onDelete,
  onSelect,
  selected,
  compact,
}: TodoItemProps) {
  const done = todo.done === true;
  const title = todo.title || "";
  const dateVal = todo.dueDate ?? "";
  const priority = todo.priority ?? "";
  const tags = todo.tags ?? [];
  const overdue = isOverdue(todo.dueDate, done);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData(NOTE_DND_TYPE, todo.id);
    e.dataTransfer.effectAllowed = "move";
  }, [todo.id]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelect(todo.id)}
      className={`group flex items-start gap-2 px-3 py-2 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${
        selected ? "bg-blue-50 dark:bg-blue-900/30 border-l-2 border-blue-500" : "hover:bg-gray-50 dark:hover:bg-zinc-700"
      } ${done ? "opacity-50" : ""}`}
      style={{ WebkitUserDrag: "element" } as React.CSSProperties}
    >
      <button
        draggable={false}
        onClick={(e) => { e.stopPropagation(); onToggle(todo.id); }}
        className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 transition-colors flex items-center justify-center ${
          done
            ? "bg-blue-500 border-blue-500 text-white"
            : "border-gray-300 dark:border-zinc-700 hover:border-blue-400"
        }`}
        title={done ? "완료 취소" : "완료 처리"}
      >
        {done && (
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <span className={`text-sm text-gray-800 dark:text-zinc-100 ${done ? "line-through text-gray-400 dark:text-zinc-500" : ""}`}>
          {title || "제목 없음"}
        </span>
        {!compact && (
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {priority && (
              <span className="inline-flex items-center" title={`우선순위 ${priority}`}>
                <PriorityFlag value={priority} />
              </span>
            )}
            {dateVal && (
              <span className={`text-xs ${overdue ? "text-red-500 dark:text-red-400 font-medium" : "text-gray-400 dark:text-zinc-500"}`}>
                {overdue ? "⚠ " : ""}{formatDate(dateVal)}
              </span>
            )}
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-1 py-0.5 rounded text-xs"
                style={{ backgroundColor: getTagColor(tag), color: "#444" }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        draggable={false}
        onClick={(e) => { e.stopPropagation(); onDelete(todo.id); }}
        className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-opacity text-xs"
        title="삭제"
      >
        ✕
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════
   TodoListPanel — 사이드바 옆 투두바
   (드롭 영역: 노트를 여기에 드롭하면 투두로 변환)
   ══════════════════════════════════════════ */

interface TodoListPanelProps {
  hook: UseTodosReturn;
  selectedTodoId: string | null;
  onSelectTodo: (id: string | null) => void;
  onClose: () => void;
  /** 일반 노트를 투두바에 드롭했을 때 투두로 변환 */
  onConvertToTodo?: (noteId: string) => void;
  /** 패널 리사이저가 정한 폭(px). 생략하면 기본값(288px) (2026-08-18 [kyle] 요청). */
  width?: number;
}

export function TodoListPanel({
  hook,
  selectedTodoId,
  onSelectTodo,
  onClose,
  onConvertToTodo,
  width = DEFAULT_PANEL_WIDTHS.todos,
}: TodoListPanelProps) {
  const {
    todos,
    activeFilter,
    setActiveFilter,
    filteredTodos,
    toggleTodo,
    addTodo,
    deleteTodo,
  } = hook;

  const [inputValue, setInputValue] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pendingTodos = filteredTodos.filter((t) => !t.done);
  const doneTodos = filteredTodos.filter((t) => t.done);
  // 우선순위 그룹 헤더(2026-09-19 TICK-UX-014). 그룹 안 순서는 TodoView가 받은 순서 그대로다.
  const pendingGroups = groupItemsByPriority(pendingTodos, (todo) => todo.priority);

  const totalCount = todos.length;
  const doneCount = todos.filter((t) => t.done).length;

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && inputValue.trim()) {
      addTodo(inputValue);
      setInputValue("");
    }
    if (e.key === "Escape") {
      setInputValue("");
      inputRef.current?.blur();
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    await deleteTodo(id);
    if (selectedTodoId === id) onSelectTodo(null);
  }, [deleteTodo, selectedTodoId, onSelectTodo]);

  // 드롭 영역: 노트를 투두바에 드롭하면 투두로 변환
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(NOTE_DND_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const noteId = e.dataTransfer.getData(NOTE_DND_TYPE);
    if (noteId && onConvertToTodo) {
      onConvertToTodo(noteId);
    }
  }, [onConvertToTodo]);

  return (
    <div
      style={{ width }}
      className={`h-full shrink-0 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-700 flex flex-col transition-colors ${
        dropOver ? "bg-green-50 dark:bg-green-900/30 ring-2 ring-inset ring-green-400" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 헤더 */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">투두</h2>
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <span className="text-xs text-gray-400 dark:text-zinc-500">{doneCount}/{totalCount}</span>
            )}
            <button
              onClick={onClose}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-xs"
              title="닫기"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex gap-1">
          {(Object.keys(FILTER_LABELS) as TodoFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => { setActiveFilter(filter); onSelectTodo(null); }}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                activeFilter === filter ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" : "text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-700"
              }`}
            >
              {FILTER_LABELS[filter]}
            </button>
          ))}
        </div>
      </div>

      {/* 빠른 입력 */}
      <div className={`px-3 py-2 border-b border-gray-100 dark:border-zinc-700 transition-all ${inputFocused ? "bg-blue-50 dark:bg-blue-900/30" : ""}`}>
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${inputFocused ? "border-blue-400" : "border-gray-300 dark:border-zinc-700"}`} />
          <input
            ref={inputRef}
            type="text"
            placeholder="새 투두 추가…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            className="flex-1 text-xs bg-transparent outline-none text-gray-800 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500"
          />
        </div>
      </div>

      {/* 투두 목록 */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {dropOver && filteredTodos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-green-500 dark:text-green-400">
            <span className="text-2xl mb-1">+</span>
            <p className="text-xs">여기에 놓으면 투두로 변환</p>
          </div>
        )}
        {!dropOver && filteredTodos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-zinc-500">
            <span className="text-2xl mb-1">✓</span>
            <p className="text-xs">
              {activeFilter === "today" && "오늘 마감인 투두가 없습니다"}
              {activeFilter === "upcoming" && "7일 내 예정 없음"}
              {activeFilter === "all" && "투두를 추가해보세요"}
            </p>
          </div>
        )}
        {filteredTodos.length > 0 && (
          <>
            {/* 우선순위 그룹 헤더(2026-09-19 TICK-UX-014). 빈 그룹은 그리지 않는다. */}
            {pendingGroups.map((group) => (
              <div key={group.key || "none"} data-todo-group={group.key || "none"}>
                <div className="flex items-center gap-2 px-3 py-1.5 mt-1">
                  {group.key !== "" && <PriorityFlag value={group.key} />}
                  <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">{group.label}</span>
                  <span className="text-xs tabular-nums text-gray-400 dark:text-zinc-500">{group.items.length}</span>
                  <div className="flex-1 h-px bg-gray-100 dark:bg-zinc-700" />
                </div>
                {group.items.map((todo) => (
                  <TodoItem
                    key={todo.id}
                    todo={todo}
                    onToggle={toggleTodo}
                    onDelete={handleDelete}
                    onSelect={onSelectTodo}
                    selected={todo.id === selectedTodoId}
                  />
                ))}
              </div>
            ))}
            {doneTodos.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 mt-1">
                <span className="text-xs text-gray-400 dark:text-zinc-500 font-medium">완료 {doneTodos.length}</span>
                <div className="flex-1 h-px bg-gray-100 dark:bg-zinc-700" />
              </div>
            )}
            {doneTodos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onToggle={toggleTodo}
                onDelete={handleDelete}
                onSelect={onSelectTodo}
                selected={todo.id === selectedTodoId}
                compact
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
