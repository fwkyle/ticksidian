// 이미지 임베드 로드/저장 변환 순수 규칙 QA (2026-08-19 TICK-IMG-001 1-C)
//
// Given: useNoteEditor.image-embeds.ts의 준비(prepare)/복원(restore) 순수 규칙.
// When: 임베드가 든 블록과 매핑을 넣는다.
// Then: blob/자리표시 변환과 원문 raw 복원이 계약대로다.
//
// 사용법: cd app && node --experimental-strip-types qa-note-editor-image-embeds.mjs

import {
  buildPlaceholderImageUrl,
  placeholderAltText,
  mimeForImagePath,
  prepareImageEmbedBlocks,
  restoreImageEmbedsInBlocks,
  revokeBlobUrls,
} from "./src/hooks/useNoteEditor.image-embeds.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

const typeOf = (block) => block?.type;
const propsOf = (block) => block?.props ?? {};
const firstText = (block) => block?.content?.[0]?.text ?? "";

// ── 자리표시 이미지 ──────────────────────────────────────────────────────────
{
  const url = buildPlaceholderImageUrl("not-found", "없는-이미지.png");
  check("자리표시는 SVG data URL", url.startsWith("data:image/svg+xml;charset=utf-8,"));
  const decoded = decodeURIComponent(url.slice("data:image/svg+xml;charset=utf-8,".length));
  check("자리표시 안내에 파일 없음 사유 포함", decoded.includes("이미지 파일을 찾지 못했습니다"));
  check("자리표시 안내에 대상 이름 포함", decoded.includes("없는-이미지.png"));
  check("20MB 초과 사유 문구", decodeURIComponent(buildPlaceholderImageUrl("too-large", "big.png")).includes("20MB"));
  check("읽기 실패 사유 문구", decodeURIComponent(buildPlaceholderImageUrl("read-error", "x.png")).includes("읽지 못했습니다"));
  check("alt 문구에 사유+대상", placeholderAltText("not-found", "a.png") === "이미지 파일을 찾지 못했습니다 (a.png)");
  const longTarget = "아주".repeat(40) + ".png";
  check("긴 대상 이름은 48자로 자른다", !decodeURIComponent(buildPlaceholderImageUrl("not-found", longTarget)).includes(longTarget));
}

// ── MIME 매핑 ────────────────────────────────────────────────────────────────
check("png→image/png", mimeForImagePath("/v/a.PNG") === "image/png");
check("jpg→image/jpeg", mimeForImagePath("/v/a.jpg") === "image/jpeg");
check("모르는 확장자는 octet-stream", mimeForImagePath("/v/a.xyz") === "application/octet-stream");

// ── prepareImageEmbedBlocks ──────────────────────────────────────────────────
const IMAGE_FILES = ["/vault/attachments/픽스처-이미지.png"];
const FAKE_PNG = new Uint8Array([1, 2, 3]);
let blobSeq = 0;
const createdBlobs = [];
const makeInput = (body, blocks, readBinaryFile = async () => FAKE_PNG) => ({
  body,
  blocks,
  imageFiles: IMAGE_FILES,
  noteFolderPath: "notes",
  vaultRootPath: "/vault",
  readBinaryFile,
  createObjectUrl: (blob) => {
    createdBlobs.push(blob);
    blobSeq += 1;
    return "blob:fake-" + blobSeq;
  },
});

{
  const blocks = [
    { type: "paragraph", content: [{ type: "text", text: "![[픽스처-이미지.png]]", styles: {} }] },
  ];
  const prepared = await prepareImageEmbedBlocks(makeInput("![[픽스처-이미지.png]]", blocks));
  check("wiki 임베드 문단이 image 블록으로 바뀐다",
    prepared.blocks.length === 1 && typeOf(prepared.blocks[0]) === "image");
  check("blob URL이 만들어지고 매핑에 등록된다",
    prepared.blobUrls.length === 1 && prepared.restoreMapping.get("blob:fake-1") === "![[픽스처-이미지.png]]");
  check("Blob MIME는 이미지 타입", createdBlobs[0] instanceof Blob && createdBlobs[0].type === "image/png");
  check("image 블록 url이 blob URL", propsOf(prepared.blocks[0]).url === "blob:fake-1");
  check("표시 이름은 파일명", propsOf(prepared.blocks[0]).name === "픽스처-이미지.png");
}

{
  // 표준 문법 — BlockNote가 이미 image 블록(url=원문 경로)으로 파싱한 상태.
  const blocks = [
    { type: "image", props: { url: "attachments/픽스처-이미지.png", name: "", caption: "" } },
  ];
  const prepared = await prepareImageEmbedBlocks(
    makeInput("![alt](attachments/픽스처-이미지.png)", blocks),
  );
  check("표준 문법 image 블록도 blob으로 교체",
    propsOf(prepared.blocks[0]).url.startsWith("blob:fake-"));
  check("표준 문법 원문 raw가 매핑에 등록된다",
    [...prepared.restoreMapping.values()].includes("![alt](attachments/픽스처-이미지.png)"));
}

{
  // BlockNote의 percent-encoding된 url(한글 경로)로도 짝이 맞아야 한다(실측 기반).
  const encoded = encodeURIComponent("attachments/픽스처-이미지.png");
  const blocks = [
    { type: "image", props: { url: encoded, name: "", caption: "" } },
  ];
  const prepared = await prepareImageEmbedBlocks(
    makeInput("![](attachments/픽스처-이미지.png)", blocks),
  );
  check("percent-encoding된 url도 원문 토큰과 짝 매칭",
    propsOf(prepared.blocks[0]).url.startsWith("blob:fake-"));
}

{
  const blocks = [
    { type: "paragraph", content: [{ type: "text", text: "![[없는거.png]]", styles: {} }] },
  ];
  const prepared = await prepareImageEmbedBlocks(makeInput("![[없는거.png]]", blocks));
  const url = propsOf(prepared.blocks[0]).url;
  check("못 찾으면 자리표시 data URL", url.startsWith("data:image/svg+xml"));
  check("자리표시도 매핑에 등록(저장 복원용)",
    prepared.restoreMapping.get(url) === "![[없는거.png]]");
}

{
  const tooLarge = async () => {
    throw new Error("file is too large: 22020096 bytes exceeds the 20971520 byte limit");
  };
  const blocks = [
    { type: "paragraph", content: [{ type: "text", text: "![[픽스처-이미지.png]]", styles: {} }] },
  ];
  const prepared = await prepareImageEmbedBlocks(makeInput("![[픽스처-이미지.png]]", blocks, tooLarge));
  check("20MB 초과 에러는 too-large 자리표시", decodeURIComponent(propsOf(prepared.blocks[0]).url).includes("20MB"));
  check("blob은 만들지 않는다", prepared.blobUrls.length === 0);
}

{
  // 문장 중간 인라인 임베드는 변환하지 않는다(v1 한계 — 원문 보존).
  const inline = "본문 중간 ![[픽스처-이미지.png]] 끝";
  const blocks = [
    { type: "paragraph", content: [{ type: "text", text: inline, styles: {} }] },
  ];
  const prepared = await prepareImageEmbedBlocks(makeInput(inline, blocks));
  check("인라인 토큰은 텍스트 그대로",
    firstText(prepared.blocks[0]) === inline && prepared.blobUrls.length === 0);
}

// ── restoreImageEmbedsInBlocks ───────────────────────────────────────────────
{
  const mapping = new Map([["blob:fake-9", "![[원본.png]]"]]);
  const blocks = [
    { type: "image", props: { url: "blob:fake-9", caption: "", name: "원본.png" }, content: [] },
    { type: "image", props: { url: "blob:other", caption: "", name: "x" }, content: [] },
    { type: "paragraph", content: [{ type: "text", text: "그냥 문단", styles: {} }] },
  ];
  const restored = restoreImageEmbedsInBlocks(blocks, mapping);
  check("매핑된 image 블록은 raw 텍스트 문단으로",
    typeOf(restored[0]) === "paragraph" && firstText(restored[0]) === "![[원본.png]]");
  check("매핑 없는 image 블록은 무변경", propsOf(restored[1]).url === "blob:other");
  check("일반 문단 무변경", firstText(restored[2]) === "그냥 문단");
}

{
  const mapping = new Map([["blob:cap", "![[원본.png]]"]]);
  const blocks = [
    { type: "image", props: { url: "blob:cap", caption: "내가 쓴 캡션" }, content: [] },
  ];
  const restored = restoreImageEmbedsInBlocks(blocks, mapping);
  check("캡션은 사용자 입력이므로 뒤 문단으로 보존",
    restored.length === 2 && firstText(restored[1]) === "내가 쓴 캡션");
}

check("빈 매핑이면 배열 그대로", restoreImageEmbedsInBlocks([1, 2], new Map()).length === 2);

// ── revokeBlobUrls ───────────────────────────────────────────────────────────
{
  const revoked = [];
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  try {
    revokeBlobUrls(["blob:a", "data:image/svg+xml,x", "blob:b"]);
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }
  check("blob: URL만 revoke한다", revoked.length === 2 && revoked[0] === "blob:a" && revoked[1] === "blob:b");
}

summary();

