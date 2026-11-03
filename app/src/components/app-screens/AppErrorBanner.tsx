/**
 * 앱 전역 에러 배너 (TICK-P0-003 무음 저장 실패 surface 포함).
 * 상단 중앙 고정, aria-live로 스크린리더에도 즉시 전달된다.
 */
export function AppErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed left-1/2 top-3 z-40 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">작업을 완료하지 못했습니다</p>
          <p className="mt-1 break-words text-red-700 dark:text-red-300">{message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/40"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
