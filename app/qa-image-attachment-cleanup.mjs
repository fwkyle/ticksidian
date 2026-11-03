// 노트 삭제 시 전용 이미지 판정 QA (2026-08-19 TICK-IMG-002 2-D)
//
// Given: lib/image-embed-attachment-cleanup.ts의 fail-closed 판정 규칙.
// When: 대상 노트와 다른 노트들의 임베드를 넣는다.
// Then: 전용 이미지만 걸러지고 공유/불확실은 남는다.

import { findExclusiveImageReferences } from "./src/lib/image-embed-attachment-cleanup.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

const VAULT = "/vault";
const IMAGE_FILES = [
  "/vault/attachments/전용.png",
  "/vault/attachments/공유.png",
  "/vault/attachments/안씀.png",
];

const make = (targetNoteContent, otherNotes, overrides = {}) => findExclusiveImageReferences({
  targetNoteContent,
  targetNoteFolder: "",
  otherNotes,
  vaultRootPath: VAULT,
  imageFiles: IMAGE_FILES,
  ...overrides,
});

{
  const result = make(
    "# 대상\n\n![[전용.png]]\n\n![[공유.png]]\n",
    [{ noteId: "b", folder: "", content: "# B\n\n![[공유.png]]\n" }],
  );
  check("전용만 대상", result.length === 1 && result[0] === "/vault/attachments/전용.png");
}

{
  // 다른 노트가 경로 포함 문법으로 같은 파일을 참조해도 공유로 본다.
  const result = make(
    "# 대상\n\n![[attachments/전용.png]]\n",
    [{ noteId: "b", folder: "notes", content: "# B\n\n![](attachments/전용.png)\n" }],
  );
  check("문법이 달라도 resolve 결과가 같으면 공유(제외)", result.length === 0);
}

{
  const result = make(
    "# 대상\n\n![[전용.png]]\n",
    [{ noteId: "b", folder: "", content: "# B\n" }, null],
  );
  check("다른 노트 읽기 실패(null)가 하나라도 있으면 빈 배열(fail-closed)", result.length === 0);
}

{
  const result = make("# 대상\n\n본문에 임베드 없음\n", []);
  check("임베드 없으면 빈 배열", result.length === 0);
}

{
  const result = make(
    "---\ntype: todo\n---\n# 대상\n\n![[전용.png]]\n",
    [],
  );
  check("frontmatter는 무시하고 본문만 판정", result.length === 1 && result[0] === "/vault/attachments/전용.png");
}

{
  const result = make(
    "# 대상\n\n![[없는-이미지.png]]\n",
    [],
  );
  check("resolve 실패 참조는 대상이 아니다", result.length === 0);
}

{
  // 코드블록 안의 임베드는 참조가 아니다.
  const result = make(
    "# 대상\n\n```\n![[전용.png]]\n```\n",
    [],
  );
  check("코드블록 안 임베드는 무시", result.length === 0);
}

{
  // 여러 이미지 중 일부만 공유.
  const result = make(
    "# 대상\n\n![[전용.png]]\n\n![[공유.png]]\n\n![[안씀.png]]\n",
    [{ noteId: "b", folder: "", content: "![[공유.png]]\n" }],
  );
  check(
    "공유만 빼고 전용+미참조(대상이 쓰는 것)가 남는다",
    // 정렬은 경로 문자열 기준(한글 코드포인트) — 안씀.png가 전용.png보다 앞서는 게 정상",
    result.join("|") === "/vault/attachments/안씀.png|/vault/attachments/전용.png",
  );
}

summary();
