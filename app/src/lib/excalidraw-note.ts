/**
 * excalidraw-note.ts — 옵시디언 Excalidraw 플러그인 그림 파일 판정(순수).
 *
 * Why: [kyle] 볼트에 플러그인 형식 그림 5개(`*.excalidraw.md`)가 실존한다(2026-08-20 실측,
 * kimaki 다이어그램). 이 파일은 노트처럼 보이지만 `## Drawing` 아래 압축 그림 데이터가
 * 본체다. 일반 에디터로 열어 저장하면 BlockNote 재직렬화가 그림 데이터를 오염시킬 수
 * 있으므로, 진짜 뷰어(TICK-DRAW-001)가 생기기 전까지 편집을 열지 않고 보호한다.
 * 잠긴 계약 1(로컬 .md가 유일한 원본 — 원본 보호)의 적용이다.
 */

import type { ParsedFrontmatter } from "./markdown-import";

/**
 * 플러그인 그림 파일 판정. 플러그인은 frontmatter에 `excalidraw-plugin: parsed|raw`를
 * 반드시 남긴다 — 값과 무관하게 키 존재로 판정한다(fail-closed: 그림일 가능성이 있으면
 * 편집을 열지 않는 쪽이 안전).
 */
export function isExcalidrawPluginNote(frontmatter: ParsedFrontmatter): boolean {
  return frontmatter["excalidraw-plugin"] !== undefined;
}

export function excalidrawNoteMessage(): string {
  return (
    "이 파일은 옵시디언 Excalidraw 그림 파일이라 편집을 열지 않았습니다. " +
    "일반 편집기로 저장하면 그림 데이터가 깨질 수 있어 원본을 보호합니다. " +
    "파일은 그대로 있고 아무것도 바뀌지 않았습니다. 그림 열람·편집은 후속 기능(TICK-DRAW-001)에서 지원합니다."
  );
}
