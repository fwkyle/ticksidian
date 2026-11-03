import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import { getVaultFileModifiedAt, readTextFile, writeTextFile } from "../../lib/local-fs";
import {
  buildExcalidrawSaveDocument,
  hasMeaningfulExcalidrawChange,
  parseExcalidrawDocument,
} from "../../lib/excalidraw-document";
import { classifyPreSaveGuard } from "../../hooks/useNoteEditor.helpers";
import { toErrorMessage } from "../../lib/error-utils";
import { useSystemTheme } from "../../hooks/useSystemTheme";

/**
 * DrawingEditor — raw JSON `*.excalidraw` 그림 전용 화면 (2026-08-23 TICK-DRAW-001 3a).
 *
 * 설계: docs/waterfall/03-상세설계/엑스칼리드로우-그림-편집.md §3
 *
 * 노트 에디터(BlockNote) 계약과 섞지 않는다 — `.md`가 아니고 frontmatter도 없다.
 * 잠긴 계약 1(로컬 파일이 원본)을 지키는 방법:
 *   1) 파싱 실패면 저장 경로를 아예 열지 않는다(fail-closed).
 *   2) 직렬화는 우리 순수 함수가 한다 — 원본 최상위 키와 `source`를 보존한다.
 *   3) 쓰기 직전 mtime을 다시 확인한다(계약 10, 노트와 같은 규칙).
 *   4) 직전 저장본과 문자열이 같으면 쓰지 않는다 — 열기만 해도 파일이 바뀌는 일을 막는다.
 */
export interface DrawingEditorProps {
  /** 그림 파일 절대경로. */
  readonly absolutePath: string;
  /** 화면에 보여줄 이름. */
  readonly title: string;
}

const SAVE_DEBOUNCE_MS = 1000;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      initialData: {
        elements: readonly unknown[];
        appState: Record<string, unknown>;
        files: Record<string, unknown> | undefined;
      };
    };

export function DrawingEditor({ absolutePath, title }: DrawingEditorProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const systemTheme = useSystemTheme();

  const originalRef = useRef<Record<string, unknown> | null>(null);
  /** 마지막으로 디스크와 같다고 아는 내용. 같은 내용 재저장(=열기만 해도 mtime 변경)을 막는다. */
  const lastSavedTextRef = useRef<string>("");
  /** 마지막으로 확인한 파일 수정 시각. 저장 직전 가드의 기준선. */
  const baselineMtimeRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 파일 로드 — 실패하면 편집을 열지 않는다.
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    setSaveError(null);
    originalRef.current = null;
    lastSavedTextRef.current = "";
    baselineMtimeRef.current = null;

    void (async () => {
      try {
        const text = await readTextFile(absolutePath);
        const parsed = parseExcalidrawDocument(text);
        if (cancelled) return;
        if (!parsed.ok) {
          setLoad({
            status: "error",
            message: `그림 파일을 읽지 못했습니다: ${parsed.reason} 파일은 그대로 두었습니다.`,
          });
          return;
        }
        originalRef.current = parsed.original;
        lastSavedTextRef.current = text;
        baselineMtimeRef.current = await readMtime(absolutePath);
        if (cancelled) return;
        setLoad({
          status: "ready",
          initialData: {
            elements: parsed.elements,
            appState: parsed.appState,
            files: parsed.files,
          },
        });
      } catch (error) {
        if (cancelled) return;
        setLoad({
          status: "error",
          message: `그림 파일을 열지 못했습니다: ${toErrorMessage(error, "알 수 없는 오류")}`,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [absolutePath]);

  const saveNow = useCallback(async (text: string) => {
    if (text === lastSavedTextRef.current) return;
    if (isMountedRef.current) {
      setIsSaving(true);
      setSaveError(null);
    }
    try {
      // 저장 직전 외부 변경 재확인(불변 계약 10과 같은 규칙).
      const guard = classifyPreSaveGuard({
        currentMtime: await readMtime(absolutePath),
        baselineMtime: baselineMtimeRef.current,
      });
      if (guard.action === "abort-external-change") {
        if (isMountedRef.current) {
          setSaveError(
            "그림 파일이 밖에서 바뀌어 저장을 멈췄습니다. 창을 닫았다가 다시 열어 최신 내용을 확인해 주세요.",
          );
        }
        return;
      }
      // 기준선은 쓰기가 돌려준 "내가 쓴 내용의 mtime"이다. 저장 뒤 다시 조회하면 그 사이 외부 쓰기를 삼킨다(DEF-CONC-002).
      baselineMtimeRef.current = await writeTextFile(absolutePath, text);
      lastSavedTextRef.current = text;
    } catch (error) {
      if (isMountedRef.current) {
        setSaveError(`그림을 저장하지 못했습니다: ${toErrorMessage(error, "알 수 없는 오류")}`);
      }
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  }, [absolutePath]);

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: unknown, files: unknown) => {
      const original = originalRef.current;
      if (original === null) return;
      // 열기만 해도 오는 onChange(내부 번호 갱신·gridSize 정규화)는 저장하지 않는다.
      // 이게 없으면 그림을 보기만 해도 파일이 바뀐다(2026-08-23 브라우저 QA가 잡은 결함).
      if (!hasMeaningfulExcalidrawChange({
        original,
        elements,
        appState: (appState ?? {}) as Record<string, unknown>,
      })) return;
      const text = buildExcalidrawSaveDocument({
        original,
        elements,
        appState: (appState ?? {}) as Record<string, unknown>,
        files: (files ?? undefined) as Record<string, unknown> | undefined,
      });
      if (text === lastSavedTextRef.current) return;

      pendingSaveRef.current = () => saveNow(text);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        void pending?.();
      }, SAVE_DEBOUNCE_MS);
    },
    [saveNow],
  );

  // 언마운트 시 대기 중 저장을 flush한다(노트 에디터와 같은 보장).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      void pending?.();
    };
  }, []);

  return (
    <div data-drawing-editor className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 text-xs text-gray-600 dark:border-zinc-700 dark:text-zinc-300">
        <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
          그림
        </span>
        <span className="min-w-0 truncate">{title}</span>
        {isSaving && <span className="ms-auto shrink-0 text-gray-400 dark:text-zinc-500">저장 중…</span>}
      </div>

      {saveError && (
        <div
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {saveError}
        </div>
      )}

      {load.status === "loading" && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-zinc-500">
          그림 여는 중…
        </div>
      )}

      {load.status === "error" && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-600 dark:text-zinc-300">
          {load.message}
        </div>
      )}

      {load.status === "ready" && (
        <div className="min-h-0 flex-1">
          <Excalidraw
            initialData={{
              elements: load.initialData.elements as never,
              appState: load.initialData.appState as never,
              files: (load.initialData.files ?? {}) as never,
            }}
            theme={systemTheme === "dark" ? "dark" : "light"}
            onChange={handleChange as never}
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
          />
        </div>
      )}
    </div>
  );
}

const readMtime = getVaultFileModifiedAt;
