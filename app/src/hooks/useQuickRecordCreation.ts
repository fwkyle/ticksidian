import { useCallback, useLayoutEffect, useRef } from 'react';
import { INBOX_FOLDER } from '../lib/folder-tree';

interface QuickRecordCreationOptions {
  vaultPath: string | null;
  folder: string | null;
  listKind: string;
  editorNoteId: string | null;
  editorDirty: boolean;
  editorExternalPending: boolean;
  searchOpen: boolean;
  showReviewQueue: boolean;
  showSecretsViewer: boolean;
  create: (title: string, folder: string, onCreated: (id: string) => void) => Promise<string>;
  open: (id: string, folder: string) => void;
}

/** 생성 IO와 화면 전환을 분리한다. 기다리는 동안 사람이 바꾼 화면을 되돌리지 않는다. */
export function useQuickRecordCreation({
  vaultPath, folder, listKind, editorNoteId, editorDirty, editorExternalPending,
  searchOpen, showReviewQueue, showSecretsViewer, create, open,
}: QuickRecordCreationOptions) {
  const generation = useRef(0);
  useLayoutEffect(() => {
    // cleanup에서 무효화하므로 A→B→A와 언마운트도 같은 경계로 막는다.
    return () => { generation.current += 1; };
  }, [vaultPath, folder, listKind, editorNoteId, editorDirty, editorExternalPending,
    searchOpen, showReviewQueue, showSecretsViewer]);

  return useCallback(async (title: string) => {
    if (editorDirty || editorExternalPending) {
      throw new Error('현재 기록의 저장이나 외부 변경 확인을 마친 뒤 다시 추가해 주세요. 제목은 그대로 남겨두었습니다.');
    }
    const started = generation.current;
    const target = folder ?? INBOX_FOLDER;
    return create(title, target, id => {
      if (started === generation.current) open(id, target);
    });
  }, [create, open, folder, editorDirty, editorExternalPending]);
}
