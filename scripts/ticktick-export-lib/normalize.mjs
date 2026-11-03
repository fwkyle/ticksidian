// TickTick 내부 표기 → Ticksidian 표기 정규화(공통 유틸).
// 원래 scripts/ticktick-local-export-lib.mjs(769줄) 분리(2026-08-15 리팩토링 2순위).
// 근거: docs/architecture/script-size-audit-2026-08-15.md

import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

export const APPLE_REFERENCE_EPOCH_SECONDS = 978_307_200;

export function isPathInside(parentPath, candidatePath) {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function toIsoDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date((value + APPLE_REFERENCE_EPOCH_SECONDS) * 1000).toISOString();
}

export function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeNullableText(value) {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

export function parseTags(value) {
  if (typeof value !== "string" || value.trim() === "") return [];
  return [...new Set(value.split(/[,\n]/u).map((tag) => tag.trim()).filter(Boolean))];
}

export function parseRichMetadata(value) {
  if (typeof value !== "string" || value.length === 0) {
    return { value: null, raw: null, valid: true };
  }

  try {
    return { value: JSON.parse(value), raw: null, valid: true };
  } catch {
    return { value: null, raw: value, valid: false };
  }
}

export function priorityLabel(priority) {
  switch (priority) {
    case 1:
      return "낮음";
    case 3:
      return "중간";
    case 5:
      return "높음";
    default:
      return "없음";
  }
}

export function bytesMetadata(value) {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) return null;
  const bytes = Buffer.from(value);
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
