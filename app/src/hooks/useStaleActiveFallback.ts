import { useEffect } from "react";
import type { NoteListItem } from "../types/note";

interface UseStaleActiveFallbackParams {
  notes: NoteListItem[];
  activeNoteId: string | null;
  selectedTodoId: string | null;
  setActiveNoteId: (id: string | null) => void;
  setSelectedTodoId: (id: string | null) => void;
}

/**
 * Stale active state fallback.
 *
 * 외부 삭제/이동으로 선택된 노트나 투두가 notes 목록에 없어지면
 * 자동으로 안전한 다음 항목으로 복구한다.
 *
 * 설계: docs/waterfall/03-상세설계/파일-감시-외부-수정-반영-정책.md §10.4
 *
 * 중요: window.setTimeout(..., 0) deferral을 보존한다.
 * 렌더 사이클 중 setState를 직접 호출하면 무한 렌더가 발생하므로
 * 반드시 다음 태스크 큐에서 실행해야 한다.
 */
export function useStaleActiveFallback({
  notes,
  activeNoteId,
  selectedTodoId,
  setActiveNoteId,
  setSelectedTodoId,
}: UseStaleActiveFallbackParams): void {
  // activeNoteId가 notes에 없으면 첫 번째 일반 노트로 fallback
  useEffect(() => {
    if (activeNoteId === null) return;
    const exists = notes.some((n) => n.id === activeNoteId);
    if (!exists) {
      const fallback = notes.find((n) => n.type !== "todo");
      const nextActiveNoteId = fallback ? fallback.id : null;
      const timer = window.setTimeout(() => {
        setActiveNoteId(nextActiveNoteId);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [notes, activeNoteId, setActiveNoteId]);

  // selectedTodoId가 notes에 없으면 null로 fallback
  useEffect(() => {
    if (selectedTodoId === null) return;
    const selected = notes.find((n) => n.id === selectedTodoId);
    if (!selected || selected.type !== "todo") {
      const timer = window.setTimeout(() => {
        // 할 일 표시 해제는 삭제가 아니다. 같은 기록의 편집기를 유지한다.
        if (selected) setActiveNoteId(selected.id);
        setSelectedTodoId(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [notes, selectedTodoId, setSelectedTodoId, setActiveNoteId]);
}
