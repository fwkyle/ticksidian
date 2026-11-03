import { useState } from "react";
import { ModalDialog } from "./ModalDialog";

/**
 * 폴더 이름 입력 다이얼로그 — 이름 변경/하위폴더 추가 공통.
 * 접근성은 ModalDialog 규칙을 따른다.
 */
export function FolderNameDialog({
  title,
  initialValue,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initialValue?: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialValue ?? "");
  const disabled = name.trim().length === 0;

  return (
    <ModalDialog title={title} onClose={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) void onSubmit(name.trim());
        }}
        className="space-y-4"
      >
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-200">
          폴더 이름
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
