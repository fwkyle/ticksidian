import { ModalDialog } from "../common/ModalDialog";

/**
 * 위험한 볼트 전환 차단 모달.
 *
 * 현재 에디터에 미저장 변경이 있거나 외부 수정 pending 배너가 떠 있는 상태에서
 * 볼트 전환 버튼을 누르면 이 모달이 뜬다. "조용히 사라지거나 덮어쓰기"를 막는다.
 *
 * 접근성(Esc/포커스 트랩/포커스 복귀)은 공통 ModalDialog가 보장한다.
 * 설계: docs/waterfall/03-상세설계/런타임-볼트-전환-정책.md §5, §7.5
 *      docs/design-rules.md "모달 패턴"
 */
export function RiskyVaultSwitchDialog({
  dirty,
  externalPending,
  onCancel,
  onDiscard,
}: {
  dirty: boolean;
  externalPending: boolean;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  const reasons: string[] = [];
  if (dirty) reasons.push("현재 편집 중인 노트에 아직 저장되지 않은 변경이 있습니다.");
  if (externalPending)
    reasons.push(
      "외부 수정이 감지되어 '외부 변경 버전 불러오기' 또는 '내 변경 유지' 선택이 대기 중입니다.",
    );

  return (
    <ModalDialog
      title="볼트 전환 확인"
      onClose={onCancel}
      description="이 상태로 볼트를 바꾸면 아래 상태가 사라집니다. 진행 전 확인해 주세요."
    >
      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-zinc-200">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <p className="mb-4 text-pretty text-xs text-gray-500 dark:text-zinc-400">
        '변경 버리고 전환'을 누르면 위 미저장 내용이 사라집니다. 유지하려면 '취소' 후
        먼저 저장하세요.
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
          onClick={onDiscard}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          title="현재 미저장 변경과 외부 수정 배너를 버리고 볼트를 전환합니다"
        >
          변경 버리고 전환
        </button>
      </div>
    </ModalDialog>
  );
}
