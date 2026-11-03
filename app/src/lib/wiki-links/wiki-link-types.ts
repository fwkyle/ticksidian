/**
 * Wiki Link Types
 *
 * 위키링크 파싱, 해석, 인덱싱에 사용하는 공통 타입 정의.
 * 설계 문서: docs/waterfall/03-상세설계/위키링크-백링크-설계안.md
 */

/** 링크 모드: 제목 기반 vs id 기반 */
export type WikiLinkMode = "title" | "id";

/** 링크 해석 결과 */
export type WikiLinkResolution = "resolved" | "ambiguous" | "unresolved";

/**
 * 본문에서 추출한 위키링크 토큰.
 * parser가 생성하고, resolver/index가 소비한다.
 */
export interface WikiLinkToken {
  /** 원문 텍스트 (e.g. "[[프로젝트 회의록|지난 회의]]") */
  raw: string;
  /** 참조 값 (e.g. "프로젝트 회의록", "id:note-123") */
  ref: string;
  /** 사용자 지정 표시 텍스트 (없으면 null) */
  displayText: string | null;
  /** title 기반인지 id 기반인지 */
  mode: WikiLinkMode;
  /** 본문 내 시작 위치 (문자 인덱스) */
  start: number;
  /** 본문 내 끝 위치 (문자 인덱스) */
  end: number;
  /**
   * 임베드(![[…]]) 여부. 이미지/노트 포함 표현이지 노트 참조 링크가 아니므로
   * 링크 인덱스(outgoing/backlink)에서 제외한다(옵시디언과 동일).
   * 2026-08-19 이미지 임베드 보기(TICK-IMG-001)에서 추가.
   */
  isEmbed: boolean;
}

/**
 * 인덱스 구축에 사용하는 노트 메타데이터.
 * NoteListItem에서 필요한 필드만 뽑아 둔 경량 구조.
 */
export interface LinkableNoteMeta {
  noteId: string;
  title: string;
  aliases: string[];
  folder: string;
  filePath: string;
  updatedAt: number;
  type?: "todo";
}

/**
 * 해석이 끝난 위키링크.
 * resolver가 생성하고, index가 누적한다.
 */
export interface ResolvedWikiLink {
  sourceNoteId: string;
  sourceFilePath: string;
  raw: string;
  ref: string;
  displayText: string | null;
  resolution: WikiLinkResolution;
  /** 후보 noteId 목록 (ambiguous일 때 2개 이상) */
  candidateNoteIds: string[];
  /** 최종 대상 noteId (resolved일 때만 값이 있음) */
  targetNoteId: string | null;
  /** 최종 대상 제목 (resolved일 때만 값이 있음) */
  targetTitle: string | null;
}

/**
 * 백링크 패널에 보여줄 단일 항목.
 */
export interface BacklinkItem {
  /** 백링크 대상 노트 (현재 보고 있는 노트) */
  targetNoteId: string;
  /** 이 노트를 참조하는 소스 노트 */
  sourceNoteId: string;
  sourceTitle: string;
  sourceFolder: string;
  sourceUpdatedAt: number;
  /** 원문 링크 텍스트 */
  raw: string;
  displayText: string | null;
  /** 링크 주변 문맥 스니펫 */
  context: string;
}

/**
 * 전체 볼트의 링크 인덱스.
 * 메모리에 유지하며 백링크 조회와 자동완성에 사용한다.
 */
export interface LinkIndex {
  /** noteId → 노트 메타데이터 */
  notesById: Map<string, LinkableNoteMeta>;
  /** 정규화된 title/alias key → noteId 배열 (중복 제목 대응) */
  noteIdsByTitleKey: Map<string, string[]>;
  /** sourceNoteId → 해석된 outgoing 링크 배열 */
  outgoingBySourceId: Map<string, ResolvedWikiLink[]>;
  /** targetNoteId → 백링크 항목 배열 */
  backlinksByTargetId: Map<string, BacklinkItem[]>;
}
