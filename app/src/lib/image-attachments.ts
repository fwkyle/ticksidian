/**
 * image-attachments.ts — 노트 소속 이미지 저장 경로 계획 (2026-08-19 TICK-IMG-002).
 *
 * [kyle] 결정 "노션 체감형": 붙여넣은 이미지를 attachments/{노트제목}/ 아래에
 * 의미 있는 이름으로 저장한다. 저장이 눈에 안 보이게 — 체감은 노션, 파일은 옵시디언 호환.
 *
 * 충돌 접미는 note-filename과 동일 규칙(첫 장 "{제목}", 이후 "{제목} 1", "{제목} 2" …).
 * 노트 제목이 나중에 바뀌어도 폴더를 따라 rename하지 않는다(경로 포함 링크라 안 깨진다).
 * 설계: docs/waterfall/03-상세설계/이미지-넣기-노션-체감형.md 2-B.
 */

import { imagePathKey } from "./image-path-key.ts";
import { sanitizeTitleForFilename } from "./note-filename.ts";

export const ATTACHMENTS_ROOT_FOLDER = "attachments";

/**
 * 이미지 한 장의 상한(20MiB). Rust `file_commands.rs::MAX_BINARY_FILE_BYTES`와 같은 값이다.
 * 프론트에서 먼저 걸러야 22MB짜리를 메모리에 올린 뒤 거부당하는 낭비가 없고,
 * 무엇보다 사용자가 "왜 안 되는지"를 알 수 있다(TICK-BUG-002).
 */
export const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** 사람이 읽는 크기 문구. 안내 문구에만 쓴다. */
export function formatImageSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export interface PlanImageAttachmentPathsInput {
  /** 에디터의 현재 노트 제목(첫 헤딩). */
  noteTitle: string;
  /** 파일 확장자(점 없음, 소문자). 예: "png". */
  extension: string;
  /** 이번에 함께 넣는 장수. */
  count: number;
  /** 충돌 검사용 기존 파일 절대경로 집합(소문자). 볼트 전체 기준. */
  existingLowercase: ReadonlySet<string>;
  /** 볼트 루트 절대경로. */
  vaultRootPath: string;
}

export interface ImageAttachmentPlan {
  /** 저장할 절대경로들(순서 = 넣는 순서). */
  absolutePaths: string[];
  /** 각 파일의 볼트 상대경로 — 임베드 raw(![[…]])에 쓴다. */
  relativePaths: string[];
}

/**
 * 노트 소속 저장 경로를 계획한다. 제목을 파일명으로 쓸 수 없으면 null(저장 중단).
 * 같은 배치 안에서도 서로 겹치지 않게 taken set을 갱신한다.
 */
export function planImageAttachmentPaths(
  input: PlanImageAttachmentPathsInput,
): ImageAttachmentPlan | null {
  const { noteTitle, extension, count, existingLowercase, vaultRootPath } = input;
  const sanitized = sanitizeTitleForFilename(noteTitle);
  if (sanitized === null || count <= 0) return null;

  const root = vaultRootPath.replace(/\/$/, "");
  const taken = new Set([...existingLowercase].map(imagePathKey));
  const absolutePaths: string[] = [];
  const relativePaths: string[] = [];

  for (let index = 0; index < count; index += 1) {
    let stem = sanitized;
    if (taken.has(imagePathKey(buildAbsolutePath(root, sanitized, stem, extension)))) {
      stem = nextAvailableStem(sanitized, extension, root, taken);
    }
    const absolute = buildAbsolutePath(root, sanitized, stem, extension);
    const relative = `${ATTACHMENTS_ROOT_FOLDER}/${sanitized}/${stem}.${extension}`;
    taken.add(imagePathKey(absolute));
    absolutePaths.push(absolute);
    relativePaths.push(relative);
  }

  return { absolutePaths, relativePaths };
}

function buildAbsolutePath(root: string, folder: string, stem: string, extension: string): string {
  return `${root}/${ATTACHMENTS_ROOT_FOLDER}/${folder}/${stem}.${extension}`;
}

function nextAvailableStem(
  base: string,
  extension: string,
  root: string,
  taken: ReadonlySet<string>,
): string {
  for (let n = 1; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(imagePathKey(buildAbsolutePath(root, base, candidate, extension)))) {
      return candidate;
    }
  }
}

/** File/Blob MIME → 확장자(점 없음). 모르면 null. */
export function extensionForMimeType(mimeType: string): string | null {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/avif": "avif",
  };
  return map[mimeType.toLowerCase()] ?? null;
}

