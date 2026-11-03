/**
 * 검토 큐 순수 규칙 (TICK-P0-007 검토 큐 UI 1차)
 *
 * IO 없이 값만 다루는 함수들이다. store/operations는 이 규칙 위에 얹는다.
 * 설계: docs/waterfall/03-상세설계/TickTick-검토-큐-UI-1차.md §3~§5
 */

import {
  CLASSIFICATION_NOTE_TARGETS,
  LEGACY_CLASSIFICATION_ALIASES,
  REVIEW_CAPTURE_SOURCE,
  REVIEW_CARD_STATUSES,
  REVIEW_CLASSIFICATIONS,
} from "./types.ts";
import type {
  ConvertibleClassification,
  ReviewCard,
  ReviewCardStatus,
  ReviewClassification,
  ReviewConversionRecord,
  ReviewQueueFile,
  ReviewSnapshotItem,
} from "./types.ts";
import { toReviewOrigin } from "./types.ts";

export const REVIEW_QUEUE_DIR = ".ticksidian-review-queue";
export const REVIEW_QUEUE_FILE_NAME = "queue.json";
export const REVIEW_QUEUE_SCHEMA_VERSION = 1;

export function resolveReviewQueueFilePath(vaultPath: string | null): string {
  if (!vaultPath) {
    throw new Error("Vault not initialized");
  }
  return `${vaultPath}/${REVIEW_QUEUE_DIR}/${REVIEW_QUEUE_FILE_NAME}`;
}

/** 중복 방지 기본 키. 같은 원본(source+sourceId)은 항상 같은 키가 나온다. */
export function toSourceKey(source: string, sourceId: string): string {
  return `${source}:${sourceId}`;
}

/**
 * 변환 노트 ID/파일 basename.
 * TickTick 스냅샷 유래는 CLI 이관기(scripts/ticktick-import-lib.mjs)와 같은
 * `ticktick-{원본ID}` — CLI가 이미 만든 파일과 앱 변환본이 같은 키로 수렴한다.
 * 그 외 source(앱 캡처 등)는 `capture-{id}`.
 * 원본 ID에 안전하지 않은 문자가 섞이면 결정적 폴백 해시로 대체한다.
 * (TickTick ObjectId는 항상 16진수 24자라 이 경로는 방어용이다.)
 */
export function toReviewNoteId(source: string, sourceId: string): string {
  const prefix = source === "ticktick-local-snapshot" ? "ticktick-" : "capture-";
  if (/^[A-Za-z0-9._-]+$/u.test(sourceId)) return `${prefix}${sourceId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < sourceId.length; i += 1) {
    const code = sourceId.codePointAt(i) ?? 0;
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = (h2 + Math.imul(code + i, 2654435761)) >>> 0;
  }
  const digest = h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  return `${prefix}${digest}${digest}`;
}

/** 분류 문자열을 현재 7종으로 정규화. 과거 `보류`는 `일반 메모`로 바꾼다. */
export function normalizeClassification(value: string): ReviewClassification | null {
  if ((REVIEW_CLASSIFICATIONS as readonly string[]).includes(value)) {
    return value as ReviewClassification;
  }
  return LEGACY_CLASSIFICATION_ALIASES[value] ?? null;
}

export function isReviewCardStatus(value: string): value is ReviewCardStatus {
  return (REVIEW_CARD_STATUSES as readonly string[]).includes(value);
}

/** 확신 정도를 0..1로 묶는다. 잘못된 값은 0으로 fail-closed. */
export function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 스냅샷 입력 1개를 검증하고 새 검토 카드로 정규화한다.
 * 필수 필드가 비었거나 분류를 정규화할 수 없으면 그 항목만 버린다(null).
 */
export function normalizeSnapshotItem(
  item: ReviewSnapshotItem,
  importedAt: string,
): ReviewCard | null {
  if (!isNonEmptyString(item.source) || !isNonEmptyString(item.sourceId)) return null;
  if (!isNonEmptyString(item.title)) return null;
  const classification = normalizeClassification(item.suggestion.classification);
  if (!classification) return null;

  return {
    sourceKey: toSourceKey(item.source, item.sourceId),
    importedAt,
    origin: toReviewOrigin(item.source),
    reviewReason:
      typeof item.reviewReason === "string" ? item.reviewReason : "",
    source: {
      source: item.source,
      sourceId: item.sourceId,
      title: item.title,
      safeContent: typeof item.safeContent === "string" ? item.safeContent : "",
      ...(isNonEmptyString(item.projectName) ? { projectName: item.projectName } : {}),
      ...(isNonEmptyString(item.safetyAction) ? { safetyAction: item.safetyAction } : {}),
    },
    suggestion: {
      classification,
      reason: typeof item.suggestion.reason === "string" ? item.suggestion.reason : "",
      confidence: normalizeConfidence(item.suggestion.confidence),
    },
    userClassification: null,
    status: "pending",
    decidedAt: null,
    updatedAt: importedAt,
    conversion: null,
  };
}

function parseReviewCard(value: unknown): ReviewCard | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record["sourceKey"])) return null;

  const source = record["source"];
  const suggestion = record["suggestion"];
  if (typeof source !== "object" || source === null) return null;
  if (typeof suggestion !== "object" || suggestion === null) return null;
  const sourceRecord = source as Record<string, unknown>;
  const suggestionRecord = suggestion as Record<string, unknown>;
  if (!isNonEmptyString(sourceRecord["source"])) return null;
  if (!isNonEmptyString(sourceRecord["sourceId"])) return null;
  if (!isNonEmptyString(sourceRecord["title"])) return null;

  const suggestedClassification = normalizeClassification(
    String(suggestionRecord["classification"] ?? ""),
  );
  if (!suggestedClassification) return null;

  const userClassificationRaw = record["userClassification"];
  const userClassification =
    typeof userClassificationRaw === "string"
      ? normalizeClassification(userClassificationRaw)
      : null;

  const statusRaw = typeof record["status"] === "string" ? record["status"] : "pending";
  const status = isReviewCardStatus(statusRaw) ? statusRaw : "pending";

  const sourceKey = record["sourceKey"];
  const importedAt = isNonEmptyString(record["importedAt"])
    ? (record["importedAt"] as string)
    : importedAtFallback();
  const updatedAt = isNonEmptyString(record["updatedAt"])
    ? (record["updatedAt"] as string)
    : importedAt;
  const decidedAt = isNonEmptyString(record["decidedAt"])
    ? (record["decidedAt"] as string)
    : null;

  const conversionRaw = record["conversion"];
  let conversion: ReviewConversionRecord | null = null;
  if (
    typeof conversionRaw === "object" &&
    conversionRaw !== null &&
    isNonEmptyString((conversionRaw as Record<string, unknown>)["noteId"]) &&
    isNonEmptyString((conversionRaw as Record<string, unknown>)["noteFolder"])
  ) {
    const conversionRecord = conversionRaw as Record<string, unknown>;
    const noteKindRaw = conversionRecord["noteKind"];
    conversion = {
      noteId: conversionRecord["noteId"] as string,
      noteFolder: conversionRecord["noteFolder"] as string,
      noteKind: noteKindRaw === "todo" ? "todo" : "note",
      convertedAt: isNonEmptyString(conversionRecord["convertedAt"])
        ? (conversionRecord["convertedAt"] as string)
        : importedAt,
      preexisting: conversionRecord["preexisting"] === true,
    };
  }

  return {
    sourceKey,
    importedAt,
    // 옛 저장 파일에는 origin/reviewReason이 없다 — source에서 유도해 채운다(마이그레이션 불필요).
    origin: toReviewOrigin(sourceRecord["source"]),
    reviewReason:
      typeof record["reviewReason"] === "string" ? record["reviewReason"] : "",
    source: {
      source: sourceRecord["source"],
      sourceId: sourceRecord["sourceId"],
      title: sourceRecord["title"],
      safeContent:
        typeof sourceRecord["safeContent"] === "string" ? sourceRecord["safeContent"] : "",
      ...(isNonEmptyString(sourceRecord["projectName"])
        ? { projectName: sourceRecord["projectName"] as string }
        : {}),
      ...(isNonEmptyString(sourceRecord["safetyAction"])
        ? { safetyAction: sourceRecord["safetyAction"] as string }
        : {}),
    },
    suggestion: {
      classification: suggestedClassification,
      reason:
        typeof suggestionRecord["reason"] === "string" ? suggestionRecord["reason"] : "",
      confidence: normalizeConfidence(Number(suggestionRecord["confidence"] ?? 0)),
    },
    userClassification,
    status,
    decidedAt: status === "pending" ? null : decidedAt,
    updatedAt,
    conversion,
  };
}

function importedAtFallback(): string {
  return new Date(0).toISOString();
}

/**
 * 저장된 검토 큐 파일 내용을 파싱한다.
 * 구조가 깨졌으면 null(파일 통째로 무시), 카드 1개가 깨졌으면 그 카드만 버린다.
 */
export function parseReviewQueueFile(text: string): ReviewQueueFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record["schemaVersion"] !== REVIEW_QUEUE_SCHEMA_VERSION) return null;
  if (!Array.isArray(record["cards"])) return null;

  const cards: ReviewCard[] = [];
  const seenKeys = new Set<string>();
  for (const entry of record["cards"]) {
    const card = parseReviewCard(entry);
    if (!card || seenKeys.has(card.sourceKey)) continue;
    seenKeys.add(card.sourceKey);
    cards.push(card);
  }
  return { schemaVersion: REVIEW_QUEUE_SCHEMA_VERSION, cards };
}

export function serializeReviewQueueFile(file: ReviewQueueFile): string {
  return JSON.stringify(file, null, 2);
}

export interface ReviewImportSummary {
  readonly addedCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
}

export interface ReviewImportResult {
  readonly cards: readonly ReviewCard[];
  readonly summary: ReviewImportSummary;
}

/**
 * 재가져오기 중복 방지 계약 (설계 §5):
 * 같은 sourceKey가 오면 새 카드를 만들지 않고 원본 미러/제안만 갱신하고,
 * 사용자 분류(userClassification)·상태(status/decidedAt)는 그대로 둔다.
 * 기존 순서는 유지되고 새 카드는 스냅샷 순서대로 뒤에 붙는다.
 */
export function mergeSnapshotCards(
  existing: readonly ReviewCard[],
  incoming: readonly ReviewCard[],
): ReviewImportResult {
  const byKey = new Map<string, ReviewCard>();
  for (const card of existing) {
    byKey.set(card.sourceKey, card);
  }

  const added: ReviewCard[] = [];
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const next of incoming) {
    const previous = byKey.get(next.sourceKey);
    if (!previous) {
      byKey.set(next.sourceKey, next);
      added.push(next);
      continue;
    }

    const merged: ReviewCard = {
      ...next,
      importedAt: previous.importedAt,
      userClassification: previous.userClassification,
      status: previous.status,
      decidedAt: previous.decidedAt,
      updatedAt: previous.updatedAt,
      conversion: previous.conversion,
    };
    const changed =
      JSON.stringify(merged.source) !== JSON.stringify(previous.source) ||
      JSON.stringify(merged.suggestion) !== JSON.stringify(previous.suggestion) ||
      merged.reviewReason !== previous.reviewReason;
    if (changed) {
      updatedCount += 1;
    } else {
      unchangedCount += 1;
    }
    byKey.set(next.sourceKey, merged);
  }

  // 기존 카드는 원래 순서, 새 카드는 스냅샷 순서
  const existingKeys = new Set(existing.map((card) => card.sourceKey));
  const keptOrder = existing.map((card) => byKey.get(card.sourceKey) ?? card);
  const cards = [...keptOrder, ...added.filter((card) => !existingKeys.has(card.sourceKey))];

  return {
    cards,
    summary: { addedCount: added.length, updatedCount, unchangedCount },
  };
}

/** 화면에 표시하는 분류. 사용자 선택이 없으면 제안을 따른다. */
export function displayClassification(card: ReviewCard): ReviewClassification {
  return card.userClassification ?? card.suggestion.classification;
}

/** 사용자가 분류를 고른다. null이면 제안 분류로 되돌린다. */
export function applyUserClassification(
  card: ReviewCard,
  classification: ReviewClassification | null,
  now: string,
): ReviewCard {
  return { ...card, userClassification: classification, updatedAt: now };
}

/** 승인/나중에 보기/대기로 되돌리기. */
export function applyCardStatus(
  card: ReviewCard,
  status: ReviewCardStatus,
  now: string,
): ReviewCard {
  return {
    ...card,
    status,
    decidedAt: status === "pending" ? null : now,
    updatedAt: now,
  };
}

/** 확신 정도를 사람이 읽는 단계로. 0.75 이상 높음, 0.5 이상 중간, 미만 낮음. */
export function confidenceLabel(confidence: number): "높음" | "중간" | "낮음" {
  if (confidence >= 0.75) return "높음";
  if (confidence >= 0.5) return "중간";
  return "낮음";
}

/* ── 2차: 승인 항목 노트/투두 변환 규칙 ──────────────────────────────────── */

/** 카드의 표시 분류에 해당하는 변환 대상. 변환 비대상 분류면 null. */
export function noteTargetForCard(
  card: ReviewCard,
): { folder: string; kind: "todo" | "note"; noteId: string } | null {
  const classification = displayClassification(card);
  const target =
    CLASSIFICATION_NOTE_TARGETS[classification as ConvertibleClassification] ?? null;
  if (!target) return null;
  return { ...target, noteId: toReviewNoteId(card.source.source, card.source.sourceId) };
}

/**
 * 앱 캡처 입력 → 검토 스냅샷 항목 (TICK-P0-007 3차).
 * Rust가 분류 7종을 이미 검증하지만, 알 수 없는 값이 오면 수동 검토로 fail-closed.
 */
export function buildCaptureSnapshotItem(
  input: { title: string; content: string },
  suggestion: { classification: string; reason: string; confidence: number },
  sourceId: string,
): ReviewSnapshotItem {
  const classification = normalizeClassification(suggestion.classification) ?? "수동 검토";
  return {
    source: REVIEW_CAPTURE_SOURCE,
    sourceId,
    title: input.title.trim(),
    safeContent: input.content.trim(),
    suggestion: {
      classification,
      reason: typeof suggestion.reason === "string" ? suggestion.reason : "",
      confidence: normalizeConfidence(suggestion.confidence),
    },
  };
}

/** 변환 가능 = 승인 상태 + 변환 가능 분류 + 아직 변환하지 않음. */
export function isConvertibleCard(card: ReviewCard): boolean {
  return card.origin !== "vault-note" && card.status === "approved" && card.conversion === null && noteTargetForCard(card) !== null;
}

/** 변환 기록을 카드에 반영한다. 변환 철회(되돌리기)는 없다. */
export function applyConversion(
  card: ReviewCard,
  conversion: ReviewConversionRecord,
  now: string,
): ReviewCard {
  return { ...card, conversion, updatedAt: now };
}
