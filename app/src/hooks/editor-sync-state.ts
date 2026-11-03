// 에디터 동기화 상태 저장소 — 흩어진 ref 클러스터의 소유자(앱 3단계 패스 2).
// 설계: docs/waterfall/03-상세설계/에디터-저장-외부수정-리팩토링-설계.md §2, §3 패스 2
//
// 왜 필요한가: lastKnownFileMtime/pendingExternalMtime는 load·save·폴링이 모두 갱신하고,
// 내용 기준선 서명은 load와 save가 교대로 기록한다. 훅을 나눈 뒤 각자 ref를 직접 건드리면
// race가 재발한다. 이 저장소가 갱신 지점을 markLoaded/markSaved/markReloadGuard로 하나로
// 모아서, useNoteEditor와 useExternalNotePoller가 같은 경로로 상태를 바꾸게 한다.
//
// React hook — useNoteEditor 컴포넌트 생명주기 안에서 한 번만 호출한다(useMemo 없이 그대로).

import { useMemo, useRef } from "react";

export interface EditorSyncState {
  /** 문서 로드 완료(초기/외부/수동 재로드 공통 게이트) */
  readonly hasLoaded: () => boolean;
  /**
   * 쓰기 허용 증거(DFXR-007): 이 세션에서 이 파일의 디스크 원문을 성공적으로 읽었다.
   * 기본 거부다. 읽기 실패로 hasLoaded가 켜져도 증거는 생기지 않는다.
   */
  readonly isWriteGranted: () => boolean;
  /** 로컬 미저장 변경 존재 */
  readonly hasLocalChanges: () => boolean;
  /** 외부 수정 pending(배너 표시 중, 자동 저장 정지) */
  readonly hasExternalChangePending: () => boolean;
  /** 폴링이 마지막으로 안 파일 mtime */
  readonly lastKnownFileMtime: () => number | null;
  /** deferred 외부 수정의 mtime(keep-local로 무시하면 해제) */
  readonly pendingExternalMtime: () => number | null;
  /** 디바운스 저장 타이머 핸들(null이면 예약 없음) */
  readonly saveTimer: () => number | null;
  /** loadNoteFromDisk 구간 동안 BlockNote onChange를 사용자 편집으로 오인하지 않게 차단 */
  readonly isReloading: () => boolean;
  /** 마지막 로드/저장 내용 서명(JSON) — handleChange 스푸리어스 change 판정용 */
  readonly lastLoadedContentSig: () => string | null;

  // ── 갱신 메서드 (load/save/poller가 호출) ──
  /** 로드 성공 직후: 기준선/mtime/pending 초기화. mtime null은 기존값 유지. */
  markLoaded(contentSig: string, fileMtime: number | null): void;
  /** 저장 성공 직후: 기준선을 저장 스냅샷으로 갱신 + 쓰기 명령이 돌려준 내가 쓴 내용의 mtime 반영. */
  markSaved(contentSig: string, fileMtime: number | null, hasNewerChanges?: boolean): void;
  /** 폴링: 2-pass baseline 확정(로드 직후 등). */
  setLastKnownFileMtime(mtime: number): void;
  /** 폴링: 외부 수정 pending 등록. */
  deferExternalChange(mtime: number): void;
  /** keep-local: pending 해제. */
  clearPendingExternal(): void;
  /** 로컬 변경 플래그 조작. */
  setHasLocalChanges(value: boolean): void;
  /** 외부 pending 플래그 조작(keep-local/저장 성공 시 해제). */
  setHasExternalChangePending(value: boolean): void;
  /** 디바운스 타이머 예약/해제. 저장 시작 직전에 비워야 폴링이 정확하다. */
  setSaveTimer(handle: number | null): void;
  clearSaveTimer(): void;
  /** reload guard ON/OFF(loadNoteFromDisk). */
  setReloading(value: boolean): void;
  /** 새 노트 시작(initial 로드 직전) 상태 초기화. 쓰기 허용 증거도 지운다. */
  resetForNewNote(): void;
  /** 원문을 실제로 읽은 지점(로드 성공, 내 변경 유지의 읽기 성공)만 부른다. */
  grantWrite(): void;
  /**
   * 로드 실패 뒤 입력 가능한 상태를 유지한다.
   * 현재 편집기는 false를 전달하여 외부 pending/기준선을 보존하고,
   * 화면 경고와 작성본 복구를 제공한다(2026-10-07).
   * true는 과거 F1 정책의 pending 해제/mtime 승격 동작을 유지하는 호환 경로다.
   */
  markLoadFailed(clearExternalPending: boolean): void;
  /**
   * 로드를 의도적으로 하지 않았을 때(예: 편집기 한계를 넘는 큰 파일).
   *
   * `hasLoaded`를 **false로 유지**하는 것이 핵심이다. 저장 경로는 `hasLoaded()`가 false면
   * 곧바로 빠져나가므로, 화면에 열리지 않은 원본이 빈 내용으로 덮어써지지 않는다
   * (잠긴 계약 1번: 로컬 `.md`가 원본).
   */
  markLoadBlocked(): void;
  /** 이동 중 쓰기만 멈춘다. 실패 시 복원할 기준선·변경 상태는 지우지 않는다. */
  pauseForMove(): void;
  /**
   * 이동 실패 후 저장 차단만 푼다(2026-08-23 TICK-UX-007 에디터 경유 폴더 이동).
   * 이동 직전에 `pauseForMove`로 막아 둔 저장을 되살린다. 내용은 이미 flush돼
   * 디스크와 같으므로 기준선/mtime은 그대로 둔다.
   */
  restoreLoaded(): void;
}

export function useEditorSyncState(): EditorSyncState {
  const hasLoaded = useRef(false);
  const writeGranted = useRef(false);
  const hasLocalChanges = useRef(false);
  const hasExternalChangePending = useRef(false);
  const lastKnownFileMtime = useRef<number | null>(null);
  const pendingExternalMtime = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const isReloading = useRef(false);
  const lastLoadedContentSig = useRef<string | null>(null);

  // 반환 객체를 useMemo로 고정한다 — 이 객체가 loadNoteFromDisk/saveToFile의 deps에 들어가므로
  // 매 렌더 새 참조가 되면 콜백이 재생성되고, initial 로드 effect가 재실행돼
  // cleanup이 isMounted=false로 되돌리는 무한 루프(isLoading 고착)가 생긴다.
  return useMemo<EditorSyncState>(() => ({
    hasLoaded: () => hasLoaded.current,
    isWriteGranted: () => writeGranted.current,
    hasLocalChanges: () => hasLocalChanges.current,
    hasExternalChangePending: () => hasExternalChangePending.current,
    lastKnownFileMtime: () => lastKnownFileMtime.current,
    pendingExternalMtime: () => pendingExternalMtime.current,
    saveTimer: () => saveTimer.current,
    isReloading: () => isReloading.current,
    lastLoadedContentSig: () => lastLoadedContentSig.current,

    markLoaded(contentSig, fileMtime) {
      lastLoadedContentSig.current = contentSig;
      hasLoaded.current = true;
      hasLocalChanges.current = false;
      hasExternalChangePending.current = false;
      if (fileMtime !== null) lastKnownFileMtime.current = fileMtime;
      pendingExternalMtime.current = null;
    },
    markSaved(contentSig, fileMtime, hasNewerChanges = false) {
      // 내용 기준선을 "마지막 저장본"으로 갱신한다(로드 시점 고정 금지).
      // 이게 없으면: A 로드 → B 타이핑·저장(디스크=B, 기준선=A) → 다시 A로 되돌림 →
      // A===기준선A라 "변경 없음"으로 판정돼 되돌림이 저장되지 않는 무음 유실이 생긴다.
      // await 중 사용자가 더 타이핑했을 수 있으므로 editor.document가 아니라 저장된
      // 스냅샷 서명을 기준선으로 삼는다(=실제 디스크 내용과 일치).
      lastLoadedContentSig.current = contentSig;
      hasLocalChanges.current = hasNewerChanges;
      hasExternalChangePending.current = false;
      if (fileMtime !== null) lastKnownFileMtime.current = fileMtime;
      pendingExternalMtime.current = null;
    },
    setLastKnownFileMtime(mtime) {
      lastKnownFileMtime.current = mtime;
    },
    deferExternalChange(mtime) {
      pendingExternalMtime.current = mtime;
      hasExternalChangePending.current = true;
    },
    clearPendingExternal() {
      pendingExternalMtime.current = null;
    },
    setHasLocalChanges(value) {
      hasLocalChanges.current = value;
    },
    setHasExternalChangePending(value) {
      hasExternalChangePending.current = value;
    },
    setSaveTimer(handle) {
      saveTimer.current = handle;
    },
    clearSaveTimer() {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
      }
      saveTimer.current = null;
    },
    setReloading(value) {
      isReloading.current = value;
    },
    grantWrite() {
      writeGranted.current = true;
    },
    resetForNewNote() {
      hasLoaded.current = false;
      writeGranted.current = false;
      hasLocalChanges.current = false;
      hasExternalChangePending.current = false;
      pendingExternalMtime.current = null;
      lastLoadedContentSig.current = null;
    },
    markLoadFailed(clearExternalPending) {
      hasLoaded.current = true;
      // 읽기 실패는 허용 증거를 무효화한다. 입력은 가능해도 원문을 다시 읽기 전에는 쓰지 않는다(DFXR-007).
      writeGranted.current = false;
      if (clearExternalPending) {
        hasExternalChangePending.current = false;
        // 호환 경로(true)만 관측한 외부 mtime을 기준선으로 끌어올린다(2026-08-23 TICK-BUG-001 후속).
        //
        // 현재 편집기는 이 경로를 쓰지 않는다(2026-10-07 작성본 보호). 외부 재로드 실패는
        // markLoadFailed(false)로 pending·기준선을 그대로 두고, 화면 경고와 작성본 복구를
        // 보여 주며 원본 저장을 보류한다. 기준선 승격은 외부 원문을 별도 버전으로 보관한 뒤
        // 사용자가 고르는 "내 변경 유지"에서만 일어난다. 이 값을 올려 두면 저장 직전 가드가
        // 읽지 못한 외부 변경을 덮는 저장을 통과시키므로, 옛 F1 정책(자동 저장 계속)은 폐기됐다.
        // 쓰기 출구는 원문을 성공적으로 읽은 기록(`writeGranted`)이 있을 때만 열린다(DFXR-007,
        // 기본 거부) — 위에서 writeGranted를 끈 것이 그 기본 거부의 출발점이다.
        // (`pendingExternalMtime`은 그대로 둔다 — 같은 mtime 재로드 폭주를 계속 막는다.)
        if (pendingExternalMtime.current !== null) {
          lastKnownFileMtime.current = pendingExternalMtime.current;
        }
      }
    },
    markLoadBlocked() {
      hasLoaded.current = false;
      writeGranted.current = false;
      hasLocalChanges.current = false;
      hasExternalChangePending.current = false;
      pendingExternalMtime.current = null;
      lastLoadedContentSig.current = null;
    },
    restoreLoaded() {
      hasLoaded.current = true;
    },
    pauseForMove() {
      hasLoaded.current = false;
    },
  }), []);
}
