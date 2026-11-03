// 마크다운 round-trip 보존 규칙 — useNoteEditor에서 추출한 순수 함수(앱 3단계 패스 1).
// 설계: docs/waterfall/03-상세설계/에디터-저장-외부수정-리팩토링-설계.md §3 패스 1
// Node QA: qa-note-editor-markdown-preserve.mjs

// 빈 문서 블록 생성
export function createEmptyBlocks(): unknown[] {
  return [{
    id: `block-${Date.now()}`,
    type: 'paragraph',
    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
    content: [],
    children: [],
  }];
}

// 빈 문단 마스킹 표식 — BlockNote의 blocksToMarkdownLossy는 빈 paragraph를
// 마크다운으로 출력하지 않음. 라운드트립에서 빈 줄을 보존하려면 NBSP를 주입해야 함.
const EMPTY_PARAGRAPH_MARKER = '\u00A0';

type InlineTextLike = { type?: string; text?: string };
type BlockLike = { type?: string; content?: InlineTextLike[] };

// 저장 전: 빈 paragraph 블록을 NBSP 한 글자짜리 텍스트로 대체
export function maskEmptyParagraphs<T>(blocks: T[]): T[] {
  return blocks.map((block) => {
    const b = block as BlockLike;
    if (
      b.type === 'paragraph' &&
      Array.isArray(b.content) &&
      b.content.length === 0
    ) {
      return {
        ...b,
        content: [
          { type: 'text', text: EMPTY_PARAGRAPH_MARKER, styles: {} },
        ],
      } as T;
    }
    return block;
  });
}

// 로드 후: NBSP 한 글자만 있는 paragraph를 빈 paragraph로 복원
export function unmaskEmptyParagraphs<T>(blocks: T[]): T[] {
  return blocks.map((block) => {
    const b = block as BlockLike;
    if (
      b.type === 'paragraph' &&
      Array.isArray(b.content) &&
      b.content.length === 1 &&
      b.content[0]?.type === 'text' &&
      b.content[0]?.text === EMPTY_PARAGRAPH_MARKER
    ) {
      return { ...b, content: [] } as T;
    }
    return block;
  });
}
