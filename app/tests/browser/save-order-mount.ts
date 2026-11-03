import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { setVaultPath } from '../../src/lib/local-fs';
import { SaveHarness, type SaveHarnessWindow } from './save-order-harness';

export function mountSaveHarness() {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  let generation = 0;
  const w = window as SaveHarnessWindow;
  w.__saveSerializations = 0;
  w.__saveHarnessDirty = false;
  w.__saveHarnessRemount = (vault) => {
    // 실제 이전 편집기 cleanup 후 다른 볼트/같은 파일의 새 편집기를 생성한다.
    flushSync(() => root.render(null));
    if (vault) setVaultPath(vault);
    flushSync(() => root.render(createElement(SaveHarness, { key: ++generation })));
  };
  w.__saveHarnessRemount();
}
