import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_PANEL_WIDTHS,
  PANEL_WIDTHS_STORAGE_KEY,
  clampPanelWidth,
  clampPanelWidths,
  parseStoredPanelWidths,
  serializePanelWidths,
  type PanelWidths,
  type ResizablePanel,
} from "../lib/panel-layout";

/**
 * 좌우 패널 폭 상태 훅 (2026-08-16 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/패널-너비-조정.md
 *
 * 두 값을 구분한다.
 * - `storedWidths`: 사용자가 정한 폭. localStorage에 남는다.
 * - `widths`: 지금 화면에 실제로 적용할 폭. 창 크기에 맞춰 잘린 값이다.
 *
 * 창을 줄여서 자동으로 좁아졌더라도 저장값은 그대로 두기 때문에,
 * 창을 다시 넓히면 원래 의도한 폭으로 돌아온다.
 */
export interface UsePanelWidthsResult {
  /** 본문 공간을 확보하기 위해 한 열 탐색을 쓰는가. */
  readonly compact: boolean;
  /** 화면에 적용할 폭(창 크기 반영). */
  readonly widths: PanelWidths;
  /** 드래그/키보드 중 호출. 저장은 하지 않는다(마지막에 commit). */
  readonly setPanelWidth: (panel: ResizablePanel, width: number) => void;
  /** 드래그 종료 시 1회 호출 — localStorage에 기록한다. */
  readonly commitPanelWidths: () => void;
}

/** 백링크 패널이 보이는 최소 창 폭(디자인 규칙: lg = 1024px). */
const BACKLINK_VISIBLE_MIN_VIEWPORT = 1024;
/** 사이드바가 고정 패널로 보이는 최소 창 폭(디자인 규칙: lg = 1024px). */
const SIDEBAR_VISIBLE_MIN_VIEWPORT = 1024;

function readViewportWidth(): number | undefined {
  if (typeof window === "undefined") return undefined;
  return window.innerWidth;
}

export function usePanelWidths(options: { todosOpen?: boolean; backlinkOpen?: boolean } = {}): UsePanelWidthsResult {
  const [storedWidths, setStoredWidths] = useState<PanelWidths>(() => {
    if (typeof window === "undefined") return DEFAULT_PANEL_WIDTHS;
    try {
      return parseStoredPanelWidths(window.localStorage.getItem(PANEL_WIDTHS_STORAGE_KEY));
    } catch {
      // 저장소 접근이 막힌 환경에서도 앱은 떠야 한다
      return DEFAULT_PANEL_WIDTHS;
    }
  });

  const [viewportWidth, setViewportWidth] = useState<number | undefined>(readViewportWidth);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const setPanelWidth = useCallback((panel: ResizablePanel, width: number) => {
    setStoredWidths((prev) => ({ ...prev, [panel]: clampPanelWidth(width) }));
  }, []);

  // 저장은 드래그가 끝났을 때 1회만 한다(포인터 이동마다 쓰지 않는다).
  // commit 콜백이 최신 폭을 보게 ref를 두되, 갱신은 렌더 중이 아니라 effect에서 한다
  // (lint react-hooks/refs: 렌더 중 ref 쓰기 금지). pointerup은 마지막 pointermove의
  // 리렌더가 끝난 뒤 도착하는 별도 이벤트라 이 시점의 ref는 최신이다.
  const storedRef = useRef(storedWidths);
  useEffect(() => {
    storedRef.current = storedWidths;
  }, [storedWidths]);

  const commitPanelWidths = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        PANEL_WIDTHS_STORAGE_KEY,
        serializePanelWidths(storedRef.current),
      );
    } catch {
      // 저장 실패는 화면 설정이라 조용히 넘긴다(노트 데이터와 무관)
    }
  }, []);

  // 창 크기에 맞춘 실제 적용 폭. 숨겨진 패널은 반대편 계산에서 빼야 정확하다.
  const sidebarVisible =
    viewportWidth === undefined || viewportWidth >= SIDEBAR_VISIBLE_MIN_VIEWPORT;
  // 레일56px와 열 경계선의 실제 공간도 본문 너비 계산에서 제외한다.
  const panelViewport = viewportWidth === undefined ? undefined : viewportWidth - (sidebarVisible ? 59 : 0);
  const widths = clampPanelWidths(storedWidths, panelViewport, {
    // 폴더 열과 노트 열은 같은 구간(lg 이상)에서 함께 보인다.
    folder: sidebarVisible,
    notes: sidebarVisible,
    // 투두 패널은 사용자가 열었을 때만 자리를 차지한다.
    todos: options.todosOpen ?? false,
    backlink: (options.backlinkOpen ?? true) &&
      (viewportWidth === undefined || viewportWidth >= BACKLINK_VISIBLE_MIN_VIEWPORT),
  });

  return { widths, setPanelWidth, commitPanelWidths, compact: !sidebarVisible };
}
