import { useEffect, useRef, type ReactNode } from "react";
import { PanelResizer } from "../layout/PanelResizer";

export type SidebarPane = "folders" | "notes";

/** 넓은 창의 두 열과 좁은 창의 폴더→목록 탐색을 조립한다. 두 열은 계속 마운트한다. */
export function SidebarNavigation({
  open, compact, collapsed, pane, onPaneChange, onClose,
  folderWidth, noteWidth, onResizeFolder, onResizeEnd, folders, notes, toolRow,
}: {
  open: boolean;
  compact: boolean;
  collapsed: boolean;
  pane: SidebarPane;
  onPaneChange: (pane: SidebarPane) => void;
  onClose: () => void;
  folderWidth: number;
  noteWidth: number;
  onResizeFolder: (width: number) => void;
  onResizeEnd: () => void;
  folders: ReactNode;
  notes: ReactNode;
  /** 1024px 미만 드로어 맨 아래에 고정되는 도구 줄(DEF-UI-001). */
  toolRow?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!compact || !open) return;
    const active = document.activeElement;
    if (!container.current?.contains(active)) {
      previousFocus.current = active instanceof HTMLElement ? active : null;
      container.current?.querySelector<HTMLButtonElement>("[data-sidebar-close]")?.focus();
    }
  }, [compact, open]);

  useEffect(() => {
    if (!compact || !open) return;
    const active = document.activeElement;
    if (!container.current?.contains(active)
      || (active instanceof HTMLElement && active.getClientRects().length === 0)) {
      container.current?.querySelector<HTMLButtonElement>("[data-sidebar-close]")?.focus();
    }
  }, [compact, open, pane]);

  const close = () => {
    onClose();
    previousFocus.current?.focus();
  };

  return (
    <div
      ref={container}
      data-sidebar-drawer
      data-open={open}
      role={compact ? "dialog" : undefined}
      aria-modal={compact && open ? true : undefined}
      aria-label={compact ? "기록 탐색" : undefined}
      className={`ticksidian-sidebar-drawer fixed inset-y-0 left-0 z-40 flex h-full shrink-0
        flex-col bg-gray-50 transition-transform dark:bg-zinc-900
        lg:static lg:z-auto lg:flex-row lg:transition-none ${collapsed ? "lg:hidden" : ""}`}
      onKeyDown={(event) => {
        if (!compact || !open || event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (event.key === "Tab") {
          const elements = [...(container.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
          ) ?? [])].filter((el) => el.getClientRects().length > 0);
          const first = elements[0];
          const last = elements.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }
      }}
    >
      <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-gray-200
        px-3 text-sm text-gray-700 lg:hidden dark:border-zinc-700 dark:text-zinc-200">
        {pane === "notes" ? (
          <button
            type="button" onClick={() => onPaneChange("folders")}
            className="min-h-11 rounded px-2 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-blue-500"
          >← 폴더로 돌아가기</button>
        ) : <span className="px-2 font-medium">폴더 선택</span>}
        <button
          type="button" data-sidebar-close onClick={close} aria-label="사이드바 닫기"
          className="min-h-11 rounded px-3 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-blue-500"
        >닫기</button>
      </div>
      <div
        style={{ width: compact ? "100%" : folderWidth }}
        className={`min-h-0 flex-1 lg:h-full lg:flex-none ${pane === "folders" ? "" : "hidden lg:block"}`}
      >{folders}</div>
      <PanelResizer
        panel="folder" width={folderWidth} onResize={onResizeFolder} onResizeEnd={onResizeEnd}
        label="폴더 패널 너비 조절" className="hidden lg:block"
      />
      <div
        style={{ width: compact ? "100%" : noteWidth }}
        className={`min-h-0 flex-1 lg:h-full lg:flex-none ${pane === "notes" ? "" : "hidden lg:block"}`}
      >{notes}</div>
      {compact ? toolRow : null}
    </div>
  );
}
