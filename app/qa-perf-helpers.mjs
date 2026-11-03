// 성능 헬퍼 검증기 (TICK-P1-006 검증기-우선 단계)
//
// 역할
//   - P1-006 배선 대상인 순수 유틸을 **직접 import**(미러링 아님)해 시나리오로 고정한다.
//     1) mapWithConcurrency — 동시성 제한 비동기 매핑(useLinkIndex.fullRebuild IO 폭증 방지).
//     2) planRescanByMtime  — mtime 빠른 경로(변경 파일만 re-read).
//   - 아직 hook/scanNoteFiles에 배선하지 않았다. 배선은 Tauri QA 이후.
//
// 사용법
//   cd app && node --experimental-strip-types qa-perf-helpers.mjs
//
// 종료 코드: 0 통과 / 1 실패

const { mapWithConcurrency } = await import("./src/lib/async-pool.ts");
const { planRescanByMtime } = await import("./src/lib/local-fs-helpers.ts");

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
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1) mapWithConcurrency
// ---------------------------------------------------------------------------

{
  const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
  check("mapWithConcurrency: 결과가 입력 순서를 보존", eq(out, [10, 20, 30, 40]));
}

{
  // 완료 순서가 뒤섞여도 결과는 인덱스 순서.
  const out = await mapWithConcurrency([30, 5, 20, 1], 4, async (ms, i) => {
    await delay(ms);
    return i;
  });
  check("mapWithConcurrency: 완료 순서와 무관하게 인덱스 순서 결과", eq(out, [0, 1, 2, 3]));
}

{
  // 동시 실행이 limit을 절대 넘지 않는다.
  let active = 0;
  let maxActive = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(5);
    active -= 1;
  });
  check(`mapWithConcurrency: 동시 실행 최대치 <= limit (max=${maxActive})`, maxActive <= 3 && maxActive > 0);
}

{
  const out = await mapWithConcurrency([1, 2], 100, async (n) => n);
  check("mapWithConcurrency: limit이 items보다 커도 정상", eq(out, [1, 2]));
}

{
  const out = await mapWithConcurrency([], 4, async (n) => n);
  check("mapWithConcurrency: 빈 입력 → 빈 배열", eq(out, []));
}

{
  // limit<=0 → 1로 클램프(순차 실행).
  let active = 0;
  let maxActive = 0;
  await mapWithConcurrency([1, 2, 3], 0, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(3);
    active -= 1;
  });
  check("mapWithConcurrency: limit<=0 → 1로 클램프(순차)", maxActive === 1);
}

{
  let threw = false;
  try {
    await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
  } catch (e) {
    threw = e instanceof Error && e.message === "boom";
  }
  check("mapWithConcurrency: fn reject → 첫 에러 전파", threw);
}

// ---------------------------------------------------------------------------
// 2) planRescanByMtime
// ---------------------------------------------------------------------------

{
  const prev = new Map();
  const plan = planRescanByMtime(prev, [
    { path: "a.md", mtime: 1 },
    { path: "b.md", mtime: 2 },
  ]);
  check(
    "planRescanByMtime: 빈 previous → 모두 added",
    eq(plan, { unchanged: [], changed: [], added: ["a.md", "b.md"], removed: [] }),
  );
}

{
  const prev = new Map([
    ["a.md", 1],
    ["b.md", 2],
    ["c.md", 3],
  ]);
  const plan = planRescanByMtime(prev, [
    { path: "a.md", mtime: 1 }, // 동일 → unchanged
    { path: "b.md", mtime: 99 }, // 변함 → changed
    { path: "d.md", mtime: 4 }, // 새 파일 → added
    // c.md 사라짐 → removed
  ]);
  check("planRescanByMtime: unchanged 분류", eq(plan.unchanged, ["a.md"]));
  check("planRescanByMtime: changed 분류", eq(plan.changed, ["b.md"]));
  check("planRescanByMtime: added 분류", eq(plan.added, ["d.md"]));
  check("planRescanByMtime: removed 분류", eq(plan.removed, ["c.md"]));
}

{
  // 변화 없는 볼트: 전부 unchanged, re-read 0 (빠른 경로의 핵심 이득).
  const prev = new Map([
    ["a.md", 10],
    ["b.md", 20],
  ]);
  const plan = planRescanByMtime(prev, [
    { path: "a.md", mtime: 10 },
    { path: "b.md", mtime: 20 },
  ]);
  check(
    "planRescanByMtime: 변화 없으면 re-read 대상(changed+added) 0",
    plan.changed.length === 0 && plan.added.length === 0 && plan.unchanged.length === 2,
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
