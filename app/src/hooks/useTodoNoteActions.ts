import { useCallback } from "react";
import type { NoteListItem } from "../types/note";
import { updateNoteFrontmatter } from "../lib/local-fs";
import { toErrorMessage } from "../lib/error-utils";

/**
 * 닫힌 기록의 할 일 표시만 변경한다. 폴더 이동은 종류 변경과 독립적이다.
 * - 파일 IO는 디스크 basename으로 (id != fileBasename일 수 있음).
 */
export interface UseTodoNoteActionsOptions {
  readonly notes: NoteListItem[];
  readonly refreshNotes: () => Promise<NoteListItem[]>;
  readonly setAppError: (message: string | null) => void;
}

export function useTodoNoteActions({ notes, refreshNotes, setAppError }: UseTodoNoteActionsOptions) {
  // 노트를 투두바에 드롭 → 투두로 변환
  const handleConvertToTodo = useCallback(async (noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note || note.drawing || note.excalidrawPlugin || note.type === "todo") return;

    try {
      setAppError(null);
      // 파일 IO는 디스크 basename으로 (id != fileBasename일 수 있음).
      await updateNoteFrontmatter(note.fileBasename ?? note.id, note.folder, {
        type: "todo",
        updatedAt: new Date().toISOString(),
      }, { done: false });
      await refreshNotes();
    } catch (error) {
      console.error('[handleConvertToTodo] failed:', error);
      setAppError(`노트를 투두로 변환하지 못했습니다: ${toErrorMessage(error, "알 수 없는 오류")}`);
    }
  }, [notes, refreshNotes, setAppError]);

  // 목록 메뉴에서 투두 → 노트로 되돌린다. 닫힌 항목 전용이다.
  const handleConvertTodoToNote = useCallback(async (noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note || note.type !== "todo") return;

    try {
      setAppError(null);
      await updateNoteFrontmatter(note.fileBasename ?? note.id, note.folder, {
        type: undefined,
        updatedAt: new Date().toISOString(),
      });
      await refreshNotes();
    } catch (error) {
      console.error('[handleConvertTodoToNote] failed:', error);
      setAppError(`투두를 노트로 되돌리지 못했습니다: ${toErrorMessage(error, "알 수 없는 오류")}`);
    }
  }, [notes, refreshNotes, setAppError]);

  return { handleConvertToTodo, handleConvertTodoToNote } as const;
}
