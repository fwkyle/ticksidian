import { useState, useCallback, useMemo } from "react";
import type { NoteListItem } from "../types/note";
import { generateId } from "../lib/id";
import {
  writeNoteFile,
  deleteNoteFile,
  updateNoteFrontmatter,
} from "../lib/local-fs";
import { buildMarkdownExportDocument } from "../lib/markdown-export";
import { addLocalDays, toLocalDateKey } from "../lib/local-date";

export type TodoFilter = "all" | "today" | "upcoming";

/** 기본 태그 옵션 (색상 포함) */
export const DEFAULT_TAG_COLORS: Record<string, string> = {
  업무: "#D3E5EF",
  개인: "#E8DFF5",
  건강: "#DBEDDB",
};

// "오늘"은 로컬 날짜다. UTC(toISOString)는 한국 00:00~09:00에 어제가 된다(2026-10-22).
function getTodayStr(): string {
  return toLocalDateKey();
}

function getUpcomingCutoffStr(): string {
  return addLocalDays(new Date(), 7);
}

export interface UseTodosOptions {
  notes: NoteListItem[];
  refreshNotes: () => Promise<NoteListItem[]>;
}

export interface UseTodosReturn {
  todos: NoteListItem[];
  activeFilter: TodoFilter;
  setActiveFilter: (filter: TodoFilter) => void;
  filteredTodos: NoteListItem[];
  toggleTodo: (noteId: string) => Promise<void>;
  addTodo: (title: string, folder?: string) => Promise<string>;
  deleteTodo: (noteId: string) => Promise<void>;
  updateTodoField: (noteId: string, field: string, value: unknown) => Promise<void>;
}

export function useTodos({ notes, refreshNotes }: UseTodosOptions): UseTodosReturn {
  const [activeFilter, setActiveFilter] = useState<TodoFilter>("all");

  // notes 배열에서 type: "todo"만 필터링
  const todos = useMemo(
    () => notes.filter((n) => n.type === "todo"),
    [notes],
  );

  // 날짜 필터 적용
  const filteredTodos = useMemo(() => {
    const today = getTodayStr();
    const cutoff = getUpcomingCutoffStr();

    switch (activeFilter) {
      case "today":
        return todos.filter((t) => t.dueDate?.slice(0, 10) === today);
      case "upcoming":
        return todos.filter((t) => {
          if (!t.dueDate) return false;
          const d = t.dueDate.slice(0, 10);
          return d >= today && d <= cutoff;
        });
      default:
        return todos;
    }
  }, [todos, activeFilter]);

  // 완료 토글
  const toggleTodo = useCallback(async (noteId: string) => {
    const todo = todos.find((t) => t.id === noteId);
    if (!todo) return;

    // 파일 IO는 디스크 basename으로. stem 충돌 시 todo.id !== todo.fileBasename일 수 있음.
    await updateNoteFrontmatter(todo.fileBasename ?? todo.id, todo.folder, {
      done: !todo.done,
      updatedAt: new Date().toISOString(),
    });
    await refreshNotes();
  }, [todos, refreshNotes]);

  // 새 투두 추가
  const addTodo = useCallback(async (title: string, folder = ""): Promise<string> => {
    if (!title.trim()) return "";

    const id = generateId();
    const now = Date.now();
    const markdownBody = `# ${title.trim()}\n\n`;

    const content = buildMarkdownExportDocument({
      noteId: id,
      title: title.trim(),
      createdAt: now,
      updatedAt: now,
      exportedAt: now,
      markdownBody,
      type: "todo",
      done: false,
    });

    await writeNoteFile(id, content, folder);
    await refreshNotes();
    return id;
  }, [refreshNotes]);

  // 투두 삭제
  const deleteTodo = useCallback(async (noteId: string) => {
    const todo = todos.find((t) => t.id === noteId);
    if (!todo) return;
    await deleteNoteFile(todo.fileBasename ?? todo.id, todo.folder);
    await refreshNotes();
  }, [todos, refreshNotes]);

  // 투두 필드 업데이트 (priority, dueDate, tags 등)
  const updateTodoField = useCallback(async (noteId: string, field: string, value: unknown) => {
    const todo = todos.find((t) => t.id === noteId);
    if (!todo) return;

    const updates: Record<string, unknown> = {
      [field]: value,
      updatedAt: new Date().toISOString(),
    };

    // title 변경 시 frontmatter의 title도 업데이트
    if (field === "title") {
      updates.title = value;
    }

    await updateNoteFrontmatter(todo.fileBasename ?? todo.id, todo.folder, updates);
    await refreshNotes();
  }, [todos, refreshNotes]);

  return {
    todos,
    activeFilter,
    setActiveFilter,
    filteredTodos,
    toggleTodo,
    addTodo,
    deleteTodo,
    updateTodoField,
  };
}
