/**
 * HTML Escape
 *
 * XSS 방어: 텍스트를 HTML 안에 삽입하기 전에 반드시 이 함수를 통과시킨다.
 * &, <, >, ", ' 다섯 글자를 HTML 엔티티로 변환한다.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
