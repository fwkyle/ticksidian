/**
 * start-screen.ts — 시작 화면 설정과 시작 계획의 단일 규칙 (2026-10-22).
 *
 * 설계: docs/waterfall/03-상세설계/시작-화면-선택.md
 * Node QA: app/qa-start-screen.mjs
 *
 * Why: 앱 시작, 볼트 전환, 기본함 첫 노트 자동 열기가 같은 설정을 따라야 한다. 호출부마다
 * 규칙을 복사하면 한 곳만 `오늘 할 일`로 열리는 갈라짐이 생기므로 결정은 여기서만 한다.
 * 설정이 없거나 읽을 수 없으면 언제나 기본함이다(기존 사용자의 동작 보존).
 */

export type StartScreen = "inbox" | "today";

export const START_SCREEN_STORAGE_KEY = "ticksidian-start-screen";
export const DEFAULT_START_SCREEN: StartScreen = "inbox";
export const START_SCREEN_LABELS: Readonly<Record<StartScreen, string>> = {
  inbox: "기본함",
  today: "오늘 할 일",
};

/** 저장값 복원. 없거나 모르는 값은 기본함이다(fail-safe). */
export function parseStoredStartScreen(raw: string | null | undefined): StartScreen {
  return raw === "today" ? "today" : DEFAULT_START_SCREEN;
}

/** localStorage 읽기. 접근 예외도 기본함이다. */
export function readStartScreen(
  storage: Pick<Storage, "getItem"> | undefined = defaultStorage(),
): StartScreen {
  try {
    return parseStoredStartScreen(storage?.getItem(START_SCREEN_STORAGE_KEY));
  } catch {
    return DEFAULT_START_SCREEN;
  }
}

/** localStorage 쓰기. 실패는 조용히 넘긴다(화면 설정). 저장했으면 true. */
export function writeStartScreen(
  value: StartScreen,
  storage: Pick<Storage, "setItem"> | undefined = defaultStorage(),
): boolean {
  try {
    storage?.setItem(START_SCREEN_STORAGE_KEY, value);
    return storage !== undefined;
  } catch {
    return false;
  }
}

export function toggleStartScreen(current: StartScreen): StartScreen {
  return current === "today" ? "inbox" : "today";
}

export interface StartPlan {
  /** 전체 폴더 + 할 일 종류 + 날짜 그룹 보기로 열지(`오늘 할 일`). */
  readonly goToday: boolean;
  /** 기본함의 첫 일반 노트를 자동으로 열지. 기본함 설정일 때만 참이다. */
  readonly autoOpenInbox: boolean;
}

export function planStart(setting: StartScreen): StartPlan {
  const goToday = setting === "today";
  return { goToday, autoOpenInbox: !goToday };
}

/** 현재 저장된 설정 기준의 시작 계획. App 초기값·볼트 전환·자동 열기가 모두 이 함수를 쓴다. */
export function currentStartPlan(): StartPlan {
  return planStart(readStartScreen());
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
