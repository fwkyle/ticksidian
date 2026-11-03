import { useCallback, useState } from "react";

/**
 * 볼트 전환 정책 훅 — 위험한 전환 차단 모달을 포함한다.
 * 원본 App.tsx 로직과 동일(2026-08-15 1단계 리팩토링).
 *
 * 설계: docs/waterfall/03-상세설계/런타임-볼트-전환-정책.md §5, §7.2
 * - selectVault가 false를 반환하면(폴더 선택 취소) 현재 상태를 그대로 유지한다.
 * - dirty/externalPending이면 모달 확인 후 진행한다.
 * - "깨끗한" 전환 시 resetTransientState(선택/패널/검색 초기화)를 App이 주입한다.
 */
export interface UseVaultSwitchOptions {
  /** selectVault(): 볼트 선택 대화상자. true 반환 시 전환 성공. */
  readonly selectVault: () => Promise<boolean>;
  /** 에디터 미저장 변경 여부(위험 신호 1) */
  readonly editorDirty: boolean;
  /** 외부 수정 pending 여부(위험 신호 2) */
  readonly editorExternalPending: boolean;
  /** 전환 성공 시 App의 휘발성 상태 초기화(선택 해제/패널 닫기/검색 비우기). */
  readonly resetTransientState: () => void;
  /** 초기화 실패 등으로 전환이 끝나지 못했을 때 알린다(DEF-CONC-001). 이전 볼트는 이미 복구돼 있다. */
  readonly onSwitchError?: (error: unknown) => void;
}

export function useVaultSwitch({
  selectVault,
  editorDirty,
  editorExternalPending,
  resetTransientState,
  onSwitchError,
}: UseVaultSwitchOptions) {
  const [showRiskySwitchDialog, setShowRiskySwitchDialog] = useState(false);

  // 볼트 전환의 "깨끗한" 경로.
  const performCleanVaultSwitch = useCallback(async () => {
    try {
      const switched = await selectVault();
      if (!switched) return; // 폴더 선택 취소 → 현재 상태 유지
      resetTransientState();
    } catch (error) {
      onSwitchError?.(error);
    }
  }, [selectVault, resetTransientState, onSwitchError]);

  // 볼트 전환 래퍼: 위험 상태(미저장 변경 / 외부 수정 pending)면 모달 확인 후 진행.
  const handleSelectVault = useCallback(async () => {
    if (editorDirty || editorExternalPending) {
      setShowRiskySwitchDialog(true);
      return;
    }
    await performCleanVaultSwitch();
  }, [editorDirty, editorExternalPending, performCleanVaultSwitch]);

  const handleConfirmRiskySwitch = useCallback(async () => {
    setShowRiskySwitchDialog(false);
    await performCleanVaultSwitch();
  }, [performCleanVaultSwitch]);

  return {
    showRiskySwitchDialog,
    setShowRiskySwitchDialog,
    handleSelectVault,
    handleConfirmRiskySwitch,
  } as const;
}
