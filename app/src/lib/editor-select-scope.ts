import { Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Fragment, Slice, type Node } from "@tiptap/pm/model";
import type { Mappable } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

/** 이미지처럼 글자가 없는 시작 블록도 빠뜨리지 않는 문서 범위 선택. */
class BodyRangeSelection extends Selection {
  replace(tr: Transaction, content = Slice.empty): void {
    // 실제 편집 때만 본문 입력 자리를 같은 트랜잭션 안에 만든다.
    // 경계 위치에 바로 쓰면 ProseMirror가 앞 제목으로 합칠 수 있다.
    const paragraph = tr.doc.type.schema.nodes.paragraph.create();
    const block = tr.doc.type.schema.nodes.blockContainer.create(null, paragraph);
    tr.insert(this.from, block);
    tr.setSelection(TextSelection.create(tr.doc, this.from + 2, this.to + block.nodeSize));
    tr.replaceSelection(content);
  }

  replaceWith(tr: Transaction, node: Node): void {
    this.replace(tr, new Slice(Fragment.from(node), 0, 0));
  }

  eq(other: Selection): boolean {
    return other instanceof BodyRangeSelection && other.from === this.from && other.to === this.to;
  }

  map(doc: Node, mapping: Mappable): Selection {
    const from = mapping.mapResult(this.from, 1);
    const to = mapping.mapResult(this.to, -1);
    if (from.deleted || to.deleted || from.pos >= to.pos) return Selection.near(doc.resolve(from.pos));
    return new BodyRangeSelection(doc.resolve(from.pos), doc.resolve(to.pos));
  }

  toJSON(): { type: string; anchor: number; head: number } {
    return { type: "ticksidian-body-range", anchor: this.anchor, head: this.head };
  }

  static fromJSON(doc: Node, value: { anchor: number; head: number }): Selection {
    return new BodyRangeSelection(doc.resolve(value.anchor), doc.resolve(value.head));
  }
}

// 개발 중 모듈 교체에서는 전역 선택 타입 등록을 반복하지 않는다.
if (!import.meta.hot?.data.bodyRangeRegistered) {
  Selection.jsonID("ticksidian-body-range", BodyRangeSelection);
}
if (import.meta.hot) {
  import.meta.hot.dispose((data) => { data.bodyRangeRegistered = true; });
}

/** 비텍스트 경계의 브라우저 기본 입력은 이미지를 건너뛸 수 있어 문서 선택으로 교체한다. */
export function replaceSelectedBodyText(view: EditorView, event: InputEvent): void {
  if (!(view.state.selection instanceof BodyRangeSelection)
    || event.inputType !== "insertText" || event.data === null || !event.cancelable) return;
  event.preventDefault();
  view.dispatch(view.state.tr.insertText(event.data));
}

/** 첫 최상위 heading만 제목으로 취급한다. 선택은 문서 쓰기를 일으키지 않는다. */
export function selectEditorScope(view: EditorView, event: KeyboardEvent): boolean {
  if (event.isComposing || event.altKey || event.shiftKey
    || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)
    || target.closest("input, textarea, select")
    || target.closest('[contenteditable="true"]') !== view.dom) return false;

  const { doc, selection } = view.state;
  const group = doc.firstChild;
  const titleContainer = group?.firstChild;
  const title = titleContainer?.firstChild;
  if (!group || !titleContainer || title?.type.name !== "heading") return false;

  // doc > blockGroup > blockContainer > heading: 텍스트 시작은 3.
  const titleStart = 3;
  const titleEnd = titleStart + title.content.size;
  const inTitle = selection.anchor >= titleStart && selection.anchor <= titleEnd;
  let next = inTitle || group.childCount === 1
    ? TextSelection.create(doc, titleStart, titleEnd)
    : TextSelection.between(doc.resolve(1 + titleContainer.nodeSize), doc.resolve(1 + group.content.size));
  if (!inTitle && group.childCount > 1) {
    const start = 1 + titleContainer.nodeSize;
    const firstBody = group.child(1);
    // 일반 텍스트 선택은 글자 없는 첫 블록을 건너뛴다. 마지막 텍스트 블록의
    // 끝은 유지해 삭제 후에도 본문 입력 자리가 제목과 합쳐지지 않게 한다.
    if (!firstBody.firstChild?.inlineContent) {
      next = new BodyRangeSelection(doc.resolve(start), doc.resolve(next.to));
    }
  }
  event.preventDefault();
  event.stopPropagation();
  view.dispatch(view.state.tr.setSelection(next));
  return true;
}
