import { Selection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const CLICK_SLOP_PX = 4;

/** 본문 아래 배경의 클릭만 처리한다. 문서 내용과 브라우저 기본 제스처는 바꾸지 않는다. */
export class EditorBlankSpaceFocus {
  private readonly root: HTMLElement;
  private readonly content: HTMLElement;
  private readonly view: EditorView;
  private start: { x: number; y: number; pointerId: number } | null = null;

  constructor(root: HTMLElement, content: HTMLElement, view: EditorView) {
    this.root = root;
    this.content = content;
    this.view = view;
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointercancel', this.cancel);
    root.addEventListener('pointerleave', this.onPointerLeave);
    root.addEventListener('scroll', this.cancel, true);
    root.addEventListener('click', this.onClick);
  }

  dispose(): void {
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointercancel', this.cancel);
    this.root.removeEventListener('pointerleave', this.onPointerLeave);
    this.root.removeEventListener('scroll', this.cancel, true);
    this.root.removeEventListener('click', this.onClick);
    this.cancel();
  }

  private cancel = (): void => { this.start = null; };

  private onPointerLeave = (event: PointerEvent): void => {
    // 터치는 손을 뗀 뒤 pointerleave → click 순서다. 누른 채 영역을 나간 경우만 취소한다.
    if (event.buttons !== 0) this.cancel();
  };

  private isBlank(event: MouseEvent): boolean {
    if (event.defaultPrevented || event.button !== 0
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || !this.view.editable || this.view.composing
      || (event.target !== this.root && event.target !== this.content)) return false;
    const bounds = this.root.getBoundingClientRect();
    const left = bounds.left + this.root.clientLeft;
    const top = bounds.top + this.root.clientTop;
    return event.clientX >= left && event.clientX < left + this.root.clientWidth
      && event.clientY >= top && event.clientY < top + this.root.clientHeight
      && event.clientY > this.view.dom.getBoundingClientRect().bottom;
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.start = event.isPrimary && this.isBlank(event)
      ? { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
      : null;
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.start && (event.pointerId !== this.start.pointerId
      || Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) > CLICK_SLOP_PX)) {
      this.cancel();
    }
  };

  private onClick = (event: MouseEvent): void => {
    const start = this.start;
    this.cancel();
    if (!start || event.detail !== 1 || !this.isBlank(event)
      || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
    const { doc } = this.view.state;
    const first = doc.firstChild?.firstChild;
    const bodyStart = first?.firstChild?.type.name === 'heading' ? 1 + first.nodeSize : 0;
    const next = Selection.findFrom(doc.resolve(doc.content.size), -1, true);
    // 제목만 있는 원본/글자 없는 블록을 위해 문단을 만들거나 제목으로 대신 이동하지 않는다.
    if (!next || next.from < bodyStart) return;
    this.view.dispatch(this.view.state.tr.setSelection(next));
    this.view.focus();
  };
}
