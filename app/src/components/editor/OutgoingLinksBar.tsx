/**
 * OutgoingLinksBar
 *
 * 현재 열린 노트의 outgoing 위키링크를 해석 상태별로 보여준다.
 * 위키링크 UX 2차의 "링크 클릭 이동 / ambiguous 후보 선택 / unresolved 새 노트 생성"
 * 사용자 액션이 이 바에서 한 곳으로 모인다.
 *
 * 설계: docs/waterfall/03-상세설계/위키링크-백링크-설계안.md §UX 2차
 *
 * 렌더링은 BlockNote 텍스트 자체를 건드리지 않는다. BlockNote 인라인 데코레이션을
 * 직접 얹는 대안도 있지만, Markdown round-trip(특히 NBSP/프런트매터/투두 메타)을
 * 깨뜨릴 위험이 커서 1차 UX는 이 바에 집중한다.
 */

import { useMemo, useState } from "react";
import type { LinkIndex, LinkableNoteMeta, ResolvedWikiLink } from "../../lib/wiki-links";

interface OutgoingLinksBarProps {
  /** 현재 편집 중인 노트의 noteId. 해당 노트의 outgoing을 linkIndex에서 조회한다. */
  activeNoteId: string | null;
  linkIndex: LinkIndex | null;
  /** 해석된 링크를 클릭했을 때 대상 노트를 열어 주는 콜백. */
  onOpenNote: (noteId: string) => void;
  /**
   * unresolved 링크를 "새 노트 생성"으로 승격할 때 호출.
   * 새 노트 생성 후 index가 업데이트되면 같은 바가 resolved 표시로 자동 갱신된다.
   */
  onCreateLinkedNote: (title: string) => Promise<void> | void;
  /**
   * ambiguous 후보로 **실제 링크 확정**을 요청할 때 호출.
   * 본문의 `[[ref]]` / `[[ref|label]]`을 `[[id:chosenNoteId|label or ref]]`로 rewrite해
   * 같은 ref 링크를 더 이상 ambiguous가 아니게 만든다.
   */
  onResolveAmbiguous?: (ref: string, chosenNoteId: string) => Promise<void> | void;
}

interface GroupedLinks {
  resolved: ResolvedWikiLink[];
  ambiguous: ResolvedWikiLink[];
  unresolved: ResolvedWikiLink[];
}

function groupLinks(links: ResolvedWikiLink[]): GroupedLinks {
  const resolved: ResolvedWikiLink[] = [];
  const ambiguous: ResolvedWikiLink[] = [];
  const unresolved: ResolvedWikiLink[] = [];

  // 동일한 raw를 여러 번 쓴 경우 중복 제거 (사용자 행동 단위로는 1건)
  const seen = new Set<string>();
  for (const link of links) {
    const key = `${link.resolution}:${link.ref}:${link.displayText ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (link.resolution === "resolved") resolved.push(link);
    else if (link.resolution === "ambiguous") ambiguous.push(link);
    else unresolved.push(link);
  }

  return { resolved, ambiguous, unresolved };
}

export function OutgoingLinksBar({
  activeNoteId,
  linkIndex,
  onOpenNote,
  onCreateLinkedNote,
  onResolveAmbiguous,
}: OutgoingLinksBarProps) {
  const [creatingRef, setCreatingRef] = useState<string | null>(null);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  // 기본 접힘. 노트를 바꿔도 사용자가 편 상태는 유지된다(세션 한정).
  const [expanded, setExpanded] = useState(false);

  const groups = useMemo<GroupedLinks>(() => {
    if (!activeNoteId || !linkIndex) return { resolved: [], ambiguous: [], unresolved: [] };
    const outgoing = linkIndex.outgoingBySourceId.get(activeNoteId) ?? [];
    return groupLinks(outgoing);
  }, [activeNoteId, linkIndex]);

  const total = groups.resolved.length + groups.ambiguous.length + groups.unresolved.length;
  if (total === 0) return null;

  const notesById: Map<string, LinkableNoteMeta> | null = linkIndex?.notesById ?? null;

  const handleCreate = async (title: string) => {
    if (creatingRef) return;
    setCreatingRef(title);
    try {
      await onCreateLinkedNote(title);
    } finally {
      setCreatingRef(null);
    }
  };

  const handleResolve = async (ref: string, chosenNoteId: string) => {
    if (!onResolveAmbiguous) return;
    const key = `${ref}::${chosenNoteId}`;
    if (resolvingKey) return;
    setResolvingKey(key);
    try {
      await onResolveAmbiguous(ref, chosenNoteId);
    } finally {
      setResolvingKey(null);
    }
  };

  return (
    <div className="mx-4 mb-3 rounded border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 px-3 py-2 text-xs">
      {/* 2026-08-18 [kyle] 지적: 미해결 링크가 7개면 7줄을 차지해 본문이 아래로 밀렸다.
          기본은 요약 한 줄만 보이고, 눌러야 펼친다. */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded text-left text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400"
      >
        <span className="text-gray-400 dark:text-zinc-500" aria-hidden="true">
          {expanded ? "⌄" : "›"}
        </span>
        <span className="font-medium text-gray-600 dark:text-zinc-300">위키링크</span>
        <span className="text-gray-400 dark:text-zinc-500">
          연결 {groups.resolved.length} · 모호 {groups.ambiguous.length} · 미해결 {groups.unresolved.length}
        </span>
        {!expanded && (groups.ambiguous.length > 0 || groups.unresolved.length > 0) && (
          <span className="ms-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            정리 필요 {groups.ambiguous.length + groups.unresolved.length}
          </span>
        )}
      </button>

      {expanded && (
      <>

      {groups.resolved.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {groups.resolved.map((link, idx) => (
            <li key={`r-${idx}-${link.ref}`}>
              <button
                onClick={() => link.targetNoteId && onOpenNote(link.targetNoteId)}
                className="rounded border border-blue-200 dark:border-blue-400/50 bg-white dark:bg-zinc-800 px-2 py-0.5 text-blue-700 dark:text-blue-400 hover:border-blue-400 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                title={`[[${link.ref}]] → ${link.targetTitle ?? ""}`}
              >
                → {link.displayText ?? link.targetTitle ?? link.ref}
              </button>
            </li>
          ))}
        </ul>
      )}

      {groups.ambiguous.length > 0 && (
        <ul className="mt-1 space-y-1">
          {groups.ambiguous.map((link, idx) => {
            const candidates = link.candidateNoteIds
              .map((id) => notesById?.get(id))
              .filter((m): m is LinkableNoteMeta => Boolean(m));
            return (
              <li
                key={`a-${idx}-${link.ref}`}
                className="rounded border border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/30 px-2 py-1"
              >
                <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-300">
                  <span>⚠ 모호</span>
                  <span className="font-medium">[[{link.ref}]]</span>
                  <span className="text-yellow-600 dark:text-yellow-300">후보 {candidates.length}개</span>
                </div>
                <div className="mt-1 flex flex-col gap-1">
                  {candidates.map((c) => {
                    const key = `${link.ref}::${c.noteId}`;
                    const isResolving = resolvingKey === key;
                    const canResolve = Boolean(onResolveAmbiguous);
                    return (
                      <div key={c.noteId} className="flex items-center gap-1">
                        {canResolve ? (
                          <button
                            onClick={() => void handleResolve(link.ref, c.noteId)}
                            disabled={isResolving}
                            className="flex-1 rounded border border-yellow-400 dark:border-yellow-700 bg-white dark:bg-zinc-800 px-1.5 py-0.5 text-left text-yellow-900 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 disabled:opacity-50"
                            title={
                              c.folder
                                ? `${c.folder}/${c.title}로 확정 (본문 링크를 id 모드로 rewrite)`
                                : `${c.title}로 확정 (본문 링크를 id 모드로 rewrite)`
                            }
                          >
                            {isResolving ? "확정 중…" : "이 후보로 확정 · "}
                            <span className="font-medium">{c.title || "제목 없음"}</span>
                            {c.folder && (
                              <span className="ml-1 text-yellow-500 dark:text-yellow-400">({c.folder})</span>
                            )}
                          </button>
                        ) : (
                          <span className="flex-1 rounded border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-zinc-800 px-1.5 py-0.5 text-yellow-800 dark:text-yellow-300">
                            {c.title || "제목 없음"}
                            {c.folder && (
                              <span className="ml-1 text-yellow-500 dark:text-yellow-400">({c.folder})</span>
                            )}
                          </span>
                        )}
                        <button
                          onClick={() => onOpenNote(c.noteId)}
                          className="rounded border border-yellow-200 dark:border-yellow-700 bg-white dark:bg-zinc-800 px-1.5 py-0.5 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40"
                          title="해당 노트 열기 (링크 확정은 하지 않음)"
                        >
                          열기
                        </button>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {groups.unresolved.length > 0 && (
        <ul className="mt-1 space-y-1">
          {groups.unresolved.map((link, idx) => {
            const title = link.ref;
            const isCreating = creatingRef === title;
            return (
              <li
                key={`u-${idx}-${link.ref}`}
                className="flex flex-wrap items-center gap-2 rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1"
              >
                <span className="text-gray-500 dark:text-zinc-400">✕ 미해결</span>
                <span className="font-medium text-gray-700 dark:text-zinc-200">[[{link.ref}]]</span>
                <button
                  onClick={() => void handleCreate(title)}
                  disabled={isCreating}
                  className="ml-auto rounded border border-blue-300 dark:border-blue-400/50 bg-white dark:bg-zinc-800 px-2 py-0.5 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                >
                  {isCreating ? "생성 중…" : "새 노트 만들기"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </>
      )}
    </div>
  );
}
