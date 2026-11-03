import type { SerializedUpdate } from "./types.ts";

export const SYNC_QUEUE_DIR = ".ticksidian-sync";

export interface QueueFileNameParts {
  readonly timestamp: number;
  readonly id: string;
}

export function resolveSyncQueueDir(vaultPath: string | null): string {
  if (!vaultPath) {
    throw new Error("Vault not initialized");
  }
  return `${vaultPath}/${SYNC_QUEUE_DIR}`;
}

export function resolveNoteQueueDir(vaultPath: string | null, noteId: string): string {
  return `${resolveSyncQueueDir(vaultPath)}/${noteId}`;
}

export function encodeSyncUpdate(update: Uint8Array): string {
  const binary = Array.from(update)
    .map((byte) => String.fromCharCode(byte))
    .join("");
  return btoa(binary);
}

export function decodeSyncUpdate(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function parseQueueFileName(fileName: string): QueueFileNameParts | null {
  const match = fileName.match(/^(\d+)-([^.]+)\.json$/);
  if (!match) {
    return null;
  }

  const timestampText = match[1];
  const id = match[2];
  if (timestampText === undefined || id === undefined) {
    return null;
  }

  const timestamp = Number.parseInt(timestampText, 10);
  if (!Number.isSafeInteger(timestamp)) {
    return null;
  }

  return { timestamp, id };
}

export function extractQueueFileName(fullPath: string): string {
  return fullPath.replaceAll("\\", "/").split("/").at(-1) ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseSerializedUpdate(content: string): SerializedUpdate | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    if (error instanceof Error) {
      return null;
    }
    throw error;
  }

  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const noteId = value["noteId"];
  const update = value["update"];
  const timestamp = value["timestamp"];
  if (
    typeof id !== "string" ||
    typeof noteId !== "string" ||
    typeof update !== "string" ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp)
  ) {
    return null;
  }

  return { id, noteId, update, timestamp };
}

export function deserializeQueuedUpdate(content: string, fileName: string): SerializedUpdate | null {
  if (!parseQueueFileName(fileName)) {
    return null;
  }

  const parsed = parseSerializedUpdate(content);
  if (!parsed) {
    return null;
  }

  return parsed;
}
