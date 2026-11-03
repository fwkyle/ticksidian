import { ModalDialog } from "./ModalDialog";

/** 폴더 삭제 확인. 실제 동작은 .trash 이동이며 실제 삭제가 아니다. */
export function DeleteFolderConfirmDialog({
  folderName,
  noteCount,
  onCancel,
  onConfirm,
}: {
  folderName: string;
  noteCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalDialog
      title="폴더 삭제"
      onClose={onCancel}
      description={`'${folderName}' 폴더를 삭제할까요? 안에 노트 ${noteCount}개가 있습니다.`}
    >
      <p className="mb-4 text-xs text-gray-500 dark:text-zinc-400">
        폴더와 안의 파일은 볼트의 .trash 폴더로 이동합니다. 브라우저 미리보기에서는
        목록에서만 사라집니다.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          폴더 삭제
        </button>
      </div>
    </ModalDialog>
  );
}
