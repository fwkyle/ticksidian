/**
 * Markdown Import Utilities
 *
 * 마크다운 파일을 BlockNote 블록으로 변환
 */

import type { BlockNoteEditor } from "@blocknote/core";
import { load as yamlLoad, CORE_SCHEMA } from "js-yaml";

export interface ParsedFrontmatter {
  id?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ParsedNote {
  frontmatter: ParsedFrontmatter;
  body: string;
  /** `---` 블록은 있으나 YAML을 읽지 못했을 때의 사유. 읽기는 관용, 쓰기 경로는 이 값이 있으면 거부한다. */
  error?: string;
}

/**
 * Frontmatter 파싱.
 *
 * 내부적으로 js-yaml을 사용해 표준 YAML을 해석한다. 인라인 배열(`aliases: ["a","b"]`)과
 * 블록 시퀀스(`aliases:\n  - "a"\n  - "b"`) 양쪽을 모두 지원해, 옵시디언/VS Code 등
 * 외부 에디터가 저장한 프론트매터를 무음 손실 없이 읽는다.
 *
 * `CORE_SCHEMA`를 쓰는 이유: js-yaml 기본 스키마는 따옴표 없는 ISO 날짜 문자열을
 * `Date` 객체로 자동 변환한다. 기존 호출부(`scanNoteFiles`, `useNoteEditor.loadNoteFromDisk`)가
 * `typeof frontmatter.createdAt === "string"`을 가정하고 있으므로, 날짜가 문자열로 남도록
 * CORE 스키마(boolean/number/null만 타입 변환, 나머지는 문자열)로 고정한다.
 */
export function parseFrontmatter(content: string): ParsedNote {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = match[1];
  const body = content.slice(match[0].length);

  let frontmatter: ParsedFrontmatter = {};
  let failure: string | undefined;
  try {
    const parsed = yamlLoad(frontmatterText, { schema: CORE_SCHEMA });
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatter = parsed as ParsedFrontmatter;
    } else if (parsed !== null && parsed !== undefined) {
      failure = "머리말이 키-값 목록이 아닙니다.";
    }
  } catch (error) {
    console.warn("[parseFrontmatter] YAML 파싱 실패, 빈 frontmatter로 처리:", error);
    failure = error instanceof Error ? error.message : "머리말을 읽지 못했습니다.";
  }

  return failure === undefined ? { frontmatter, body } : { frontmatter, body, error: failure };
}

// 마크다운을 BlockNote 블록으로 변환 (간단 버전)
export function markdownToBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  const lines = markdown.split('\n');
  let currentParagraph: string[] = [];
  
  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(' ').trim();
      if (text) {
        blocks.push({
          id: generateBlockId(),
          type: 'paragraph',
          props: {
            textColor: 'default',
            backgroundColor: 'default',
            textAlignment: 'left',
          },
          content: [{ type: 'text', text, styles: {} }],
          children: [],
        });
      }
      currentParagraph = [];
    }
  };
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 빈 줄
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    
    // h1
    if (trimmed.startsWith('# ')) {
      flushParagraph();
      blocks.push({
        id: generateBlockId(),
        type: 'heading',
        props: {
          level: 1,
          textColor: 'default',
          backgroundColor: 'default',
          textAlignment: 'left',
        },
        content: [{ type: 'text', text: trimmed.slice(2), styles: {} }],
        children: [],
      });
      continue;
    }
    
    // h2
    if (trimmed.startsWith('## ')) {
      flushParagraph();
      blocks.push({
        id: generateBlockId(),
        type: 'heading',
        props: {
          level: 2,
          textColor: 'default',
          backgroundColor: 'default',
          textAlignment: 'left',
        },
        content: [{ type: 'text', text: trimmed.slice(3), styles: {} }],
        children: [],
      });
      continue;
    }
    
    // h3
    if (trimmed.startsWith('### ')) {
      flushParagraph();
      blocks.push({
        id: generateBlockId(),
        type: 'heading',
        props: {
          level: 3,
          textColor: 'default',
          backgroundColor: 'default',
          textAlignment: 'left',
        },
        content: [{ type: 'text', text: trimmed.slice(4), styles: {} }],
        children: [],
      });
      continue;
    }
    
    // 체크리스트
    const checkMatch = trimmed.match(/^(\s*)- \[([ x])\] (.+)$/);
    if (checkMatch) {
      flushParagraph();
      blocks.push({
        id: generateBlockId(),
        type: 'checkListItem',
        props: {
          checked: checkMatch[2] === 'x',
          textColor: 'default',
          backgroundColor: 'default',
          textAlignment: 'left',
        },
        content: [{ type: 'text', text: checkMatch[3], styles: {} }],
        children: [],
      });
      continue;
    }
    
    // 불릿 리스트
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph();
      blocks.push({
        id: generateBlockId(),
        type: 'bulletListItem',
        props: {
          textColor: 'default',
          backgroundColor: 'default',
          textAlignment: 'left',
        },
        content: [{ type: 'text', text: trimmed.slice(2), styles: {} }],
        children: [],
      });
      continue;
    }
    
    // 번호 리스트
    const numberedMatch = trimmed.match(/^\d+\.\s(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      blocks.push({
        id: generateBlockId(),
        type: 'numberedListItem',
        props: {
          textColor: 'default',
          backgroundColor: 'default',
          textAlignment: 'left',
        },
        content: [{ type: 'text', text: numberedMatch[1], styles: {} }],
        children: [],
      });
      continue;
    }
    
    // 인용구
    if (trimmed.startsWith('> ')) {
      flushParagraph();
      blocks.push({
        id: generateBlockId(),
        type: 'quote',
        props: {
          textColor: 'default',
          backgroundColor: 'default',
          textAlignment: 'left',
        },
        content: [{ type: 'text', text: trimmed.slice(2), styles: {} }],
        children: [],
      });
      continue;
    }
    
    // 코드 블록 (단순 처리)
    if (trimmed.startsWith('```')) {
      flushParagraph();
      // TODO: 코드 블록 처리
      continue;
    }
    
    // 일반 텍스트 (문단 누적)
    currentParagraph.push(line);
  }
  
  flushParagraph();
  
  return blocks.length > 0 ? blocks : [createEmptyParagraph()];
}

function generateBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptyParagraph(): unknown {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    props: {
      textColor: 'default',
      backgroundColor: 'default',
      textAlignment: 'left',
    },
    content: [],
    children: [],
  };
}

// 에디터에서 마크다운을 블록으로 변환 (BlockNote API 사용)
export async function convertMarkdownToBlocks(
  editor: BlockNoteEditor,
  markdown: string
): Promise<unknown[]> {
  try {
    // BlockNote의 markdownToBlocks API 사용
    const blocks = await editor.tryParseMarkdownToBlocks(markdown);
    return blocks;
  } catch {
    // 폴백: 간단 파서 사용
    return markdownToBlocks(markdown);
  }
}
