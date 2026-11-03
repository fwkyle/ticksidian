/**
 * useNoteEditor.ts에서 추출한 순수 helper.
 *
 * 이 파일의 함수들은 React state, ref, side effect 없이 입출력만 다룬다.
 * 큰 분해 전 안전망 역할로 분리되었으며, 동작 변경은 회귀로 본다.
 *
 * **동기화 주의**: `app/qa-note-editor-helpers.mjs`가 같은 로직을 미러링해서
 * 검증한다. 한쪽을 바꾸면 다른 쪽도 같이 바꿔라.
 */

export type ReloadReason = "initial" | "external" | "manualReload";

/**
 * 제목이 바뀔 때 이전 제목을 aliases에 누적한다.
 * - prevTitle이 없거나 nextTitle과 같으면 existing 그대로 반환.
 * - prevTitle이 빈 문자열(공백만)이면 추가하지 않는다.
 * - 이미 existing에 포함된 값이면 중복 추가하지 않는다.
 */
export function accumulateAliases(
  prevTitle: string | undefined,
  nextTitle: string,
  existing: string[],
): string[] {
  if (
    !prevTitle ||
    prevTitle === nextTitle ||
    prevTitle.trim().length === 0
  ) {
    return existing;
  }
  if (existing.includes(prevTitle)) {
    return existing;
  }
  return [...existing, prevTitle];
}

/**
 * frontmatter.aliases 값이 array of string인지 확인하고 string만 필터링한다.
 * - 배열이 아니면 빈 배열 반환.
 * - 배열이지만 비-string 항목이 섞여 있으면 string만 남긴다.
 */
export function normalizeFrontmatterAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (a): a is string => typeof a === "string",
  );
}

/**
 * 외부 수정이 감지되었을 때 즉시 재로드해도 안전한지 판정.
 * - hasLocalChanges: 사용자가 편집한 미저장 변경이 있는가
 * - hasPendingTimer: 디바운스 자동 저장 타이머가 예약되어 있는가
 * 둘 중 하나라도 true면 즉시 재로드는 데이터 유실 위험 → true 반환(defer).
 *
 * 호출부는 ref/timer 자체를 옮기지 않고 .current로 풀어서 boolean을 넘긴다.
 */
export function shouldDeferExternalReload(
  hasLocalChanges: boolean,
  hasPendingTimer: boolean,
): boolean {
  return hasLocalChanges || hasPendingTimer;
}

/**
 * reload reason별 사용자 안내 메시지.
 * - "initial": 메시지 없음(파일 첫 로드는 별도 알림 불필요).
 * - "external" / "manualReload": 각각 다른 안내 문구.
 */
export function noticeForReloadReason(reason: ReloadReason): string | null {
  if (reason === "external") {
    return "외부 수정이 감지되어 최신 파일 내용으로 다시 불러왔습니다.";
  }
  if (reason === "manualReload") {
    return "외부 변경 버전으로 다시 불러왔습니다.";
  }
  return null;
}

// ===========================================================================
// TICK-P0-003 분해 대상 순수 결정 로직.
//
// 아래 함수들은 현재 `useNoteEditor.ts` 본체에 inline으로 흩어진 결정 로직을
// 순수 함수로 추출한 것이다. 분해(decomposition) 단계에서 hook이 이 함수들을
// 채택한다. 검증기는 `app/qa-note-editor-flow.mjs`가 이 파일을 **직접 import**해서
// 돌리므로(미러링 아님) drift가 없다.
//
// 검증기 먼저 추가 → 그 뒤 hook 채택 + Tauri 클릭 QA 순서다(TICK-P0-003).
// ===========================================================================

/**
 * BlockNote onChange가 "사용자 편집"인지 판정한다.
 *
 * 현재 hook(`useNoteEditor.ts` handleChange)은 `hasLoaded && !isReloading`만 본다.
 * 그러나 reload guard 해제가 `setTimeout(0)` macrotask에 의존해, BlockNote가
 * onChange를 더 늦은 macrotask로 미루면 guard가 풀린 뒤 도착한 change를 사용자
 * 편집으로 오인할 수 있다(reload guard race, `useNoteEditor.ts:296-337`).
 *
 * 이 함수는 race-hardened 판정이다: 내용이 방금 로드한 디스크 내용과 같으면
 * (`contentChangedSinceLoad=false`) guard 상태와 무관하게 사용자 편집이 아니다.
 * 시간 의존 대신 내용 동일성(idempotency)으로 ping-pong 저장 루프를 닫는다.
 */
export function shouldTreatChangeAsUserEdit(
  hasLoaded: boolean,
  isReloading: boolean,
  contentChangedSinceLoad: boolean,
): boolean {
  if (!hasLoaded) return false;
  if (isReloading) return false;
  return contentChangedSinceLoad;
}

/** 저장 직전 재확인 1회의 판정 결과. */
export type PreSaveGuardAction =
  | "proceed" // 기준선과 디스크가 일치(또는 비교 불가) → 저장 진행
  | "abort-external-change"; // 디스크가 기준선과 다름 → 저장 중단, 충돌로 넘김

export interface PreSaveGuardInput {
  /** 저장 직전에 다시 읽은 디스크 mtime. 파일 없음/stat 실패면 null. */
  currentMtime: number | null;
  /** 마지막 로드/저장 시점에 기록한 기준 mtime. 아직 없으면 null. */
  baselineMtime: number | null;
}

export interface PreSaveGuardResult {
  action: PreSaveGuardAction;
  /** action이 'abort-external-change'일 때 관측한 디스크 mtime. */
  externalMtime?: number;
}

/**
 * 저장 직전 외부 변경 가드 (TICK-BUG-001, 2026-08-23).
 *
 * 왜 필요한가: 외부 수정 감지가 3초 폴링뿐이라 "마지막 폴링 ~ 실제 쓰기" 사이의 변경을
 * 구조적으로 볼 수 없다. 그 틈에 저장하면 외부 내용이 경고 없이 덮이고, 이어서 markSaved가
 * 기준 mtime을 우리 저장 시각으로 올리기 때문에 이후 폴링도 영원히 감지하지 못한다
 * (currentMtime <= lastKnownMtime → ignore). 즉 조용한 영구 유실이다.
 * 같은 위험을 보안 메모는 이미 막고 있다(`secrets_viewer.rs::write_secret_file_impl`의
 * expected_mtime 비교). 노트 저장 경로에만 없던 가드를 같은 모양으로 채운다.
 *
 * 왜 `>`가 아니라 `!==`인가: mtime을 보존하는 동기화 도구(Syncthing, rsync -t)는 원본의
 * 오래된 mtime을 그대로 써 넣는다. 더 새로울 때만 막으면 그런 변경을 놓친다.
 *
 * 한계(의도한 fail-open): currentMtime이 null이면 진행한다. 새 노트의 첫 저장은 파일이
 * 아직 없어 null이고, 일시적 stat 실패로 저장을 영구 차단하면 그게 더 큰 유실이다.
 * 이 가드는 창을 3초에서 1ms 수준으로 줄이는 것이지 0으로 만들지 않는다(완전 차단은
 * 파일 잠금 수준의 별도 작업이다).
 */
export function classifyPreSaveGuard(input: PreSaveGuardInput): PreSaveGuardResult {
  if (input.baselineMtime === null) return { action: "proceed" };
  if (input.currentMtime === null) return { action: "proceed" };
  if (input.currentMtime === input.baselineMtime) return { action: "proceed" };
  return { action: "abort-external-change", externalMtime: input.currentMtime };
}

/** 외부 수정 폴링 1회의 판정 결과. */
export type ExternalPollAction =
  | "skip" // 아직 로드 안 됨 / 저장 중 / mtime 미확보 → 아무것도 안 함
  | "set-baseline" // 첫 관측 → 현재 mtime을 기준선으로 기록
  | "ignore" // 더 새 파일 아님 / 이미 같은 mtime을 pending 처리함
  | "defer-pending" // 더 새 파일이지만 미저장 변경/타이머 있음 → 충돌 배너로 미룸
  | "reload"; // 더 새 파일 + 안전 → 디스크에서 재로드

export interface ExternalPollInput {
  hasLoaded: boolean;
  isSaving: boolean;
  /** getNoteFileModifiedAt 결과. IO 실패/파일 없음이면 null. */
  currentMtime: number | null;
  lastKnownMtime: number | null;
  pendingExternalMtime: number | null;
  hasLocalChanges: boolean;
  hasPendingTimer: boolean;
}

export interface ExternalPollResult {
  action: ExternalPollAction;
  /** action이 'set-baseline'이면 새 lastKnownMtime. */
  nextLastKnownMtime?: number;
  /** action이 'defer-pending' 또는 'reload'이면 새 pendingExternalMtime. */
  nextPendingExternalMtime?: number;
}

/**
 * 외부 수정 폴링(3초 interval, `useNoteEditor.ts:517-548`)의 결정 트리를 순수
 * 함수로 옮긴 것. ref/IO/타이머 없이 입력 스냅샷만으로 다음 행동을 분류한다.
 *
 * 현재 hook과 동일한 순서를 보존한다:
 *   1) 로드 전이거나 저장 중이거나 mtime 미확보 → skip
 *   2) lastKnownMtime이 null(첫 관측) → set-baseline
 *   3) currentMtime <= lastKnown → ignore (더 새 파일 아님)
 *   4) 같은 mtime을 이미 pending 처리 → ignore (중복 방지)
 *   5) 미저장 변경/타이머 있음 → defer-pending (pendingMtime 갱신)
 *   6) 그 외 → reload (pendingMtime 갱신)
 */
export function classifyExternalPoll(input: ExternalPollInput): ExternalPollResult {
  if (!input.hasLoaded || input.isSaving) return { action: "skip" };
  if (input.currentMtime === null) return { action: "skip" };
  if (input.lastKnownMtime === null) {
    return { action: "set-baseline", nextLastKnownMtime: input.currentMtime };
  }
  if (input.currentMtime <= input.lastKnownMtime) return { action: "ignore" };
  if (input.pendingExternalMtime === input.currentMtime) return { action: "ignore" };
  if (shouldDeferExternalReload(input.hasLocalChanges, input.hasPendingTimer)) {
    return { action: "defer-pending", nextPendingExternalMtime: input.currentMtime };
  }
  return { action: "reload", nextPendingExternalMtime: input.currentMtime };
}
