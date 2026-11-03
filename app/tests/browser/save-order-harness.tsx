import { useEffect } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useNoteEditor, type UseNoteEditorReturn } from '../../src/hooks/useNoteEditor';

export interface SaveHarnessWindow extends Window {
  __saveHarness: UseNoteEditorReturn;
  __saveHarnessRemount: (vault?: string) => void;
  __saveHarnessDirty: boolean;
  __saveSerializations: number;
}

// 테스트 전용 실제 훅 호스트. 저장 알고리즘/IO를 복제하지 않는다.
function observeSerializations(editor: NonNullable<UseNoteEditorReturn['editor']>) {
  const convert = editor.blocksToMarkdownLossy.bind(editor);
  editor.blocksToMarkdownLossy = (...args) => {
    (window as SaveHarnessWindow).__saveSerializations += 1;
    return convert(...args);
  };
  return () => { editor.blocksToMarkdownLossy = convert; };
}

export function SaveHarness() {
  const state = useNoteEditor({
    noteId: 'save-harness', folder: 'notes',
    onDirtyChange: dirty => { (window as SaveHarnessWindow).__saveHarnessDirty = dirty; },
  });
  useEffect(() => {
    (window as SaveHarnessWindow).__saveHarness = state;
  });
  useEffect(() => {
    if (!state.editor) return;
    return observeSerializations(state.editor);
  }, [state.editor]);
  return <section aria-label="저장 훅 검사">
    <span data-testid="save-harness-status">{state.isLoading ? 'loading' : state.isSaving || state.hasUnsavedChanges ? 'pending' : 'saved'}</span>
    {state.saveError && <span role="alert">{state.saveError}</span>}
    {state.editor && <BlockNoteView editor={state.editor} onChange={state.handleChange} />}
  </section>;
}
