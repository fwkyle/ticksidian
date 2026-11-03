// 노트 소속 이미지 저장 경로 계획 QA (2026-08-19 TICK-IMG-002 2-B)
//
// Given: lib/image-attachments.ts의 경로 계획 순수 규칙.
// When: 노트 제목/확장자/기존 파일 집합을 넣는다.
// Then: attachments/{제목}/ 아래 의미 있는 이름이 만들어지고 충돌이 회피된다.

import {
  planImageAttachmentPaths,
  extensionForMimeType,
  ATTACHMENTS_ROOT_FOLDER,
} from "./src/lib/image-attachments.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

const VAULT = "/vault";
const plan = (input) => planImageAttachmentPaths({ vaultRootPath: VAULT, ...input });

// ── 기본 경로 ────────────────────────────────────────────────────────────────
{
  const result = plan({ noteTitle: "회의록", extension: "png", count: 1, existingLowercase: new Set() });
  check("첫 장은 attachments/{제목}/{제목}.png",
    result?.relativePaths[0] === "attachments/회의록/회의록.png");
  check("절대경로도 노트 소속 폴더",
    result?.absolutePaths[0] === "/vault/attachments/회의록/회의록.png");
}

{
  const result = plan({ noteTitle: "회의록", extension: "png", count: 3, existingLowercase: new Set() });
  check("여러 장은 같은 배치에서도 순차 접미",
    result?.relativePaths.join("|") ===
      "attachments/회의록/회의록.png|attachments/회의록/회의록 1.png|attachments/회의록/회의록 2.png");
}

{
  const existing = new Set(["/vault/attachments/회의록/회의록.png"]);
  const result = plan({ noteTitle: "회의록", extension: "png", count: 1, existingLowercase: existing });
  check("기존 파일과 충돌하면 {제목} 1",
    result?.relativePaths[0] === "attachments/회의록/회의록 1.png");
}

{
  const existing = new Set([
    "/vault/attachments/회의록/회의록.png",
    "/vault/attachments/회의록/회의록 1.png",
  ]);
  const result = plan({ noteTitle: "회의록", extension: "png", count: 1, existingLowercase: existing });
  check("연속 충돌은 다음 번호",
    result?.relativePaths[0] === "attachments/회의록/회의록 2.png");
}

{
  // 폴더는 항상 제목 기준 — stem 접미와 무관하게 같은 노트 폴더에 쌓인다.
  const result = plan({ noteTitle: "메모", extension: "png", count: 2, existingLowercase: new Set() });
  check("접미가 붙어도 폴더는 노트 제목 그대로",
    result?.relativePaths.every((p) => p.startsWith("attachments/메모/")) === true);
}

// ── 제목 정리 ────────────────────────────────────────────────────────────────
{
  const result = plan({
    noteTitle: "A/B:C*D?E|F", extension: "png", count: 1, existingLowercase: new Set(),
  });
  check("금지 문자는 note-filename 규칙으로 정리된다",
    result?.relativePaths[0] === "attachments/A B C D E F/A B C D E F.png");
}

check("빈 제목은 null(저장 중단)", plan({ noteTitle: "  ", extension: "png", count: 1, existingLowercase: new Set() }) === null);
check("기본 제목(새 노트)도 그대로 쓴다 — 노트 소속이므로 안전",
  plan({ noteTitle: "새 노트", extension: "png", count: 1, existingLowercase: new Set() })?.relativePaths[0] === "attachments/새 노트/새 노트.png");
check("count 0은 null", plan({ noteTitle: "제목", extension: "png", count: 0, existingLowercase: new Set() }) === null);

// ── 확장자 ──────────────────────────────────────────────────────────────────
check("image/png → png", extensionForMimeType("image/png") === "png");
check("image/jpeg → jpg(대소문자 무시)", extensionForMimeType("IMAGE/JPEG") === "jpg");
check("image/webp → webp", extensionForMimeType("image/webp") === "webp");
check("모르는 MIME은 null", extensionForMimeType("application/octet-stream") === null);
check("attachments 루트 상수", ATTACHMENTS_ROOT_FOLDER === "attachments");

{
  const result = plan({ noteTitle: '회의록 1', extension: 'png', count: 2, existingLowercase: new Set() });
  check('숫자로 끝나는 제목도 절대경로와 링크가 일치', result.absolutePaths.every((path, index) => path === `${VAULT}/${result.relativePaths[index]}`));
  check('숫자 제목 폴더는 고정', result.absolutePaths.every(path => path.startsWith('/vault/attachments/회의록 1/')));
}
{
  const existing = new Set(['/vault/attachments/회의록/회의록.png'.normalize('NFD')]);
  const result = plan({ noteTitle: '회의록', extension: 'png', count: 2, existingLowercase: existing });
  check('한글 구성만 다른 기존 이미지 덮어쓰기 방지', result.relativePaths.join('|') === 'attachments/회의록/회의록 1.png|attachments/회의록/회의록 2.png');
}

summary();

