/**
 * image-embeds.ts — 이미지 임베드 해석 순수 규칙 (2026-08-19 TICK-IMG-001).
 *
 * 옵시디언 ![[이름.png]] 와 표준 ![alt](경로) 두 문법을 토큰화하고,
 * 볼트 이미지 파일 목록에서 실제 파일을 찾는다. IO는 하지 않는다.
 * 설계: docs/waterfall/03-상세설계/이미지-임베드-보기.md 2-B.
 */

import { imagePathKey } from "./image-path-key.ts";
import { maskCodeBlocks } from "./wiki-links/wiki-link-parser.ts";

/** 이미지로 취급하는 확장자(소문자 비교). */
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif",
]);

/**
 * 그림 임베드 확장자 (2026-08-23 TICK-DRAW-001 3b).
 * 이미지와 같은 파이프라인(해석 → 블록 치환 → 저장 시 원문 복원)을 타되,
 * 로드할 때만 SVG로 그려낸다.
 */
const DRAWING_EXTENSIONS = new Set(["excalidraw"]);

export type ImageEmbedSyntax = "wiki" | "standard";
/** 임베드가 가리키는 것의 종류. */
export type ImageEmbedKind = "image" | "drawing";

export interface ImageEmbedToken {
  /** 원문 전체(구분자 포함). wiki는 ![[…]] 전체, standard는 ![alt](경로) 전체. */
  raw: string;
  /** 참조 대상(경로 또는 파일명). */
  target: string;
  /** 표준 문법의 alt 텍스트(wiki의 | 표시텍스트 포함). 없으면 null. */
  displayText: string | null;
  syntax: ImageEmbedSyntax;
  /** "drawing"이면 `.excalidraw` — 로드 시 SVG 미리보기로 그린다. */
  kind: ImageEmbedKind;
  /** 본문 내 시작 위치(문자 인덱스) */
  start: number;
  /** 본문 내 끝 위치(문자 인덱스) */
  end: number;
}

function extensionOf(target: string): string | null {
  const dot = target.lastIndexOf(".");
  return dot === -1 ? null : target.slice(dot + 1).toLowerCase();
}

/**
 * 대상 참조가 임베드할 파일(이미지 또는 그림)을 가리키는지. 노트 임베드(![[노트 제목]])는 false.
 * 이름은 기존 호출부(image-scan 등) 호환을 위해 유지한다.
 */
export function isImagePathishTarget(target: string): boolean {
  const ext = extensionOf(target);
  if (ext === null) return false;
  return IMAGE_EXTENSIONS.has(ext) || DRAWING_EXTENSIONS.has(ext);
}

/** 임베드 대상의 종류. 확장자로만 판정한다. */
export function embedKindForTarget(target: string): ImageEmbedKind {
  const ext = extensionOf(target);
  return ext !== null && DRAWING_EXTENSIONS.has(ext) ? "drawing" : "image";
}

/** 옵시디언 wiki 임베드: ![[대상]] / ![[대상|표시텍스트]] */
const WIKI_EMBED_REGEX = /!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;
/** 표준 마크다운 이미지: ![alt](경로) — 제목 구문 ![alt](경로 "제목")도 허용. */
const STANDARD_EMBED_REGEX = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * 본문(body, frontmatter 제거)에서 이미지 임베드 토큰을 추출한다.
 * 코드 블록/인라인 코드 안은 무시한다(위키링크 파서와 같은 마스킹 재사용).
 */
export function parseImageEmbeds(body: string): ImageEmbedToken[] {
  const masked = maskCodeBlocks(body);
  const tokens: ImageEmbedToken[] = [];

  for (const regex of [WIKI_EMBED_REGEX, STANDARD_EMBED_REGEX]) {
    regex.lastIndex = 0;
    let match = regex.exec(masked);
    while (match !== null) {
      const raw = body.slice(match.index, match.index + match[0].length);
      const isWiki = regex === WIKI_EMBED_REGEX;
      const target = (isWiki ? match[1] : match[2]).trim();
      if (target.length > 0 && isImagePathishTarget(target)) {
        tokens.push({
          raw,
          target,
          displayText: ((isWiki ? match[2] : match[1]) ?? "").trim() || null,
          syntax: isWiki ? "wiki" : "standard",
          kind: embedKindForTarget(target),
          start: match.index,
          end: match.index + match[0].length,
        });
      }
      match = regex.exec(masked);
    }
  }

  return tokens.sort((a, b) => a.start - b.start);
}

/** 표준 문법 경로의 %20 같은 URL 인코딩을 푼다(실패 시 원문). */
function decodeTarget(target: string): string {
  if (!target.includes("%")) return target;
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function basenameLower(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return imagePathKey(slash === -1 ? normalized : normalized.slice(slash + 1));
}

function pathSegments(path: string): number {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).length;
}

export interface ResolveImageEmbedOptions {
  /** 노트의 볼트 상대 폴더(빈 문자열 = 볼트 루트). 상대 참조 해석에만 쓴다. */
  noteFolderPath: string;
  /** 볼트 루트 절대경로. */
  vaultRootPath: string;
  /** 볼트 안 이미지 파일 절대경로 목록(스캔 결과). */
  imageFiles: readonly string[];
}

/**
 * 임베드 대상을 실제 이미지 파일 절대경로로 해석한다. 못 찾으면 null.
 *
 * 1. 대상에 경로가 있으면: 볼트 루트 기준 → 노트 폴더 기준 순서로 정확 일치(대소문자 무시).
 * 2. 파일명만 있으면: basename 일치 후보 중 (a) attachments/ 경로 우선, (b) 경로가 짧은 것
 *    우선(옵시디언 shortest-path 근사).
 */
export function resolveImageEmbedTarget(
  target: string,
  options: ResolveImageEmbedOptions,
): string | null {
  const { noteFolderPath, vaultRootPath, imageFiles } = options;
  const decoded = decodeTarget(target);
  const filesByKey = new Map(imageFiles.map((file) => [imagePathKey(file), file]));
  const root = vaultRootPath.replace(/\/$/, "");
  const joinVault = (...segments: string[]): string =>
    [root, ...segments.filter((segment) => segment.length > 0)].join("/");

  if (decoded.includes("/")) {
    const candidates = [joinVault(decoded)];
    if (noteFolderPath) candidates.push(joinVault(noteFolderPath, decoded));
    for (const candidate of candidates) {
      const actualPath = filesByKey.get(imagePathKey(candidate));
      if (actualPath !== undefined) return actualPath;
    }
    return null;
  }

  const wanted = basenameLower(decoded);
  const matches = imageFiles.filter((file) => basenameLower(file) === wanted);
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const aAttachments = a.toLowerCase().includes("/attachments/") ? 0 : 1;
    const bAttachments = b.toLowerCase().includes("/attachments/") ? 0 : 1;
    if (aAttachments !== bAttachments) return aAttachments - bAttachments;
    const segmentDiff = pathSegments(a) - pathSegments(b);
    if (segmentDiff !== 0) return segmentDiff;
    return a.localeCompare(b);
  });
  return matches[0] ?? null;
}
