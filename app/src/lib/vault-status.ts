import type { VaultBinding } from "../types/note";

export type VaultStatusTone = "neutral" | "ready" | "warning" | "danger";

export interface VaultStatus {
  label: string;
  tone: VaultStatusTone;
  title: string;
}

/**
 * 현재 볼트의 `vault_binding` 한 행을 사람이 보는 상태 라벨로 매핑한다.
 *
 * M3-1b는 "표시 껍데기"라 실제 동기화 동작은 아직 없다. 따라서 라벨도
 * "동기화 중" 같은 진행 상태처럼 보이지 않게 고른다.
 *
 *  - 로컬 전용         : 서버 동기화 모드 자체가 꺼진 볼트
 *  - 로그인 필요       : sync_enabled인데 아직 로그인 안 함
 *  - 재인증 필요       : 토큰 만료/세션 폐기. 로컬 편집은 계속 가능
 *  - 동기화 준비됨     : 인증은 됐지만 실제 업로드/다운로드는 후속 단계
 *
 * 설계 근거: docs/waterfall/03-상세설계/M3-인증-설계.md §5
 */
export function deriveVaultStatus(
  binding: VaultBinding | null,
): VaultStatus | null {
  if (!binding) return null;

  if (binding.syncMode === "local_only") {
    return {
      label: "로컬 전용",
      tone: "neutral",
      title: "이 볼트는 로컬에만 저장됩니다. 서버 동기화는 사용하지 않습니다.",
    };
  }

  switch (binding.authState) {
    case "signed_in":
      return {
        label: "동기화 준비됨",
        tone: "ready",
        title:
          "서버 동기화 모드가 켜져 있고 로그인 상태입니다. 실제 업로드/다운로드는 후속 단계에서 추가됩니다.",
      };
    case "reauth_required":
      return {
        label: "재인증 필요",
        tone: "danger",
        title:
          "세션이 만료되었습니다. 다시 로그인하면 동기화가 재개됩니다. 로컬 편집은 계속 가능합니다.",
      };
    case "signed_out":
    default:
      return {
        label: "로그인 필요",
        tone: "warning",
        title:
          "이 볼트는 동기화 모드로 표시되어 있지만 로그인되지 않았습니다. 로컬 편집은 그대로 가능합니다.",
      };
  }
}
