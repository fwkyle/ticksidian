/**
 * local-date.ts — 로컬 날짜 기준 "오늘" 판정 (2026-10-22).
 *
 * 설계: docs/waterfall/03-상세설계/시작-화면-선택.md "로컬 날짜"
 * Node QA: app/qa-start-screen.mjs
 *
 * Why: `toISOString().slice(0, 10)`은 UTC 날짜라 한국 00:00~09:00에 "오늘"이 어제로 잡힌다.
 * 할 일 기한(`dueDate`)은 `YYYY-MM-DD` 문자열이므로 로컬 연·월·일 문자열끼리 견준다.
 */

export type DueState = "overdue" | "today" | "upcoming" | "none";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 로컬 시간대 기준 `YYYY-MM-DD`. */
export function toLocalDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 로컬 날짜에 일수를 더한 `YYYY-MM-DD`. 월말·연말 넘김은 Date가 처리한다. */
export function addLocalDays(date: Date, days: number): string {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return toLocalDateKey(next);
}

const DUE_PREFIX = /^((\d{4})-(\d{2})-(\d{2}))/;

/** 실제 달력에 있는 날짜인가(`2026-09-99`, `2026-02-30` 거부). */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * 기한을 오늘과 견준다. 앞 10자(`YYYY-MM-DD`)만 읽는 점은 `formatDueLabel`과 같다.
 * 비어 있거나 형식이 다르거나 실제 달력에 없는 날짜면 `none`이다(숨기지 않고 날짜 없음으로 둔다).
 */
export function classifyDue(dueDate: string | undefined, todayKey: string): DueState {
  const matched = dueDate ? DUE_PREFIX.exec(dueDate) : null;
  if (!matched) return "none";
  if (!isRealCalendarDate(Number(matched[2]), Number(matched[3]), Number(matched[4]))) return "none";
  const due = matched[1];
  if (due < todayKey) return "overdue";
  if (due === todayKey) return "today";
  return "upcoming";
}
