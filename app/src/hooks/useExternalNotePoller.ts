// 외부 수정 감지 폴러(3초) — useNoteEditor에서 추출(앱 3단계 패스 2).
// 설계: docs/waterfall/03-상세설계/에디터-저장-외부수정-리팩토링-설계.md §3 패스 2
//
// 계약(파일-감시-외부-수정-반영-정책.md):
// - 로드 전/저장 중이면 IO 자체를 피한다.
// - 로컬 미저장 변경/디바운스 타이머 대기 중 mtime이 바뀌면 pending으로 미룬다(자동 reload 금지).
// - 그 외 mtime 변화는 자동 재로드.
// 결정 트리는 순수 함수 classifyExternalPoll(useNoteEditor.helpers)을 그대로 쓴다.

import { useEffect } from "react";

import { classifyExternalPoll } from "./useNoteEditor.helpers";
import { getVaultFileModifiedAt } from "../lib/local-fs";
import type { EditorSyncState } from "./editor-sync-state";

export interface UseExternalNotePollerOptions {
  /** 검사할 파일(에디터 식별자). 값이 바뀌면 폴링을 다시 시작한다. */
  readonly fileKey: string;
  /** 편집기가 시작할 때 고정한 절대경로. 가변 볼트 경로를 다시 조립하지 않는다. */
  readonly filePath: string;
  /** 로딩 중에는 폴링을 돌리지 않는다(원본 effect와 동일). */
  readonly enabled: boolean;
  /** 저장 중(진행 중) 플래그 — 저장 완료 시 이 훅을 다시 시작시킨다. */
  readonly isSaving: boolean;
  readonly syncState: EditorSyncState;
  /** mtime 변화 감지 → 자동 재로드. */
  readonly onExternalChange: (mtime: number) => void;
  /** 로컬 변경 있음 + mtime 변화 → pending 등록(배너). */
  readonly onPendingExternalChange: (mtime: number) => void;
}

export function useExternalNotePoller({
  fileKey,
  filePath,
  enabled,
  isSaving,
  syncState,
  onExternalChange,
  onPendingExternalChange,
}: UseExternalNotePollerOptions): void {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let checking = false;

    const intervalId = window.setInterval(async () => {
      // 로드 전/저장 중이면 IO 자체를 피한다(빠른 경로).
      if (!active || checking || !syncState.hasLoaded() || isSaving) return;
      checking = true;
      const baseline = syncState.lastKnownFileMtime();
      try {
        const currentMtime = await getVaultFileModifiedAt(filePath);
        if (!active || !syncState.hasLoaded() || baseline !== syncState.lastKnownFileMtime()) return;
        // 고정 경로 stat도 파일 부재/IO 실패 시 null이다. 판정 함수와 같은 빠른 종료다.
        if (currentMtime === null) return;

        const result = classifyExternalPoll({
          hasLoaded: syncState.hasLoaded(),
          isSaving,
          currentMtime,
          lastKnownMtime: syncState.lastKnownFileMtime(),
          pendingExternalMtime: syncState.pendingExternalMtime(),
          hasLocalChanges: syncState.hasLocalChanges(),
          hasPendingTimer: syncState.saveTimer() !== null,
        });
        const resolvedMtime: number = result.nextPendingExternalMtime ?? currentMtime;

        switch (result.action) {
          case "skip":
          case "ignore":
            return;
          case "set-baseline":
            syncState.setLastKnownFileMtime(result.nextLastKnownMtime ?? currentMtime);
            return;
          case "defer-pending":
            syncState.deferExternalChange(resolvedMtime);
            onPendingExternalChange(resolvedMtime);
            return;
          case "reload":
            syncState.deferExternalChange(resolvedMtime);
            onExternalChange(resolvedMtime);
            return;
        }
      } finally {
        checking = false;
      }
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
    // 경로/저장 상태/콜백이 바뀌면 이전 effect와 진행 중 stat 결과를 함께 무효화한다.
  }, [fileKey, filePath, enabled, isSaving, syncState, onExternalChange, onPendingExternalChange]);
}
