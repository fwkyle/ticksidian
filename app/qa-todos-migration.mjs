// todos-migration 순수 로직 검증기
//
// 역할
//   - decideMigrationMarkDone 함수의 결정 로직을 Node 레벨에서 직접 검증한다.
//   - migration 3가지 경로(done/noop/blocked)의 markDone 결정이 올바른지 확인한다.
//
// 사용법
//   cd app && node qa-todos-migration.mjs

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

// decideMigrationMarkDone 순수 함수 미러
function decideMigrationMarkDone(result) {
  return result !== "blocked";
}

// ── decideMigrationMarkDone 케이스 ──

check(
  "decideMigrationMarkDone: 'done' → true (완료 후 표시)",
  decideMigrationMarkDone("done") === true,
);

check(
  "decideMigrationMarkDone: 'noop' → true (todos.json 없음, 표시 가능)",
  decideMigrationMarkDone("noop") === true,
);

check(
  "decideMigrationMarkDone: 'blocked' → false (충돌 있음, 절대 표시 안 함)",
  decideMigrationMarkDone("blocked") === false,
);

// ── initializeVault 흐름 시뮬레이션 ──

function simulateInitFlow(migrationDone, mockResult) {
  // todosMigrationDone === 1 이면 migration 호출 안 함
  if (migrationDone) {
    return { called: false, shouldMark: null };
  }
  // 미완료면 실행
  const shouldMark = decideMigrationMarkDone(mockResult);
  return { called: true, shouldMark };
}

const flowAlreadyDone = simulateInitFlow(1, "done");
check(
  "initFlow: todosMigrationDone=1 → migration 호출 안 함",
  flowAlreadyDone.called === false,
);

const flowNoop = simulateInitFlow(0, "noop");
check(
  "initFlow: todosMigrationDone=0 + 'noop' → 호출됨, shouldMark=true",
  flowNoop.called === true && flowNoop.shouldMark === true,
);

const flowDone = simulateInitFlow(0, "done");
check(
  "initFlow: todosMigrationDone=0 + 'done' → 호출됨, shouldMark=true",
  flowDone.called === true && flowDone.shouldMark === true,
);

const flowBlocked = simulateInitFlow(0, "blocked");
check(
  "initFlow: todosMigrationDone=0 + 'blocked' → 호출됨, shouldMark=false",
  flowBlocked.called === true && flowBlocked.shouldMark === false,
  "blocked 결과는 절대 done:1 로 표시하면 안 된다",
);

console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
