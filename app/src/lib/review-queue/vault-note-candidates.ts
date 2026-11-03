/**
 * vault-note-candidates.ts — 볼트 기존 노트에서 검토 큐 후보를 뽑는 순수 규칙
 * (2026-08-30 TICK-REVIEW-002 단계 2, [kyle] 승인)
 *
 * 설계 배경: docs/ux-ui-analysis.md §2
 *
 * Why: TickTick 이관이 끝난 뒤 검토 큐는 할 일이 없다. 진짜 문제는 "오래된 노트가
 * 묻힌다"는 것이고, 이 규칙은 그 노트를 이유와 함께 다시 데워 보여주는 재발견 대기열을 만든다.
 *
 * 계약:
 * - 후보는 "이유"가 있어야 한다. 규칙에 걸리지 않으면 뽑지 않는다.
 * - 하루 상한(DAILY_LIMIT)이 있다. 재발견은 약이고 과용하면 독이다.
 * - 이미 큐에 있는 카드(sourceKey)는 다시 뽑지 않는다 — 판정을 반복하지 않는다.
 * - 보관(archive) 폴더 노트는 대상에서 제외한다.
 * - 삭제는 이 규칙의 산물이 아니다. 판단 액션은 유지/보관 이동뿐이다(잠긴 계약 11 정합).
 */

import type { NoteListItem } from "../../types/note.ts";
import { toSourceKey } from "./rules.ts";
import type { ReviewSnapshotItem } from "./types.ts";

/** vault-notes 소스의 source 값. types.ts의 toReviewOrigin과 짝이다. */
export const VAULT_NOTE_SOURCE = "vault-note";

/** 하루에 데워 보여줄 최대 카드 수. */
export const VAULT_NOTE_DAILY_LIMIT = 10;

/** "오랜 미수정" 기준(일). 이보다 오래 됐으면 후보 자격이 있다. */
export const STALE_DAYS = 90;

/** 제목에서 임시성 흔적을 찾는 패턴(대소문자 무시). */
const TEMP_TITLE_PATTERNS: readonly RegExp[] = [
  /^qa[-_ ]/i,
  /[-_ ]qa$/i,
  /^임시/,
  /^테스트/,
  /^tmp[-_ ]/i,
  /^test[-_ ]/i,
  /\btest\d*\b/i,
  /\btmp\b/i,
];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export interface VaultNoteCandidateRule {
  readonly id: "stale" | "temp-title";
  readonly reason: string;
}

/**
 * 노트 1개가 후보 규칙에 걸리는지 판정한다. 여러 개 걸려도 첫 번째 이유만 쓴다 —
 * 이유는 판단 보조일 뿐이고, 나열은 부담이 된다.
 */
export function matchVaultNoteRule(
  note: NoteListItem,
  now: Date = new Date(),
): VaultNoteCandidateRule | null {
  // 투두는 "할 일"이라 완료 여부가 생명이다. 재발견 대상이 아니라 목록 관리 대상이다.
  if (note.type === "todo") return null;
  // 그림은 편집 화면이 별도라 검토 카드로 다루지 않는다.
  if (note.drawing === true) return null;

  const updated = note.updatedAt;
  if (updated && !isNaN(updated.getTime())) {
    const days = Math.floor((startOfDay(now) - startOfDay(updated)) / 86_400_000);
    if (days >= STALE_DAYS) {
      return {
        id: "stale",
        reason: `마지막 수정이 ${days}일 전입니다. 아직 쓸 모양인지 판단해 보세요.`,
      };
    }
  }

  const title = note.title || "";
  if (TEMP_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return {
      id: "temp-title",
      reason: "제목에 임시·테스트 흔적이 있습니다. 남아 있어야 할 노트인지 확인해 보세요.",
    };
  }

  return null;
}

/** 보관 폴더와 그 하부는 대상에서 제외한다. */
function isArchived(note: NoteListItem): boolean {
  return note.folder === "archive" || note.folder.startsWith("archive/");
}

/**
 * 노트 목록에서 검토 후보를 뽑는다.
 * @param existingSourceKeys 큐에 이미 있는 카드 키들 — 여기 있으면 다시 뽑지 않는다.
 * @param limit 최대 후보 수(기본 VAULT_NOTE_DAILY_LIMIT).
 */
export function pickVaultNoteCandidates(
  notes: readonly NoteListItem[],
  existingSourceKeys: ReadonlySet<string>,
  now: Date = new Date(),
  limit: number = VAULT_NOTE_DAILY_LIMIT,
): readonly ReviewSnapshotItem[] {
  const candidates: ReviewSnapshotItem[] = [];

  for (const note of notes) {
    if (candidates.length >= limit) break;
    if (isArchived(note)) continue;

    const sourceId = note.filePath ?? note.fileBasename;
    if (existingSourceKeys.has(toSourceKey(VAULT_NOTE_SOURCE, sourceId))) continue;

    const rule = matchVaultNoteRule(note, now);
    if (!rule) continue;

    candidates.push({
      source: VAULT_NOTE_SOURCE,
      sourceId,
      title: note.title || "제목 없음",
      // 볼트 노트는 원본이 큐에 복제되지 않게 본문을 싣지 않는다 — 카드는 열어보라는 안내만.
      safeContent: `(볼트 노트 · ${note.folder || "루트"}) 원본을 열어 판단하세요.`,
      reviewReason: rule.reason,
      suggestion: {
        // AI 제안이 아니다. 기본 분류는 "정리 후보"(변환 불가 판단 보류 계열)로 두고,
        // 사용자가 고른 분류(userClassification)가 항상 이 기본값을 이긴다.
        classification: "정리 후보",
        reason: "규칙 기반 후보입니다. AI 제안이 아닙니다.",
        confidence: 0,
      },
    });
  }

  return candidates;
}
