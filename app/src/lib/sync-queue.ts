/**
 * File-based Yjs Sync Queue (Individual File Strategy)
 *
 * Offline Yjs updates are persisted as individual files and replayed after
 * reconnect.
 *
 * Storage path: {vault}/.ticksidian-sync/{noteId}/{timestamp}-{uuid}.json
 * - One file per update avoids write races.
 * - Uint8Array payloads are serialized as base64 strings.
 * - Filenames include timestamps so queue files remain inspectable.
 */

import { createSyncQueueOperations } from "./sync-queue/operations.ts";
import { tauriSyncQueueStore } from "./sync-queue/store.ts";
import type { QueuedUpdate } from "./sync-queue/types.ts";

const operations = createSyncQueueOperations({ store: tauriSyncQueueStore });

export type { QueuedUpdate };

export async function queueSyncUpdate(noteId: string, update: Uint8Array): Promise<void> {
  await operations.queueSyncUpdate(noteId, update);
}

export async function getQueuedSyncUpdates(noteId: string): Promise<QueuedUpdate[]> {
  return operations.getQueuedSyncUpdates(noteId);
}

export async function clearQueuedSyncUpdates(noteId: string, ids: string[]): Promise<void> {
  await operations.clearQueuedSyncUpdates(noteId, ids);
}

export async function clearAllQueuedSyncUpdates(noteId: string): Promise<void> {
  await operations.clearAllQueuedSyncUpdates(noteId);
}
