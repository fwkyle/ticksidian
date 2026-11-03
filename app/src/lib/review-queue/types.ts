/**
 * 검토 큐 도메인 타입 (TICK-P0-007 검토 큐 UI 1차)
 *
 * 설계: docs/waterfall/03-상세설계/TickTick-검토-큐-UI-1차.md
 *
 * 계약:
 * - 검토 카드는 TickTick 원본 1개(sourceId)에 1개다. 재가져오기로 늘어나지 않는다.
 * - 사용자가 고른 분류(userClassification)와 AI 제안(suggestion)은 분리되어,
 *   재가져오기가 제안을 갱신해도 사용자 선택을 덮어쓰지 않는다.
 * - 검토 데이터는 Ticksidian 볼트 내부에만 저장하고 TickTick 원본은 건드리지 않는다.
 */

/** 검토 분류 7종. 2026-08-15 `보류`를 `일반 메모`로 교체했다. */
export const REVIEW_CLASSIFICATIONS = [
  "실행",
  "아이디어",
  "참고",
  "일반 메모",
  "중복 의심",
  "정리 후보",
  "수동 검토",
] as const;

export type ReviewClassification = (typeof REVIEW_CLASSIFICATIONS)[number];

/**
 * 변환 가능한 분류 4종 (검토 큐 2차).
 * 중복 의심/정리 후보/수동 검토는 정리 판단이 끝나지 않아 변환 대상이 아니다.
 * 사용자가 이 4종 중 하나로 고르면 변환할 수 있다.
 */
export const CONVERTIBLE_CLASSIFICATIONS = ["실행", "아이디어", "참고", "일반 메모"] as const;

export type ConvertibleClassification = (typeof CONVERTIBLE_CLASSIFICATIONS)[number];

/**
 * 분류 → 노트 변환 대상.
 *
 * 폴더는 **볼트 루트 기준 상대경로**다. 2026-08-16 볼트 전체 스캔 전에는 노트 뿌리가
 * `{vault}/notes`라서 폴더명만 적어도 그 아래에 만들어졌다. 뿌리가 볼트 폴더 자체로
 * 바뀐 뒤에는 `notes/`를 명시해야 같은 위치가 유지된다. 그러지 않으면 옵시디언 볼트
 * 최상위에 `실행`/`아이디어`/`참고`/`메모` 폴더가 새로 생긴다.
 * 설계: docs/waterfall/03-상세설계/볼트-전체-스캔.md
 */
export const CLASSIFICATION_NOTE_TARGETS: Readonly<
  Record<ConvertibleClassification, { folder: string; kind: "todo" | "note" }>
> = {
  실행: { folder: "notes/실행", kind: "todo" },
  아이디어: { folder: "notes/아이디어", kind: "note" },
  참고: { folder: "notes/참고", kind: "note" },
  "일반 메모": { folder: "notes/메모", kind: "note" },
};

/** 과거 분류명 정규화. 과거 산출물의 `보류` 기록은 수정하지 않고 입력 시점에만 바꾼다. */
export const LEGACY_CLASSIFICATION_ALIASES: Readonly<
  Record<string, ReviewClassification>
> = {
  보류: "일반 메모",
};

export const REVIEW_CARD_STATUSES = ["pending", "approved", "later"] as const;

export type ReviewCardStatus = (typeof REVIEW_CARD_STATUSES)[number];

/**
 * 카드가 어디서 왔는지(2026-08-30 TICK-REVIEW-002 단계 1).
 * vault-notes 소스(볼트 기존 노트 재발견)가 단계 2에서 붙을 때 이 값을 기준으로
 * 화면 라벨·판단 액션(유지/보관)이 갈린다. 기존 카드는 전부 "external"이다.
 */
export const REVIEW_ORIGINS = ["external", "capture", "vault-note"] as const;

export type ReviewOrigin = (typeof REVIEW_ORIGINS)[number];

/** source 문자열 → origin. 모르는 source는 fail-closed로 external로 둔다. */
export function toReviewOrigin(source: string): ReviewOrigin {
  if (source === REVIEW_CAPTURE_SOURCE) return "capture";
  if (source === "vault-note") return "vault-note";
  return "external";
}

/** TickTick 원본의 읽기 전용 미러. 안전 필터가 적용된 값만 들어온다. */
export interface ReviewSourceMirror {
  readonly source: string;
  readonly sourceId: string;
  readonly title: string;
  readonly safeContent: string;
  readonly projectName?: string;
  /** "manual-review-only"면 자동 처리 금지 배지로 표시한다. */
  readonly safetyAction?: string;
}

/** AI 제안. 제안일 뿐이며 자동 실행으로 이어지지 않는다. */
export interface ReviewSuggestion {
  readonly classification: ReviewClassification;
  readonly reason: string;
  readonly confidence: number;
}

/** 검토 카드 1개 = 외부 원본 1개. */
export interface ReviewCard {
  /** `${source}:${sourceId}` — 중복 방지 기본 키 */
  readonly sourceKey: string;
  readonly importedAt: string;
  /**
   * 카드 유래(2026-08-30 단계 1). 저장 파일에 이미 있으면 그 값을 유지하고,
   * 없는 옛 카드는 source에서 유도해 채운다(마이그레이션 불필요).
   */
  readonly origin: ReviewOrigin;
  /**
   * 이 카드가 왜 검토 대상이 됐는지(2026-08-30 단계 1).
   * AI 제안 이유(suggestion.reason)와 다르다 — 제안은 "어디로 분류하냐"의 이유고
   * reviewReason은 "왜 큐에 나왔냐"의 이유다. 없으면 빈 문자열.
   */
  readonly reviewReason: string;
  readonly source: ReviewSourceMirror;
  readonly suggestion: ReviewSuggestion;
  /** 사용자가 고른 분류. null이면 제안 분류를 따른다. 재가져오기로 덮어쓰지 않는다. */
  readonly userClassification: ReviewClassification | null;
  readonly status: ReviewCardStatus;
  readonly decidedAt: string | null;
  readonly updatedAt: string;
  /**
   * 승인 항목을 Ticksidian 노트/투두로 변환한 기록 (2차).
   * null이면 아직 변환하지 않았다. 재가져오기로 덮어쓰지 않는다.
   * 설계: docs/waterfall/03-상세설계/TickTick-검토-큐-2차-변환.md
   */
  readonly conversion: ReviewConversionRecord | null;
}

/** 변환 기록. 파일을 되돌리는(삭제하는) 기능은 없다. */
export interface ReviewConversionRecord {
  /** 노트 ID이자 파일 basename: `ticktick-{원본ID}` */
  readonly noteId: string;
  /** 생성 폴더: 실행/아이디어/참고/메모 */
  readonly noteFolder: string;
  /** todo면 투두 노트, note면 일반 노트 */
  readonly noteKind: "todo" | "note";
  readonly convertedAt: string;
  /** 볼트에 이미 같은 파일이 있어서 덮어쓰지 않은 경우 true */
  readonly preexisting: boolean;
}

/** 볼트에 저장되는 검토 큐 파일 1개의 형태. */
export interface ReviewQueueFile {
  readonly schemaVersion: 1;
  readonly cards: readonly ReviewCard[];
}

/** 스냅샷 가져오기 입력 1개. fixture 또는 후속 CLI/Open API 추출 결과가 같은 형태를 쓴다. */
export interface ReviewSnapshotItem {
  readonly source: string;
  readonly sourceId: string;
  readonly title: string;
  readonly safeContent: string;
  readonly projectName?: string;
  readonly safetyAction?: string;
  /** "왜 큐에 나왔는지". vault-notes 소스에서는 필수가 된다(단계 2). */
  readonly reviewReason?: string;
  readonly suggestion: {
    readonly classification: string;
    readonly reason: string;
    readonly confidence: number;
  };
}

/** 앱 안 캡처 입력의 source 값 (TICK-P0-007 3차). TickTick 유래가 아닌 항목이다. */
export const REVIEW_CAPTURE_SOURCE = "ticksidian-capture";
