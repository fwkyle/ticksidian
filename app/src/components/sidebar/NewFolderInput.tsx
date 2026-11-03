import { useState, useCallback } from "react";

/* ── 새 폴더 입력 ── */

export function NewFolderInput({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // 폴더 이름 안전성 검사: '..' / '.' / '/' / '\' / NUL 포함 거부
    if (
      trimmed === '..' ||
      trimmed === '.' ||
      trimmed.includes('/') ||
      trimmed.includes('\\') ||
      trimmed.includes('\0')
    ) {
      alert(`폴더 이름에 사용할 수 없는 문자가 포함되어 있습니다: "${trimmed}"`);
      return;
    }
    onSubmit(trimmed);
    setValue("");
    setShow(false);
  }, [value, onSubmit]);

  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        className="min-h-11 w-full whitespace-nowrap rounded px-3 py-1.5 text-left text-xs font-medium
          text-gray-600 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none
          focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-300
          dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
      >
        + 새 폴더
      </button>
    );
  }

  return (
    <div className="min-w-0 py-1">
      <input
        autoFocus
        type="text"
        placeholder="폴더 이름"
        aria-label="폴더 이름"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setShow(false);
            setValue("");
          }
        }}
        onBlur={handleSubmit}
        className="min-h-11 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm
          text-gray-800 outline-none placeholder:text-gray-400 focus:border-blue-400
          dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />
    </div>
  );
}
