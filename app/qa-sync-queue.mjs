// Sync queue characterization QA
//
// Given: fixed bytes, filenames, and vault paths.
// When: sync queue pure rules and store-backed operations run.
// Then: public queue behavior stays stable while internals can be refactored.
//
// Usage:
//   cd app && node --experimental-strip-types qa-sync-queue.mjs

const {
  decodeSyncUpdate,
  encodeSyncUpdate,
  extractQueueFileName,
  parseQueueFileName,
  resolveNoteQueueDir,
  resolveSyncQueueDir,
} = await import("./src/lib/sync-queue/rules.ts");
const {
  createOperations,
  createReporter,
  eq,
  expectThrow,
  FakeSyncQueueStore,
  serializedUpdate,
} = await import("./qa/sync-queue-test-kit.mjs");

const { check, expectResolve, summary } = createReporter();

{
  // Given: a byte array that includes low, high, and non-ASCII byte values.
  const input = new Uint8Array([0, 1, 127, 128, 255]);

  // When: the queue encoder serializes and deserializes it.
  const encoded = encodeSyncUpdate(input);
  const decoded = decodeSyncUpdate(encoded);

  // Then: the byte values survive exactly.
  check("encode/decode preserves byte values", eq(Array.from(decoded), [0, 1, 127, 128, 255]));
}

{
  // Given: POSIX and Windows style paths from a queue listing.
  // When/Then: the filename helper extracts the final segment for both.
  check("extractQueueFileName supports POSIX paths", extractQueueFileName("/vault/q/1-a.json") === "1-a.json");
  check(
    "extractQueueFileName supports Windows paths",
    extractQueueFileName("C:\\vault\\q\\1-a.json") === "1-a.json",
  );
}

{
  // Given: a queue filename using the persisted format.
  const parsed = parseQueueFileName("1710000000123-queue-id-1.json");

  // When/Then: timestamp and ID are extracted for sorting and clearing.
  check(
    "parseQueueFileName accepts persisted queue filename",
    parsed?.timestamp === 1710000000123 && parsed.id === "queue-id-1",
    JSON.stringify(parsed),
  );
}

{
  // Given: a fake queue store and deterministic runtime values.
  const store = new FakeSyncQueueStore("/vault");
  const operations = createOperations(store, [1710000000123], ["id-1"]);

  // When: an update is queued.
  await operations.queueSyncUpdate("note-a", new Uint8Array([0, 1, 127, 128, 255]));

  // Then: the note queue directory is created and one serialized queue file is written.
  check(
    "queueSyncUpdate creates note queue directory recursively",
    eq(store.createDirectoryCalls, [{ dirPath: "/vault/.ticksidian-sync/note-a", recursive: true }]),
    JSON.stringify(store.createDirectoryCalls),
  );
  check(
    "queueSyncUpdate writes deterministic queue file path",
    store.writeTextFileCalls[0]?.path === "/vault/.ticksidian-sync/note-a/1710000000123-id-1.json",
    JSON.stringify(store.writeTextFileCalls),
  );
  const content = store.writeTextFileCalls[0]?.content ?? "{}";
  const parsed = JSON.parse(content);
  check("queueSyncUpdate stores note ID", parsed.noteId === "note-a", content);
  check("queueSyncUpdate stores generated ID", parsed.id === "id-1", content);
  check("queueSyncUpdate stores timestamp", parsed.timestamp === 1710000000123, content);
  check(
    "queueSyncUpdate stores base64 byte payload",
    eq(Array.from(decodeSyncUpdate(parsed.update)), [0, 1, 127, 128, 255]),
    content,
  );
}

{
  // Given: a missing note queue directory.
  const store = new FakeSyncQueueStore("/vault");
  const noteDir = "/vault/.ticksidian-sync/missing-note";
  store.listFailures.add(noteDir);
  const operations = createOperations(store);

  // When: queued updates are requested.
  const updates = await operations.getQueuedSyncUpdates("missing-note");

  // Then: missing directories behave like an empty queue.
  check("getQueuedSyncUpdates returns [] for missing directory", eq(updates, []));
}

{
  // Given: mixed queue files in listing order that is not timestamp order.
  const store = new FakeSyncQueueStore("/vault");
  const noteDir = "/vault/.ticksidian-sync/note-b";
  store.files.set(`${noteDir}/300-late.json`, serializedUpdate("late", "note-b", [3], 300));
  store.files.set(`${noteDir}/100-early.json`, serializedUpdate("early", "note-b", [1], 100));
  store.files.set(`${noteDir}/200-middle.json`, serializedUpdate("middle", "note-b", [2], 200));
  store.files.set(`${noteDir}/400-bad.txt`, serializedUpdate("bad-name", "note-b", [4], 400));
  store.files.set(`${noteDir}/500-corrupt.json`, "{");
  store.files.set(`${noteDir}/600-unreadable.json`, serializedUpdate("unreadable", "note-b", [6], 600));
  store.readFailures.add(`${noteDir}/600-unreadable.json`);
  const operations = createOperations(store);

  // When: queued updates are loaded.
  const updates = await operations.getQueuedSyncUpdates("note-b");

  // Then: valid files are decoded, corrupt/unreadable/bad names are ignored, and order is ascending.
  check(
    "getQueuedSyncUpdates sorts valid updates by timestamp",
    eq(
      updates.map((update) => update.id),
      ["early", "middle", "late"],
    ),
    JSON.stringify(updates),
  );
  check(
    "getQueuedSyncUpdates preserves stored filenames",
    eq(
      updates.map((update) => update.fileName),
      ["100-early.json", "200-middle.json", "300-late.json"],
    ),
    JSON.stringify(updates),
  );
  check(
    "getQueuedSyncUpdates decodes byte payloads",
    eq(
      updates.map((update) => Array.from(update.update)),
      [[1], [2], [3]],
    ),
    JSON.stringify(updates.map((update) => Array.from(update.update))),
  );
  check(
    "getQueuedSyncUpdates does not read invalid queue filenames",
    !store.readTextFileCalls.includes(`${noteDir}/400-bad.txt`),
    JSON.stringify(store.readTextFileCalls),
  );
}

{
  // Given: a queue with two target IDs, one keep ID, and one invalid filename.
  const store = new FakeSyncQueueStore("/vault");
  const noteDir = "/vault/.ticksidian-sync/note-c";
  store.files.set(`${noteDir}/100-target-1.json`, serializedUpdate("target-1", "note-c", [1], 100));
  store.files.set(`${noteDir}/200-keep.json`, serializedUpdate("keep", "note-c", [2], 200));
  store.files.set(`${noteDir}/300-target-2.json`, serializedUpdate("target-2", "note-c", [3], 300));
  store.files.set(`${noteDir}/400-invalid.txt`, serializedUpdate("invalid", "note-c", [4], 400));
  store.deleteFailures.add(`${noteDir}/100-target-1.json`);
  const operations = createOperations(store);

  // When: a partial clear is requested.
  await expectResolve("clearQueuedSyncUpdates ignores delete failures", () =>
    operations.clearQueuedSyncUpdates("note-c", ["target-1", "target-2"]),
  );

  // Then: only matching queue IDs request deletion, and later files still run after a failure.
  check(
    "clearQueuedSyncUpdates requests deletion for matching IDs only",
    eq(store.deleteFileCalls, [`${noteDir}/100-target-1.json`, `${noteDir}/300-target-2.json`]),
    JSON.stringify(store.deleteFileCalls),
  );
}

{
  // Given: an empty clear request.
  const store = new FakeSyncQueueStore("/vault");
  const operations = createOperations(store);

  // When: no IDs are passed.
  await operations.clearQueuedSyncUpdates("note-d", []);

  // Then: no list or delete operation is requested.
  check("clearQueuedSyncUpdates empty ID list does not list files", store.listDirectoryCalls.length === 0);
  check("clearQueuedSyncUpdates empty ID list does not delete files", store.deleteFileCalls.length === 0);
}

{
  // Given: a queue directory with several listed files.
  const store = new FakeSyncQueueStore("/vault");
  const noteDir = "/vault/.ticksidian-sync/note-e";
  store.files.set(`${noteDir}/100-a.json`, serializedUpdate("a", "note-e", [1], 100));
  store.files.set(`${noteDir}/200-b.json`, serializedUpdate("b", "note-e", [2], 200));
  store.files.set(`${noteDir}/not-a-queue.txt`, "not json");
  store.deleteFailures.add(`${noteDir}/100-a.json`);
  const operations = createOperations(store);

  // When: all queued files are cleared.
  await expectResolve("clearAllQueuedSyncUpdates ignores individual delete failures", () =>
    operations.clearAllQueuedSyncUpdates("note-e"),
  );

  // Then: deletion is requested for every listed path.
  check(
    "clearAllQueuedSyncUpdates requests deletion for every listed path",
    eq(store.deleteFileCalls, [
      `${noteDir}/100-a.json`,
      `${noteDir}/200-b.json`,
      `${noteDir}/not-a-queue.txt`,
    ]),
    JSON.stringify(store.deleteFileCalls),
  );
}

{
  // Given: invalid names that should never be treated as queue files.
  const invalidNames = [
    "1710000000123-queue-id-1.txt",
    "not-a-timestamp-id.json",
    "1710000000123-.json",
    "1710000000123-queue.id.json",
  ];

  // When/Then: every invalid name is rejected.
  check(
    "parseQueueFileName rejects invalid queue filenames",
    invalidNames.every((name) => parseQueueFileName(name) === null),
  );
}

{
  // Given: a selected vault path.
  const vaultPath = "/Users/kyle/Vault";

  // When/Then: sync directories are resolved without touching Tauri.
  check(
    "resolveSyncQueueDir builds vault queue directory",
    resolveSyncQueueDir(vaultPath) === "/Users/kyle/Vault/.ticksidian-sync",
  );
  check(
    "resolveNoteQueueDir builds note queue directory",
    resolveNoteQueueDir(vaultPath, "note-1") === "/Users/kyle/Vault/.ticksidian-sync/note-1",
  );
}

{
  // Given: no selected vault.
  // When/Then: queue path resolution keeps the existing public error.
  expectThrow(check, "resolveSyncQueueDir rejects missing vault", () => resolveSyncQueueDir(null), "Vault not initialized");
  expectThrow(check, "resolveSyncQueueDir rejects empty vault", () => resolveSyncQueueDir(""), "Vault not initialized");
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) {
  process.exit(1);
}
