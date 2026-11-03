import { useEffect, useRef, useState } from "react";
import { REVIEW_CLASSIFICATIONS } from "../../lib/review-queue/types";
import type {
  ReviewCard,
  ReviewCardStatus,
  ReviewClassification,
} from "../../lib/review-queue/types";
import { confidenceLabel, displayClassification, isConvertibleCard } from "../../lib/review-queue/rules";

/* ── 분류 배지 색 (design-rules 상태 배지 토큰, 동적 클래스 금지라 정적 맵) ── */

const CLASSIFICATION_BADGE_STYLES: Record<ReviewClassification, string> = {
  실행: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  아이디어: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  참고: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "일반 메모": "bg-gray-100 text-gray-700 dark:bg-zinc-700 dark:text-zinc-300",
  "중복 의심": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "정리 후보": "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "수동 검토": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function ClassificationBadge({ value }: { value: ReviewClassification }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${CLASSIFICATION_BADGE_STYLES[value]}`}
    >
      {value}
    </span>
  );
}

const STATUS_LABELS: Record<ReviewCardStatus, string> = {
  pending: "대기",
  approved: "승인",
  later: "나중에",
};

const STATUS_BADGE_STYLES: Record<ReviewCardStatus, string> = {
  pending: "bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-zinc-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  later: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
};

/* ── 검토 카드 1개 ── */

interface ReviewCardItemProps {
  card: ReviewCard;
  busy: boolean;
  /** 퀵키(J/K) 포커스 대상 카드인지. */
  focused: boolean;
  /** 다중 선택 체크박스 상태. */
  selected: boolean;
  onFocusCard: () => void;
  onToggleSelected: () => void;
  onSetClassification: (sourceKey: string, classification: ReviewClassification | null) => void;
  onSetStatus: (sourceKey: string, status: ReviewCardStatus) => void;
  onConvert: (sourceKey: string) => void;
  /** vault-note 카드 전용: 원본 노트를 archive 폴더로 옮긴다(2026-08-30 단계 2). */
  onArchive?: (sourceKey: string) => void;
}

export function ReviewCardItem({
  card,
  busy,
  focused,
  selected,
  onFocusCard,
  onToggleSelected,
  onSetClassification,
  onSetStatus,
  onConvert,
  onArchive,
}: ReviewCardItemProps) {
  const [expanded, setExpanded] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const shown = displayClassification(card);
  const manualReviewOnly = card.source.safetyAction === "manual-review-only";
  const confidencePercent = Math.round(card.suggestion.confidence * 100);

  // 포커스가 J/K로 넘어오면 실제 DOM 포커스와 스크롤도 따라간다.
  // 이래야 이후 Enter/L이 카드에서 패널로 버블링된다.
  useEffect(() => {
    if (!focused || articleRef.current === null) return;
    articleRef.current.focus({ preventScroll: true });
    articleRef.current.scrollIntoView({ block: "nearest" });
  }, [focused]);

  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      className={`rounded-lg border bg-white p-4 focus-visible:outline-none dark:bg-zinc-800 ${
        focused
          ? "border-blue-500 ring-2 ring-blue-500/40 dark:border-blue-400"
          : "border-gray-200 dark:border-zinc-700"
      }`}
      data-review-source-key={card.sourceKey}
      data-review-focused={focused ? "true" : "false"}
      onClick={onFocusCard}
    >
      {/* 제목 줄: 제목 + 프로젝트 + 수동 검토 배지 + 상태 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {/* 다중 선택 체크박스 — 일괄 승인/나중에 보기 대상을 고른다. */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          disabled={busy}
          aria-label={`카드 선택: ${card.source.title}`}
          className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800"
        />
        {/* truncate(nowrap)이면 text-balance가 적용되지 않는다 — 조합은 no-op이라
            truncate만 남긴다(2026-08-18 검수 후속 P3). */}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-zinc-100" title={card.source.title}>
          {card.source.title}
        </h3>
        {card.source.projectName && (
          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-zinc-700 dark:text-zinc-400">
            {card.source.projectName}
          </span>
        )}
        {/* 카드 유래 라벨(2026-08-30 단계 1). vault-note 소스 대비용 — 현재는 capture만 구분. */}
        {card.origin === "capture" && (
          <span className="shrink-0 rounded bg-purple-50 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
            캡처
          </span>
        )}
        {manualReviewOnly && (
          <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300" title="민감정보·파괴 명령·금융 판단 의심 항목. 자동 완료·이동·삭제 없음">
            수동 검토 필요
          </span>
        )}
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE_STYLES[card.status]}`}
          aria-label={`검토 상태: ${STATUS_LABELS[card.status]}`}
        >
          {STATUS_LABELS[card.status]}
        </span>
        {card.conversion && (
          <span
            className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
            title={
              card.conversion.preexisting
                ? "볼트에 이미 같은 파일이 있어 덮어쓰지 않았습니다"
                : `${card.conversion.noteFolder}/${card.conversion.noteId}.md`
            }
          >
            {/* 저장 경로는 `notes/참고`처럼 여러 단계라, 배지에는 마지막 폴더명만 보여준다.
                전체 경로는 title 속성(툴팁)에 그대로 있다. */}
            변환됨 · {card.conversion.noteFolder.split("/").pop()}
            {card.conversion.noteKind === "todo" ? " (투두)" : ""}
            {card.conversion.preexisting ? " · 이미 있음" : ""}
          </span>
        )}
      </div>

      {/* 왜 이 카드가 큐에 나왔는지(2026-08-30 단계 1). AI 제안 이유와 다른 정보다. */}
      {card.reviewReason.length > 0 && (
        <p className="mb-2 text-xs text-gray-500 dark:text-zinc-400">
          <span className="mr-1" aria-hidden="true">💡</span>
          {card.reviewReason}
        </p>
      )}

      {/* 안전하게 가공된 원문 내용 */}
      {card.source.safeContent.length > 0 ? (
        <div className="mb-3">
          <p
            className={`whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600 dark:text-zinc-300 ${expanded ? "" : "line-clamp-3"}`}
          >
            {card.source.safeContent}
          </p>
          {card.source.safeContent.length > 120 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-1 text-xs text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-500 dark:hover:text-zinc-300"
            >
              {expanded ? "접기" : "전체 보기"}
            </button>
          )}
        </div>
      ) : (
        <p className="mb-3 text-xs italic text-gray-400 dark:text-zinc-500">(본문 없음)</p>
      )}

      {/* AI 제안: 분류 + 이유 + 확신 */}
      <div className="mb-3 rounded-md bg-gray-50 p-2.5 dark:bg-zinc-900">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-zinc-400">AI 제안</span>
          <ClassificationBadge value={card.suggestion.classification} />
          <span className="text-xs text-gray-400 dark:text-zinc-500">
            확신 {confidencePercent}% ({confidenceLabel(card.suggestion.confidence)})
          </span>
        </div>
        <p className="text-xs leading-relaxed text-gray-600 dark:text-zinc-300">
          {card.suggestion.reason || "(제안 이유 없음)"}
        </p>
      </div>

      {/* 사용자 판단: 분류 선택 + 승인/나중에 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400">
          분류
          <select
            value={shown}
            onChange={(e) => onSetClassification(card.sourceKey, e.target.value as ReviewClassification)}
            disabled={busy}
            aria-label={`검토 분류 선택: ${card.source.title}`}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {REVIEW_CLASSIFICATIONS.map((classification) => (
              <option key={classification} value={classification}>
                {classification}
              </option>
            ))}
          </select>
        </label>

        {card.userClassification !== null && (
          <button
            type="button"
            onClick={() => onSetClassification(card.sourceKey, null)}
            disabled={busy}
            className="rounded-md px-2 py-1 text-xs text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-zinc-300"
            title="AI 제안 분류로 되돌립니다"
          >
            제안 복원
          </button>
        )}

        <div className="ms-auto flex items-center gap-1.5">
          {/* vault-note 카드 전용: 원본을 보관 폴더로 옮긴다(삭제는 없다 — 계약 11 정합). */}
          {card.origin === "vault-note" && onArchive && (
            <button
              type="button"
              onClick={() => {
                onArchive(card.sourceKey);
              }}
              disabled={busy}
              className="rounded-md border border-amber-500 bg-transparent px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-900/30"
              title="이 노트를 보관(archive) 폴더로 옮깁니다. 삭제되지 않습니다."
            >
              보관으로 이동
            </button>
          )}
          {card.status !== "pending" && (
            <button
              type="button"
              onClick={() => onSetStatus(card.sourceKey, "pending")}
              disabled={busy}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              대기로
            </button>
          )}
          {isConvertibleCard(card) && (
            <button
              type="button"
              onClick={() => onConvert(card.sourceKey)}
              disabled={busy}
              className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50"
              title="이 항목을 notes 폴더의 노트/투두로 만듭니다. TickTick 원본은 바뀌지 않습니다."
            >
              Ticksidian으로 변환
            </button>
          )}
          <button
            type="button"
            onClick={() => onSetStatus(card.sourceKey, "later")}
            disabled={busy}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            나중에 보기
          </button>
          <button
            type="button"
            onClick={() => onSetStatus(card.sourceKey, "approved")}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
          >
            승인
          </button>
        </div>
      </div>
    </article>
  );
}
