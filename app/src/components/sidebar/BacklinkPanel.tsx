/**
 * BacklinkPanel
 *
 * 현재 활성 노트를 참조하는 다른 노트 목록을 표시한다.
 * 설계안 11절 기준.
 */

import { useState, useCallback } from "react";
import type { BacklinkItem } from "../../lib/wiki-links";
import { DEFAULT_PANEL_WIDTHS } from "../../lib/panel-layout";

interface BacklinkPanelProps {
  activeNoteId: string | null;
  backlinks: BacklinkItem[];
  onOpenNote: (noteId: string) => void;
  /** 패널 리사이저가 정한 폭(px). 생략하면 기존 기본값(256px) (2026-08-16). */
  width?: number;
  /**
   * 패널 닫기. 아이콘 레일의 백링크 토글과 같은 상태를 쓰도록 App이 넘긴다(2026-08-18).
   * 넘기지 않으면 컴포넌트 내부 접기 상태로 동작한다(기존 호환).
   */
  onHidePanel?: () => void;
}

export function BacklinkPanel({
  activeNoteId,
  backlinks,
  onOpenNote,
  width = DEFAULT_PANEL_WIDTHS.backlink,
  onHidePanel,
}: BacklinkPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  // App이 토글을 제어하면(레일 아이콘) 그쪽으로 위임한다. 안 그러면 상태가 둘로 갈려
  // 레일은 "켜짐"인데 화면은 접혀 있는 어긋남이 생긴다.
  const handleTogglePanel = useCallback(() => {
    if (onHidePanel) {
      onHidePanel();
      return;
    }
    setPanelHidden((prev) => !prev);
  }, [onHidePanel]);

  // 패널 접힌 상태: 세로 탭만 표시
  if (panelHidden) {
    return (
      <div className="hidden lg:flex h-full border-l border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 flex-col">
        <button
          onClick={handleTogglePanel}
          className="px-1.5 py-3 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
          title="백링크 패널 열기"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      </div>
    );
  }

  // 노트 미선택
  if (!activeNoteId) {
    return (
      <div
        style={{ width }}
        className="hidden lg:flex h-full shrink-0 border-l border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 flex-col"
      >
        <BacklinkHeader
          count={0}
          collapsed={collapsed}
          onToggle={handleToggle}
          onHidePanel={handleTogglePanel}
        />
        <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-zinc-500 text-sm px-4 text-center">
          노트를 선택하면 백링크가 표시됩니다
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ width }}
      className="hidden lg:flex h-full shrink-0 border-l border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 flex-col"
    >
      <BacklinkHeader
        count={backlinks.length}
        collapsed={collapsed}
        onToggle={handleToggle}
        onHidePanel={handleTogglePanel}
      />

      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          {backlinks.length === 0 ? (
            <div className="px-4 py-8 text-gray-400 dark:text-zinc-500 text-sm text-center">
              이 노트를 참조하는 다른 노트가 없습니다
            </div>
          ) : (
            <ul className="py-1">
              {backlinks.map((item, index) => (
                <BacklinkListItem
                  key={`${item.sourceNoteId}-${index}`}
                  item={item}
                  onOpenNote={onOpenNote}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 헤더 ── */

function BacklinkHeader({
  count,
  collapsed,
  onToggle,
  onHidePanel,
}: {
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onHidePanel: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-zinc-700">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-zinc-200 hover:text-gray-900 dark:hover:text-zinc-100"
      >
        <svg
          className={`w-3 h-3 text-gray-400 dark:text-zinc-500 transition-transform ${collapsed ? "" : "rotate-90"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span>백링크</span>
        {count > 0 && (
          <span className="ml-1 text-xs text-gray-400 dark:text-zinc-500 font-normal">
            {count}
          </span>
        )}
      </button>
      <button
        onClick={onHidePanel}
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
        title="패널 접기"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  );
}

/* ── 개별 백링크 아이템 ── */

function BacklinkListItem({
  item,
  onOpenNote,
}: {
  item: BacklinkItem;
  onOpenNote: (noteId: string) => void;
}) {
  return (
    <li>
      <button
        onClick={() => onOpenNote(item.sourceNoteId)}
        className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
      >
        {/* 제목 행 */}
        <div className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
          <span className="text-sm font-medium text-gray-700 dark:text-zinc-200 truncate">
            {item.sourceTitle || "제목 없음"}
          </span>
        </div>

        {/* 폴더 */}
        {item.sourceFolder && (
          <div className="ml-5 text-xs text-gray-400 dark:text-zinc-500 truncate">
            {item.sourceFolder}
          </div>
        )}

        {/* 문맥 스니펫 */}
        <div className="ml-5 mt-0.5 text-xs text-gray-500 dark:text-zinc-400 line-clamp-2">
          {item.context}
        </div>
      </button>
    </li>
  );
}
