// 민감정보 안전 정책 — 패턴 정의/검출/가림.
// 원래 scripts/ticktick-local-export-lib.mjs(769줄) 분리(2026-08-15 리팩토링 2순위).
// 설계: docs/waterfall/03-상세설계/TickTick-로컬-읽기전용-가져오기-실험.md §3

import { normalizeText } from "./normalize.mjs";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const NOTION_TOKEN_PATTERN = /\bntn_[A-Za-z0-9]{20,}\b/gu;
const AWS_SIGNIN_PATTERN = /https:\/\/[0-9]{6,}\.signin\.aws\.amazon\.com\/[A-Za-z0-9/?=&._-]*/giu;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu;
const OPENAI_KEY_PATTERN = /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu;
const SLACK_TOKEN_PATTERN = /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu;
const GOOGLE_API_KEY_PATTERN = /\bAIza[A-Za-z0-9_-]{30,}\b/gu;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gu;
const CREDENTIAL_CONTEXT_PATTERN = /(?:AWS|notion|노션|계정|로그인|password|passwd|비밀번호|token|secret|access[ _-]?key|api[ _-]?key|root)/iu;
const PASSWORD_PAIR_PATTERN = /(?:password|passwd|비밀번호|admin|root)\s*[:/=]\s*[^\s,;]{4,}/giu;
export const DESTRUCTIVE_ACTION_PATTERN = /(?:^|\n)\s*(?:sudo\s+)?(?:rm\b|pkill\b|kill\b|launchctl\s+bootout\b)|(?:EC2|RDS|DB|database|서버)[^\n]{0,50}(?:삭제|delete)/imu;
export const MUTATING_CLI_PATTERN = /(?:\bskills?\s+install\b|\bsessions?\s+optimize-storage\b|\bnpm\s+(?:install|uninstall)\b|\bbrew\s+(?:install|uninstall)\b)/iu;
export const FINANCIAL_DECISION_PATTERN = /(?:ISA|계좌|주식|투자|매수|매도|비트코인|삼전|하이닉스|레버리지)/iu;

const SECRET_VALUE_RULES = [
  ["notion-token-like", NOTION_TOKEN_PATTERN, "노션 토큰"],
  ["aws-signin-url", AWS_SIGNIN_PATTERN, "AWS 로그인 주소"],
  ["aws-access-key-like", AWS_ACCESS_KEY_PATTERN, "AWS 접근 키"],
  ["github-token-like", GITHUB_TOKEN_PATTERN, "GitHub 토큰"],
  ["openai-key-like", OPENAI_KEY_PATTERN, "OpenAI 키"],
  ["slack-token-like", SLACK_TOKEN_PATTERN, "Slack 토큰"],
  ["google-api-key-like", GOOGLE_API_KEY_PATTERN, "Google API 키"],
  ["private-key-like", PRIVATE_KEY_BLOCK_PATTERN, "개인 키"],
];

export function detectSensitiveText(text) {
  const source = normalizeText(text);
  const findings = [];
  for (const [finding, pattern] of SECRET_VALUE_RULES) {
    if (pattern.test(source)) findings.push(finding);
    pattern.lastIndex = 0;
  }
  const passwordPairFound = PASSWORD_PAIR_PATTERN.test(source);
  PASSWORD_PAIR_PATTERN.lastIndex = 0;
  if (CREDENTIAL_CONTEXT_PATTERN.test(source) && passwordPairFound) {
    findings.push("credential-pair-like");
  }
  return [...new Set(findings)];
}

export function redactEmailAddresses(text) {
  return normalizeText(text).replace(EMAIL_PATTERN, "[이메일 가림]");
}

export function redactSensitiveValues(text) {
  let redacted = redactEmailAddresses(text);
  for (const [, pattern, label] of SECRET_VALUE_RULES) {
    redacted = redacted.replace(pattern, `[${label} 가림]`);
  }
  return redacted.replace(PASSWORD_PAIR_PATTERN, "[자격증명 가림]");
}

export function summarizeRichMetadata(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return { kind: typeof value, itemCount: 1, keys: [] };
  const keys = value
    .map((item) => (item && typeof item === "object" ? item.key : null))
    .filter((key) => typeof key === "string");
  return {
    kind: "array",
    itemCount: value.length,
    keys: [...new Set(keys.map(redactSensitiveValues))].sort(),
  };
}
