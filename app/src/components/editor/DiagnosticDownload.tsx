import { useState, useSyncExternalStore } from 'react';
import { editorDiagnostics } from '../../lib/editor-diagnostics';
import { downloadTextFile } from '../../lib/browser-download';

export function DiagnosticDownload() {
  useSyncExternalStore(editorDiagnostics.subscribe, editorDiagnostics.getSnapshot);
  const [failed, setFailed] = useState(false);
  if (editorDiagnostics.count === 0 && editorDiagnostics.persisted) return null;
  return <>
    <button
      type="button"
      title="메모 본문은 포함하지 않습니다. 파일 경로가 포함되므로 공유 전에 확인하세요."
      className="min-h-11 rounded px-2 text-gray-600 underline decoration-dotted hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400 dark:hover:text-zinc-100"
      onClick={() => {
        try {
          downloadTextFile(`ticksidian-errors-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, editorDiagnostics.exportJson(), 'application/json;charset=utf-8');
          setFailed(false);
        } catch {
          setFailed(true);
        }
      }}
    >오류 기록 받기</button>
    {!editorDiagnostics.persisted && <span role="status">기록은 앱을 닫으면 사라질 수 있습니다</span>}
    {failed && <span role="alert">기록 파일을 받지 못했습니다. 다시 시도해 주세요.</span>}
  </>;
}
