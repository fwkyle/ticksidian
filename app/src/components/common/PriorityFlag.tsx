import { isPriorityLevel, normalizePriorityValue, priorityFlagColor } from "../../lib/priority";

/**
 * PriorityFlag — 할 일 우선순위를 나타내는 작은 깃발 (2026-09-19 TICK-UX-014).
 *
 * 설계: docs/waterfall/03-상세설계/즐겨찾기와-우선순위-시각화.md
 *
 * 색·순서의 기준은 lib/priority.ts 하나다. 값이 없으면 회색 빈 깃발을 그려
 * "단계가 정해지지 않음"과 "화면이 안 그려짐"을 구분한다(정보 바 규칙과 같다).
 * 글자 없이 쓰이므로 호출부가 이름(aria-label 또는 title)을 준다.
 */
export function PriorityFlag({
  value,
  className = "",
}: {
  value?: string;
  className?: string;
}) {
  const filled = isPriorityLevel(value) || normalizePriorityValue(value) !== "";
  const color = priorityFlagColor(value);

  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
      data-priority-flag={filled ? normalizePriorityValue(value) : ""}
      className={`shrink-0 ${color} ${className}`}
    >
      <path
        d="M3.4 1.6v12.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M4.6 2.5h8.1c.45 0 .68.53.37.86L11.2 5.5l1.87 2.14c.31.33.08.86-.37.86H4.6z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

