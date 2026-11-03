/**
 * qa-start-screen.mjs — 시작 화면 설정·로컬 날짜·오늘 할 일 그룹 규칙 검증 (2026-10-22).
 *
 * 설계: docs/waterfall/03-상세설계/시작-화면-선택.md
 *
 * 핵심 계약
 * - 설정이 없거나 모르는 값이거나 저장소 접근이 예외면 기본함이다.
 * - `오늘 할 일`이면 자동 열기를 하지 않고, 기본함이면 기존처럼 연다.
 * - "오늘"은 로컬 날짜다. 한국 08:30(UTC 전날 23:30)에도 오늘이 오늘이다.
 * - 오늘 할 일은 미완료만, 기한 지남 → 오늘 → 날짜 없음, 앞날은 제외한다.
 *
 * 실행: node --experimental-strip-types qa-start-screen.mjs
 */

// 시간대를 고정한다(Node는 실행 중 TZ 변경을 반영한다). 한국에서 UTC 날짜가 어제가 되는 구간을 잰다.
process.env.TZ = "Asia/Seoul";

import {
  START_SCREEN_STORAGE_KEY,
  currentStartPlan,
  parseStoredStartScreen,
  planStart,
  readStartScreen,
  toggleStartScreen,
  writeStartScreen,
} from "./src/lib/start-screen.ts";
import { addLocalDays, classifyDue, toLocalDateKey } from "./src/lib/local-date.ts";
import { buildTodaySections } from "./src/lib/today-todos.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

// ── 시작 화면 설정 ──
check("저장값 없음 → 기본함", parseStoredStartScreen(null) === "inbox");
check("빈 문자열 → 기본함", parseStoredStartScreen("") === "inbox");
check("모르는 값 → 기본함", parseStoredStartScreen("calendar") === "inbox");
check("today → 오늘 할 일", parseStoredStartScreen("today") === "today");
check("대소문자 다르면 기본함", parseStoredStartScreen("Today") === "inbox");

const memory = (initial) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, value),
  };
};
const throwing = {
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("denied"); },
};

check("읽기 예외 → 기본함", readStartScreen(throwing) === "inbox");
check("저장소 없음 → 기본함", readStartScreen(undefined) === "inbox");
check("저장된 today 읽기",
  readStartScreen(memory({ [START_SCREEN_STORAGE_KEY]: "today" })) === "today");
const store = memory({});
check("쓰기 성공", writeStartScreen("today", store) === true
  && readStartScreen(store) === "today");
check("쓰기 예외는 false", writeStartScreen("today", throwing) === false);
check("토글", toggleStartScreen("inbox") === "today" && toggleStartScreen("today") === "inbox");

check("기본함 계획: 자동 열기 O, 오늘 보기 X",
  planStart("inbox").autoOpenInbox === true && planStart("inbox").goToday === false);
check("오늘 할 일 계획: 자동 열기 X, 오늘 보기 O",
  planStart("today").autoOpenInbox === false && planStart("today").goToday === true);
check("저장소 없는 환경의 현재 계획은 기본함", currentStartPlan().goToday === false);

// ── 로컬 날짜 ──
const kstMorning = new Date("2026-10-21T23:30:00Z"); // KST 2026-10-22 08:30
check("고정 시계: UTC 날짜는 어제(버그 재현)",
  kstMorning.toISOString().slice(0, 10) === "2026-10-21");
check("KST 08:30의 로컬 오늘은 2026-10-22", toLocalDateKey(kstMorning) === "2026-10-22");
check("자정 직전 23:59:59", toLocalDateKey(new Date("2026-10-22T14:59:59Z")) === "2026-10-22");
check("자정 00:00:00", toLocalDateKey(new Date("2026-10-22T15:00:00Z")) === "2026-10-23");
check("월말 넘김 +7일", addLocalDays(new Date("2026-10-28T00:00:00Z"), 7) === "2026-11-04");
check("연말 넘김 +1일", addLocalDays(new Date("2026-12-31T03:00:00Z"), 1) === "2027-01-01");

const today = "2026-10-22";
check("어제 기한 → overdue", classifyDue("2026-10-21", today) === "overdue");
check("오늘 기한 → today", classifyDue("2026-10-22", today) === "today");
check("내일 기한 → upcoming", classifyDue("2026-10-23", today) === "upcoming");
check("기한 없음 → none", classifyDue(undefined, today) === "none");
check("빈 문자열 → none", classifyDue("", today) === "none");
check("형식 불명 → none", classifyDue("tomorrow", today) === "none");
check("달력에 없는 날짜(2026-09-99)는 날짜 없음", classifyDue("2026-09-99", today) === "none");
check("달력에 없는 날짜(2026-02-30)는 날짜 없음", classifyDue("2026-02-30", today) === "none");
check("달력에 없는 날짜(월 13)는 날짜 없음", classifyDue("2026-13-01", today) === "none");
check("평년 2월 29일은 날짜 없음", classifyDue("2027-02-29", today) === "none");
check("윤년 2월 29일은 유효(기한 지남 아님: 2028 > 오늘)", classifyDue("2028-02-29", today) === "upcoming");
check("시각 붙은 값은 앞 10자만 본다", classifyDue("2026-10-22T09:00:00", today) === "today");

// ── 오늘 할 일 그룹 ──
const todo = (id, extra = {}) => ({ id, title: id, type: "todo", done: false, ...extra });
const notes = [
  todo("t-today", { dueDate: "2026-10-22" }),
  todo("t-yesterday", { dueDate: "2026-10-21" }),
  todo("t-old", { dueDate: "2026-10-01", priority: "긴급" }),
  todo("t-tomorrow", { dueDate: "2026-10-23" }),
  todo("t-none", {}),
  todo("t-none-high", { priority: "높음" }),
  todo("t-done", { dueDate: "2026-10-22", done: true }),
  { id: "note-1", title: "note-1", dueDate: "2026-10-22" },
];
const sections = buildTodaySections(notes, "title", today);
const ids = (key) => sections.find((s) => s.key === key)?.items.map((n) => n.id) ?? null;

check("그룹 순서: 기한 지남 → 오늘 → 날짜 없음",
  sections.map((s) => s.key).join(",") === "due:overdue,due:today,due:none");
check("그룹 라벨", sections.map((s) => s.label).join(",") === "기한 지남,오늘,날짜 없음");
check("기한 지남은 우선순위가 먼저", ids("due:overdue")?.join(",") === "t-old,t-yesterday");
check("오늘 그룹", ids("due:today")?.join(",") === "t-today");
check("날짜 없음은 우선순위 높은 것이 먼저", ids("due:none")?.join(",") === "t-none-high,t-none");
check("앞날 기한은 제외", !sections.some((s) => s.items.some((n) => n.id === "t-tomorrow")));
check("완료한 할 일은 제외", !sections.some((s) => s.items.some((n) => n.id === "t-done")));
check("할 일이 아닌 노트는 제외", !sections.some((s) => s.items.some((n) => n.id === "note-1")));
const mixed = buildTodaySections([
  todo("plain", { dueDate: "2026-10-22" }),
  todo("raw-drawing", { dueDate: "2026-10-22", drawing: true }),
  todo("plugin", { dueDate: "2026-10-22", excalidrawPlugin: true }),
  todo("bad-date", { dueDate: "2026-09-99" }),
], "title", today);
check("그림·플러그인 그림은 오늘 보기에서 제외(노출 0)",
  mixed.flatMap((s) => s.items.map((n) => n.id)).sort().join(",") === "bad-date,plain");
check("잘못된 날짜는 숨기지 않고 날짜 없음 그룹",
  mixed.find((s) => s.key === "due:none")?.items.map((n) => n.id).join(",") === "bad-date");
check("빈 그룹은 만들지 않는다",
  buildTodaySections([todo("only", { dueDate: "2026-10-22" })], "title", today).length === 1);
check("대상이 없으면 빈 배열", buildTodaySections([], "title", today).length === 0);
check("KST 08:30에 오늘 기한이 오늘 그룹",
  buildTodaySections([todo("a", { dueDate: "2026-10-22" }), todo("b", { dueDate: "2026-10-21" })],
    "title", toLocalDateKey(kstMorning)).map((s) => `${s.key}:${s.items[0].id}`).join(",")
    === "due:overdue:b,due:today:a");
check("입력 배열을 바꾸지 않는다", notes[0].id === "t-today" && notes.length === 8);

summary();
