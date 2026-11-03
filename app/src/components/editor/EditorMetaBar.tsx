// 에디터 상태 메타 바 — 로딩/저장/외부수정 상태 표시. NoteEditor에서 분리(2026-08-15 앱 2단계).

import { DiagnosticDownload } from "./DiagnosticDownload";

interface EditorMetaBarProps {
  isLoading: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  saveError: string | null;
  loadError: string | null;
  externalChangeNotice: string | null;
  hasExternalChangePending: boolean;
}

export function EditorMetaBar({
  isLoading,
  isSaving,
  hasUnsavedChanges,
  saveError,
  loadError,
  externalChangeNotice,
  hasExternalChangePending,
}: EditorMetaBarProps) {
  const statusColorClass = isLoading
    ? "bg-yellow-500"
    : hasExternalChangePending
      ? "bg-orange-500"
      : isSaving || hasUnsavedChanges
        ? "bg-blue-500"
        : "bg-green-500";

  const statusLabel = isLoading
    ? "로딩 중…"
    : hasExternalChangePending
      ? "외부 수정 대기 중"
      : isSaving
        ? "저장 중…"
        : hasUnsavedChanges
          ? "미저장"
          : "저장됨";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
      <span className={`inline-flex shrink-0 items-center py-0.5 ${hasExternalChangePending ? "text-orange-600 dark:text-orange-300" : ""}`}>
        <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${statusColorClass}`} />
        <span>{statusLabel}</span>
      </span>
      <DiagnosticDownload />
      {loadError && <span role="alert" className="break-words text-red-500 dark:text-red-400">{loadError}</span>}
      {saveError && <span role="alert" className="break-words text-red-500 dark:text-red-400">{saveError}</span>}
      {externalChangeNotice && (
        <span
          className={
            hasExternalChangePending
              ? "text-yellow-600 dark:text-yellow-300"
              : "text-blue-600 dark:text-blue-400"
          }
        >
          {externalChangeNotice}
        </span>
      )}
    </div>
  );
}
