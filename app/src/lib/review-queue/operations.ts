/**
 * 검토 큐 IO 조립 (TICK-P0-007 검토 큐 UI 1차)
 *
 * store(어댑터) 위에 순수 규칙(rules)을 얹어 읽기/가져오기/분류 변경/상태 변경을 제공한다.
 * 저장은 `{vault}/.ticksidian-review-queue/queue.json` 한 파일이다.
 * 검토 데이터는 파생 데이터라 원자적 쓰기 계약(.md 원본)의 대상이 아니며,
 * 손상 시 빈 큐로 시작해도 원본 손실이 없다.
 */

import {
  REVIEW_QUEUE_DIR,
  applyCardStatus,
  applyConversion,
  applyUserClassification,
  mergeSnapshotCards,
  normalizeSnapshotItem,
  parseReviewQueueFile,
  resolveReviewQueueFilePath,
  serializeReviewQueueFile,
} from "./rules.ts";
import type { ReviewImportResult } from "./rules.ts";
import type { ReviewQueueStore } from "./store.ts";
import type {
  ReviewCard,
  ReviewCardStatus,
  ReviewClassification,
  ReviewConversionRecord,
  ReviewQueueFile,
  ReviewSnapshotItem,
} from "./types.ts";
import { isExpectedIoError } from "../error-utils.ts";

export interface ReviewQueueRuntime {
  readonly now: () => string;
}

export interface ReviewQueueOperations {
  readonly loadQueue: () => Promise<readonly ReviewCard[]>;
  readonly importSnapshot: (
    items: readonly ReviewSnapshotItem[],
  ) => Promise<ReviewImportResult>;
  readonly setClassification: (
    sourceKey: string,
    classification: ReviewClassification | null,
  ) => Promise<readonly ReviewCard[]>;
  readonly setCardStatus: (
    sourceKey: string,
    status: ReviewCardStatus,
  ) => Promise<readonly ReviewCard[]>;
  readonly setCardsStatus: (
    sourceKeys: readonly string[],
    status: ReviewCardStatus,
  ) => Promise<readonly ReviewCard[]>;
  /** 2차: 변환 기록을 큐에 반영해 저장한다(파일 생성은 훅이 맡는다). */
  readonly applyConversion: (
    sourceKey: string,
    conversion: ReviewConversionRecord,
  ) => Promise<readonly ReviewCard[]>;
}

export interface ReviewQueueOperationsOptions {
  readonly store: ReviewQueueStore;
  readonly runtime?: ReviewQueueRuntime;
}

const defaultRuntime: ReviewQueueRuntime = {
  now: () => new Date().toISOString(),
};



export function createReviewQueueOperations(
  options: ReviewQueueOperationsOptions,
): ReviewQueueOperations {
  const store = options.store;
  const runtime = options.runtime ?? defaultRuntime;

  async function readCurrentCards(): Promise<readonly ReviewCard[]> {
    const filePath = resolveReviewQueueFilePath(store.getVaultPath());
    let text: string;
    try {
      text = await store.readTextFile(filePath);
    } catch (error) {
      if (isExpectedIoError(error)) {
        return []; // 아직 없는 파일 = 빈 큐 (첫 실행)
      }
      throw error;
    }
    const file = parseReviewQueueFile(text);
    return file ? file.cards : []; // 손상 파일 = 빈 큐로 재시작
  }

  async function persist(cards: readonly ReviewCard[]): Promise<void> {
    const filePath = resolveReviewQueueFilePath(store.getVaultPath());
    await store.createDirectory(`${store.getVaultPath()}/${REVIEW_QUEUE_DIR}`, true);
    const file: ReviewQueueFile = {
      schemaVersion: 1,
      cards,
    };
    await store.writeTextFile(filePath, serializeReviewQueueFile(file));
  }

  return {
    loadQueue: async () => readCurrentCards(),

    importSnapshot: async (items) => {
      const importedAt = runtime.now();
      const incoming = items
        .map((item) => normalizeSnapshotItem(item, importedAt))
        .filter((card): card is ReviewCard => card !== null);
      const existing = await readCurrentCards();
      const result = mergeSnapshotCards(existing, incoming);
      await persist(result.cards);
      return result;
    },

    setClassification: async (sourceKey, classification) => {
      const now = runtime.now();
      const cards = await readCurrentCards();
      const next = cards.map((card) =>
        card.sourceKey === sourceKey ? applyUserClassification(card, classification, now) : card,
      );
      await persist(next);
      return next;
    },

    setCardStatus: async (sourceKey, status) => {
      const now = runtime.now();
      const cards = await readCurrentCards();
      const next = cards.map((card) =>
        card.sourceKey === sourceKey ? applyCardStatus(card, status, now) : card,
      );
      await persist(next);
      return next;
    },

    setCardsStatus: async (sourceKeys, status) => {
      const wanted = new Set(sourceKeys);
      const now = runtime.now();
      const cards = await readCurrentCards();
      const next = cards.map((card) =>
        wanted.has(card.sourceKey) ? applyCardStatus(card, status, now) : card,
      );
      await persist(next);
      return next;
    },

    applyConversion: async (sourceKey, conversion) => {
      const now = runtime.now();
      const cards = await readCurrentCards();
      const next = cards.map((card) =>
        card.sourceKey === sourceKey ? applyConversion(card, conversion, now) : card,
      );
      await persist(next);
      return next;
    },
  };
}
