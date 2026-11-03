import { useState } from "react";
import { ModalDialog } from "./ModalDialog";

/**
 * 노트 삭제 확인 다이얼로그 (2026-08-18 TICK-UX-008 P0-2).
 *
 * 삭제는 사용자가 되돌리기 어려운 동작이므로 즉시 실행하지 않고 한 번 확인받는다.
 * 실창(Tauri)의 삭제는 .trash/ticksidian/ 로의 이동이라 되돌릴 수 있지만, 복구
 * 진입점이 UI에 없어 '그냥 사라졌다'로 느껴지는 문제를 안내 문구로 막는다.
 *
 * 접근성(Esc/포커스 트랩/트리거 복귀)은 공통 ModalDialog가 보장한다.
 * docs/design-rules.md '모달 패턴' 준수 — 새 모달 패턴을 만들지 않는다.
 */
export function DeleteNoteConfirmDialog({
  noteTitle,
  exclusiveImageCount = 0,
  onCancel,
  onConfirm,
}: {
  noteTitle: string;
  /** 이 노트만 참조하는 이미지 수(2026-08-19 TICK-IMG-002). 0이면 안내 없음. */
  exclusiveImageCount?: number;
  onCancel: () => void;
  onConfirm: (cleanupImages: boolean) => void;
}) {
  const [cleanupImages, setCleanupImages] = useState(true);
  return (
    <ModalDialog
      title="노트 삭제"
      onClose={onCancel}
      description={`'${noteTitle}' 노트를 삭제할까요?`}
    >
      <p className="mb-4 text-xs text-gray-500 dark:text-zinc-400">
        삭제된 노트는 볼트의 .trash 폴더로 이동합니다. 브라우저 미리보기 가짜 볼트에서는
        바로 사라집니다.
      </p>
      {exclusiveImageCount > 0 && (
        <label className="mb-4 flex min-h-[44px] items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <input
            type="checkbox"
            checked={cleanupImages}
            onChange={(event) => setCleanupImages(event.target.checked)}
            className="size-4"
          />
          <span>
            이 노트만 쓰는 이미지 {exclusiveImageCount}개를 함께 정리합니다
            <span className="block text-xs text-gray-500 dark:text-zinc-400">
              다른 노트가 쓰는 이미지는 그대로 둡니다(.trash 폴더로 이동).
            </span>
          </span>
        </label>
      )}
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
          onClick={() => onConfirm(exclusiveImageCount > 0 && cleanupImages)}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          삭제
        </button>
      </div>
    </ModalDialog>
  );
}
