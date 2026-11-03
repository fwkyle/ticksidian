/**
 * useNoteEditor.image-embeds.ts — 이미지 임베드 로드/저장 변환의 순수 규칙.
 *
 * 로드: 임베드 토큰을 image 블록(blob URL 또는 자리표시 data URL)으로 바꾼다.
 * 저장: 매핑에 등록된 image 블록을 원문 raw 텍스트 문단으로 되돌린다(원본 불변).
 * 설계: docs/waterfall/03-상세설계/이미지-임베드-보기.md 2-D.
 *
 * BlockNote 실측 근거(2026-08-19):
 * - ![[…]] 는 paragraph 텍스트로 파싱된다(원문 보존).
 * - ![](path) 는 image 블록(url=원문 경로)으로 파싱되지만 직렬화 시
 *   (1) name이 비면 ![BlockNote image](url), (2) url이 percent-encoding 된다.
 *   그래서 저장 직전에 반드시 raw 문단으로 되돌려야 한다.
 */

import { parseExcalidrawDocument } from "../lib/excalidraw-document.ts";
import {
  parseImageEmbeds,
  resolveImageEmbedTarget,
  type ImageEmbedToken,
} from "../lib/image-embeds.ts";

export type ImageEmbedPlaceholderReason = "not-found" | "too-large" | "read-error";

/** 이미지 확장자 → Blob MIME 타입. */
const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

export function mimeForImagePath(path: string): string {
  const dot = path.lastIndexOf(".");
  const extension = dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const PLACEHOLDER_REASON_TEXT: Record<ImageEmbedPlaceholderReason, string> = {
  "not-found": "이미지 파일을 찾지 못했습니다",
  "too-large": "이미지가 20MB 상한을 초과했습니다",
  "read-error": "이미지를 읽지 못했습니다",
};

/** 자리표시 안내문구(alt/테스트 검증용). */
export function placeholderAltText(
  reason: ImageEmbedPlaceholderReason,
  target: string,
): string {
  return PLACEHOLDER_REASON_TEXT[reason] + " (" + target + ")";
}

/**
 * 자리표시 이미지(SVG data URL). 사유와 대상을 안내 문구에 담는다.
 * 디자인 규칙: 빈 칸/깨진 아이콘 대신 사유를 알려주는 같은 경로의 이미지.
 */
export function buildPlaceholderImageUrl(
  reason: ImageEmbedPlaceholderReason,
  target: string,
): string {
  const shortTarget = target.length > 48 ? target.slice(0, 45) + "…" : target;
  const title = escapeXml(PLACEHOLDER_REASON_TEXT[reason]);
  const detail = escapeXml("대상: " + shortTarget);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="112" role="img" aria-label="' + title + '">' +
    '<rect x="1" y="1" width="418" height="110" rx="8" fill="#f4f4f5" stroke="#a1a1aa" stroke-dasharray="6 4"/>' +
    '<text x="50%" y="48" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="13" fill="#3f3f46">' + title + '</text>' +
    '<text x="50%" y="72" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="11" fill="#71717a">' + detail + '</text>' +
    '</svg>';
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// ── 로드 변환 ────────────────────────────────────────────────────────────────

/** 블록에서 순수 텍스트만 이어 붙인다(paragraph 원문 비교용). */
function blockText(block: unknown): string {
  const content = (block as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const item of content) {
    const t = (item as { text?: unknown }).text;
    if (typeof t === "string") text += t;
  }
  return text;
}

export interface ImageEmbedAsset {
  /** image 블록에 넣을 URL(blob: 또는 data: 자리표시). */
  url: string;
  /** image 블록 표시 이름(alt). */
  name: string;
}

/**
 * 그림 문서 텍스트를 SVG 문자열로 그린다 (2026-08-23 TICK-DRAW-001 3b).
 * 테스트가 갈아끼울 수 있게 주입점으로 둔다.
 */
export type DrawingSvgRenderer = (text: string) => Promise<string>;

/**
 * 기본 구현. `@excalidraw/excalidraw`를 **여기서 처음 동적 import**한다 —
 * 그림 임베드가 없는 노트는 이 패키지를 아예 받지 않는다(번들 분리 유지).
 */
async function renderDrawingSvgWithExcalidraw(text: string): Promise<string> {
  const parsed = parseExcalidrawDocument(text);
  if (!parsed.ok) throw new Error(`drawing parse failed: ${parsed.reason}`);
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  const svg = await exportToSvg({
    elements: parsed.elements as never,
    appState: { ...parsed.appState, exportBackground: true } as never,
    files: (parsed.files ?? {}) as never,
  });
  return new XMLSerializer().serializeToString(svg);
}

export interface PrepareImageEmbedBlocksInput {
  /** 원본 마크다운 본문(frontmatter 제거) — 토큰 raw의 원천. */
  body: string;
  /** 파싱된 블록 배열(변형하지 않는다). */
  blocks: unknown[];
  /** 볼트 이미지 파일 절대경로 목록. */
  imageFiles: readonly string[];
  /** 노트의 볼트 상대 폴더(빈 문자열 = 루트). */
  noteFolderPath: string;
  /** 볼트 루트 절대경로. */
  vaultRootPath: string;
  /** 바이너리 읽기(어댑터 주입). */
  readBinaryFile: (path: string) => Promise<Uint8Array>;
  /** blob URL 생성(테스트 주입용). 기본 URL.createObjectURL. */
  createObjectUrl?: (blob: Blob) => string;
  /** 그림 임베드 렌더러(테스트 주입용). 기본은 excalidraw 동적 import. */
  renderDrawingSvg?: DrawingSvgRenderer;
}

export interface PreparedImageEmbeds {
  /** 변환된 블록 배열(새 배열). */
  blocks: unknown[];
  /** image 블록 URL → 원문 raw. 저장 복원의 유일한 근거. */
  restoreMapping: Map<string, string>;
  /** 이번 변환에서 만든 blob URL들(revoke 대상). */
  blobUrls: string[];
}

/**
 * 임베드 토큰을 image 블록으로 바꾼 블록 배열을 만든다.
 *
 * - paragraph 텍스트가 토큰 raw와 정확히 일치(wiki 임베드) → image 블록으로 교체.
 * - image 블록의 url이 표준 문법 토큰 대상과 일치 → url/name을 blob/자리표시로 교체.
 * - 문장 중간 인라인 토큰은 그대로 둔다(v1 한계 — 원문은 보존됨).
 */
export async function prepareImageEmbedBlocks(
  input: PrepareImageEmbedBlocksInput,
): Promise<PreparedImageEmbeds> {
  const { body, blocks, imageFiles, noteFolderPath, vaultRootPath, readBinaryFile } = input;
  const createObjectUrl = input.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const renderDrawingSvg = input.renderDrawingSvg ?? renderDrawingSvgWithExcalidraw;

  // wiki 임베드는 paragraph 텍스트와 raw가 정확히 일치할 때만 변환한다.
  const rawTextSet = new Set<string>();
  for (const block of blocks) {
    const text = blockText(block);
    if (text.length > 0) rawTextSet.add(text);
  }
  // 표준 문법은 BlockNote가 이미 image 블록으로 만든다 — url(target)로 짝 찾는다.
  const standardTokensByTarget = new Map<string, ImageEmbedToken>();
  for (const token of parseImageEmbeds(body)) {
    if (rawTextSet.has(token.raw)) continue;
    standardTokensByTarget.set(token.target, token);
  }

  const restoreMapping = new Map<string, string>();
  const blobUrls: string[] = [];

  const buildAsset = async (token: ImageEmbedToken): Promise<ImageEmbedAsset> => {
    const resolved = resolveImageEmbedTarget(token.target, {
      noteFolderPath,
      vaultRootPath,
      imageFiles,
    });
    if (resolved === null) {
      return {
        url: buildPlaceholderImageUrl("not-found", token.target),
        name: placeholderAltText("not-found", token.target),
      };
    }
    const displayName = resolved.slice(resolved.lastIndexOf("/") + 1);
    try {
      const bytes = await readBinaryFile(resolved);
      // 그림은 그려서 SVG로 넣는다. 원문 `![[…]]`은 restoreMapping이 그대로 되돌린다.
      if (token.kind === "drawing") {
        const svg = await renderDrawingSvg(new TextDecoder().decode(bytes));
        const url = createObjectUrl(new Blob([svg], { type: "image/svg+xml" }));
        blobUrls.push(url);
        return { url, name: displayName };
      }
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeForImagePath(resolved) });
      const url = createObjectUrl(blob);
      blobUrls.push(url);
      return { url, name: displayName };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason: ImageEmbedPlaceholderReason = message.includes("too large")
        ? "too-large"
        : "read-error";
      return {
        url: buildPlaceholderImageUrl(reason, token.target),
        name: placeholderAltText(reason, token.target),
      };
    }
  };

  const result: unknown[] = [];
  for (const block of blocks) {
    const text = blockText(block);
    if (typeof text === "string" && text.length > 0) {
      const token = parseImageEmbeds(text).find((candidate) => candidate.raw === text);
      if (token) {
        const asset = await buildAsset(token);
        restoreMapping.set(asset.url, token.raw);
        result.push(buildImageBlock(asset));
        continue;
      }
    }
   const props = (block as { props?: { url?: unknown } }).props;
   const url = props && typeof props.url === "string" ? props.url : null;
   if (url !== null && standardTokensByTarget.has(url)) {
     const token = standardTokensByTarget.get(url);
     if (token) {
       const asset = await buildAsset(token);
       restoreMapping.set(asset.url, token.raw);
       result.push(buildImageBlock(asset));
       continue;
     }
   }
    // BlockNote는 마크다운 파싱 단계에서 url을 percent-encoding한다(실측).
    // 원문 target(한글 경로)과 짝 맞추려면 디코딩된 url로도 조회한다.
    if (url !== null && url.includes("%")) {
      let decodedUrl: string | null = null;
      try {
        decodedUrl = decodeURIComponent(url);
      } catch {
        decodedUrl = null;
      }
      if (decodedUrl !== null && standardTokensByTarget.has(decodedUrl)) {
        const token = standardTokensByTarget.get(decodedUrl);
        if (token) {
          const asset = await buildAsset(token);
          restoreMapping.set(asset.url, token.raw);
          result.push(buildImageBlock(asset));
          continue;
        }
      }
    }
   result.push(block);
  }

  return { blocks: result, restoreMapping, blobUrls };
}

function buildImageBlock(asset: ImageEmbedAsset): unknown {
  return {
    type: "image",
    props: {
      url: asset.url,
      name: asset.name,
      caption: "",
      showPreview: true,
    },
    content: [],
    children: [],
  };
}

// ── 저장 복원 ────────────────────────────────────────────────────────────────

/**
 * 매핑에 등록된 image 블록을 원문 raw 텍스트 paragraph로 되돌린다.
 * 사용자가 캡션을 입력했다면 캡션 문단을 raw 뒤에 살린다(입력 보존).
 * 매핑에 없는 image 블록은 그대로 둔다.
 */
export function restoreImageEmbedsInBlocks(
  blocks: unknown[],
  restoreMapping: ReadonlyMap<string, string>,
): unknown[] {
  if (restoreMapping.size === 0) return blocks;
  const result: unknown[] = [];
  for (const block of blocks) {
    const props = (block as { props?: { url?: unknown; caption?: unknown } }).props;
    const url = props && typeof props.url === "string" ? props.url : null;
    if (url !== null && restoreMapping.has(url)) {
      const raw = restoreMapping.get(url) ?? "";
      result.push({
        type: "paragraph",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "left",
        },
        content: [{ type: "text", text: raw, styles: {} }],
        children: [],
      });
     const caption = props?.caption;
      const captionText = typeof caption === "string" ? caption : "";
      if (captionText.trim().length > 0) {
        result.push({
          type: "paragraph",
          props: {
            backgroundColor: "default",
            textColor: "default",
            textAlignment: "left",
          },
          content: [{ type: "text", text: captionText, styles: {} }],
          children: [],
        });
      }
      continue;
    }
    result.push(block);
  }
  return result;
}

/** blob URL들을 revoke한다. data: 자리표시는 revoke 대상이 아니다. */
export function revokeBlobUrls(urls: readonly string[]): void {
  for (const url of urls) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}
