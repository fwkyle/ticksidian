// Sync replay characterization QA
//
// Given: fake queued Yjs updates and fake queue clearing.
// When: replay helpers and exported cleanup functions run.
// Then: replay pending state is cleared only at the intended lifecycle points.
//
// Usage:
//   cd app && node --experimental-strip-types qa-sync-replay.mjs

import * as Y from "yjs";

const {
  clearSyncQueueForNote,
  clearSyncedReplayEntries,
  destroyAllSyncProviders,
  destroySyncProvider,
  replayQueuedUpdatesToYDoc,
  sortQueuedUpdatesForReplay,
} = await import("./src/lib/sync.ts");

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

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

if (typeof sortQueuedUpdatesForReplay !== "function" || typeof clearSyncedReplayEntries !== "function") {
  check("sync replay pure helpers are exported", false, "missing sortQueuedUpdatesForReplay or clearSyncedReplayEntries");
  console.log(`\n${assertions} assertions, ${failures} failures`);
  process.exit(1);
}

function makeYUpdate(value) {
  const doc = new Y.Doc();
  doc.getMap("content").set("value", value);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function queuedUpdate(noteId, id, timestamp, value) {
  return {
    id,
    noteId,
    update: makeYUpdate(value),
    timestamp,
    fileName: `${timestamp}-${id}.json`,
  };
}

function createFakeQueue(updatesByNoteId) {
  const clearCalls = [];
  const allClearCalls = [];
  return {
    api: {
      getQueuedSyncUpdates: async (noteId) => updatesByNoteId.get(noteId) ?? [],
      clearQueuedSyncUpdates: async (noteId, ids) => {
        clearCalls.push({ noteId, ids: [...ids] });
      },
      clearAllQueuedSyncUpdates: async (noteId) => {
        allClearCalls.push(noteId);
      },
    },
    clearCalls,
    allClearCalls,
  };
}

{
  // Given: queued updates in a non-chronological order.
  const updates = [
    queuedUpdate("note-sort", "late", 300, "late"),
    queuedUpdate("note-sort", "early", 100, "early"),
    queuedUpdate("note-sort", "middle", 200, "middle"),
  ];

  // When: replay order is planned.
  const sorted = sortQueuedUpdatesForReplay(updates);

  // Then: replay order follows timestamp order.
  check(
    "sortQueuedUpdatesForReplay returns timestamp order",
    eq(
      sorted.map((update) => update.id),
      ["early", "middle", "late"],
    ),
    JSON.stringify(sorted.map((update) => update.id)),
  );
}

{
  // Given: no queued updates for a note.
  const fakeQueue = createFakeQueue(new Map([["note-empty", []]]));

  // When: replay is attempted.
  const count = await replayQueuedUpdatesToYDoc("note-empty", fakeQueue.api);
  const syncedIds = clearSyncedReplayEntries("note-empty", fakeQueue.api);

  // Then: nothing is replayed and no later clear request is created.
  check("replayQueuedUpdatesToYDoc returns 0 for empty queue", count === 0);
  check("empty replay leaves no synced IDs", eq(syncedIds, []), JSON.stringify(syncedIds));
  check("empty replay does not clear queue files", fakeQueue.clearCalls.length === 0);
}

{
  // Given: a fake queue with unsorted updates.
  const noteId = "note-synced-clear";
  const fakeQueue = createFakeQueue(
    new Map([
      [
        noteId,
        [
          queuedUpdate(noteId, "late", 300, "late"),
          queuedUpdate(noteId, "early", 100, "early"),
          queuedUpdate(noteId, "middle", 200, "middle"),
        ],
      ],
    ]),
  );

  // When: queued updates are replayed before provider sync.
  const count = await replayQueuedUpdatesToYDoc(noteId, fakeQueue.api);

  // Then: the queue has not been cleared yet.
  check("replayQueuedUpdatesToYDoc replays all queued updates", count === 3);
  check("replay does not clear queue before provider synced", fakeQueue.clearCalls.length === 0);

  // When: provider synced is simulated.
  const syncedIds = clearSyncedReplayEntries(noteId, fakeQueue.api);

  // Then: sorted replay IDs are passed to queue clearing.
  check("clearSyncedReplayEntries returns replayed IDs", eq(syncedIds, ["early", "middle", "late"]));
  check(
    "clearSyncedReplayEntries passes replayed IDs to queue clearing",
    eq(fakeQueue.clearCalls, [{ noteId, ids: ["early", "middle", "late"] }]),
    JSON.stringify(fakeQueue.clearCalls),
  );
}

{
  // Given: replay-pending state exists for a note.
  const noteId = "note-clear-all";
  const fakeQueue = createFakeQueue(new Map([[noteId, [queuedUpdate(noteId, "one", 100, "one")]]]));
  await replayQueuedUpdatesToYDoc(noteId, fakeQueue.api);

  // When: the note sync queue is explicitly cleared.
  await clearSyncQueueForNote(noteId, fakeQueue.api);
  const syncedIds = clearSyncedReplayEntries(noteId, fakeQueue.api);

  // Then: all-clear is requested and local replay-pending state is gone.
  check("clearSyncQueueForNote calls all-clear queue API", eq(fakeQueue.allClearCalls, [noteId]));
  check("clearSyncQueueForNote clears replay-pending state", eq(syncedIds, []), JSON.stringify(syncedIds));
}

{
  // Given: replay-pending state exists for a note.
  const noteId = "note-destroy-one";
  const fakeQueue = createFakeQueue(new Map([[noteId, [queuedUpdate(noteId, "one", 100, "one")]]]));
  await replayQueuedUpdatesToYDoc(noteId, fakeQueue.api);

  // When: that note provider is destroyed.
  destroySyncProvider(noteId);
  const syncedIds = clearSyncedReplayEntries(noteId, fakeQueue.api);

  // Then: no pending replay IDs remain for that note.
  check("destroySyncProvider clears replay-pending state", eq(syncedIds, []), JSON.stringify(syncedIds));
}

{
  // Given: replay-pending state exists for multiple notes.
  const first = "note-destroy-all-a";
  const second = "note-destroy-all-b";
  const fakeQueue = createFakeQueue(
    new Map([
      [first, [queuedUpdate(first, "one", 100, "one")]],
      [second, [queuedUpdate(second, "two", 200, "two")]],
    ]),
  );
  await replayQueuedUpdatesToYDoc(first, fakeQueue.api);
  await replayQueuedUpdatesToYDoc(second, fakeQueue.api);

  // When: all providers are destroyed.
  destroyAllSyncProviders();
  const firstSyncedIds = clearSyncedReplayEntries(first, fakeQueue.api);
  const secondSyncedIds = clearSyncedReplayEntries(second, fakeQueue.api);

  // Then: no pending replay IDs remain for either note.
  check("destroyAllSyncProviders clears first replay-pending state", eq(firstSyncedIds, []));
  check("destroyAllSyncProviders clears second replay-pending state", eq(secondSyncedIds, []));
}

console.log(`\n${assertions} assertions, ${failures} failures`);
if (failures > 0) {
  process.exit(1);
}
