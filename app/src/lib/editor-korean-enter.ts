import type { EditorView } from '@tiptap/pm/view';

const COMPOSITION_ENTER_WINDOW_MS = 500;
const SETTLE_MS = 25;
const MAX_SETTLE_ATTEMPTS = 8;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;

/** 한글 확정은 OS에 맡기고, 확정 뒤 기존 편집기 Enter를 한 번 실행한다. */
export class EditorKoreanEnter {
  private korean = false;
  private endedAt = -Infinity;
  private pending: KeyboardEvent | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    const dom = view.dom;
    dom.addEventListener('compositionstart', this.onStart, true);
    dom.addEventListener('compositionupdate', this.onUpdate, true);
    dom.addEventListener('compositionend', this.onEnd, true);
    dom.addEventListener('keydown', this.onKeyDown, true);
    dom.addEventListener('beforeinput', this.onBeforeInput, true);
    dom.addEventListener('blur', this.cancel, true);
  }

  dispose(): void {
    const dom = this.view.dom;
    dom.removeEventListener('compositionstart', this.onStart, true);
    dom.removeEventListener('compositionupdate', this.onUpdate, true);
    dom.removeEventListener('compositionend', this.onEnd, true);
    dom.removeEventListener('keydown', this.onKeyDown, true);
    dom.removeEventListener('beforeinput', this.onBeforeInput, true);
    dom.removeEventListener('blur', this.cancel, true);
    this.cancel();
  }

  private cancel = (): void => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.endedAt = -Infinity;
  };

  private onStart = (): void => {
    this.cancel();
    this.korean = false;
  };

  private onUpdate = (event: CompositionEvent): void => {
    this.korean = HANGUL.test(event.data);
  };

  private onEnd = (event: CompositionEvent): void => {
    this.korean = HANGUL.test(event.data);
    this.endedAt = this.korean ? event.timeStamp : -Infinity;
    if (this.pending) {
      if (this.korean) this.schedule();
      else this.cancel();
    }
  };

  private onBeforeInput = (event: InputEvent): void => {
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      this.cancel();
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const composing = event.isComposing || this.view.composing;
    const justEnded = Math.abs(event.timeStamp - this.endedAt) < COMPOSITION_ENTER_WINDOW_MS;
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey
      || event.metaKey || event.repeat || event.defaultPrevented
      || !this.korean || !this.view.editable || (!composing && !justEnded)) {
      this.cancel();
      return;
    }
    // 조합 중 preventDefault는 OS의 글자 확정까지 막을 수 있으므로 호출하지 않는다.
    if (!composing) event.preventDefault();
    event.stopPropagation();
    this.pending = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
    });
    this.endedAt = -Infinity;
    if (!composing || justEnded) this.schedule();
  };

  private schedule(attempt = 0): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.pending || this.view.isDestroyed || !this.view.editable || !this.view.hasFocus()) {
        this.cancel();
        return;
      }
      if (this.view.composing) {
        if (attempt < MAX_SETTLE_ATTEMPTS) this.schedule(attempt + 1);
        else this.cancel();
        return;
      }
      const event = this.pending;
      this.cancel();
      if (this.view.someProp('handleKeyDown', (handle) => handle(this.view, event))) {
        // 이미 본문에 있는 포커스를 유지하면서 새 문단의 선택을 DOM에 반영한다.
        this.view.focus();
      }
    }, SETTLE_MS);
  }
}
