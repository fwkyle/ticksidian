import { encodeSyncUpdate } from "../src/lib/sync-queue/rules.ts";
import { createSyncQueueOperations } from "../src/lib/sync-queue/operations.ts";

export function createReporter() {
  let assertions = 0;
  let failures = 0;

  function check(label, condition, detail) {
    assertions += 1;
    if (condition) {
      console.log(`PASS  ${label}`);
    } else {
      failures += 1;
      console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
    }
  }

  async function expectResolve(label, fn) {
    let resolved = false;
    try {
      await fn();
      resolved = true;
    } catch (error) {
      check(label, false, error instanceof Error ? error.message : String(error));
      return;
    }
    check(label, resolved);
  }

  function summary() {
    return { assertions, failures };
  }

  return { check, expectResolve, summary };
}

export function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function expectThrow(check, label, fn, expectedMessage) {
  let thrown = false;
  let message = "";
  try {
    fn();
  } catch (error) {
    thrown = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check(label, thrown && message === expectedMessage, `message=${message}`);
}

export class FakeSyncQueueStore {
  constructor(vaultPath = "/vault") {
    this.vaultPath = vaultPath;
    this.createDirectoryCalls = [];
    this.listDirectoryCalls = [];
    this.readTextFileCalls = [];
    this.writeTextFileCalls = [];
    this.deleteFileCalls = [];
    this.files = new Map();
    this.listFailures = new Set();
    this.readFailures = new Set();
    this.deleteFailures = new Set();
  }

  getVaultPath() {
    return this.vaultPath;
  }

  async createDirectory(dirPath, recursive) {
    this.createDirectoryCalls.push({ dirPath, recursive });
  }

  async writeTextFile(path, content) {
    this.writeTextFileCalls.push({ path, content });
    this.files.set(path, content);
  }

  async listDirectory(dirPath) {
    this.listDirectoryCalls.push(dirPath);
    if (this.listFailures.has(dirPath)) {
      throw new Error(`missing directory: ${dirPath}`);
    }
    const prefix = `${dirPath}/`;
    return Array.from(this.files.keys()).filter((path) => {
      if (!path.startsWith(prefix)) {
        return false;
      }
      return !path.slice(prefix.length).includes("/");
    });
  }

  async readTextFile(path) {
    this.readTextFileCalls.push(path);
    if (this.readFailures.has(path)) {
      throw new Error(`unreadable file: ${path}`);
    }
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`missing file: ${path}`);
    }
    return content;
  }

  async deleteFile(path) {
    this.deleteFileCalls.push(path);
    if (this.deleteFailures.has(path)) {
      throw new Error(`delete failed: ${path}`);
    }
    this.files.delete(path);
  }
}

function createRuntime(times, ids) {
  let timeIndex = 0;
  let idIndex = 0;
  return {
    now: () => {
      const value = times[timeIndex];
      timeIndex += 1;
      return value;
    },
    randomUuid: () => {
      const value = ids[idIndex];
      idIndex += 1;
      return value;
    },
  };
}

export function createOperations(store, times = [1000], ids = ["uuid-1"]) {
  return createSyncQueueOperations({
    store,
    runtime: createRuntime(times, ids),
  });
}

export function serializedUpdate(id, noteId, bytes, timestamp) {
  return JSON.stringify({
    id,
    noteId,
    update: encodeSyncUpdate(new Uint8Array(bytes)),
    timestamp,
  });
}
