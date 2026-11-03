import {
  classifyAutoOpenSize,
  findAutoOpenableNoteId,
} from "./src/lib/note-open-selection.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";
import { isExcalidrawPluginNote, excalidrawNoteMessage } from "./src/lib/excalidraw-note.ts";


const { check, summary } = createReporter();

function note(id, overrides = {}) {
  return {
    id,
    fileBasename: id,
    title: id,
    folder: "",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function makeIO(sizes, contents) {
  const reads = [];
  return {
    reads,
    io: {
      async getFileSize(id) {
        if (!(id in sizes)) throw new Error(`size failed: ${id}`);
        const size = sizes[id];
        return size ?? null;
      },
      async readNoteContent(id) {
        reads.push(id);
        if (!(id in contents)) throw new Error(`read failed: ${id}`);
        return contents[id];
      },
    },
  };
}

{
  check("바이트 50만 이하는 확정 통과", classifyAutoOpenSize(500_000) === "pass");
  check("바이트 50만 초과는 경계 검사", classifyAutoOpenSize(500_001) === "inspect");
  check("바이트 150만 이하는 경계 검사", classifyAutoOpenSize(1_500_000) === "inspect");
  check("바이트 150만 초과는 확정 차단", classifyAutoOpenSize(1_500_001) === "block");
  check("크기 unknown은 경계 검사", classifyAutoOpenSize(null) === "inspect");
}

{
  const { io, reads } = makeIO({ small: 100_000 }, {});
  const selected = await findAutoOpenableNoteId([note("small")], io);
  check("작은 후보는 본문을 읽지 않고 통과", selected === "small" && reads.length === 0);
}

{
  const { io, reads } = makeIO({ giant: 12_000_000 }, {});
  const selected = await findAutoOpenableNoteId([note("giant")], io);
  check("12MB 후보는 본문을 읽지 않고 차단", selected === null && reads.length === 0);
}

{
  const korean = "가".repeat(300_000);
  const { io, reads } = makeIO({ korean: 900_000 }, { korean });
  const selected = await findAutoOpenableNoteId([note("korean")], io);
  check("한글 경계 후보는 본문을 읽어 통과", selected === "korean" && reads.includes("korean"));
}

{
  const large = "a".repeat(500_001);
  const { io, reads } = makeIO(
    { large: 500_001, next: 10_000 },
    { large },
  );
  const selected = await findAutoOpenableNoteId([note("large"), note("next")], io);
  check("경계 초과 후보는 건너뛰고 다음 후보를 연다",
    selected === "next" && reads.includes("large"));
}

{
  const { io, reads } = makeIO({ unknown: null }, { unknown: "짧은 노트" });
  const selected = await findAutoOpenableNoteId([note("unknown")], io);
  check("크기 unknown 후보는 본문으로 정확 판정", selected === "unknown" && reads.includes("unknown"));
}

{
  const { io } = makeIO({ a: 2_000_000, b: 2_000_000 }, {});
  const selected = await findAutoOpenableNoteId([note("a"), note("b")], io);
  check("모두 한계 초과면 null(자동 선택 없음)", selected === null);
}

{
  const { io, reads } = makeIO({ todo: 10_000, normal: 20_000 }, {});
  const selected = await findAutoOpenableNoteId(
    [note("todo", { type: "todo" }), note("normal")],
    io,
  );
  check("투두는 자동 오픈 후보에서 제외", selected === "normal" && !reads.includes("todo"));
}

{
  const { io, reads } = makeIO({ next: 10_000 }, { next: "다음 노트" });
  const selected = await findAutoOpenableNoteId([note("broken"), note("next")], io);
  check("후보 IO 실패는 다음 후보로 넘어간다", selected === "next" && !reads.includes("broken"));
}


{
  // Excalidraw 플러그인 그림은 자동 선택에서 제외된다(2026-08-20 편집 보호 연장).
  const { io } = makeIO({ draw: 100, normal: 100 }, {});
  const picked = await findAutoOpenableNoteId(
    [note("draw", { excalidrawPlugin: true }), note("normal")],
    io,
  );
  check("excalidraw 플러그인 노트는 건너뛰고 다음 노트를 고른다", picked === "normal");

  const onlyDraw = await findAutoOpenableNoteId([note("draw", { excalidrawPlugin: true })], io);
  check("excalidraw뿐이면 자동 선택하지 않는다", onlyDraw === null);
}

{
  check(
    "frontmatter excalidraw-plugin 키가 있으면 그림 파일이다(값 무관)",
    isExcalidrawPluginNote({ "excalidraw-plugin": "parsed" })
      && isExcalidrawPluginNote({ "excalidraw-plugin": "raw" }),
  );
  check("키가 없으면 그림 파일이 아니다", !isExcalidrawPluginNote({ title: "x" }));
  check("보호 안내는 원본 불변을 명시한다", excalidrawNoteMessage().includes("아무것도 바뀌지"));
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);
