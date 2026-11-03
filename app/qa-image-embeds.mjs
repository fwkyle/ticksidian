// 이미지 임베드 해석 순수 규칙 QA (2026-08-19 TICK-IMG-001 1-B)
//
// Given: lib/image-embeds.ts 파싱/해석 규칙과 위키링크 파서의 embed 구분.
// When: 옵시디언/표준 임베드 문법과 볼트 이미지 목록을 넣는다.
// Then: 토큰·해석·embed 판정이 계약대로다.
//
// 사용법: cd app && node --experimental-strip-types qa-image-embeds.mjs

import { parseImageEmbeds, resolveImageEmbedTarget, isImagePathishTarget } from "./src/lib/image-embeds.ts";
import { parseWikiLinks } from "./src/lib/wiki-links/wiki-link-parser.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

// ── parseImageEmbeds ─────────────────────────────────────────────────────────
{
  const body = [
    "![[Pasted image 20260101120000.png]]",
    "",
    "![alt 설명](attachments/foo.png)",
    "",
    "일반 링크 [[노트 제목]] 와 노트 임베드 ![[노트 제목]] 은 이미지가 아니다.",
    "",
    "문장 중간 ![[inline.png]] 삽입도 토큰은 잡는다(렌더는 v1 한계).",
    "",
    "```",
    "코드블록 ![[코드안.png]] 무시",
    "```",
    "",
    "인라인 코드 `![[코드인라인.png]]` 도 무시",
  ].join("\n");

  const tokens = parseImageEmbeds(body);
  check("wiki 임베드 토큰: raw가 ![[…]] 전체",
    tokens.some((t) => t.syntax === "wiki" && t.raw === "![[Pasted image 20260101120000.png]]"));
  check("표준 임베드 토큰: raw와 target, alt",
    tokens.some((t) => t.syntax === "standard" && t.raw === "![alt 설명](attachments/foo.png)" && t.target === "attachments/foo.png" && t.displayText === "alt 설명"));
  check("노트 참조/노트 임베드는 토큰에서 제외",
    !tokens.some((t) => t.target === "노트 제목"));
  check("코드블록/인라인 코드 안은 제외",
    !tokens.some((t) => t.target.includes("코드")));
  check("인라인(문장 중간) 임베드도 토큰은 추출",
    tokens.some((t) => t.target === "inline.png"));
  check("토큰은 본문 순서대로 정렬",
    tokens.every((t, i) => i === 0 || tokens[i - 1].start <= t.start));
}

{
  const tokens = parseImageEmbeds("![[img.png|300]]");
  check("wiki 임베드 | 표시텍스트 추출", tokens[0]?.displayText === "300" && tokens[0]?.target === "img.png");
}

// ── isImagePathishTarget ─────────────────────────────────────────────────────
check("png/jpg/jpeg/gif/webp/svg는 이미지", ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg"].every(isImagePathishTarget));
check("확장자 없음/md는 이미지 아님", !isImagePathishTarget("노트 제목") && !isImagePathishTarget("a.md"));

// ── resolveImageEmbedTarget ──────────────────────────────────────────────────
const VAULT = "/vault";
const IMAGE_FILES = [
  "/vault/deep/nested/very/folder/icon.png",
  "/vault/attachments/icon.png",
  "/vault/attachments/sub/bar.png",
  "/vault/notes/스크린샷.png",
];

check("파일명만: attachments 우선",
  resolveImageEmbedTarget("icon.png", { noteFolderPath: "", vaultRootPath: VAULT, imageFiles: IMAGE_FILES }) === "/vault/attachments/icon.png");
check("파일명만: attachments가 없으면 shortest-path",
  resolveImageEmbedTarget("bar.png", { noteFolderPath: "", vaultRootPath: VAULT, imageFiles: IMAGE_FILES }) === "/vault/attachments/sub/bar.png");
check("경로 포함: 볼트 루트 기준 정확 일치",
  resolveImageEmbedTarget("notes/스크린샷.png", { noteFolderPath: "inbox", vaultRootPath: VAULT, imageFiles: IMAGE_FILES }) === "/vault/notes/스크린샷.png");
check("경로 포함: 노트 폴더 기준 fallback",
  resolveImageEmbedTarget("notes/스크린샷.png", { noteFolderPath: "project", vaultRootPath: VAULT, imageFiles: ["/vault/project/notes/스크린샷.png"] }) === "/vault/project/notes/스크린샷.png");
check("%20 디코딩 후 일치",
  resolveImageEmbedTarget("attachments/my%20image.png", { noteFolderPath: "", vaultRootPath: VAULT, imageFiles: ["/vault/attachments/my image.png"] }) === "/vault/attachments/my image.png");
check("대소문자 무시 일치(macOS)",
  resolveImageEmbedTarget("ICON.PNG", { noteFolderPath: "", vaultRootPath: VAULT, imageFiles: IMAGE_FILES }) === "/vault/attachments/icon.png");
check("못 찾으면 null",
  resolveImageEmbedTarget("없는거.png", { noteFolderPath: "", vaultRootPath: VAULT, imageFiles: IMAGE_FILES }) === null);

// ── 위키링크 파서 embed 구분 (회귀 잠금) ────────────────────────────────────
{
  const body = "링크 [[노트 제목]] 그리고 임베드 ![[Pasted image 1.png]]";
  const tokens = parseWikiLinks(body);
  const linkToken = tokens.find((t) => t.ref === "노트 제목");
  const embedToken = tokens.find((t) => t.ref === "Pasted image 1.png");
  check("일반 링크는 isEmbed=false", linkToken != null && linkToken.isEmbed === false);
  check("이미지 임베드는 isEmbed=true (링크 인덱스 제외 근거)", embedToken != null && embedToken.isEmbed === true);
  check("기존 파싱 회귀: ref/raw 유지",
    embedToken?.raw === "[[Pasted image 1.png]]" && embedToken?.mode === "title");
}

// macOS directory entries can use decomposed Hangul while Markdown uses NFC.
{
  const actual = '/vault/attachments/사운드온 제주/사운드온 제주 1.png'.normalize('NFD');
  const options = { noteFolderPath: 'inbox', vaultRootPath: '/vault', imageFiles: [actual] };
  check('NFC 링크는 NFD 실제 경로를 반환', resolveImageEmbedTarget('attachments/사운드온 제주/사운드온 제주 1.png', options) === actual);
  check('파일명만 있는 한글도 정규화 비교', resolveImageEmbedTarget('사운드온 제주 1.png', options) === actual);
  check('URL 인코딩과 정규화 함께 적용', resolveImageEmbedTarget(encodeURI('attachments/사운드온 제주/사운드온 제주 1.png'), options) === actual);
  const relative = '/vault/메모/그림/사진.png'.normalize('NFD');
  check('노트 상대경로도 실제 스캔 경로 반환', resolveImageEmbedTarget('그림/사진.png', { noteFolderPath: '메모', vaultRootPath: '/vault', imageFiles: [relative] }) === relative);
}

summary();

