// 앱 시작 화면 — 볼트가 등록되지 않았을 때 볼트 폴더 선택을 유도한다.

export function VaultSelectionScreen({
  onSelectVault,
  notice = null,
}: {
  onSelectVault: () => void;
  /** 볼트를 열지 못한 이유(저장된 볼트 복원 실패·등록 거부). 있으면 버튼 위에 보인다. */
  notice?: string | null;
}) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50 dark:bg-zinc-900">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg dark:bg-zinc-800">
        <h1 className="mb-4 text-balance text-2xl font-bold text-gray-800 dark:text-zinc-100">Ticksidian</h1>
        <p className="mb-6 text-pretty text-gray-600 dark:text-zinc-300">
          로컬 마크다운 파일을 관리하는 노트 앱입니다.
          <br />
          노트를 저장할 볼트 폴더를 선택해주세요.
        </p>
        {notice && (
          <p
            role="alert"
            className="mb-4 break-words rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-950 dark:text-amber-200"
          >
            {notice}
          </p>
        )}
        <button
          onClick={onSelectVault}
          className="w-full rounded bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          볼트 폴더 선택
        </button>
        <p className="mt-4 text-xs text-gray-500 dark:text-zinc-400">
          선택한 폴더에 notes/ 디렉터리가 생성되고,
          <br />
          마크다운 파일(.md)로 노트가 저장됩니다.
        </p>
      </div>
    </div>
  );
}
