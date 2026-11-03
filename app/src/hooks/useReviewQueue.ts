import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReviewQueueOperations } from "../lib/review-queue/operations";
import { tauriReviewQueueStore } from "../lib/review-queue/store";
import { ReviewQueueSession } from "../lib/review-queue/session";
import {
  buildCaptureSnapshotItem,
  isConvertibleCard,
  noteTargetForCard,
  toSourceKey,
} from "../lib/review-queue/rules";
import type { ReviewImportResult } from "../lib/review-queue/rules";
import type {
  ReviewCard,
  ReviewCardStatus,
  ReviewClassification,
  ReviewConversionRecord,
  ReviewSnapshotItem,
} from "../lib/review-queue/types";
import { toErrorMessage } from "../lib/error-utils";
import { buildMarkdownExportDocument } from "../lib/markdown-export";
import { classifyReviewItem, createMarkdownFileIfAbsent } from "../lib/tauri-commands";
import { generateId } from "../lib/id";

/**
 * TickTick 검토 큐 훅 (TICK-P0-007 검토 큐 1차 + 2차 변환)
 *
 * 상태는 항상 디스크(`{vault}/.ticksidian-review-queue/queue.json`)가 원본이고
 * hook은 그 조회/변경 결과를 반영한다. 어떤 실패도 throw하지 않고 error 상태로만
 * 노출해 노트/투두 편집 흐름을 막지 않는다(다른 IO 훅과 같은 원칙).
 *
 * 2차 변환: 승인 카드를 노트/투두 파일로 만들고 기록을 큐에 남긴다.
 * 설계: docs/waterfall/03-상세설계/TickTick-검토-큐-2차-변환.md
 */
export interface ReviewConversionSummary {
  readonly createdCount: number;
  readonly preexistingCount: number;
  readonly failedCount: number;
}

export interface UseReviewQueueOptions {
  /** 변환으로 노트 파일이 생겼을 때 호출(노트 목록 재스캔용). */
  readonly onNotesChanged?: () => void;
}

export interface UseReviewQueueReturn {
  readonly cards: readonly ReviewCard[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly importSnapshot: (
    items: readonly ReviewSnapshotItem[],
  ) => Promise<ReviewImportResult | null>;
  readonly setClassification: (
    sourceKey: string,
    classification: ReviewClassification | null,
  ) => Promise<void>;
  readonly setCardStatus: (sourceKey: string, status: ReviewCardStatus) => Promise<void>;
  readonly setCardsStatus: (sourceKeys: readonly string[], status: ReviewCardStatus) => Promise<void>;
  readonly convertCard: (sourceKey: string) => Promise<ReviewConversionRecord | null>;
  readonly convertApprovedCards: () => Promise<ReviewConversionSummary | null>;
  /** 캡처 입력 → Gemini 분류 → 대기 카드 추가 (TICK-P0-007 3차). */
  readonly captureItem: (
    title: string,
    content: string,
  ) => Promise<ReviewCard | null>;
}

/** 카드 → 노트 본문. 제목과 안전 가공된 원문만 남긴다(2026-08-15 [kyle] 결정: 이관은 1회성이라 출처 표기는 남기지 않는다). */
function buildReviewNoteBody(card: ReviewCard): string {
  const content = card.source.safeContent.trim();
  if (content.length === 0) {
    return `# ${card.source.title}\n`;
  }
  return `# ${card.source.title}\n\n${content}\n`;
}

export function useReviewQueue(
  vaultPath: string | null,
  options: UseReviewQueueOptions = {},
): UseReviewQueueReturn {
  const [cards, setCards] = useState<readonly ReviewCard[]>([]);
  const [loading, setLoading] = useState(vaultPath !== null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onNotesChangedRef = useRef(options.onNotesChanged);
  onNotesChangedRef.current = options.onNotesChanged;

  const session = useMemo(() => new ReviewQueueSession(vaultPath, tauriReviewQueueStore), [vaultPath]);
  const operations = useMemo(() => createReviewQueueOperations({ store: session.store }), [session]);

  // 볼트가 바뀌면 큐를 다시 불러온다. stale 업데이트 방지는 cancelled 가드로.
  useEffect(() => {
    session.activate();
    setCards([]);
    setError(null);
    setBusy(false);
    if (!vaultPath) {
      setCards([]);
      setLoading(false);
      return () => session.cancel();
    }
    let cancelled = false;
    setLoading(true);
    operations
      .loadQueue()
      .then((loaded) => {
        if (cancelled || !session.isActive()) return;
        setCards(loaded);
        setError(null);
      })
      .catch((e) => {
        if (cancelled || !session.isActive()) return;
        console.error("[useReviewQueue] load failed:", e);
        setError(toErrorMessage(e, "검토 큐를 불러오지 못했습니다."));
      })
      .finally(() => {
        if (cancelled || !session.isActive()) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
      session.cancel();
    };
  }, [vaultPath, operations, session]);

  // 변경 작업 동시 실행 방지(파일 read-modify-write 경합 최소화)
  const runExclusive = useCallback(
    async <T extends { cards: readonly ReviewCard[] }>(action: () => Promise<T>): Promise<T | null> => {
      if (!session.start()) return null;
      setBusy(true);
      try {
        const result = await action();
        session.assertActive();
        setCards(result.cards);
        setError(null);
        return result;
      } catch (e) {
        if (!session.isActive()) return null;
        console.error("[useReviewQueue] mutation failed:", e);
        setError(toErrorMessage(e, "검토 큐 변경을 저장하지 못했습니다."));
        return null;
      } finally {
        session.finish();
        if (session.isActive()) setBusy(false);
      }
    },
    [session],
  );

  const importSnapshot = useCallback(
    (items: readonly ReviewSnapshotItem[]) =>
      runExclusive(() => operations.importSnapshot(items)),
    [operations, runExclusive],
  );

  const setClassification = useCallback(
    async (sourceKey: string, classification: ReviewClassification | null) => {
      await runExclusive(async () => ({
        cards: await operations.setClassification(sourceKey, classification),
      }));
    },
    [operations, runExclusive],
  );

  const setCardStatus = useCallback(
    async (sourceKey: string, status: ReviewCardStatus) => {
      await runExclusive(async () => ({
        cards: await operations.setCardStatus(sourceKey, status),
      }));
    },
    [operations, runExclusive],
  );

  const setCardsStatus = useCallback(
    async (sourceKeys: readonly string[], status: ReviewCardStatus) => {
      if (sourceKeys.length === 0) return;
      await runExclusive(async () => ({
        cards: await operations.setCardsStatus(sourceKeys, status),
      }));
    },
    [operations, runExclusive],
  );

  /**
   * 카드 1개 변환. 규칙 검증 → 파일 존재 확인 → (없으면) 생성 → 큐에 기록.
   * 파일이 이미 있으면 덮어쓰지 않고 preexisting으로 기록한다.
   * 파일 생성까지 성공했는데 큐 기록이 실패하면, 다음 시도에서 존재 확인이
   * preexisting으로 잡아 큐와 실제 상태가 수렴한다(설계 §6).
   */
  const convertCardInternal = useCallback(
    async (sourceKey: string): Promise<ReviewConversionRecord> => {
      session.assertActive();
      const card = cards.find((entry) => entry.sourceKey === sourceKey);
      if (!card || !isConvertibleCard(card)) {
        throw new Error("변환할 수 없는 카드입니다. 승인 상태와 변환 가능 분류를 확인하세요.");
      }
      const target = noteTargetForCard(card);
      if (!target) throw new Error("변환할 수 없는 분류입니다.");

      const timestamp = Date.now();
      const content = buildMarkdownExportDocument({
        noteId: target.noteId,
        title: card.source.title,
        createdAt: timestamp,
        updatedAt: timestamp,
        exportedAt: timestamp,
        markdownBody: buildReviewNoteBody(card),
        ...(target.kind === "todo" ? { type: "todo" as const, done: false } : {}),
      });
      const path = `${session.vaultPath}/${target.folder}/${target.noteId}.md`;
      const created = await session.checked(() => createMarkdownFileIfAbsent(path, content));
      const preexisting = !created;

      const record: ReviewConversionRecord = {
        noteId: target.noteId,
        noteFolder: target.folder,
        noteKind: target.kind,
        convertedAt: new Date().toISOString(),
        preexisting,
      };
      const next = await operations.applyConversion(sourceKey, record);
      session.assertActive();
      setCards(next);
      if (!preexisting) onNotesChangedRef.current?.();
      return record;
    },
    [cards, operations, session],
  );

  const convertCard = useCallback(
    async (sourceKey: string): Promise<ReviewConversionRecord | null> => {
      if (!session.start()) return null;
      setBusy(true);
      try {
        const record = await convertCardInternal(sourceKey);
        session.assertActive();
        setError(null);
        return record;
      } catch (e) {
        if (!session.isActive()) return null;
        console.error("[useReviewQueue] convert failed:", e);
        setError(toErrorMessage(e, "검토 항목을 노트로 변환하지 못했습니다."));
        return null;
      } finally {
        session.finish();
        if (session.isActive()) setBusy(false);
      }
    },
    [convertCardInternal, session],
  );

  /** 승인 + 미변환 + 변환 가능 분류 카드를 순서대로 변환한다. 개별 실패는 건너뛴다. */
  const convertApprovedCards = useCallback(async (): Promise<ReviewConversionSummary | null> => {
    if (!session.start()) return null;
    setBusy(true);
    const summary = { createdCount: 0, preexistingCount: 0, failedCount: 0 };
    try {
      for (const card of cards) {
        if (!session.isActive()) return null;
        if (!isConvertibleCard(card)) continue;
        try {
          const record = await convertCardInternal(card.sourceKey);
          if (record.preexisting) summary.preexistingCount += 1;
          else summary.createdCount += 1;
        } catch (e) {
          if (!session.isActive()) return null;
          summary.failedCount += 1;
          console.error("[useReviewQueue] bulk convert failed:", card.sourceKey, e);
        }
      }
      setError(null);
      return summary;
    } finally {
      session.finish();
      if (session.isActive()) setBusy(false);
    }
  }, [cards, convertCardInternal, session]);

  /**
   * 캡처 입력 1건: Gemini 분류 → 대기 카드 추가. 분류 실패 시 카드를 만들지 않고
   * 에러만 노출한다(fail-closed — 사용자가 다시 시도할 수 있다).
   */
  const captureItem = useCallback(
    async (title: string, content: string): Promise<ReviewCard | null> => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle || !session.start()) return null;
      setBusy(true);
      try {
        const classification = await session.checked(() => classifyReviewItem(trimmedTitle, content.trim()));
        const sourceId = generateId();
        const item = buildCaptureSnapshotItem(
          { title: trimmedTitle, content },
          classification,
          sourceId,
        );
        const result = await operations.importSnapshot([item]);
        session.assertActive();
        setCards(result.cards);
        setError(null);
        const key = toSourceKey(item.source, item.sourceId);
        return result.cards.find((card) => card.sourceKey === key) ?? null;
      } catch (e) {
        if (!session.isActive()) return null;
        console.error("[useReviewQueue] capture failed:", e);
        setError(toErrorMessage(e, "항목 분류에 실패했습니다. 잠시 후 다시 시도하세요."));
        return null;
      } finally {
        session.finish();
        if (session.isActive()) setBusy(false);
      }
    },
    [operations, session],
  );

  return {
    cards,
    loading,
    error,
    busy,
    importSnapshot,
    setClassification,
    setCardStatus,
    setCardsStatus,
    convertCard,
    convertApprovedCards,
    captureItem,
  };
}
