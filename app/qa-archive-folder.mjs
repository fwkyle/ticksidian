import {
  isArchiveFolder,
  sortFolderNodesForDisplay,
} from "./src/lib/archive-folder.ts";
import { isAttachmentsFolder } from "./src/lib/archive-folder.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

function folder(path, children = []) {
  return { name: path.split("/").at(-1), path, children, isProject: false };
}

{
  check("최상위 archive만 보관 폴더다", isArchiveFolder("archive"));
  check("중첩 archive는 특별 취급하지 않는다", !isArchiveFolder("notes/archive"));
}

{
  const sorted = sortFolderNodesForDisplay([
    folder("notes"),
    folder("archive"),
    folder("inbox"),
  ]);
  check("보관 폴더는 맨 아래로 간다", sorted.map((f) => f.path).join("," ) === "notes,inbox,archive");
  check("다른 폴더 순서는 유지된다", sorted[0].path === "notes" && sorted[1].path === "inbox");
}

// ── attachments 폴더(2026-08-19 TICK-IMG-002 2-C) ──────────────────────
{
  check("최상위 attachments만 특별 취급", isAttachmentsFolder("attachments"));
  check("중첩 attachments는 특별 취급하지 않는다", !isAttachmentsFolder("notes/attachments"));
}
{
  const sorted = sortFolderNodesForDisplay([
    folder("archive"),
    folder("attachments"),
    folder("notes"),
    folder("inbox"),
  ]);
  check(
    "attachments는 맨 아래로 가고 archive는 계속 마지막이다",
    sorted.map((f) => f.path).join(",") === "notes,inbox,attachments,archive",
  );
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);
