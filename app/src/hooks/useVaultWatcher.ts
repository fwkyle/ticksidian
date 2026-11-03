/**
 * useVaultWatcher
 *
 * 전체 볼트를 주기적으로 스캔해서 파일 생성/삭제/수정을 감지하고
 * 변경이 있을 때만 `refreshNotes`를 호출해 상태를 업데이트한다.
 *
 * 구현 방식: OS push watcher(vault-fs-changed 이벤트, 1차) + 프론트 폴링(안전망).
 * 폴링 기본 간격은 30초 — push watcher가 [kyle] Tauri QA로 안정 확인된 뒤(2026-06-10)
 * 7초에서 완화했다. push가 죽어도 폴링이 정확성을 커버한다(최대 30초 지연).
 * env `VITE_TICKSIDIAN_WATCH_POLL_MS`로 간격을 바꿀 수 있다(최소 1000ms, 잘못된 값은 기본값).
 * 설계: docs/waterfall/03-상세설계/파일-감시-외부-수정-반영-정책.md §10
 *
 * 현재 열린 노트의 본문 재로드는 `useNoteEditor` 자체 폴링이 계속 담당한다.
 * 이 훅은 목록/메타 변화만 감지한다.
 */

import { useEffect, useRef } from "react";
import type { NoteListItem } from "../types/note";
import {
  scanNoteFiles as scanVaultNoteFiles,
  getVaultPath as getCurrentVaultPath,
} from "../lib/local-fs";
import {
  startVaultWatch as startVaultWatchCmd,
  stopVaultWatch as stopVaultWatchCmd,
  subscribeVaultChanges as subscribeVaultChangesCmd,
} from "../lib/tauri-commands";

/** push watcher 안정 확인(2026-06-10 Tauri QA) 후 7초 → 30초로 완화. push가 1차, 폴링은 안전망. */
const DEFAULT_POLL_MS = 30_000;
/** env로 간격을 줄일 때도 폭주를 막는 하한. */
const MIN_POLL_MS = 1000;
/** push 이벤트가 몰려와도 한 번만 스캔하게 모으는 짧은 디바운스. */
const PUSH_DEBOUNCE_MS = 250;

const ENV = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};

/** `VITE_TICKSIDIAN_WATCH_POLL_MS` 파싱. 숫자가 아니거나 하한 미만이면 기본값. */
export function resolvePollIntervalMs(
  raw: string | undefined = ENV["VITE_TICKSIDIAN_WATCH_POLL_MS"],
): number {
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed >= MIN_POLL_MS) return parsed;
  }
  return DEFAULT_POLL_MS;
}

interface UseVaultWatcherOptions {
  hasVault: boolean;
  notes: NoteListItem[];
  /**
   * 이중 스캔 수정(P1-006): tick이 미리 스캔한 결과를 넘길 수 있도록 preScanned를 선택 인자로 받는다.
   * 볼트 전환 등 무인자 경로에서는 기존과 동일하게 전체 재읽기를 한다.
   */
  refreshNotes: (preScanned?: { noteList: NoteListItem[]; scannedVaultPath: string }) => Promise<NoteListItem[]>;
  /** 현재 볼트 경로. 바뀌면 push 감시를 새 볼트로 재시작한다(폴링은 module state 기반이라 무관). */
  vaultPath?: string | null;
  pollIntervalMs?: number;
  getVaultPath?: () => string | null;
  scanNoteFiles?: (previous?: NoteListItem[]) => Promise<NoteListItem[]>;
  /** P1-006 push watcher 주입(기본 tauri-commands). 실패해도 폴링 fallback이 동작. */
  startVaultWatch?: (vaultPath: string) => Promise<void>;
  stopVaultWatch?: () => Promise<void>;
  subscribeVaultChanges?: (onChange: () => void) => Promise<() => void>;
}

/**
 * 두 스냅샷 사이에 의미 있는 변경이 있는지만 판정한다.
 *
 * 주의: scanNoteFiles().updatedAt은 frontmatter.updatedAt 우선이라
 *       외부 편집기가 frontmatter를 안 고치면 변하지 않을 수 있다.
 *       그래서 파일 시스템이 기록한 fileMtime을 1순위로 본다.
 *       또 aliases/tags/type/done/filePath처럼 frontmatter 안에서만 바뀔 수 있는
 *       필드들도 함께 비교한다.
 *
 * 설계: docs/waterfall/03-상세설계/파일-감시-외부-수정-반영-정책.md §10.3
 */
function stringArraysEqual(a?: string[], b?: string[]): boolean {
  const aArr = a ?? [];
  const bArr = b ?? [];
  if (aArr.length !== bArr.length) return false;
  const sortedA = [...aArr].sort();
  const sortedB = [...bArr].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

function noteHasChange(prev: NoteListItem, curr: NoteListItem): boolean {
  // 파일 시스템 기준 mtime — frontmatter.updatedAt을 안 고친 외부 편집까지 잡는다.
  const prevMtime = prev.fileMtime ?? prev.updatedAt.getTime();
  const currMtime = curr.fileMtime ?? curr.updatedAt.getTime();
  if (prevMtime !== currMtime) return true;

  if (prev.updatedAt.getTime() !== curr.updatedAt.getTime()) return true;
  if (prev.title !== curr.title) return true;
  if (prev.folder !== curr.folder) return true;
  if ((prev.filePath ?? "") !== (curr.filePath ?? "")) return true;
  if (prev.type !== curr.type) return true;
  if ((prev.done ?? false) !== (curr.done ?? false)) return true;
  if ((prev.dueDate ?? "") !== (curr.dueDate ?? "")) return true;
  if ((prev.priority ?? "") !== (curr.priority ?? "")) return true;
  if (!stringArraysEqual(prev.aliases, curr.aliases)) return true;
  if (!stringArraysEqual(prev.tags, curr.tags)) return true;
  return false;
}

function hasAnyChange(prev: NoteListItem[], curr: NoteListItem[]): boolean {
  if (prev.length !== curr.length) return true;
  const prevMap = new Map(prev.map((n) => [n.id, n]));
  for (const c of curr) {
    const p = prevMap.get(c.id);
    if (!p) return true;
    if (noteHasChange(p, c)) return true;
  }
  return false;
}

export function useVaultWatcher({
  hasVault,
  notes,
  refreshNotes,
  vaultPath = null,
  pollIntervalMs = resolvePollIntervalMs(),
  getVaultPath = getCurrentVaultPath,
  scanNoteFiles = scanVaultNoteFiles,
  startVaultWatch = startVaultWatchCmd,
  stopVaultWatch = stopVaultWatchCmd,
  subscribeVaultChanges = subscribeVaultChangesCmd,
}: UseVaultWatcherOptions): void {
  const notesRef = useRef<NoteListItem[]>(notes);
  notesRef.current = notes;
  const runningRef = useRef(false);

  // ── push watcher stop↔start 레이스 수정 (P1-006) ──
  // vaultPath 변경 시 cleanup의 stopVaultWatch()와 새 effect의 startVaultWatch(B)가 둘 다
  // 비동기 invoke라 순서가 보장되지 않는다 — stop이 늦게 도착하면 새 watcher를 꺼버릴 수 있다.
  // Rust start_vault_watch는 이전 watcher를 교체(drop)하므로 idempotent하다.
  //
  // 구조:
  //   - vaultPath 변경 재실행: stopVaultWatch를 호출하지 않고 startVaultWatch의 교체 의미에만 의존.
  //   - 폴링/구독 구조가 완전히 종료될 때(hasVault=false/언마운트 최종): stopVaultWatch를 호출.
  //     hasVault가 false로 바뀌면 별도 effect가 stop을 담당하므로, 아래 cleanup에서는
  //     vaultPath가 있었던 경우만 stop을 호출하지 않는다.
  //
  // 실제로 감시를 '완전히 끄는' 경로(hasVault=false 전환, 언마운트)는 아래 별도 effect가 담당.

  // 실제 감시 종료용 별도 effect: hasVault가 꺼지거나 컴포넌트가 언마운트될 때만 stop.
  useEffect(() => {
    if (hasVault) return; // 볼트 있는 동안은 아무것도 안 한다
    // hasVault가 false가 됐을 때(전환 등): 혹시 살아 있는 watcher를 정리.
    void stopVaultWatch().catch(() => { /* 정리 실패 무시 */ });
  }, [hasVault, stopVaultWatch]);

  useEffect(() => {
    if (!hasVault) return;

    const tick = async () => {
      if (runningRef.current) return;
      // HMR이나 전환 레이스 중 vaultPath 모듈 state가 비어 있는 순간에는
      // scanNoteFiles가 던지므로 조용히 다음 tick을 기다린다.
      const currentVaultPath = getVaultPath();
      if (!currentVaultPath) return;
      runningRef.current = true;
      try {
        // P1-006: 직전 목록을 캐시로 넘겨, mtime이 그대로인 파일은 재읽기하지 않는다.
        // 변경/신규 파일만 read → 폴링의 IO를 크게 줄인다.
        const fresh = await scanNoteFiles(notesRef.current);
        if (hasAnyChange(notesRef.current, fresh)) {
          // 이중 스캔 수정: 미리 스캔된 fresh와 스캔 시점의 볼트 경로를 함께 넘긴다.
          // refreshNotes 내부의 볼트 전환 안전 가드가 경로가 다르면 전체 재읽기로 fallback한다.
          await refreshNotes({ noteList: fresh, scannedVaultPath: currentVaultPath });
        }
      } catch (error) {
        // §10.5 조용한 실패: 사용자에게 배너를 띄우지 않는다.
        console.warn("[vaultWatcher] scan failed, will retry next tick:", error);
      } finally {
        runningRef.current = false;
      }
    };

    // ── push watcher (P1-006): OS 파일 변경 이벤트로 즉시 tick. ──
    // 폴링은 fallback으로 그대로 둔다. push가 실패/누락돼도 폴링이 잡으므로 무회귀.
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let pushDebounce: number | null = null;

    const onPush = () => {
      // 이벤트가 몰려와도 한 번만 스캔. 실제 변경 판정은 tick의 hasAnyChange가 한다.
      if (pushDebounce !== null) window.clearTimeout(pushDebounce);
      pushDebounce = window.setTimeout(() => {
        pushDebounce = null;
        void tick();
      }, PUSH_DEBOUNCE_MS);
    };

    if (vaultPath) {
      // vaultPath 변경 시 start의 교체 의미에만 의존한다.
      // cleanup에서 stop을 먼저 호출하면 비동기 invoke 순서가 뒤집혀
      // 새 watcher를 꺼버릴 수 있으므로(stop↔start 레이스), stop을 생략한다.
      void startVaultWatch(vaultPath).catch((error) => {
        console.warn("[vaultWatcher] startVaultWatch failed (polling fallback):", error);
      });
    }
    void subscribeVaultChanges(onPush)
      .then((un) => {
        // 이미 cleanup됐으면 즉시 해제(레이스 방지).
        if (cancelled) {
          un();
          return;
        }
        unlisten = un;
      })
      .catch((error) => {
        console.warn("[vaultWatcher] subscribeVaultChanges failed (polling fallback):", error);
      });

    const intervalId = window.setInterval(tick, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (pushDebounce !== null) window.clearTimeout(pushDebounce);
      if (unlisten) unlisten();
      // vaultPath 변경에 의한 재실행: stop을 호출하지 않는다 — start의 교체 의미에 의존.
      // 완전 종료(hasVault=false/언마운트)는 위 별도 effect가 담당.
    };
  }, [
    hasVault,
    vaultPath,
    refreshNotes,
    pollIntervalMs,
    getVaultPath,
    scanNoteFiles,
    startVaultWatch,
    subscribeVaultChanges,
  ]);
}
