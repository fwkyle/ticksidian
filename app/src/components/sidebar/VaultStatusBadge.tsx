import type { VaultStatus, VaultStatusTone } from "../../lib/vault-status";

function toneClasses(tone: VaultStatusTone): string {
  switch (tone) {
    case "ready":
      return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 ring-green-200 dark:ring-green-800";
    case "warning":
      return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800";
    case "danger":
      return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 ring-red-200 dark:ring-red-900";
    case "neutral":
    default:
      return "bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 ring-gray-200 dark:ring-zinc-600";
  }
}

/**
 * 사이드바 헤더 아래에 노출되는 작은 라벨.
 * 실제 동기화 진행 표시가 아니라 "현재 볼트가 어떤 모드/인증 상태인지"만 보여준다.
 */
export function VaultStatusBadge({ status }: { status: VaultStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${toneClasses(status.tone)}`}
      title={status.title}
      aria-label={`볼트 상태: ${status.label}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70"
        aria-hidden="true"
      />
      {status.label}
    </span>
  );
}
