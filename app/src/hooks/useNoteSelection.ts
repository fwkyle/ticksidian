import { useCallback } from "react";
import type { NoteListItem } from "../types/note";
import type { SearchHit } from "./useSearch";

/**
 * 노트/투두 선택 흐름 훅 — App에서 추출(2026-08-15 1단계 리팩토링).
 *
 * 원본 App.tsx 로직과 같은 부분:
 * - 노트 선택 시 투두 선택 해제, 투두 선택 시 노트 해제.
 * - 노트/투두를 열면 특수 패널(검토 큐/보안 메모)은 닫는다.
 * - 검색 결과(제목/RAG) 클릭 → 대상 열기 + 검색어 초기화.
 *
 * 원본과 의도적으로 달라진 부분(2026-08-16 검수 F5로 문서화):
 * - `handleSelectSearchHit`의 투두 분기에서도 특수 패널을 닫는다. 원본은 이 분기만
 *   패널을 열어 둔 채 투두를 선택해서, 검토 큐가 메인 영역을 덮은 상태로 선택만
 *   바뀌는 불일치가 있었다. `handleSelectTodo`와 같은 규칙으로 맞춘 것이다.
 */
export interface UseNoteSelectionOptions {
  readonly notes: NoteListItem[];
  readonly setActiveNoteId: (id: string | null) => void;
  readonly setSelectedTodoId: (id: string | null) => void;
  /** 검토 큐/보안 메모 등 메인 영역 특수 패널 닫기 */
  readonly closeSpecialPanels: () => void;
  /** 제목 검색어 초기화(검색 결과 선택 후) */
  readonly clearTitleSearch: () => void;
  /** RAG 검색어 초기화 */
  readonly clearRagSearch: () => void;
}

export function useNoteSelection({
  notes,
  setActiveNoteId,
  setSelectedTodoId,
  closeSpecialPanels,
  clearTitleSearch,
  clearRagSearch,
}: UseNoteSelectionOptions) {
  const handleSelectNote = useCallback((id: string | null) => {
    setActiveNoteId(id);
    setSelectedTodoId(null);
    if (id) closeSpecialPanels();
  }, [setActiveNoteId, setSelectedTodoId, closeSpecialPanels]);

  const handleSelectTodo = useCallback((id: string | null) => {
    setSelectedTodoId(id);
    if (id) {
      setActiveNoteId(null); // 투두 선택 시 노트 해제
      closeSpecialPanels();
    }
  }, [setActiveNoteId, setSelectedTodoId, closeSpecialPanels]);

  const handleOpenNote = useCallback((noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (note?.type === "todo") {
      // 2026-08-18: 투두 전용 열이 사라져서 패널을 여는 단계가 없다.
      // 투두도 노트와 같은 목록에 있고, 선택하면 본문에서 열린다.
      setSelectedTodoId(noteId);
      setActiveNoteId(null);
      closeSpecialPanels();
    } else {
      handleSelectNote(noteId);
    }
  }, [notes, handleSelectNote, setActiveNoteId, setSelectedTodoId, closeSpecialPanels]);

  // 검색 결과 클릭 → 노트/투두 열기 + 검색창 초기화
  const handleSelectSearchHit = useCallback((hit: SearchHit) => {
    const note = hit.note;
    if (note.type === "todo") {
      setSelectedTodoId(note.id);
      setActiveNoteId(null);
      closeSpecialPanels();
    } else {
      handleSelectNote(note.id);
    }
    clearTitleSearch();
  }, [handleSelectNote, setActiveNoteId, setSelectedTodoId, closeSpecialPanels, clearTitleSearch]);

  // RAG 결과의 filePath를 노트 목록과 매칭해 연다.
  // 2026-08-16 볼트 전체 스캔 이후 양쪽 모두 **볼트 루트 기준 상대경로**라 그대로 비교하면 된다.
  // (이전에는 노트 목록이 `notes/` 아래로 제한돼 있어 `^notes/` prefix를 떼고 비교했는데,
  //  그 보정이 이제는 `notes/a.md`와 `a.md`를 같은 것으로 만들어 잘못 열 수 있다.)
  // 설계: docs/waterfall/03-상세설계/볼트-전체-스캔.md
  const handleSelectRagHit = useCallback(
    (hit: { filePath: string }) => {
      const normalize = (p: string) => p.replace(/^\/+/, "");
      const path = normalize(hit.filePath);
      const note = notes.find((n) => {
        const notePath = normalize(
          n.filePath ?? `${n.folder ? `${n.folder}/` : ""}${n.fileBasename}.md`,
        );
        return notePath === path;
      });
      if (!note) return; // 인덱스에는 있지만 목록에 없는 파일(삭제 등)은 무시
      handleOpenNote(note.id);
      clearRagSearch();
    },
    [notes, handleOpenNote, clearRagSearch],
  );

  return {
    handleSelectNote,
    handleSelectTodo,
    handleOpenNote,
    handleSelectSearchHit,
    handleSelectRagHit,
  } as const;
}
