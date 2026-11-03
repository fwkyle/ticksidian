import { useCallback, useEffect, useRef } from "react";
import type { NoteListItem } from "../types/note";
import { renameNoteFile } from "../lib/local-fs";
import { isUuidBasename, planFilenameSync } from "../lib/note-filename";

/**
 * useFilenameSync — 파일명-제목 동기화의 실행 시점/IO 조립 (2026-08-18 [kyle] 결정).
 *
 * 판정 규칙은 lib/note-filename.ts(순수)가 맡고, 이 훅은 "언제 실행해도 안전한가"만
 * 책임진다. rename은 **노트를 벗어나는 순간(switch-away)**과 **볼트 로드 직후
 * catch-up(UUID 파일명 한정, 열린 노트 제외)**에서만 실행한다. 열려 있는 에디터는
 * 마운트 시점의 파일명으로 저장하므로, 열려 있는 동안 파일명을 바꾸면 자동 저장이
 * 옛 경로에 파일을 되살리는 레이스가 생긴다.
 *
 * 설계: docs/waterfall/03-상세설계/파일명-제목-동기화.md
 */
export interface UseFilenameSyncOptions {
  readonly notes: NoteListItem[];
  readonly hasVault: boolean;
  readonly notesLoading: boolean;
  readonly vaultPath: string | null;
  /** 현재 에디터에 열린 노트/투두 id (selectedTodoId ?? activeNoteId). */
  readonly editorNoteId: string | null;
  /** 미저장 변경/저장 타이머 대기 중 — true면 이번 회차 rename을 건너뛴다. */
  readonly editorDirty: boolean;
  readonly refreshNotes: () => Promise<NoteListItem[]>;
}

export interface UseFilenameSyncReturn {
  /** 사용자가 이 노트의 제목을 실제로 바꿨을 때 호출(2단계 추적). */
  markTitleChanged: (noteId: string) => void;
  /**
   * 에디터 선택이 바뀌기 직전에 호출한다(setActiveNoteId/setSelectedTodoId 래퍼).
   * 떠나는 노트가 대상이면 fire-and-forget으로 rename을 시도한다.
   */
  notifyBeforeEditorSwitch: (nextEditorNoteId: string | null) => void;
}

export function useFilenameSync({
  notes,
  hasVault,
  notesLoading,
  vaultPath,
  editorNoteId,
  editorDirty,
  refreshNotes,
}: UseFilenameSyncOptions): UseFilenameSyncReturn {
  // 콜백이 렌더 시점 값에 묶이지 않도록 ref로 최신 값을 본다(useNoteEditor 패턴).
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const editorNoteIdRef = useRef(editorNoteId);
  editorNoteIdRef.current = editorNoteId;
  const editorDirtyRef = useRef(editorDirty);
  editorDirtyRef.current = editorDirty;
  const refreshNotesRef = useRef(refreshNotes);
  refreshNotesRef.current = refreshNotes;

  /** 이번 세션에서 제목이 실제로 바뀐 노트 id(2단계 대상). */
  const titleChangedRef = useRef<Set<string>>(new Set());
  /** rename 배치 직렬화 — 겹쳐 실행하면 같은 노트를 두 번 옮길 수 있다. */
  const busyRef = useRef(false);
  /** 볼트별 catch-up 1회 실행 기록. */
  const catchupDoneForRef = useRef<string | null>(null);

  const runSync = useCallback(async (noteIds: readonly string[]) => {
    if (busyRef.current) return;
    busyRef.current = true;
    let renamedCount = 0;
    try {
      // 같은 배치에서 방금 배정한 이름은 목록 상태에 아직 없다 — 별도로 누적한다.
      const extraTaken = new Set<string>();
      for (const noteId of noteIds) {
        const note = notesRef.current.find((n) => n.id === noteId);
        if (!note) continue;
        const plan = planFilenameSync(note, notesRef.current, {
          titleChanged: titleChangedRef.current.has(noteId),
          extraTakenLowercase: extraTaken,
        });
        if (!plan) {
          // 이미 동기화됐거나 대상이 아니다. 제목이 또 바뀌면 다시 마킹된다.
          titleChangedRef.current.delete(noteId);
          continue;
        }
        try {
          await renameNoteFile(plan.fromBasename, plan.toBasename, plan.folder);
          extraTaken.add(plan.toBasename.toLowerCase());
          titleChangedRef.current.delete(noteId);
          renamedCount++;
        } catch (error) {
          // 실패해도 원본은 유지된다(쓰기 성공 후에만 삭제). 다음 기회에 다시 시도.
          console.error("[useFilenameSync] rename failed:", plan, error);
        }
      }
    } finally {
      busyRef.current = false;
    }
    if (renamedCount > 0) {
      // 파일 시스템 기준 재스캔 — id(stem)·링크 인덱스가 함께 새 이름을 따라간다.
      await refreshNotesRef.current();
    }
  }, []);

  const markTitleChanged = useCallback((noteId: string) => {
    titleChangedRef.current.add(noteId);
  }, []);

  const notifyBeforeEditorSwitch = useCallback((nextEditorNoteId: string | null) => {
    const currentId = editorNoteIdRef.current;
    if (!currentId || currentId === nextEditorNoteId) return;
    // dirty면 언마운트 flush 저장이 옛 경로로 나간다 — 이번 회차는 건너뛴다.
    // UUID 노트는 다음 전환/다음 실행 catch-up이, 2단계 노트는 titleChangedRef가 다시 잡는다.
    if (editorDirtyRef.current) return;
    void runSync([currentId]);
  }, [runSync]);

  // 볼트 로드 직후 catch-up: UUID 파일명으로 남아 있는 노트를 제목으로 정리한다.
  // 현재 열린 노트는 제외(에디터 레이스) — 그 노트는 switch-away가 잡는다.
  useEffect(() => {
    if (!hasVault || notesLoading || !vaultPath) return;
    if (catchupDoneForRef.current === vaultPath) return;
    if (notes.length === 0) return;
    catchupDoneForRef.current = vaultPath;

    const targets = notes
      .filter((n) => n.id !== editorNoteIdRef.current)
      .filter((n) => isUuidBasename(n.fileBasename ?? n.id))
      .map((n) => n.id);
    if (targets.length > 0) void runSync(targets);
  }, [hasVault, notesLoading, vaultPath, notes, runSync]);

  return { markTitleChanged, notifyBeforeEditorSwitch };
}
