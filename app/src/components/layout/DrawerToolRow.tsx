import type { RailAction } from "./AppRail";

/**
 * DrawerToolRow — 1024px 미만 드로어 맨 아래 도구 줄 (2026-10-20 DEF-UI-001).
 *
 * 레일이 숨겨지는 좁은 창에서도 보안 메모·HTML 내보내기·볼트 변경에 갈 수 있게 한다.
 * 동작 정의는 레일과 같은 `RailAction` 목록을 그대로 받는다(복제 금지).
 * 접근 이름은 레일 버튼과 같고, 보이는 글자(`shortLabel`)는 그 이름의 앞부분이다.
 *
 * 설계: docs/waterfall/03-상세설계/사이드바-3열-레이아웃.md §4-0
 * 기준: docs/design-rules.md "반응형 분기"
 */
export function DrawerToolRow({
  actions,
  onAfterAction,
}: {
  readonly actions: readonly RailAction[];
  /** 동작을 실행한 뒤 호출한다(드로어 닫기). */
  readonly onAfterAction: () => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="도구"
      data-drawer-tool-row
      className="flex shrink-0 flex-wrap gap-1 border-t border-gray-200 bg-gray-50 p-2 lg:hidden dark:border-zinc-700 dark:bg-zinc-900"
    >
      {actions.map(({ id, label, shortLabel, icon, onClick, disabled }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          aria-label={label}
          onClick={() => {
            onClick();
            onAfterAction();
          }}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm text-gray-700 [overflow-wrap:break-word] [word-break:keep-all] hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          {icon}
          <span>{shortLabel ?? label}</span>
        </button>
      ))}
    </div>
  );
}
