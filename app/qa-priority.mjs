/**
 * qa-priority.mjs — 우선순위 단계/그룹 규칙 검증 (2026-09-19 TICK-UX-014).
 *
 * 설계: docs/waterfall/03-상세설계/즐겨찾기와-우선순위-시각화.md
 *
 * 핵심 계약
 * - 단계 순서는 긴급 > 높음 > 중간 > 낮음 > 모르는 값 > 없음이다.
 * - 빈 그룹은 만들지 않는다.
 * - 모르는 값(틱틱 가져오기 등)은 지우지 않고 원래 이름 그대로 별도 그룹이다.
 * - 값이 없으면(빈 문자열/공백/undefined) 마지막 그룹 하나로 모인다.
 * - 입력 순서를 그룹 안에서 보존한다.
 *
 * 실행: node --experimental-strip-types qa-priority.mjs
 */

import {
  PRIORITY_LEVELS,
  PRIORITY_MUTED_FLAG_COLOR,
  PRIORITY_NONE_LABEL,
  groupItemsByPriority,
  isPriorityLevel,
  normalizePriorityValue,
  priorityFlagColor,
  priorityRank,
} from "./src/lib/priority.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

const values = (groups) => groups.map((group) => group.key);
const todo = (id, priority) => ({ id, priority });

check("단계 순서는 긴급 > 높음 > 중간 > 낮음",
  PRIORITY_LEVELS.join(",") === "긴급,높음,중간,낮음");

check("긴급 0 … 낮음 3",
  priorityRank("긴급") === 0 && priorityRank("높음") === 1
  && priorityRank("중간") === 2 && priorityRank("낮음") === 3);

check("값 없음은 낮음 뒤",
  priorityRank(undefined) === 4 && priorityRank("") === 4 && priorityRank("   ") === 4);

check("모르는 값은 값 없음보다 뒤(별도 취급)", priorityRank("보통") === 5);

check("단계 판정과 값 정리",
  isPriorityLevel("긴급") && !isPriorityLevel("보통") && !isPriorityLevel(undefined)
  && normalizePriorityValue(" 중간 ") === "중간");

check("없는 값에도 색을 돌려준다",
  priorityFlagColor(undefined) === PRIORITY_MUTED_FLAG_COLOR
  && priorityFlagColor("보통") === PRIORITY_MUTED_FLAG_COLOR);

check("단계마다 다른 깃발 색", new Set(PRIORITY_LEVELS.map((level) => priorityFlagColor(level))).size === 4);

{
  const groups = groupItemsByPriority(
    [todo("a", undefined), todo("b", "낮음"), todo("c", "긴급"), todo("d", "보통"), todo("e", "중간")],
    (item) => item.priority,
  );
  check("그룹 순서: 긴급 > 중간 > 낮음 > 모르는 값 > 없음",
    values(groups).join("|") === ["긴급", "중간", "낮음", "보통", ""].join("|"));
  check("없음 그룹 문구", groups[4]?.label === PRIORITY_NONE_LABEL);
  check("그룹 안 순서는 입력 순서",
    groups[0]?.items.map((item) => item.id).join(",") === "c"
    && groups[4]?.items.map((item) => item.id).join(",") === "a");
  check("빈 그룹은 만들지 않는다",
    groups.length === 5 && groups.every((group) => group.items.length > 0));
}

{
  // 모르는 값이 여러 개면 이름순으로 안정 정렬한다(스캔마다 순서가 흔들리지 않게).
  const groups = groupItemsByPriority(
    [todo("a", "보류"), todo("b", "보통"), todo("c", "긴급")],
    (item) => item.priority,
  );
  check("모르는 값은 이름순", values(groups).join("|") === ["긴급", "보류", "보통"].join("|"));
}

{
  const groups = groupItemsByPriority([], (item) => item.priority);
  check("빈 입력은 빈 배열", groups.length === 0);
}

{
  const groups = groupItemsByPriority([todo("a", "  높음  ")], (item) => item.priority);
  check("앞뒤 공백은 같은 단계로 묶는다", groups.length === 1 && groups[0].key === "높음");
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);

