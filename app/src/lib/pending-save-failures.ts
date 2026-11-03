/**
 * 언마운트 시 저장 flush 실패를 컴포넌트 수명과 무관하게 보관하는 모듈 레벨 store.
 *
 * 문제(TICK-P0-003): `useNoteEditor.ts`의 언마운트 cleanup은 디바운스 대기 중이던
 * 변경을 `void saveToFileRef.current()`로 fire-and-forget 저장한다. 이 시점엔
 * `isMountedRef.current === false`라, 저장이 실패(디스크 가득참/권한 거부 등)해도
 * `saveToFile`의 catch가 `saveError`를 띄우지 못하고 console.error만 남긴다.
 * 결과적으로 미저장 변경이 **무음 유실**된다.
 *
 * 이 store는 그 실패를 컴포넌트 밖에 적재해 둔다. App은 다음 렌더/마운트에서
 * `drain()`으로 꺼내 "이 노트는 마지막 저장이 실패했습니다"를 사용자에게 surface할
 * 수 있다. 분해 단계에서 hook의 언마운트 flush catch가 `record()`를 호출하고,
 * App이 `drain()`을 읽어 배너로 보여준다(이번 검증기-우선 단계에서는 store와 검증기만
 * 추가하고, hook/App 배선은 다음 단계 + Tauri QA에서 한다).
 *
 * 순수 factory(`createPendingSaveFailureStore`)로 테스트에서 격리 인스턴스를 만들고,
 * 앱은 기본 싱글턴(`pendingSaveFailures`)을 공유한다.
 */

export interface PendingSaveFailure {
  noteId: string;
  /** 사용자에게 보일 메시지(원문 에러가 아니라 안내 문구). */
  message: string;
  /** 실패 시각(ms epoch). 호출부가 주입한다(테스트 결정성 위해 내부 생성 안 함). */
  at: number;
}

export interface PendingSaveFailureStore {
  /** 노트 저장 실패를 적재한다. 같은 noteId는 최신 실패로 덮어쓴다. 적재 후 구독자에게 알린다. */
  record(failure: PendingSaveFailure): void;
  /** 쌓인 실패를 모두 꺼내고 store를 비운다(꺼내 가면 surface 완료로 본다). */
  drain(): PendingSaveFailure[];
  /** 적재된 실패가 있는지. */
  has(): boolean;
  /**
   * 적재(record) 발생을 구독한다. App이 구독해 즉시 surface할 수 있다.
   * 언마운트 flush 실패는 비동기로 도착하므로(컴포넌트는 이미 사라짐),
   * 폴링/타이밍 race 없이 알림을 받으려면 구독이 필요하다.
   * 반환값은 구독 해제 함수.
   */
  subscribe(listener: () => void): () => void;
}

export function createPendingSaveFailureStore(): PendingSaveFailureStore {
  // noteId당 최신 실패만 유지 — 같은 노트의 반복 실패가 무한히 쌓이지 않게 한다.
  const failures = new Map<string, PendingSaveFailure>();
  const listeners = new Set<() => void>();
  return {
    record(failure: PendingSaveFailure): void {
      failures.set(failure.noteId, failure);
      for (const listener of listeners) listener();
    },
    drain(): PendingSaveFailure[] {
      const out = Array.from(failures.values());
      failures.clear();
      return out;
    },
    has(): boolean {
      return failures.size > 0;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 앱 전역에서 공유하는 기본 store 싱글턴. */
export const pendingSaveFailures = createPendingSaveFailureStore();
