/**
 * 보안 메모 뷰어 순수 파싱/마스킹 규칙 (2026-08-15, [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/보안-메모-뷰어.md
 * - env 계열 파일은 KEY=VALUE 줄을 감지해 키만 노출하고 값은 가림 대상으로 둔다.
 * - env 줄이 과반인 파일을 envLike로 판정하고, 그렇지 않은 파일(.pem 등)은
 *   전체 줄을 가림 대상으로 둔다.
 * - 렌더는 이 구조를 받아 기본 가림, "값 표시" 토글로만 공개한다.
 */

export type SecretLine =
  | { readonly kind: "env"; readonly key: string; readonly value: string }
  | { readonly kind: "comment"; readonly text: string }
  | { readonly kind: "text"; readonly text: string };

export interface ParsedSecretFile {
  readonly lines: readonly SecretLine[];
  /** env 줄이 과반이면 true — 키는 보이고 값만 가리는 렌더에 쓴다. */
  readonly envLike: boolean;
}

const ENV_LINE_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=(.*)$/;
const COMMENT_LINE_PATTERN = /^\s*#/;

export function parseSecretFileContent(content: string): ParsedSecretFile {
  const lines: SecretLine[] = [];
  let envCount = 0;
  let contentCount = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    contentCount += 1;
    const envMatch = ENV_LINE_PATTERN.exec(rawLine);
    if (envMatch) {
      const key = envMatch[1] ?? "";
      const value = envMatch[2] ?? "";
      lines.push({ kind: "env", key, value });
      envCount += 1;
      continue;
    }
    if (COMMENT_LINE_PATTERN.test(rawLine)) {
      lines.push({ kind: "comment", text: rawLine });
      continue;
    }
    lines.push({ kind: "text", text: rawLine });
  }
  return {
    lines,
    envLike: contentCount > 0 && envCount * 2 >= contentCount,
  };
}

/** 값 가림 마커. 길이 정보를 줘서 대략적인 길이만 노출한다(값 자체는 아님). */
export function maskSecret(value: string): string {
  if (value.length === 0) return "•";
  return "•".repeat(Math.min(value.length, 24));
}
