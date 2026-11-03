// 빈 볼트 화면 — 노트가 하나도 없을 때 첫 노트 생성을 유도한다.

export function EmptyVaultScreen({ onCreateNote }: { onCreateNote: () => void }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center bg-gray-50 dark:bg-zinc-900">
      <div className="text-center">
        <h2 className="mb-2 text-xl font-semibold text-gray-700 dark:text-zinc-200">노트가 없습니다</h2>
        <p className="mb-4 text-gray-500 dark:text-zinc-400">첫 번째 노트를 만들어보세요.</p>
        <button
          onClick={onCreateNote}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          새 노트 만들기
        </button>
      </div>
    </div>
  );
}
