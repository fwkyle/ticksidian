import { useEffect, useId, useRef, useState } from 'react';
import { toErrorMessage } from '../../lib/error-utils';

interface QuickRecordInputProps {
  hidden: boolean;
  focusSignal: number;
  onCreate: (title: string) => Promise<unknown>;
  /**
   * 지금 목록이 할 일 필터인가(2026-09-22). true면 만드는 항목이 기록이 아니라 할 일이고,
   * 입력 안내·버튼 이름·상태 문구가 그에 맞게 바뀐다.
   */
  todo: boolean;
}

/** 검색 중에도 마운트를 유지한다. 볼트 변경은 부모의 key로 초안을 분리한다. */
export function QuickRecordInput({ hidden, focusSignal, todo, onCreate }: QuickRecordInputProps) {
  const [title, setTitle] = useState('');
  // 문구는 종류에 따라 달라지고, 입력칸의 접근 이름(`빠른 기록 제목`)은 기존 계약(브라우저 QA 준비 신호)으로 유지한다.
  const noun = todo ? '할 일' : '기록';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const composingRef = useRef(false);
  const errorId = useId();

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busyRef.current || composingRef.current) return;
    busyRef.current = true;
    inputRef.current?.focus();
    setPending(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setTitle('');
      setSavedTitle(trimmed);
    } catch (cause) {
      setError(toErrorMessage(cause, `${noun}을 저장하지 못했습니다. 다시 시도해 주세요.`));
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };

  return (
    <div hidden={hidden} className="shrink-0 border-b border-gray-200 px-3 py-2 dark:border-zinc-700">
      <form
        aria-label="빠른 기록"
        data-quick-kind={todo ? 'todo' : 'record'}
        aria-busy={pending}
        // IME가 발생시킨 암묵적 form submit으로는 생성하지 않는다.
        onSubmit={(event) => event.preventDefault()}
        className="flex min-w-0 items-center rounded-md border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <button type="button" onClick={() => { void submit(); }} aria-label={`${noun} 추가`} title={`${noun} 추가 (Enter)`}
          disabled={pending || !title.trim()}
          className="h-11 w-11 shrink-0 rounded lg:h-9 lg:w-9 text-gray-500 hover:text-gray-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:text-zinc-100">
          <span aria-hidden="true">+</span>
        </button>
        <input ref={inputRef} aria-label="빠른 기록 제목" placeholder={todo ? '할 일 제목 입력…' : '기록 제목 입력…'}
          value={title} readOnly={pending} aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          onChange={(event) => { setTitle(event.target.value); setError(null); setSavedTitle(''); }}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composingRef.current) return;
            event.preventDefault();
            void submit();
          }}
          className="h-11 min-w-0 flex-1 bg-transparent pr-2 text-sm font-semibold text-gray-800 outline-none placeholder:font-normal placeholder:text-gray-500 lg:h-9 dark:text-zinc-100 dark:placeholder:text-zinc-400"
        />
      </form>
      {error && <p id={errorId} role="alert" className="mt-1 break-words text-xs text-red-600 dark:text-red-400">{error}</p>}
      <p role="status" className="sr-only">{pending ? `${noun} 저장 중` : savedTitle ? `저장됨: ${savedTitle}` : ''}</p>
    </div>
  );
}
