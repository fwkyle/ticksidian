import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

// 포커스 트랩 대상이 되는 인터랙티브 요소 셀렉터.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface ModalDialogProps {
  /** 다이얼로그 제목. aria-labelledby로 스크린리더에 연결된다. */
  title: string;
  /** Esc 키 또는 배경 클릭 같은 "안전한 취소" 의도 시 호출. 데이터 손실 없는 경로여야 한다. */
  onClose: () => void;
  /** 배경(overlay) 클릭으로 닫을지. 기본 true. */
  closeOnOverlayClick?: boolean;
  /** 헤더 아래 보조 설명. 있으면 aria-describedby로 연결된다. */
  description?: ReactNode;
  /** 다이얼로그 본문(설명/목록/액션 버튼 등). */
  children: ReactNode;
}

/**
 * 접근성 기준을 만족하는 공통 모달 컨테이너.
 *
 * 앱의 모든 모달은 이 컴포넌트를 통해 렌더한다. 직접 `fixed inset-0` overlay div를
 * 만들어 `role="dialog"`만 붙이는 패턴은 더 이상 쓰지 않는다.
 *
 * 보장 사항(= docs/design-rules.md "모달 패턴"):
 *  - Esc 키로 onClose 호출 (취소/안전 경로)
 *  - Tab / Shift+Tab 포커스 트랩 (모달 밖으로 포커스가 새지 않음)
 *  - 열릴 때 모달 안 첫 포커스 대상으로 focus 이동
 *  - 닫힐 때 직전에 포커스됐던 요소(트리거 버튼)로 focus 복귀
 *  - role="dialog" aria-modal + aria-labelledby(+ 선택적 aria-describedby)
 *
 * onClose는 "안전한 취소"에만 연결한다. 데이터 손실이 따르는 확정 동작은 children 안의
 * 별도 버튼으로 두고, 그 버튼에 위계/마이크로카피를 직접 부여한다.
 */
export function ModalDialog({
  title,
  onClose,
  closeOnOverlayClick = true,
  description,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // onClose를 ref로 잡아 키 핸들러 effect를 재구독하지 않고도 최신 콜백을 쓴다.
  // (ref 갱신은 렌더가 아니라 effect에서 — react-hooks/refs 규칙.)
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;

    // 열릴 때 모달 안 첫 포커스 대상으로 이동. 없으면 컨테이너 자체.
    const initialFocusables = dialog?.querySelectorAll<HTMLElement>(
      FOCUSABLE_SELECTOR,
    );
    if (initialFocusables && initialFocusables.length > 0) {
      initialFocusables[0].focus();
    } else {
      dialog?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = dialog?.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR,
      );
      if (!focusables || focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      // 모달 경계에서 순환시키고, 포커스가 모달 밖으로 나가면 다시 안으로 끌어온다.
      if (event.shiftKey) {
        if (active === first || !dialog?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // 닫힐 때 직전 포커스 요소로 복귀.
      previouslyFocused?.focus?.();
    };
  }, []);

  const handleOverlayMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!closeOnOverlayClick) return;
      // 배경 자체를 눌렀을 때만 닫는다 (다이얼로그 내부 클릭은 무시).
      if (event.target === event.currentTarget) onClose();
    },
    [closeOnOverlayClick, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-800 p-6 shadow-xl focus:outline-none"
      >
        <h2
          id={titleId}
          className="mb-2 text-lg font-semibold text-gray-800 dark:text-zinc-100"
        >
          {title}
        </h2>
        {description && (
          <div id={descId} className="mb-3 text-pretty text-sm text-gray-600 dark:text-zinc-300">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
