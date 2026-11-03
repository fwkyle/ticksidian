/**
 * note-size.ts — 편집기로 열 수 있는 노트 크기 한계 (2026-08-16).
 *
 * Why: [kyle]이 실볼트에서 `팅김.md`(12MB, 가장 긴 줄 21만 자 — macOS 크래시 리포트 JSON을
 * 통째로 붙여넣은 문서)를 클릭했더니 앱이 "로딩 중..."에서 멈췄다. BlockNote의
 * `tryParseMarkdownToBlocks`가 UI 스레드에서 도는데, 이런 크기는 사실상 끝나지 않는다.
 * 볼트 전체 스캔으로 `notes/` 밖 문서까지 열 수 있게 되면서 이런 파일을 만날 확률이 커졌다.
 *
 * 계약: 한계를 넘는 노트는 **열지 않고 안내만 한다**. 절대 빈 내용으로 열어 두지 않는다 —
 * 열어 버리면 자동 저장이 원본 12MB를 빈 문서로 덮어쓸 수 있다(잠긴 계약 1번: 로컬 .md가 원본).
 *
 * Node QA: app/qa-note-size.mjs
 */

/**
 * 편집기로 열 수 있는 최대 문자 수.
 *
 * 500,000자는 한글 원고지 약 2,500장이라 사람이 쓴 노트로는 사실상 도달하지 않는다.
 * 이 선을 넘는 파일은 로그/덤프/데이터 붙여넣기로 본다.
 *
 * RAG 색인기의 상한(`MAX_INDEXABLE_MARKDOWN_BYTES` = 2MB)보다 보수적이다.
 * 색인은 백그라운드 CLI에서 돌지만 편집기 파싱은 화면을 직접 막기 때문이다.
 */
export const MAX_EDITABLE_NOTE_CHARS = 500_000;

/** 편집기로 열기에 너무 큰 노트인가. */
export function isTooLargeToEdit(content: string): boolean {
  return content.length > MAX_EDITABLE_NOTE_CHARS;
}

/** 사람이 읽을 크기 표기. 1,024 단위로 KB/MB까지만 쓴다. */
export function formatNoteSize(chars: number): string {
  if (chars < 1024) return `${chars}자`;
  if (chars < 1024 * 1024) return `${Math.round(chars / 1024)}KB`;
  return `${(chars / (1024 * 1024)).toFixed(1)}MB`;
}

/** 크기 초과 노트에 보여줄 안내 문구. 원본을 건드리지 않았다는 사실을 분명히 말한다. */
export function tooLargeNoteMessage(chars: number): string {
  return (
    `이 노트는 너무 커서(약 ${formatNoteSize(chars)}) 편집기에서 열지 않았습니다. ` +
    `파일은 그대로 있고 아무것도 바뀌지 않았습니다. ` +
    `다른 편집기로 열거나, 내용을 나눠 저장한 뒤 다시 열어주세요.`
  );
}
