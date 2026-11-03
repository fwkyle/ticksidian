// RAG 텍스트 규칙 — 청킹/해시/민감 패턴/마크다운 순회 (순수 함수, IO는 파일 읽기만).
// 원래 scripts/rag-index-lib.mjs(898줄)의 텍스트 책임 분리(2026-08-15 리팩토링).
// 설계: docs/architecture/script-size-audit-2026-08-15.md

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export const EMBEDDING_TEXT_MAX_LENGTH = 480;
export const MAX_INDEXABLE_MARKDOWN_BYTES = 2 * 1024 * 1024;

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".obsidian", ".staging", ".ticksidian", ".trash", "attachments", "node_modules",
]);
const SECRET_PATTERNS = [
  /\bntn_[A-Za-z0-9]{20,}\b/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\bAIza[A-Za-z0-9_-]{30,}\b/gu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu,
  /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gu,
  /(?:password|passwd|비밀번호|admin|root)\s*[:/=]\s*[^\s,;]{4,}/giu,
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 임베딩 프로바이더에 실제로 전달되는 입력 문자열을 만든다.
 *
 * 결함 방어: 임베딩 입력은 "title\nheading\ncontent"를 EMBEDDING_TEXT_MAX_LENGTH로
 * 자른 것이다. content만 해싱하면 제목/헤딩만 바뀐 경우 벡터가 잘못 재사용된다.
 * 그래서 재사용 판정 해시도 이 문자열 기준으로 한다(build/incremental 공통).
 */
export function embeddingInputText(title, heading, content) {
  return `${title}\n${heading}\n${content}`.slice(0, EMBEDDING_TEXT_MAX_LENGTH);
}

export function containsKnownSecret(value) {
  for (const pattern of SECRET_PATTERNS) {
    const found = pattern.test(value);
    pattern.lastIndex = 0;
    if (found) return true;
  }
  return false;
}

export function walkMarkdown(directory, root = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(fullPath, root));
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push({ absolutePath: fullPath, relativePath: relative(root, fullPath) });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "ko"));
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/u);
  if (!match) return { body: markdown, values: {} };
  const values = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    try {
      values[key] = JSON.parse(raw);
    } catch {
      values[key] = raw.replace(/^['"]|['"]$/gu, "");
    }
  }
  return { body: markdown.slice(match[0].length), values };
}

function titleFromBody(body, fallback) {
  const heading = body.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  return heading || fallback.replace(/\.md$/iu, "");
}

function splitLongText(text, maxLength, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxLength);
    if (end < text.length) {
      const breakAt = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end));
      if (breakAt > start + Math.floor(maxLength * 0.6)) end = breakAt;
    }
    const value = text.slice(start, end).trim();
    if (value) chunks.push(value);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function chunkMarkdown(markdown, { maxLength = 900, overlap = 120 } = {}) {
  const { body, values } = parseFrontmatter(markdown);
  const sections = [];
  let heading = "";
  let lines = [];
  const flush = () => {
    const text = lines.join("\n").trim();
    if (text && heading !== "가져오기 정보") sections.push({ heading, text });
    lines = [];
  };
  for (const line of body.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+)$/u);
    if (match) {
      flush();
      heading = match[2].trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  if (sections.length === 0 && body.trim()) sections.push({ heading: "", text: body.trim() });
  const chunks = sections.flatMap((section) => splitLongText(section.text, maxLength, overlap)
    .map((content) => ({ heading: section.heading, content })));
  return { values, body, chunks };
}

/** 파일 1개 → 색인 레코드(frontmatter/제목/noteId/태그 추출). */
function toRecord(file, markdown, stats, documentId) {
  const parsed = chunkMarkdown(markdown);
  const title = typeof parsed.values.title === "string"
    ? parsed.values.title
    : titleFromBody(parsed.body, file.relativePath.split("/").pop());
  const noteId = typeof parsed.values.id === "string"
    ? parsed.values.id
    : `path-${sha256(file.relativePath).slice(0, 24)}`;
  const tags = Array.isArray(parsed.values.tags)
    ? parsed.values.tags.filter((value) => typeof value === "string")
    : [];
  const record = { ...file, markdown, parsed, title, noteId, tags, stats };
  if (documentId !== undefined) record.documentId = documentId;
  return record;
}

/**
 * 볼트 파일 목록 → 색인 레코드 수집 (build/incremental 공통).
 * - 크기 초과/민감 패턴 파일은 건너뛰고 목록에 남긴다.
 * - existing(Map<경로, {hash,id}>)을 주면 파일 해시가 같은 항목은 unchangedPaths로 돌려보내고,
 *   변경/추가분에만 documentId(기존 문서 id 또는 null)를 붙인다. null이면 전체 수집(build).
 */
export function collectVaultRecords(files, existing = null) {
  const skippedSensitiveFiles = [];
  const skippedOversizedFiles = [];
  const records = [];
  const unchangedPaths = [];
  for (const file of files) {
    const stats = statSync(file.absolutePath);
    if (stats.size > MAX_INDEXABLE_MARKDOWN_BYTES) {
      skippedOversizedFiles.push({ filePath: file.relativePath, sizeBytes: stats.size });
      continue;
    }
    const markdown = readFileSync(file.absolutePath, "utf8");
    if (containsKnownSecret(markdown)) {
      skippedSensitiveFiles.push(file.relativePath);
      continue;
    }
    if (existing) {
      const prior = existing.get(file.relativePath);
      if (prior && prior.hash === sha256(markdown)) {
        unchangedPaths.push(file.relativePath);
        continue;
      }
      records.push(toRecord(file, markdown, stats, prior?.id ?? null));
    } else {
      records.push(toRecord(file, markdown, stats));
    }
  }
  return { records, skippedSensitiveFiles, skippedOversizedFiles, unchangedPaths };
}
