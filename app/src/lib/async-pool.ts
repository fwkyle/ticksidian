/**
 * 동시성 제한 비동기 매핑 (TICK-P1-006).
 *
 * `Promise.all(items.map(fn))`은 모든 작업을 한 번에 띄운다. 1000개 노트 볼트에서
 * `useLinkIndex.fullRebuild`가 이렇게 돌면 readTextFile invoke 1000개가 동시에 나가
 * IO가 폭증한다. 이 유틸은 결과는 그대로 두되 동시 실행 개수만 limit으로 묶는다.
 *
 * 검증기-우선 단계로 추가됨 — 아직 hook에 배선하지 않았다. 배선은 Tauri QA 이후.
 */

/**
 * items를 동시 실행 최대 limit개로 비동기 매핑한다.
 *
 * 보장:
 *  - 결과는 입력 순서를 보존한다(`Promise.all`과 동일).
 *  - 동시에 실행 중인 fn 호출은 절대 limit을 넘지 않는다.
 *  - fn 하나라도 reject하면 전체가 reject하고(첫 에러 전파), 이후 새 작업은 시작하지
 *    않는다(`Promise.all`과 같은 fail-fast 시맨틱).
 *  - limit이 0 이하면 1로, items보다 크면 items 길이로 클램프한다.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const total = items.length;
  const results = new Array<R>(total);
  if (total === 0) return results;

  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, total));
  let nextIndex = 0;
  let failed = false;

  async function worker(): Promise<void> {
    // `nextIndex++`은 await가 끼지 않아 원자적 — 각 worker가 고유 index를 집는다.
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failed = true; // 다른 worker가 새 작업을 더 집지 않게 한다.
        throw error;
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}
