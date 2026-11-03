import { useMemo, useState, useSyncExternalStore } from 'react';
import { noteRecovery, type RecoveryVersion } from '../../lib/note-recovery';
import { ModalDialog } from '../common/ModalDialog';

export function RecoveryVersions({ filePath, text, onRestore, disabled }: {
  filePath: string;
  text: (version: RecoveryVersion) => string;
  onRestore: (version: RecoveryVersion) => Promise<void>;
  disabled: boolean;
}) {
  const revision = useSyncExternalStore(noteRecovery.subscribe, noteRecovery.getSnapshot);
  const versions = useMemo(() => {
    // 보관 버전 변경 때만 다시 읽고 일반 키 입력에는 저장소를 재탐색하지 않는다.
    void revision;
    return noteRecovery.listVersions(filePath);
  }, [filePath, revision]);
  const [selected, setSelected] = useState<RecoveryVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const current = selected?.path === filePath && versions.some(v => v.id === selected.id) ? selected : null;
  if (versions.length === 0) return null;
  return <details className="mx-6 mb-3 text-sm text-gray-700 dark:text-zinc-300">
    <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline focus-visible:outline-blue-500">보관한 버전 ({versions.length})</summary>
    <div className="flex flex-wrap gap-2">
      {versions.map(version => <button key={version.id} type="button" className="min-h-11 rounded border border-gray-300 px-3 focus-visible:outline focus-visible:outline-blue-500 dark:border-zinc-600" onClick={() => { setSelected(version); setConfirmRemove(false); setRemoveError(null); }}>
        {version.kind === 'draft' ? '내 작성본' : '외부 버전'} · {new Date(version.at).toLocaleString('ko-KR')}
      </button>)}
    </div>
    {current && <div className="mt-2">
      <textarea aria-label="보관한 버전 내용" readOnly value={text(current)} rows={8} className="w-full rounded border border-gray-300 bg-white p-2 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
      <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || busy} className="min-h-11 rounded bg-blue-600 px-3 text-white focus-visible:outline focus-visible:outline-blue-500 disabled:opacity-50" onClick={async () => {
        setBusy(true);
        try { await onRestore(current); } finally { setBusy(false); }
      }}>이 버전을 작성본으로 복원</button>
      <button type="button" disabled={disabled || busy} className="min-h-11 rounded border border-gray-300 px-3 focus-visible:outline focus-visible:outline-blue-500 disabled:opacity-50 dark:border-zinc-600" onClick={() => { setRemoveError(null); setConfirmRemove(true); }}>제거</button>
      </div>
      {removeError && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{removeError}</p>}
      <p className="mt-1 text-xs">원본 파일은 바로 덮어쓰지 않습니다.</p>
      {confirmRemove && <ModalDialog title="보관한 버전을 제거할까요?" description="선택한 이전 버전만 목록에서 제거합니다. 현재 글과 원본 파일은 유지합니다." onClose={() => setConfirmRemove(false)}>
        <div className="flex justify-end gap-2">
          <button type="button" className="min-h-11 rounded border border-gray-300 px-3 focus-visible:outline focus-visible:outline-blue-500 dark:border-zinc-600" onClick={() => setConfirmRemove(false)}>취소</button>
          <button type="button" disabled={disabled || busy} className="min-h-11 rounded bg-red-600 px-3 text-white focus-visible:outline focus-visible:outline-blue-500 disabled:opacity-50" onClick={() => {
            if (disabled || busy) return;
            if (noteRecovery.removeVersion(filePath, current.id)) { setSelected(null); setRemoveError(null); }
            else setRemoveError('보관한 버전을 제거하지 못했습니다. 내용은 그대로 유지합니다.');
            setConfirmRemove(false);
          }}>제거 확인</button>
        </div>
      </ModalDialog>}
    </div>}
  </details>;
}
