import { useState, useCallback, useEffect, useRef } from "react";

interface UseEditorRiskStateResult {
  editorDirty: boolean;
  editorExternalPending: boolean;
  handleEditorDirtyChange: (dirty: boolean) => void;
  handleEditorExternalPendingChange: (pending: boolean) => void;
}

/**
 * NoteEditor의 위험 상태(미저장 변경 / 외부 수정 pending)를 관리한다.
 *
 * - editorDirty / editorExternalPending state 와 각 setter 콜백을 제공한다.
 * - editorNoteId가 null로 바뀌면(에디터 언마운트) 두 상태를 모두 false로 리셋한다.
 *   useNoteEditor의 cleanup이 false report를 하지만, 에디터 자체가 렌더되지 않는
 *   경로도 있어 방어적으로 App 레벨에서도 비운다.
 *
 * 중요: 리셋 effect는 window.setTimeout(..., 0) + prevRef 갱신 순서를 원본과 동일하게 유지.
 * useRef가 아니라 setState인 이유: 모달 렌더링이 즉시 이 값을 보기 때문.
 *
 * showRiskySwitchDialog state는 화면 오케스트레이션에 속하므로 App에 잔류한다.
 */
export function useEditorRiskState(
  editorNoteId: string | null,
): UseEditorRiskStateResult {
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorExternalPending, setEditorExternalPending] = useState(false);

  const handleEditorDirtyChange = useCallback((dirty: boolean) => {
    setEditorDirty(dirty);
  }, []);

  const handleEditorExternalPendingChange = useCallback((pending: boolean) => {
    setEditorExternalPending(pending);
  }, []);

  // editorNoteId가 null로 바뀌는 순간(에디터 완전 언마운트) 위험 상태를 비운다.
  // setTimeout(0) deferral로 렌더 중 setState 회피.
  // prevEditorNoteIdRef 갱신은 setTimeout 바깥(동기)에서 해야 다음 effect에서 올바른 prev를 본다.
  const prevEditorNoteIdRef = useRef<string | null>(editorNoteId);
  useEffect(() => {
    if (prevEditorNoteIdRef.current !== null && editorNoteId === null) {
      const timer = window.setTimeout(() => {
        setEditorDirty(false);
        setEditorExternalPending(false);
      }, 0);
      prevEditorNoteIdRef.current = editorNoteId;
      return () => window.clearTimeout(timer);
    }
    prevEditorNoteIdRef.current = editorNoteId;
  }, [editorNoteId]);

  return {
    editorDirty,
    editorExternalPending,
    handleEditorDirtyChange,
    handleEditorExternalPendingChange,
  };
}
