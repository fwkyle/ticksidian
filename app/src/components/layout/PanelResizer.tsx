import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from "react";

import {
  KEYBOARD_STEP,
  KEYBOARD_STEP_LARGE,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  widthFromDrag,
  type ResizablePanel,
} from "../../lib/panel-layout";

/**
 * PanelResizer — 패널과 본문 사이의 세로 손잡이 (2026-08-16 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/패널-너비-조정.md
 * 기준: docs/design-rules.md "패널 너비 조정"
 *
 * - 마우스/트랙패드: pointer capture로 창 밖으로 나가도 드래그가 끊기지 않는다.
 * - 키보드: 화살표 좌우 16px, Shift+화살표 64px, Home/End는 최소/최대.
 * - 폭 계산 자체는 순수 함수(`widthFromDrag`)에 있고, 여기서는 이벤트만 다룬다.
 */
export interface PanelResizerProps {
  /** 어느 패널의 손잡이인가(드래그 방향이 갈린다). */
  readonly panel: ResizablePanel;
  /** 현재 적용 중인 폭(px). */
  readonly width: number;
  /** 드래그/키보드 중 새 폭 보고. 저장은 하지 않는다. */
  readonly onResize: (width: number) => void;
  /** 드래그 종료(저장 시점). */
  readonly onResizeEnd: () => void;
  /** 스크린리더용 이름. 예: "노트 목록 패널 너비 조절" */
  readonly label: string;
  /** 반응형으로 손잡이를 감출 때 쓰는 추가 클래스. 예: "hidden md:block" */
  readonly className?: string;
}

export function PanelResizer({
  panel,
  width,
  onResize,
  onResizeEnd,
  label,
  className = "",
}: PanelResizerProps) {
  // 드래그 시작 시점의 기준값. move마다 이 기준으로 다시 계산해 누적 오차를 없앤다.
  const dragOriginRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // 주 버튼(왼쪽 클릭 / 터치)만 처리한다.
      if (event.button !== 0) return;
      dragOriginRef.current = { startX: event.clientX, startWidth: width };
      event.currentTarget.setPointerCapture(event.pointerId);
      // 드래그 중 본문 텍스트가 선택되는 것을 막는다.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      onResize(widthFromDrag(panel, origin.startWidth, event.clientX - origin.startX));
    },
    [onResize, panel],
  );

  const endDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragOriginRef.current) return;
      dragOriginRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      onResizeEnd();
    },
    [onResizeEnd],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
      // 왼쪽 패널(폴더/노트)은 →가 넓어지고, 오른쪽 패널(백링크)은 ←가 넓어진다.
      const grow = panel === "backlink" ? -1 : 1;

      let next: number | null = null;
      if (event.key === "ArrowRight") next = width + step * grow;
      else if (event.key === "ArrowLeft") next = width - step * grow;
      else if (event.key === "Home") next = PANEL_MIN_WIDTH;
      else if (event.key === "End") next = PANEL_MAX_WIDTH;
      if (next === null) return;

      event.preventDefault();
      onResize(next);
      onResizeEnd();
    },
    [onResize, onResizeEnd, panel, width],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      data-panel-resizer={panel}
      className={`group relative z-10 h-full w-px shrink-0 cursor-col-resize touch-none select-none bg-transparent before:absolute before:inset-y-0 before:-left-1 before:w-[9px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${className}`}
    >
      {/* 평소에는 얇은 경계선처럼 보이고, 손을 올리거나 끄는 중에는 파랗게 강조된다 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-200 transition-colors group-hover:bg-blue-500 group-active:bg-blue-500 dark:bg-zinc-700 dark:group-hover:bg-blue-500"
      />
    </div>
  );
}
