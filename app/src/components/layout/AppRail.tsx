import type { ReactNode } from "react";

/**
 * AppRail — 화면 제일 왼쪽 아이콘 레일 (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/사이드바-3열-레이아웃.md
 * 기준: docs/design-rules.md "사이드바 3열 레이아웃"
 *
 * 사이드바 하단에 세로로 쌓여 있던 버튼 5종을 아이콘만 남겨 이리로 옮겼다.
 * 아이콘 전용 버튼이므로 `aria-label`이 필수이고, 켜짐/꺼짐은 `aria-pressed`로 알린다.
 */

export interface RailAction {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
  /** 토글 버튼이면 현재 켜져 있는지. 단발 실행 버튼이면 생략한다. */
  readonly active?: boolean;
  /** 오른쪽 위에 붙는 숫자 배지(검토 큐 대기 수 등). */
  readonly badge?: number;
  readonly disabled?: boolean;
  /** 드로어 도구 줄에 보이는 짧은 글자. 접근 이름(label)의 앞부분이어야 한다. */
  readonly shortLabel?: string;
  /** false면 1024px 미만 드로어 도구 줄에서 뺀다(백링크). 기본 true. */
  readonly inDrawer?: boolean;
}

export interface AppRailProps {
  /** 위쪽 묶음 — 화면을 바꾸는 토글류. */
  readonly primary: readonly RailAction[];
  /** 아래쪽 묶음 — 내보내기/볼트 변경 같은 도구. */
  readonly secondary?: readonly RailAction[];
}

export function AppRail({ primary, secondary = [] }: AppRailProps) {
  return (
    <nav
      aria-label="빠른 이동"
      data-app-rail
      className="hidden lg:flex h-full w-14 shrink-0 flex-col items-center justify-between border-r border-gray-200 bg-gray-100 py-2 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex flex-col items-center gap-1">
        {primary.map((action) => (
          <RailButton key={action.id} action={action} />
        ))}
      </div>
      {secondary.length > 0 && (
        <div className="flex flex-col items-center gap-1">
          {secondary.map((action) => (
            <RailButton key={action.id} action={action} />
          ))}
        </div>
      )}
    </nav>
  );
}

function RailButton({ action }: { action: RailAction }) {
  const { label, icon, onClick, active, badge, disabled } = action;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      // 토글이 아닌 단발 버튼에는 aria-pressed를 붙이지 않는다(스크린리더가 상태로 읽지 않게).
      {...(active === undefined ? {} : { "aria-pressed": active })}
      className={`relative inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          : "text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
      }`}
    >
      {icon}
      {typeof badge === "number" && badge > 0 && (
        <span className="absolute right-1 top-1 min-w-[1rem] rounded-full bg-blue-600 px-1 text-[10px] font-medium tabular-nums leading-4 text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
