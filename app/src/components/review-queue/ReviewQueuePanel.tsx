import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { UseReviewQueueReturn } from "../../hooks/useReviewQueue";
import {
  REVIEW_SNAPSHOT_FIXTURE,
  REVIEW_SNAPSHOT_FIXTURE_META,
} from "../../lib/review-queue/fixture-snapshot";
import type { ReviewCardStatus } from "../../lib/review-queue/types";
import {
  displayClassification,
  isConvertibleCard,
} from "../../lib/review-queue/rules";
import {
  pickVaultNoteCandidates,
  VAULT_NOTE_DAILY_LIMIT,
} from "../../lib/review-queue/vault-note-candidates";
import type { NoteListItem, FolderNode } from "../../types/note";
import { ReviewCardItem } from "./ReviewCardItem";
import { InboxOrganizer } from "./InboxOrganizer";

type ReviewFilter = "pending" | "approved" | "later" | "all";

const FILTER_LABELS: Record<ReviewFilter, string> = {
  pending: "대기",
  approved: "승인",
  later: "나중에",
  all: "전체",
};

interface ReviewQueuePanelProps {
  vaultPath: string;
  folders: readonly FolderNode[];
  onNotesMoved: () => Promise<void>;
  selectedNoteId?: string | null;
  selectionSignal?: number;
  onSelectCandidate?: (path: string) => void;
  hook: UseReviewQueueReturn;
  onClose: () => void;
  /**
   * 볼트 노트 목록 — "내 노트 검토" 후보 선정에 쓴다(2026-08-30 단계 2).
   * 패널은 노트를 수정하지 않고, 후보 선정과 (App이 내려준) 보관 이동 콜백만 쓴다.
   */
  notes?: readonly NoteListItem[];
  /** vault-note 카드의 "보관으로 이동". App의 기존 moveNote 경로를 재사용한다. */
  onArchiveNote?: (noteId: string) => Promise<boolean>;
}

export function ReviewQueuePanel(props: ReviewQueuePanelProps) {
  const [tab, setTab] = useState<'inbox' | 'legacy'>('inbox');
  return <div className="flex h-full min-w-0 flex-col bg-white dark:bg-zinc-900">
    <nav aria-label="정리 화면 선택" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 pt-2 dark:border-zinc-700">
      {([['inbox', '기본함 AI 정리'], ['legacy', '외부 가져오기·기존 검토']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={`min-h-11 border-b-2 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tab === value ? 'border-gray-800 text-gray-900 dark:border-zinc-100 dark:text-zinc-100' : 'border-transparent text-gray-500 dark:text-zinc-400'}`}>{label}</button>)}
      <button type="button" aria-label="AI 정리 닫기" onClick={props.onClose} className="ml-auto min-h-11 min-w-11 text-gray-500 focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400">닫기</button>
    </nav>
    <div className="min-h-0 flex-1 overflow-auto">
      {tab === 'inbox' ? <InboxOrganizer key={`${props.vaultPath}:${props.selectedNoteId}:${props.selectionSignal}`} vaultPath={props.vaultPath} notes={props.notes ?? []} folders={props.folders} onMoved={props.onNotesMoved} selectedNoteId={props.selectedNoteId} selectionSignal={props.selectionSignal} onSelectCandidate={props.onSelectCandidate} /> : <LegacyReviewQueuePanel {...props} />}
    </div>
  </div>;
}

function LegacyReviewQueuePanel({ hook, onClose, notes, onArchiveNote }: ReviewQueuePanelProps) {
  const {
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
  } = hook;
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureContent, setCaptureContent] = useState("");
  // 퀵키 포커스와 다중 선택은 화면 상태다. 디스크에 저장하지 않는다.
  const [focusedSourceKey, setFocusedSourceKey] = useState<string | null>(null);
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<string[]>([]);
  const archiveLock = useRef(false);
  const [archiving, setArchiving] = useState(false);
  const handleArchive = async (sourceKey: string) => {
    if (!onArchiveNote || busy || archiveLock.current) return;
    const card = cards.find(item => item.sourceKey === sourceKey);
    const note = notes?.find(item => item.filePath === card?.source.sourceId);
    if (!note) return;
    archiveLock.current = true;
    setArchiving(true);
    try {
      if (await onArchiveNote(note.id)) await setCardStatus(sourceKey, 'approved');
    } finally {
      archiveLock.current = false;
      setArchiving(false);
    }
  };

  const counts = useMemo(() => {
    const result = { pending: 0, approved: 0, later: 0 } as Record<ReviewCardStatus, number>;
    let converted = 0;
    for (const card of cards) {
      result[card.status] += 1;
      if (card.conversion) converted += 1;
    }
    return { ...result, converted };
  }, [cards]);

  // 검토 진행률(2026-08-30 단계 1): (승인+나중에)/전체. 큐에 "끝"이 보이게 한다.
  const progressPercent = useMemo(() => {
    if (cards.length === 0) return 0;
    return Math.round(((counts.approved + counts.later) / cards.length) * 100);
  }, [cards.length, counts.approved, counts.later]);

  const convertibleCount = useMemo(
    () => cards.filter((card) => isConvertibleCard(card)).length,
    [cards],
  );

  const filteredCards = useMemo(() => {
    if (filter === "all") return cards;
    return cards.filter((card) => card.status === filter);
  }, [cards, filter]);

  const selectedKeySet = useMemo(() => new Set(selectedSourceKeys), [selectedSourceKeys]);

  const toggleSelected = (sourceKey: string) => {
    setSelectedSourceKeys((prev) =>
      prev.includes(sourceKey) ? prev.filter((key) => key !== sourceKey) : [...prev, sourceKey],
    );
  };

  const handleBulkStatus = async (status: ReviewCardStatus) => {
    if (selectedSourceKeys.length === 0) return;
    await setCardsStatus(selectedSourceKeys, status);
    setSelectedSourceKeys([]);
  };

  // 입력 요소 안에서 누른 키는 캡처 폼/분류 select가 쓸 수 있게 그대로 둔다.
  const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };

  // 검토 큐 영역 안에서만 동작한다(전역 단축키가 아니다).
  // Enter/L은 카드에 포커스가 있을 때만 승인한다 — 버튼 위 Enter는 그 버튼의 역할을 존중한다.
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return;
    if (filteredCards.length === 0) return;
    const key = event.key.toLowerCase();
    const currentIndex = filteredCards.findIndex((card) => card.sourceKey === focusedSourceKey);
    const targetIsCard =
      event.target instanceof HTMLElement &&
      event.target.closest("article[data-review-source-key]") !== null;

    if (key === "j") {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, filteredCards.length - 1);
      setFocusedSourceKey(filteredCards[nextIndex].sourceKey);
    } else if (key === "k") {
      event.preventDefault();
      const nextIndex =
        currentIndex < 0 ? filteredCards.length - 1 : Math.max(currentIndex - 1, 0);
      setFocusedSourceKey(filteredCards[nextIndex].sourceKey);
    } else if ((event.key === "Enter" || key === "l") && targetIsCard) {
      if (focusedSourceKey == null || busy) return;
      const card = filteredCards.find((item) => item.sourceKey === focusedSourceKey);
      if (!card) return;
      event.preventDefault();
      void setCardStatus(focusedSourceKey, "approved");
    }
  };

  const handleImport = async () => {
    setImportMessage("가져오는 중…");
    const result = await importSnapshot(REVIEW_SNAPSHOT_FIXTURE);
    if (!result) return;
    const { addedCount, updatedCount, unchangedCount } = result.summary;
    setImportMessage(
      `가져오기 완료: 추가 ${addedCount}개, 갱신 ${updatedCount}개, 동일 ${unchangedCount}개 (총 ${result.cards.length}개)`,
    );
  };

  const handleConvertAll = async () => {
    setImportMessage("변환하는 중…");
    const summary = await convertApprovedCards();
    if (!summary) return;
    setImportMessage(
      `변환 완료: 생성 ${summary.createdCount}개, 이미 있음 ${summary.preexistingCount}개, 실패 ${summary.failedCount}개`,
    );
  };

  const handleCapture = async () => {
    const title = captureTitle;
    setImportMessage("AI 분류 중…");
    const card = await captureItem(title, captureContent);
    if (!card) return;
    setCaptureTitle("");
    setCaptureContent("");
    setFilter("pending");
    setImportMessage(
      `추가됨: "${card.source.title}" → 제안 ${displayClassification(card)} (대기 카드)`,
    );
  };

  // "내 노트 검토"(2026-08-30 단계 2): 볼트에서 후보를 뽑아 큐에 들인다.
  // 이미 큐에 있는 카드는 후보에서 제외되므로 반복해서 눌러도 같은 노트가 재등장하지 않는다.
  const vaultNoteCount = useMemo(() => {
    if (!notes) return 0;
    const existingKeys = new Set(cards.map((card) => card.sourceKey));
    return pickVaultNoteCandidates(notes, existingKeys).length;
  }, [notes, cards]);

  const handleImportVaultNotes = async () => {
    if (!notes) return;
    setImportMessage("내 노트 후보를 담는 중…");
    const existingKeys = new Set(cards.map((card) => card.sourceKey));
    const candidates = pickVaultNoteCandidates(notes, existingKeys);
    if (candidates.length === 0) {
      setImportMessage("지금 새로 검토할 노트가 없습니다. 좋은 상태예요!");
      return;
    }
    const result = await importSnapshot(candidates);
    if (!result) return;
    setImportMessage(
      `내 노트 ${result.summary.addedCount}장을 검토 큐에 담았습니다 (하루 최대 ${VAULT_NOTE_DAILY_LIMIT}장).`,
    );
  };

  return (
    <div
      className="flex h-full flex-col bg-gray-50 dark:bg-zinc-900"
      role="region"
      aria-label="TickTick 검토 큐"
      onKeyDown={handlePanelKeyDown}
    >
      {/* 헤더 */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">TickTick 검토 큐</h2>
          {cards.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-zinc-500">
              승인 {counts.approved} · 나중에 {counts.later} · 대기 {counts.pending} · 변환됨 {counts.converted} / {cards.length}
            </span>
          )}
          <div className="ms-auto flex items-center gap-2">
            {convertibleCount > 0 && (
              <button
                type="button"
                onClick={() => void handleConvertAll()}
                disabled={busy || loading}
                className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
                title="승인 + 변환 가능 분류 카드 전부를 notes 폴더의 노트/투두로 만듭니다"
              >
                승인 항목 일괄 변환 ({convertibleCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={busy || loading}
              // 빈 상태에서는 아래 컨텍스트 CTA('스냅샷 N개 가져오기')만 보여준다.
              // 같은 동작의 버튼이 두 개 함께 뜨는 이중 진입점을 없앤다(2026-08-18 TICK-UX-008).
              hidden={cards.length === 0}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
              title={`읽기 전용 스냅샷 ${REVIEW_SNAPSHOT_FIXTURE_META.itemCount}개를 가져온다. TickTick 원본은 바뀌지 않는다.`}
            >
              스냅샷 가져오기
            </button>
            {notes && (
              <button
                type="button"
                onClick={() => void handleImportVaultNotes()}
                disabled={busy || loading}
                className="rounded-md border border-teal-600 bg-transparent px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-900/30"
                title={`볼트에서 오래된 노트·임시성 노트를 최대 ${VAULT_NOTE_DAILY_LIMIT}장 골라 검토 큐에 담습니다. 원본은 바뀌지 않습니다.`}
              >
                내 노트 검토({vaultNoteCount})
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              title="검토 큐 닫기"
              aria-label="검토 큐 닫기"
            >
              ✕
            </button>
          </div>
        </div>

        <p className="mt-1.5 text-xs text-gray-400 dark:text-zinc-500">
          TickTick 원본은 읽기 전용입니다. 이 화면의 분류·승인 기록은 Ticksidian 검토 데이터에만 저장됩니다.
        </p>

        {/* 다중 선택 도구모음: 선택 카드를 한 번에 승인/나중에 보기로 바꾼다. */}
        {cards.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-zinc-500">
              선택 항목 {selectedSourceKeys.length}개
            </span>
            <button
              type="button"
              onClick={() => void handleBulkStatus("approved")}
              disabled={selectedSourceKeys.length === 0 || busy || loading}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              선택 항목 승인
            </button>
            <button
              type="button"
              onClick={() => void handleBulkStatus("later")}
              disabled={selectedSourceKeys.length === 0 || busy || loading}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              선택 항목 나중에 보기
            </button>
            <span className="ms-auto text-xs text-gray-400 dark:text-zinc-500">
              J/K 카드 이동 · Enter/L 승인
            </span>
          </div>
        )}

        {/* 상태 필터 + 진행 표시(2026-08-30 단계 1). "대기 0"이면 검토 완료 상태로 알린다. */}
        <div className="mt-2 flex items-center gap-3" role="group" aria-label="검토 상태 필터">
          <div className="flex gap-1">
            {(Object.keys(FILTER_LABELS) as ReviewFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  filter === key
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : "text-gray-500 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                }`}
              >
                {FILTER_LABELS[key]}
              </button>
            ))}
          </div>
          {cards.length > 0 && (
            <div className="flex min-w-0 flex-1 items-center gap-2" aria-label={`검토 진행률 ${progressPercent}%`}>
              <div
                className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700"
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-teal-500 transition-[width]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {counts.pending === 0 ? (
                <span className="shrink-0 text-xs font-medium text-teal-600 dark:text-teal-300">
                  🎉 검토 완료!
                </span>
              ) : (
                <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-zinc-500">
                  {progressPercent}%
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
        {importMessage && !error && (
          <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400" aria-live="polite">
            {importMessage}
          </p>
        )}

        {/* 캡처 입력: 여기 쓰면 AI가 분류해 대기 카드가 된다 (Ticksidian 안에서 도는 흐름) */}
        <form
          className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            if (captureTitle.trim()) void handleCapture();
          }}
        >
          <input
            type="text"
            value={captureTitle}
            onChange={(e) => setCaptureTitle(e.target.value)}
            disabled={busy || loading}
            autoFocus
            placeholder="새 항목 제목 — 떠오른 생각을 적으면 AI가 분류합니다"
            aria-label="검토 항목 제목 입력"
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
          <textarea
            value={captureContent}
            onChange={(e) => setCaptureContent(e.target.value)}
            disabled={busy || loading}
            placeholder="상세 내용(선택)"
            aria-label="검토 항목 내용 입력"
            rows={2}
            className="min-w-0 flex-1 resize-y rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
          <button
            type="submit"
            disabled={busy || loading || !captureTitle.trim()}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            title="Gemini(gemini-3.8-flash)가 7종으로 분류해 대기 카드를 만듭니다"
          >
            AI 분류 추가
          </button>
        </form>
        {/* 비활성화 사유 힌트 — 버튼이 꺼져 있는 이유를 화면이 설명한다(2026-08-18 TICK-UX-008).
            live region은 항상 마운트해 두고 내용만 바꾼다. 조건부 렌더면 요소가 새로
            생기는 시점의 변경을 스크린리더가 공지하지 못한다(2026-08-18 검수 후속 P3). */}
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500" aria-live="polite">
          {captureTitle.trim().length === 0 && !busy && !loading
            ? "제목을 입력하면 AI 분류 추가를 누를 수 있습니다."
            : ""}
        </p>
      </div>

      {/* 카드 목록 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-zinc-500">
            검토 큐를 불러오는 중…
          </div>
        ) : cards.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <h3 className="mb-2 text-base font-semibold text-gray-700 dark:text-zinc-200">
              가져온 검토 항목이 없습니다
            </h3>
            <p className="mb-4 text-sm leading-relaxed text-gray-500 dark:text-zinc-400">
              읽기 전용으로 추출한 TickTick 스냅샷 {REVIEW_SNAPSHOT_FIXTURE_META.itemCount}개를 가져와
              AI 분류 제안과 이유를 검토할 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={busy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              스냅샷 {REVIEW_SNAPSHOT_FIXTURE_META.itemCount}개 가져오기
            </button>
          </div>
        ) : filteredCards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-zinc-500">
            <p className="text-sm">{FILTER_LABELS[filter]} 상태의 항목이 없습니다</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {filteredCards.map((card) => (
              <ReviewCardItem
                key={card.sourceKey}
                card={card}
                busy={busy || archiving}
                focused={card.sourceKey === focusedSourceKey}
                selected={selectedKeySet.has(card.sourceKey)}
                onFocusCard={() => setFocusedSourceKey(card.sourceKey)}
                onToggleSelected={() => toggleSelected(card.sourceKey)}
                onSetClassification={(sourceKey, classification) =>
                  void setClassification(sourceKey, classification)
                }
                onSetStatus={(sourceKey, status) => void setCardStatus(sourceKey, status)}
                onConvert={(sourceKey) => void convertCard(sourceKey)}
                onArchive={onArchiveNote ? sourceKey => void handleArchive(sourceKey) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
