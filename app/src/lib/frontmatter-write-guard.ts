/**
 * 머리말 쓰기 보호 규칙(DFXR-004·005). 설계: docs/waterfall/03-상세설계/옵시디언-원본-최소-frontmatter.md
 *
 * 불변식: 머리말 바이트는 이 파일을 읽을 수 있는 디스크 파싱 결과에서 왔거나,
 * 그 위에 얹은 사용자의 명시적 편집에서 온 경우에만 쓴다.
 *
 * 두 사실을 따로 다룬다.
 * - diskUnreadable: 지금 디스크 머리말을 읽을 수 없다.
 * - metaUnreadable: 편집기가 든 로컬 메타가 읽지 못한 머리말 위에서 만들어졌다(가짜 빈 머리말).
 */

export interface WriteGuardState {
  /** 이 세션에서 이 파일의 디스크 원문을 성공적으로 읽은 기록(DFXR-007). 없으면 기본 거부. */
  writeGranted: boolean;
  diskUnreadable: boolean;
  metaUnreadable: boolean;
}

/**
 * 작성본의 메타 출처 표시(DFXR-007 재개).
 * - metaFromDisk: 긍정 증거. false면 "읽은 디스크 메타 위에서 만든 것이 아니다". 없으면 옛 작성본(정상 취급, 호환).
 * - metaUnreadable: 4라운드 옛 표시. true는 metaFromDisk:false와 같은 뜻으로 읽기만 한다.
 */
export interface DraftGuardMark {
  metaFromDisk?: boolean;
  metaUnreadable?: boolean;
}

/** 다른 작성본으로 옮겨 쓸 때 출처 표시를 있는 그대로(없으면 없는 채로) 전달한다. */
export function draftMetaOrigin(draft: DraftGuardMark): { metaFromDisk?: boolean; metaUnreadable?: true } {
  return {
    ...(draft.metaFromDisk !== undefined ? { metaFromDisk: draft.metaFromDisk } : {}),
    ...(draft.metaUnreadable === true ? { metaUnreadable: true } : {}),
  };
}

export function isDraftMetaUntrusted(draft: DraftGuardMark): boolean {
  return draft.metaFromDisk === false || draft.metaUnreadable === true;
}

/** 디스크 원문의 상태. read-failed는 읽기 자체가 실패한 것으로, 읽을 수 있는 파싱 결과가 아니다(DFXR-006). */
export type DiskState = 'readable' | 'unreadable' | 'read-failed';

export interface LoadGuard {
  /** true면 로컬 메타를 작성본이 아니라 디스크 파싱 결과에서 만든다. */
  useDiskMeta: boolean;
  metaUnreadable: boolean;
  /** 디스크 사실 ref에 대입할 값. 읽기 실패도 확인 불가이므로 true다. */
  diskUnreadable: boolean;
  /** 작성본의 로컬 메타를 버리고 디스크 값을 썼다(알림 대상). */
  droppedLocalMeta: boolean;
}

export function isFrontmatterWriteBlocked(state: WriteGuardState): boolean {
  return !state.writeGranted || state.diskUnreadable || state.metaUnreadable;
}

export function resolveLoadGuard(input: { disk: DiskState; draft: DraftGuardMark | null }): LoadGuard {
  const { disk, draft } = input;
  const diskUnreadable = disk !== 'readable';
  if (disk === 'read-failed') {
    // 실패 대체값으로 표시를 끄거나 디스크 메타를 확정하지 않는다.
    return { useDiskMeta: false, metaUnreadable: draft === null || isDraftMetaUntrusted(draft), diskUnreadable, droppedLocalMeta: false };
  }
  if (!draft) return { useDiskMeta: true, metaUnreadable: diskUnreadable, diskUnreadable, droppedLocalMeta: false };
  if (!isDraftMetaUntrusted(draft)) return { useDiskMeta: false, metaUnreadable: false, diskUnreadable, droppedLocalMeta: false };
  if (diskUnreadable) return { useDiskMeta: false, metaUnreadable: true, diskUnreadable, droppedLocalMeta: false };
  return { useDiskMeta: true, metaUnreadable: false, diskUnreadable, droppedLocalMeta: true };
}
