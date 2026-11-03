import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { QueuedUpdate } from "./sync-queue/types.ts";
import { isExpectedIoError } from "./error-utils.ts";

/* ── 파일 기반 오프라인 큐 ── */

const syncStateMap = new Map<string, string>();

function setSyncState(key: string, value: string): void {
  syncStateMap.set(key, value);
}

const SYNC_URL = (import.meta as { env?: { VITE_HOCUSPOCUS_URL?: string } }).env
  ?.VITE_HOCUSPOCUS_URL;

export function isSyncEnabled(): boolean {
  return typeof SYNC_URL === "string" && SYNC_URL.length > 0;
}

export interface SyncStatus {
  connected: boolean;
  syncing: boolean;
  lastSynced: number | null;
  error: string | null;
}

interface NoteSyncState {
  status: SyncStatus;
  listeners: Set<(status: SyncStatus) => void>;
}

const noteStateCache = new Map<string, NoteSyncState>();
const providerCache = new Map<string, HocuspocusProvider>();
const docCache = new Map<string, Y.Doc>();
const replayPendingCache = new Map<string, QueuedUpdate[]>();

export interface SyncQueueApi {
  readonly queueSyncUpdate: (noteId: string, update: Uint8Array) => Promise<void>;
  readonly getQueuedSyncUpdates: (noteId: string) => Promise<QueuedUpdate[]>;
  readonly clearQueuedSyncUpdates: (noteId: string, ids: readonly string[]) => Promise<void>;
  readonly clearAllQueuedSyncUpdates: (noteId: string) => Promise<void>;
}

type SyncQueueReader = Pick<SyncQueueApi, "getQueuedSyncUpdates">;
type SyncedQueueClearer = Pick<SyncQueueApi, "clearQueuedSyncUpdates">;
type FullQueueClearer = Pick<SyncQueueApi, "clearAllQueuedSyncUpdates">;

const defaultSyncQueueApi: SyncQueueApi = {
  queueSyncUpdate: async (noteId, update) => {
    const queue = await import("./sync-queue.ts");
    await queue.queueSyncUpdate(noteId, update);
  },
  getQueuedSyncUpdates: async (noteId) => {
    const queue = await import("./sync-queue.ts");
    return queue.getQueuedSyncUpdates(noteId);
  },
  clearQueuedSyncUpdates: async (noteId, ids) => {
    const queue = await import("./sync-queue.ts");
    await queue.clearQueuedSyncUpdates(noteId, [...ids]);
  },
  clearAllQueuedSyncUpdates: async (noteId) => {
    const queue = await import("./sync-queue.ts");
    await queue.clearAllQueuedSyncUpdates(noteId);
  },
};

function ignoreSyncQueueError(error: unknown): void {
  // Tauri invoke 거부값(plain object)도 예상 가능한 IO 실패로 본다(2026-08-18).
  if (isExpectedIoError(error)) {
    return;
  }
}

export function sortQueuedUpdatesForReplay(updates: readonly QueuedUpdate[]): QueuedUpdate[] {
  return [...updates].sort((left, right) => left.timestamp - right.timestamp);
}

function setReplayPending(noteId: string, updates: readonly QueuedUpdate[]): void {
  if (updates.length === 0) {
    replayPendingCache.delete(noteId);
    return;
  }
  replayPendingCache.set(noteId, [...updates]);
}

function clearReplayPendingForNote(noteId: string): void {
  replayPendingCache.delete(noteId);
}

export function clearSyncedReplayEntries(
  noteId: string,
  queueApi: SyncedQueueClearer = defaultSyncQueueApi,
): readonly string[] {
  const replayedEntries = replayPendingCache.get(noteId);
  if (!replayedEntries || replayedEntries.length === 0) {
    replayPendingCache.delete(noteId);
    return [];
  }

  const ids = replayedEntries.map((entry) => entry.id);
  queueApi.clearQueuedSyncUpdates(noteId, ids).catch(ignoreSyncQueueError);
  replayPendingCache.delete(noteId);
  return ids;
}

function getNoteState(noteId: string): NoteSyncState {
  if (!noteStateCache.has(noteId)) {
    noteStateCache.set(noteId, {
      status: {
        connected: false,
        syncing: false,
        lastSynced: null,
        error: null,
      },
      listeners: new Set(),
    });
  }
  return noteStateCache.get(noteId)!;
}

function notifyNote(noteId: string) {
  const state = getNoteState(noteId);
  const snapshot = { ...state.status };
  state.listeners.forEach((fn) => fn(snapshot));
}

export function onSyncStatusChange(
  noteId: string,
  fn: (status: SyncStatus) => void
): () => void {
  const state = getNoteState(noteId);
  state.listeners.add(fn);
  fn({ ...state.status });
  return () => {
    state.listeners.delete(fn);
  };
}

export function getSyncStatus(noteId: string): SyncStatus {
  return { ...getNoteState(noteId).status };
}

export function getYDoc(noteId: string): Y.Doc {
  if (!docCache.has(noteId)) {
    const doc = new Y.Doc();
    docCache.set(noteId, doc);
  }
  return docCache.get(noteId)!;
}

export function createSyncProvider(noteId: string): HocuspocusProvider {
  if (!isSyncEnabled()) {
    throw new Error("Sync is not enabled for this environment.");
  }
  const syncUrl = SYNC_URL;
  if (!syncUrl) {
    throw new Error("Sync URL is missing.");
  }

  if (providerCache.has(noteId)) {
    return providerCache.get(noteId)!;
  }

  const doc = getYDoc(noteId);
  const state = getNoteState(noteId);
  state.status.syncing = true;
  notifyNote(noteId);

  const provider = new HocuspocusProvider({
    url: syncUrl,
    name: noteId,
    document: doc,
    onConnect: () => {
      state.status.connected = true;
      state.status.error = null;
      notifyNote(noteId);
    },
    onDisconnect: () => {
      state.status.connected = false;
      state.status.syncing = false;
      notifyNote(noteId);
    },
    onSynced: () => {
      state.status.syncing = false;
      state.status.lastSynced = Date.now();
      setSyncState(`last-synced-${noteId}`, String(Date.now()));
      notifyNote(noteId);

      clearSyncedReplayEntries(noteId);
      // 파일 기반 큐는 자동으로 복구되므로 onSynced에서만 삭제하면 됨
    },
  });

  // 오프라인 상태에서 update 발생 시 파일 기반 큐에 저장
  doc.on("update", (update: Uint8Array) => {
    if (!state.status.connected || state.status.syncing) {
      defaultSyncQueueApi.queueSyncUpdate(noteId, update).catch(ignoreSyncQueueError);
    }
  });

  provider.on("close", (data: { event: CloseEvent }) => {
    if (data.event.code !== 1000) {
      state.status.connected = false;
      state.status.error = `연결 끊김 (${data.event.code})`;
      notifyNote(noteId);
    }
  });

  providerCache.set(noteId, provider);
  return provider;
}

export async function replayQueuedUpdatesToYDoc(
  noteId: string,
  queueApi: SyncQueueReader = defaultSyncQueueApi,
): Promise<number> {
  const updates = await queueApi.getQueuedSyncUpdates(noteId);
  if (updates.length === 0) {
    clearReplayPendingForNote(noteId);
    return 0;
  }

  const doc = getYDoc(noteId);
  const sortedUpdates = sortQueuedUpdatesForReplay(updates);

  Y.transact(doc, () => {
    for (const queued of sortedUpdates) {
      Y.applyUpdate(doc, queued.update, "queued-replay");
    }
  }, "queued-replay-batch");

  setReplayPending(noteId, sortedUpdates);
  return sortedUpdates.length;
}

export function destroySyncProvider(noteId: string): void {
  const provider = providerCache.get(noteId);
  if (provider) {
    provider.destroy();
    providerCache.delete(noteId);
  }
  const doc = docCache.get(noteId);
  if (doc) {
    doc.destroy();
    docCache.delete(noteId);
  }
  clearReplayPendingForNote(noteId);
  noteStateCache.delete(noteId);
}

export function destroyAllSyncProviders(): void {
  providerCache.forEach((p) => p.destroy());
  docCache.forEach((d) => d.destroy());
  providerCache.clear();
  docCache.clear();
  replayPendingCache.clear();
  noteStateCache.clear();
  syncStateMap.clear();
}

/**
 * 특정 노트의 동기화 큐를 완전히 비웁니다.
 * 볼트 전환 등의 상황에서 사용.
 */
export async function clearSyncQueueForNote(
  noteId: string,
  queueApi: FullQueueClearer = defaultSyncQueueApi,
): Promise<void> {
  await queueApi.clearAllQueuedSyncUpdates(noteId);
  clearReplayPendingForNote(noteId);
}
