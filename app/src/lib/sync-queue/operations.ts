import {
  decodeSyncUpdate,
  deserializeQueuedUpdate,
  encodeSyncUpdate,
  extractQueueFileName,
  parseQueueFileName,
  resolveNoteQueueDir,
} from "./rules.ts";
import type { SyncQueueStore } from "./store.ts";
import type { QueuedUpdate, SerializedUpdate } from "./types.ts";
import { isExpectedIoError } from "../error-utils.ts";

export interface SyncQueueRuntime {
  readonly now: () => number;
  readonly randomUuid: () => string;
}

export interface SyncQueueOperations {
  readonly queueSyncUpdate: (noteId: string, update: Uint8Array) => Promise<void>;
  readonly getQueuedSyncUpdates: (noteId: string) => Promise<QueuedUpdate[]>;
  readonly clearQueuedSyncUpdates: (noteId: string, ids: readonly string[]) => Promise<void>;
  readonly clearAllQueuedSyncUpdates: (noteId: string) => Promise<void>;
}

export interface SyncQueueOperationsOptions {
  readonly store: SyncQueueStore;
  readonly runtime?: SyncQueueRuntime;
}

const defaultRuntime: SyncQueueRuntime = {
  now: () => Date.now(),
  randomUuid: () => crypto.randomUUID(),
};



function getNoteQueueDir(store: SyncQueueStore, noteId: string): string {
  return resolveNoteQueueDir(store.getVaultPath(), noteId);
}

async function ensureNoteQueueDirectory(store: SyncQueueStore, noteDir: string): Promise<void> {
  try {
    await store.createDirectory(noteDir, true);
  } catch (error) {
    if (isExpectedIoError(error)) {
      return;
    }
    throw error;
  }
}

async function listQueueFiles(store: SyncQueueStore, noteDir: string): Promise<readonly string[] | null> {
  try {
    return await store.listDirectory(noteDir);
  } catch (error) {
    if (isExpectedIoError(error)) {
      return null;
    }
    throw error;
  }
}

async function readQueuedUpdate(
  store: SyncQueueStore,
  fullPath: string,
  fileName: string,
): Promise<QueuedUpdate | null> {
  const parsedFileName = parseQueueFileName(fileName);
  if (!parsedFileName) {
    return null;
  }

  try {
    const content = await store.readTextFile(fullPath);
    const data = deserializeQueuedUpdate(content, fileName);
    if (!data) {
      return null;
    }
    return toQueuedUpdate(data, fileName);
  } catch (error) {
    if (isExpectedIoError(error)) {
      return null;
    }
    throw error;
  }
}

function toQueuedUpdate(data: SerializedUpdate, fileName: string): QueuedUpdate {
  return {
    id: data.id,
    noteId: data.noteId,
    update: decodeSyncUpdate(data.update),
    timestamp: data.timestamp,
    fileName,
  };
}

export function createSyncQueueOperations(options: SyncQueueOperationsOptions): SyncQueueOperations {
  const runtime = options.runtime ?? defaultRuntime;
  const store = options.store;

  return {
    queueSyncUpdate: async (noteId, update) => {
      const noteDir = getNoteQueueDir(store, noteId);
      await ensureNoteQueueDirectory(store, noteDir);

      const timestamp = runtime.now();
      const id = runtime.randomUuid();
      const fileName = `${timestamp}-${id}.json`;
      const filePath = `${noteDir}/${fileName}`;

      const data: SerializedUpdate = {
        id,
        noteId,
        update: encodeSyncUpdate(update),
        timestamp,
      };

      await store.writeTextFile(filePath, JSON.stringify(data, null, 2));
    },

    getQueuedSyncUpdates: async (noteId) => {
      const noteDir = getNoteQueueDir(store, noteId);
      const entries = await listQueueFiles(store, noteDir);
      if (!entries) {
        return [];
      }

      const updates: QueuedUpdate[] = [];
      for (const fullPath of entries) {
        const fileName = extractQueueFileName(fullPath);
        const update = await readQueuedUpdate(store, fullPath, fileName);
        if (update) {
          updates.push(update);
        }
      }

      return updates.sort((left, right) => left.timestamp - right.timestamp);
    },

    clearQueuedSyncUpdates: async (noteId, ids) => {
      if (ids.length === 0) {
        return;
      }

      const idSet = new Set(ids);
      const noteDir = getNoteQueueDir(store, noteId);
      const entries = await listQueueFiles(store, noteDir);
      if (!entries) {
        return;
      }

      for (const fullPath of entries) {
        const parsed = parseQueueFileName(extractQueueFileName(fullPath));
        if (!parsed || !idSet.has(parsed.id)) {
          continue;
        }

        try {
          await store.deleteFile(fullPath);
        } catch (error) {
          if (!isExpectedIoError(error)) {
            throw error;
          }
        }
      }
    },

    clearAllQueuedSyncUpdates: async (noteId) => {
      const noteDir = getNoteQueueDir(store, noteId);
      const entries = await listQueueFiles(store, noteDir);
      if (!entries) {
        return;
      }

      for (const fullPath of entries) {
        try {
          await store.deleteFile(fullPath);
        } catch (error) {
          if (!isExpectedIoError(error)) {
            throw error;
          }
        }
      }
    },
  };
}
