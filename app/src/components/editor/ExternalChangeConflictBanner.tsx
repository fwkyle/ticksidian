// 외부 수정 충돌 배너 — NoteEditor에서 분리(2026-08-15 앱 2단계 리팩토링).

/** 버전 선택 전에 양쪽 글을 보관한다. 자동 덮어쓰기는 하지 않는다. */
export function ExternalChangeConflictBanner({
  summary,
  protectedDraft = false,
  onReloadFromDisk,
  onKeepLocalChanges,
}: {
  /** 외부 디스크 버전이 마지막 저장본과 어떻게 다른지 짧은 요약. */
  summary?: string | null;
  protectedDraft?: boolean;
  onReloadFromDisk: () => Promise<void>;
  onKeepLocalChanges: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-4 mb-3 rounded-md border border-orange-300 bg-orange-50 p-3 dark:border-orange-700 dark:bg-orange-900/30"
    >
      <p className="text-sm font-semibold text-orange-900 dark:text-orange-200">
        파일이 외부에서 수정되었습니다
      </p>
      <p className="mt-1 text-sm text-orange-800 dark:text-orange-200">
        파일의 수정 시각이 달라 원본 저장을 잠시 멈췄습니다. 작성 중인 글은 그대로 편집할 수 있습니다.
      </p>
      <p className="mt-1 text-sm text-orange-800 dark:text-orange-200">
        {protectedDraft ? '작성 중인 내용은 복구본에 보관했습니다.' : '복구본 보관 상태를 확인해 주세요. 화면의 글은 유지합니다.'}
      </p>
      {summary && (
        <p className="mt-1 rounded bg-orange-100/80 px-2 py-1 text-xs font-medium text-orange-900 dark:bg-orange-950/60 dark:text-orange-200">
          변경 요약: {summary}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => onKeepLocalChanges()}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          내 변경 유지
        </button>
        <button
          type="button"
          onClick={() => void onReloadFromDisk()}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-orange-400 bg-white px-4 py-2.5 text-sm font-medium text-orange-800 hover:bg-orange-100 dark:bg-zinc-800 dark:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          외부 변경 버전 불러오기
        </button>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-orange-700 dark:text-orange-300">
        <li>· 외부 변경 버전 불러오기: 내 작성본을 먼저 보관하고 외부 내용을 보여줍니다.</li>
        <li>· 내 변경 유지: 외부 버전을 먼저 보관하고 내 글을 저장합니다.</li>
      </ul>
    </div>
  );
}
