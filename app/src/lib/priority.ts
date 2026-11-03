/**
 * priority.ts — 할 일 우선순위 단계의 단일 정의 (2026-09-19 TICK-UX-014).
 *
 * 설계: docs/waterfall/03-상세설계/즐겨찾기와-우선순위-시각화.md
 * Node QA: app/qa-priority.mjs
 *
 * Why: 우선순위는 frontmatter에만 저장되고 목록에서는 순서도 색도 드러나지 않았다.
 * [kyle] 요청("투두 -> 우선순위 ... 기능화 및 시각화")으로 목록과 투두바를 단계별 그룹으로
 * 나누고 깃발로 표시한다. 순서·문구·색을 컴포넌트마다 하드코딩하지 않도록 여기서 소유한다.
 *
 * 값 체계는 기존 그대로다(긴급/높음/중간/낮음 + 없음). 이미 가져온 자료에 값이 들어 있다.
 */

export const PRIORITY_LEVELS = ["긴급", "높음", "중간", "낮음"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

/** 값이 없을 때 그룹 헤더에 쓰는 문구. */
export const PRIORITY_NONE_LABEL = "우선순위 없음";

const LEVEL_ORDER = new Map<string, number>(
  PRIORITY_LEVELS.map((level, index) => [level, index]),
);

/** 값 정리. 값이 없거나 공백뿐이면 빈 문자열이다. */
export function normalizePriorityValue(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 우리 4단계 중 하나인가. */
export function isPriorityLevel(value: string | undefined | null): boolean {
  return LEVEL_ORDER.has(normalizePriorityValue(value));
}

/**
 * 그룹·정렬 기준. 긴급 0 … 낮음 3, 값 없음 4, 모르는 값 5다.
 * 모르는 값을 값 없음과 같은 순위로 두면 원래 값을 가진 항목이 "없음"으로 섞인다.
 */
export function priorityRank(value: string | undefined | null): number {
  const normalized = normalizePriorityValue(value);
  if (normalized === "") return PRIORITY_LEVELS.length;
  return LEVEL_ORDER.get(normalized) ?? PRIORITY_LEVELS.length + 1;
}

/**
 * 깃발 색. 기존 투두 칩 팔레트(긴급 빨강 · 높음 주황 · 중간 노랑 · 낮음 회색)를 이어 쓴다.
 * 색을 바꾸면 같은 화면 안에서 같은 단계가 두 가지 색으로 보이므로 기준을 하나로 둔다.
 */
const FLAG_COLORS: Record<string, string> = {
  긴급: "text-red-600 dark:text-red-400",
  높음: "text-orange-600 dark:text-orange-400",
  중간: "text-amber-600 dark:text-amber-400",
  낮음: "text-zinc-500 dark:text-zinc-400",
};

/** 값이 없거나 모르는 값일 때의 깃발 색. */
export const PRIORITY_MUTED_FLAG_COLOR = "text-zinc-400 dark:text-zinc-500";

export function priorityFlagColor(value: string | undefined | null): string {
  return FLAG_COLORS[normalizePriorityValue(value)] ?? PRIORITY_MUTED_FLAG_COLOR;
}

export interface PriorityGroup<T> {
  /** 그룹 키. 단계 이름, 모르는 값 원문, 값 없음은 빈 문자열이다. */
  readonly key: string;
  /** 그룹 헤더 문구. 개수는 호출부가 붙인다. */
  readonly label: string;
  readonly items: readonly T[];
}

/**
 * 우선순위별 그룹. 빈 그룹은 만들지 않는다.
 *
 * 순서: 긴급 > 높음 > 중간 > 낮음 > 모르는 값(이름순) > 우선순위 없음.
 * 틱틱에서 가져온 파일에 우리 4단계 밖의 값이 남아 있을 수 있다. 그 값을 지우거나
 * "없음"에 섞지 않고 원래 이름 그대로 별도 그룹으로 보여준다(원본 값 보존).
 */
export function groupItemsByPriority<T>(
  items: readonly T[],
  getPriority: (item: T) => string | undefined,
): PriorityGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const value = normalizePriorityValue(getPriority(item));
    const bucket = buckets.get(value);
    if (bucket) bucket.push(item);
    else buckets.set(value, [item]);
  }

  const known: PriorityGroup<T>[] = PRIORITY_LEVELS
    .filter((level) => buckets.has(level))
    .map((level) => ({ key: level, label: level, items: buckets.get(level) ?? [] }));

  const unknown: PriorityGroup<T>[] = [...buckets.keys()]
    .filter((key) => key !== "" && !LEVEL_ORDER.has(key))
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((key) => ({ key, label: key, items: buckets.get(key) ?? [] }));

  const none = buckets.get("");
  const groups = none ? [{ key: "", label: PRIORITY_NONE_LABEL, items: none }] : [];

  return [...known, ...unknown, ...groups];
}

