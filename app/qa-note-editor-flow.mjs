// useNoteEditor 흐름 검증기 (TICK-P0-003 검증기-우선 단계)
//
// 역할
//   - useNoteEditor 분해 대상인 순수 결정 로직을 **직접 import**해서(미러링 아님,
//     drift 없음) 시나리오로 고정한다.
//   - 검증 대상:
//       1) shouldTreatChangeAsUserEdit — reload guard race를 내용 동일성으로 닫는
//          race-hardened 사용자 편집 판정.
//       2) classifyExternalPoll — 외부 수정 폴링(3초 interval) 결정 트리.
//       3) createPendingSaveFailureStore — 언마운트 무음 저장 실패 적재/배출 store.
//   - 이 함수/스토어는 아직 hook에 배선되지 않았다. 검증기-우선 → 다음 단계에서 hook이
//     채택 + Tauri 클릭 QA. (docs/TODO.md TICK-P0-003)
//
// 사용법
//   cd app && node --experimental-strip-types qa-note-editor-flow.mjs
//
// 종료 코드
//   0  — 모든 assertion 통과
//   1  — assertion 1건 이상 실패

const { shouldTreatChangeAsUserEdit, classifyExternalPoll, classifyPreSaveGuard } = await import(
  "./src/hooks/useNoteEditor.helpers.ts"
);
const { createPendingSaveFailureStore } = await import(
  "./src/lib/pending-save-failures.ts"
);

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

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { getNoteTitleFromBlocks } = await import('./src/lib/note-content.ts');
check('링크 표시 글자도 제목에 보존', getNoteTitleFromBlocks([{ content: [
  { type: 'text', text: '참고 ' },
  { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'https://example.com' }] },
  { type: 'text', text: ' 제목' },
] }]) === '참고 https://example.com 제목');
check('빈 제목 기본값 보존', getNoteTitleFromBlocks([{ content: [] }]) === '새 노트');

// ---------------------------------------------------------------------------
// 1) shouldTreatChangeAsUserEdit (race-hardened 사용자 편집 판정)
// ---------------------------------------------------------------------------

check(
  "shouldTreatChangeAsUserEdit: 로드 전이면 false",
  shouldTreatChangeAsUserEdit(false, false, true) === false,
);
check(
  "shouldTreatChangeAsUserEdit: reload guard 켜져 있으면 false (정상 reload)",
  shouldTreatChangeAsUserEdit(true, true, true) === false,
);
check(
  "shouldTreatChangeAsUserEdit: guard 꺼졌지만 내용 동일 → false (race idempotency)",
  shouldTreatChangeAsUserEdit(true, false, false) === false,
  "setTimeout(0) race로 guard가 일찍 풀려도, 내용이 디스크와 같으면 저장 루프를 안 만든다",
);
check(
  "shouldTreatChangeAsUserEdit: 로드 + guard off + 내용 변경 → true (실제 편집)",
  shouldTreatChangeAsUserEdit(true, false, true) === true,
);
check(
  "shouldTreatChangeAsUserEdit: guard on + 내용 변경 → false (reload 주입은 편집 아님)",
  shouldTreatChangeAsUserEdit(true, true, true) === false,
);
// 회귀 가드(검토 워크플로우 confirmed): 내용 기준선은 "마지막 저장본"이어야 한다.
// A 로드 → B 타이핑·저장 → 다시 A로 되돌림. 기준선이 마지막 저장본 B이면 A!==B라
// contentChangedSinceLoad=true → 편집으로 인정돼 되돌림이 저장된다. (기준선을 로드시점
// A로 고정하면 A===A로 무음 유실. hook은 saveToFile 성공 시 기준선을 갱신한다.)
check(
  "shouldTreatChangeAsUserEdit: 저장 후 로드시점 내용으로 되돌림 → true (기준선=마지막 저장본)",
  shouldTreatChangeAsUserEdit(true, false, true) === true,
);

// ---------------------------------------------------------------------------
// 2) classifyExternalPoll (외부 수정 폴링 결정 트리)
// ---------------------------------------------------------------------------

const basePoll = {
  hasLoaded: true,
  isSaving: false,
  currentMtime: 200,
  lastKnownMtime: 100,
  pendingExternalMtime: null,
  hasLocalChanges: false,
  hasPendingTimer: false,
};

check(
  "classifyExternalPoll: 로드 전 → skip",
  eq(classifyExternalPoll({ ...basePoll, hasLoaded: false }), { action: "skip" }),
);
check(
  "classifyExternalPoll: 저장 중 → skip",
  eq(classifyExternalPoll({ ...basePoll, isSaving: true }), { action: "skip" }),
);
check(
  "classifyExternalPoll: mtime 미확보(null) → skip",
  eq(classifyExternalPoll({ ...basePoll, currentMtime: null }), { action: "skip" }),
);
check(
  "classifyExternalPoll: 첫 관측(lastKnown=null) → set-baseline",
  eq(classifyExternalPoll({ ...basePoll, lastKnownMtime: null }), {
    action: "set-baseline",
    nextLastKnownMtime: 200,
  }),
);
check(
  "classifyExternalPoll: 더 새 파일 아님(current<=lastKnown) → ignore",
  eq(classifyExternalPoll({ ...basePoll, currentMtime: 100 }), { action: "ignore" }),
);
check(
  "classifyExternalPoll: 같은 mtime 이미 pending → ignore",
  eq(
    classifyExternalPoll({ ...basePoll, pendingExternalMtime: 200 }),
    { action: "ignore" },
  ),
);
check(
  "classifyExternalPoll: 더 새 파일 + 안전(변경/타이머 없음) → reload",
  eq(classifyExternalPoll(basePoll), {
    action: "reload",
    nextPendingExternalMtime: 200,
  }),
);
check(
  "classifyExternalPoll: 더 새 파일 + 미저장 변경 → defer-pending",
  eq(classifyExternalPoll({ ...basePoll, hasLocalChanges: true }), {
    action: "defer-pending",
    nextPendingExternalMtime: 200,
  }),
);
check(
  "classifyExternalPoll: 더 새 파일 + 디바운스 타이머 대기 → defer-pending",
  eq(classifyExternalPoll({ ...basePoll, hasPendingTimer: true }), {
    action: "defer-pending",
    nextPendingExternalMtime: 200,
  }),
);

// ---------------------------------------------------------------------------
// 3) createPendingSaveFailureStore (언마운트 무음 저장 실패 적재)
// ---------------------------------------------------------------------------

{
  const store = createPendingSaveFailureStore();
  check("pendingSaveFailures: 새 store는 has()===false", store.has() === false);

  store.record({ noteId: "a", message: "저장 실패", at: 1 });
  check("pendingSaveFailures: record 후 has()===true", store.has() === true);

  const drained = store.drain();
  check(
    "pendingSaveFailures: drain은 적재된 실패를 반환",
    eq(drained, [{ noteId: "a", message: "저장 실패", at: 1 }]),
  );
  check("pendingSaveFailures: drain 후 store 비워짐", store.has() === false);
  check("pendingSaveFailures: 빈 store drain은 빈 배열", eq(store.drain(), []));
}

{
  const store = createPendingSaveFailureStore();
  store.record({ noteId: "a", message: "first", at: 1 });
  store.record({ noteId: "a", message: "second", at: 2 });
  const drained = store.drain();
  check(
    "pendingSaveFailures: 같은 noteId 반복 record → 최신 1건만 유지",
    drained.length === 1 && drained[0].message === "second",
    JSON.stringify(drained),
  );
}

{
  const store = createPendingSaveFailureStore();
  store.record({ noteId: "a", message: "ma", at: 1 });
  store.record({ noteId: "b", message: "mb", at: 2 });
  check(
    "pendingSaveFailures: 서로 다른 noteId 2건 → drain 2건",
    store.drain().length === 2,
  );
}

{
  // 격리: 두 store 인스턴스는 서로 영향 없음(싱글턴 공유 사고 방지).
  const s1 = createPendingSaveFailureStore();
  const s2 = createPendingSaveFailureStore();
  s1.record({ noteId: "a", message: "x", at: 1 });
  check(
    "pendingSaveFailures: factory 인스턴스는 서로 격리",
    s1.has() === true && s2.has() === false,
  );
}

{
  // 구독: record 시 listener가 호출되고, unsubscribe 후엔 호출 안 됨.
  const store = createPendingSaveFailureStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  store.record({ noteId: "a", message: "x", at: 1 });
  check("pendingSaveFailures: record가 구독자에게 알림", calls === 1);
  store.record({ noteId: "b", message: "y", at: 2 });
  check("pendingSaveFailures: 두 번째 record도 알림", calls === 2);
  unsubscribe();
  store.record({ noteId: "c", message: "z", at: 3 });
  check("pendingSaveFailures: unsubscribe 후엔 알림 없음", calls === 2);
}

// ---------------------------------------------------------------------------
// classifyPreSaveGuard — 저장 직전 mtime 재확인 (TICK-BUG-001)
//
// 왜: 3초 폴러만으로는 "마지막 폴링 ~ 실제 쓰기" 사이에 들어온 외부 변경을 못 본다.
// 그 틈에 저장하면 외부 내용이 경고 없이 덮이고, markSaved가 기준을 우리 저장 시각으로
// 올려버려 이후에도 영원히 감지되지 않는다(2026-08-23 [kyle] C1 실측).
// ---------------------------------------------------------------------------

{
  check(
    "preSaveGuard: 기준 mtime과 디스크 mtime이 같으면 저장 진행",
    eq(classifyPreSaveGuard({ currentMtime: 1000, baselineMtime: 1000 }), { action: "proceed" }),
  );
  check(
    "preSaveGuard: 디스크가 더 새로우면 저장 중단(외부 변경)",
    eq(classifyPreSaveGuard({ currentMtime: 1001, baselineMtime: 1000 }), {
      action: "abort-external-change",
      externalMtime: 1001,
    }),
  );
  check(
    "preSaveGuard: 디스크가 더 오래돼도 저장 중단 — mtime 보존 동기화(Syncthing/rsync) 대비",
    eq(classifyPreSaveGuard({ currentMtime: 999, baselineMtime: 1000 }), {
      action: "abort-external-change",
      externalMtime: 999,
    }),
  );
  check(
    "preSaveGuard: 기준선이 없으면 진행(첫 저장 — 비교할 대상이 없다)",
    eq(classifyPreSaveGuard({ currentMtime: 1000, baselineMtime: null }), { action: "proceed" }),
  );
  check(
    "preSaveGuard: 디스크 mtime을 못 읽으면 진행(새 노트 첫 저장/일시적 stat 실패 — fail-open)",
    eq(classifyPreSaveGuard({ currentMtime: null, baselineMtime: 1000 }), { action: "proceed" }),
  );
  check(
    "preSaveGuard: 둘 다 없으면 진행",
    eq(classifyPreSaveGuard({ currentMtime: null, baselineMtime: null }), { action: "proceed" }),
  );
}

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

{
  const { FileTaskQueue, LatestSaveQueue } = await import('./src/lib/note-save-queue.ts');
  const files = new FileTaskQueue();
  const queue = new LatestSaveQueue('/vault/a.md', files);
  const events = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const first = queue.request(async () => { events.push('first'); await held; });
  await Promise.resolve();
  const middle = queue.request(async () => { events.push('middle'); });
  const latest = queue.request(async () => { events.push('latest'); });
  let resolved = false;
  void latest.then(() => { resolved = true; });
  const read = files.run('/vault/a.md', async () => { events.push('read'); });
  await files.run('/other/a.md', async () => { events.push('other-vault'); });
  check('save queue: 대기 요청은 첫 저장 완료 전에 resolve하지 않는다', !resolved);
  release();
  await Promise.all([first, middle, latest, read]);
  check('save queue: 첫/최신만 저장 후 재마운트 읽기, 다른 볼트는 독립',
    eq(events, ['first', 'other-vault', 'latest', 'read']), JSON.stringify(events));

  let fail;
  const failureGate = new Promise(resolve => { fail = resolve; });
  const failed = queue.request(async () => { await failureGate; throw new Error('expected'); });
  const failedResult = failed.catch(error => error.message);
  await Promise.resolve();
  const recovered = queue.request(async () => { events.push('recovery'); });
  const recoveredResult = recovered.catch(error => error.message);
  fail();
  await Promise.all([failedResult, recoveredResult]);
  check('save queue: 앞선 실패 뒤 대기 중 최신 요청은 실행된다', events.at(-1) === 'recovery');
  await queue.request(async () => { events.push('later'); });
  check('save queue: 실패 후에도 새 요청을 받을 수 있다', events.at(-1) === 'later');
}

await import('./qa-note-editor-poller.mjs');
console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
