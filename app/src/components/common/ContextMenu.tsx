import { useEffect, useMemo, useRef } from "react";

export interface ContextMenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
}

export interface ContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly onClose: () => void;
  readonly ariaLabel: string;
}

/**
 * 공통 우클릭 컨텍스트 메뉴(2026-08-19 폴더 메뉴 도입).
 * Esc/바깥 클릭 닫기, 화살표/Home/End 키보드 이동, 닫힐 때 트리거로 포커스 복귀를 보장한다.
 */
export function ContextMenu({ x, y, items, onClose, ariaLabel }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const position = useMemo(() => {
    if (typeof window === "undefined") return { left: x, top: y };
    const width = 220;
    const height = Math.max(1, items.length) * 44 + 12;
    return {
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    };
  }, [x, y, items.length]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const menu = menuRef.current;
    const buttons = () => Array.from(
      menu?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") ?? [],
    );
    buttons()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      const list = buttons();
      if (list.length === 0) return;
      const current = document.activeElement;
      const index = current instanceof HTMLElement ? list.indexOf(current as HTMLButtonElement) : -1;
      let next: number | null = null;
      if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % list.length;
      else if (event.key === "ArrowUp") next = index <= 0 ? list.length - 1 : index - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      if (next === null) return;
      event.preventDefault();
      list[next]?.focus();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        aria-hidden="true"
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        className="fixed z-50 min-w-44 rounded-md border border-gray-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
        style={position}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`flex min-h-[44px] w-full items-center rounded px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              item.destructive
                ? "text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                : "text-gray-700 hover:bg-gray-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
