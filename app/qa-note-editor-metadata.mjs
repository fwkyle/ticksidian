// Note editor metadata QA (앱 3단계 패스 1)
//
// Given: frontmatter 메타 추출/저장 문서 조립 순수 규칙(useNoteEditor.metadata.ts).
// When: 다양한 frontmatter를 추출하고 저장 문서를 조립한다.
// Then: 조건부 유지(null/undefined 신호), alias 누적, todo 재기입 계약이 유지된다.
//
// Usage:
//   cd app && node --experimental-strip-types qa-note-editor-metadata.mjs

import {
  buildNoteSaveDocument,
  extractNoteMetadata,
} from "./src/hooks/useNoteEditor.metadata.ts";
import { formatYamlKey, formatYamlValue, formatYamlValueStrict } from "./src/lib/frontmatter-yaml.ts";
import { parseFrontmatter } from "./src/lib/markdown-import.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

{
  // 추출: 기본 케이스
  const meta = extractNoteMetadata({
    title: "제목",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    aliases: ["a", "b"],
  });
  check("createdAt/updatedAt를 epoch로 변환한다",
    meta.createdAt === new Date("2026-01-01T00:00:00.000Z").getTime()
    && meta.updatedAt === new Date("2026-01-02T00:00:00.000Z").getTime());
  check("aliases 배열을 정규화해 반환한다", JSON.stringify(meta.aliases) === JSON.stringify(["a", "b"]));
  check("previousTitle을 반환한다", meta.previousTitle === "제목");
  check("일반 노트는 todoMeta가 빈 객체다", JSON.stringify(meta.todoMeta) === "{}");
  check("원본 frontmatter 객체를 그대로 반환한다(TICK-UX-002)",
    meta.frontmatter !== undefined && meta.frontmatter.title === "제목");
}

{
  // 추출: 조건부 유지 신호
  const meta = extractNoteMetadata({});
  check("aliases가 없으면 null(기존 유지 신호)", meta.aliases === null);
  check("빈 aliases 배열은 []로 반환(명시적 없음 수용)", extractNoteMetadata({ aliases: [] }).aliases !== null
    && extractNoteMetadata({ aliases: [] }).aliases.length === 0);
  check("title이 없으면 previousTitle undefined", meta.previousTitle === undefined);
  // 원본 동작 보존: truthy면 무엇이든 new Date로 변환 시도(숫자 123 → 123)
  check("createdAt 숫자는 그대로 통과(원본 truthy 체크와 동일)",
    extractNoteMetadata({ createdAt: 123 }).createdAt === 123);
  check("빈 문자열 createdAt은 undefined", extractNoteMetadata({ createdAt: "" }).createdAt === undefined);
}

{
  // 추출: todo frontmatter 보존
  const meta = extractNoteMetadata({
    type: "todo",
    done: true,
    dueDate: "2026-09-01",
    priority: "높음",
    tags: ["업무", 42, "개인"],
    externalSource: "ticktick-local-snapshot",
    externalSourceId: "abc123",
    importedAt: "2026-08-14T00:00:00.000Z",
  });
  check("todoMeta가 type: todo로 추출된다", meta.todoMeta.type === "todo");
  check("done/dueDate/priority를 보존한다",
    meta.todoMeta.done === true && meta.todoMeta.dueDate === "2026-09-01" && meta.todoMeta.priority === "높음");
  // 2026-08-23 TICK-UX-007: 태그는 투두 전용이 아니라 노트 공통 메타다.
  check("tags는 노트 공통 meta.tags로 추출되고 비문자열을 걸러낸다", JSON.stringify(meta.tags) === JSON.stringify(["업무", "개인"]));
  check("todoMeta는 더 이상 tags를 들고 다니지 않는다", meta.todoMeta.tags === undefined);
  check("externalSource/Id/importedAt을 보존한다",
    meta.todoMeta.externalSource === "ticktick-local-snapshot" && meta.todoMeta.externalSourceId === "abc123");
}

{
  // 계약(2026-08-16 F4): todoMeta는 "기존 유지"가 아니라 항상 파일 기준이다.
  // 표시를 지운 파일은 할 일로 되살리지 않되, 파일에 남은 날짜·완료 이력은 보존한다.
  const afterTodoRemoved = extractNoteMetadata({
    title: "원래 투두였던 노트",
    done: true,
    dueDate: "2026-09-01",
  });
  check("파일에 type이 없으면 할 일 표시도 없다", afterTodoRemoved.todoMeta.type === undefined);
  check("파일에 남은 done/dueDate는 보존한다",
    afterTodoRemoved.todoMeta.done === true && afterTodoRemoved.todoMeta.dueDate === "2026-09-01");

  const resaved = buildNoteSaveDocument({
    noteId: "note-x",
    title: "원래 투두였던 노트",
    markdownBody: "본문",
    now: 1770000000000,
    meta: {
      createdAt: 1,
      aliases: [],
      previousTitle: "원래 투두였던 노트",
      todoMeta: afterTodoRemoved.todoMeta,
      frontmatter: { source: "ticksidian" },
    },
  });
  check("투두 해제 후 저장 문서에 type: todo가 되살아나지 않는다",
    !resaved.content.includes('type: "todo"') && !resaved.content.includes("type: todo"));
  check("틱시디언 원본도 표시 해제 후 날짜와 완료 이력을 저장한다",
    resaved.content.includes('done: true') && resaved.content.includes('2026-09-01'));
}

{
  // 조립: alias 누적 (제목 변경 시 이전 제목이 alias에 추가)
  const now = 1770000000000;
  const saved = buildNoteSaveDocument({
    noteId: "note-1",
    title: "새제목",
    markdownBody: "# 새제목\n\n본문",
    now,
    meta: {
      createdAt: undefined,
      aliases: ["기존"],
      previousTitle: "이전제목",
      todoMeta: {},
      frontmatter: { source: "ticksidian" },
    },
  });
  check("이전 제목이 alias에 누적된다", saved.aliases.includes("이전제목"));
  check("기존 alias를 보존한다", saved.aliases.includes("기존"));
  check("createdAt이 없으면 now로 확정된다", saved.createdAt === now);
  check("previousTitle이 새 제목으로 갱신된다", saved.previousTitle === "새제목");
  check("content에 frontmatter가 포함된다", saved.content.includes("id: \"note-1\"") && saved.content.includes("# 새제목"));
  check("aliases가 frontmatter에 기록된다", saved.content.includes("aliases"));
}

{
  // 조립: 제목이 같으면 alias 누적이 일어나지 않음
  const saved = buildNoteSaveDocument({
    noteId: "note-1",
    title: "같은제목",
    markdownBody: "본문",
    now: 1,
    meta: {
      createdAt: 100,
      aliases: [],
      previousTitle: "같은제목",
      todoMeta: {},
      frontmatter: { source: "ticksidian" },
    },
  });
  check("제목 불변 시 aliases는 빈 상태 유지", saved.aliases.length === 0);
  check("createdAt은 기존 값을 유지한다", saved.createdAt === 100);
  check("빈 aliases는 frontmatter에서 생략된다", !saved.content.includes("aliases:"));
}

{
  // 조립: todo frontmatter 재기입
  const saved = buildNoteSaveDocument({
    noteId: "todo-1",
    title: "투두제목",
    markdownBody: "본문",
    now: 5,
    meta: {
      createdAt: 1,
      aliases: [],
      previousTitle: "투두제목",
      todoMeta: { type: "todo", done: false, dueDate: "2026-09-01", priority: "높음" },
      frontmatter: { source: "ticksidian", type: "todo" },
    },
  });
  check("todo meta가 문서에 재기입된다",
    saved.content.includes("type: \"todo\"") && saved.content.includes("done: false")
    && saved.content.includes("dueDate:") && saved.content.includes("priority:"));
}

{
  // TICK-UX-002: 옵시디언 원본에는 최소 frontmatter만 남긴다.
  const now = 1770000000000;
  const bare = buildNoteSaveDocument({
    noteId: "맨몸-메모",
    title: "맨몸 메모",
    markdownBody: "# 맨몸 메모\n\n본문 수정",
    now,
    meta: {
      createdAt: undefined,
      aliases: [],
      previousTitle: undefined,
      todoMeta: {},
      frontmatter: {},
    },
  });
  check("frontmatter 없는 원본 저장에 id만 최소로 붙는다", bare.content.includes("id: \"맨몸-메모\""));
  check("옵시디언 원본에 exportedAt를 붙이지 않는다", !bare.content.includes("exportedAt:"));
  check("옵시디언 원본에 source를 붙이지 않는다", !bare.content.includes("source:"));
  check("옵시디언 원본에 createdAt를 붙이지 않는다", !bare.content.includes("createdAt:"));
  check("옵시디언 원본에 updatedAt를 붙이지 않는다", !bare.content.includes("updatedAt:"));
  check("옵시디언 원본 본문은 저장된다", bare.content.includes("본문 수정"));

  const original = {
    title: "이전 제목",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    aliases: ["원래별칭"],
    exportedAt: "2026-01-03T00:00:00.000Z",
    source: "obsidian",
    cssclass: "dashboard",
  };
  const updated = buildNoteSaveDocument({
    noteId: "옵시디언-노트",
    title: "새 제목",
    markdownBody: "# 새 제목\n\n본문",
    now,
    meta: {
      createdAt: new Date("2026-01-01T00:00:00.000Z").getTime(),
      aliases: ["원래별칭"],
      previousTitle: "이전 제목",
      todoMeta: {},
      frontmatter: original,
    },
  });
  check("원본에 있던 title만 갱신한다", updated.content.includes("title: \"새 제목\""));
  check("원본에 있던 updatedAt만 갱신한다", updated.content.includes(`updatedAt: "${new Date(now).toISOString()}"`));
  check("원본 exportedAt는 값을 보존한다", updated.content.includes("2026-01-03T00:00:00.000Z"));
  check("다른 source는 덮어쓰지 않는다", updated.content.includes("source: \"obsidian\""));
  check("알 수 없는 옵시디언 필드를 보존한다", updated.content.includes("cssclass"));
}

{
  // TICK-UX-002: source=ticksidian 생성본은 기존 저장 포맷을 유지한다.
  const now = 1770000000000;
  const saved = buildNoteSaveDocument({
    noteId: "note-1",
    title: "생성본 제목",
    markdownBody: "# 생성본 제목\n\n본문",
    now,
    meta: {
      createdAt: 1,
      aliases: [],
      previousTitle: "생성본 제목",
      todoMeta: {},
      frontmatter: { source: "ticksidian" },
    },
  });
  check("Ticksidian 생성본은 exportedAt를 유지한다", saved.content.includes("exportedAt:"));
  check("Ticksidian 생성본은 source=ticksidian을 유지한다", saved.content.includes("source: \"ticksidian\""));
  check("Ticksidian 생성본은 updatedAt를 유지한다", saved.content.includes("updatedAt:"));
}

{
  // 2026-09-08 승인: 옵시디언 원본에서도 표시만 끄고 정보는 보존한다.
  const saved = buildNoteSaveDocument({
    noteId: "옵시디언-투두",
    title: "옵시디언 투두",
    markdownBody: "# 옵시디언 투두\n\n본문",
    now: 1770000000000,
    meta: {
      createdAt: undefined,
      aliases: [],
      previousTitle: undefined,
      todoMeta: {},
      frontmatter: {
        type: "todo",
        done: true,
        dueDate: "2026-08-20",
        priority: "높음",
        tags: ["업무"],
      },
    },
  });
  check("옵시디언 원본 투두→노트 변환은 type을 지운다", !saved.content.includes("type:"));
  check("옵시디언 원본은 날짜·완료·우선순위·태그를 보존한다",
    saved.content.includes("done: true") && saved.content.includes("dueDate:") && saved.content.includes("priority:") && saved.content.includes('tags: ["업무"]'));
}

{
  // 태그 = 노트 공통 메타 (2026-08-23 TICK-UX-007). 잠재 결함: 틱시디언 생성 일반 노트의 태그가 저장 때 사라졌다.
  check("일반 노트(type 없음)도 tags를 추출한다", JSON.stringify(extractNoteMetadata({ tags: ["a", 1] }).tags) === JSON.stringify(["a"]));
  check("tags 키가 없으면 undefined(원본 미변경 신호)", extractNoteMetadata({}).tags === undefined);

  const base = {
    noteId: "n", title: "노트", markdownBody: "# 노트\n\n본문", now: 1770000000000,
  };
  const ticksidianKept = buildNoteSaveDocument({
    ...base,
    meta: { createdAt: 1, aliases: [], previousTitle: undefined, todoMeta: {}, tags: ["보존"], frontmatter: { source: "ticksidian" } },
  });
  check("틱시디언 생성 일반 노트의 tags가 저장 후에도 남는다(잠재 결함 수정)", ticksidianKept.content.includes('tags: ["보존"]'));

  const obsidianAdded = buildNoteSaveDocument({
    ...base,
    meta: { createdAt: undefined, aliases: [], previousTitle: undefined, todoMeta: {}, tags: ["새"], frontmatter: { id: "n" } },
  });
  check("옵시디언 원본에 태그를 추가하면 tags 줄이 생긴다", obsidianAdded.content.includes('tags: ["새"]'));

  const obsidianRemoved = buildNoteSaveDocument({
    ...base,
    meta: { createdAt: undefined, aliases: [], previousTitle: undefined, todoMeta: {}, tags: [], frontmatter: { id: "n", tags: ["옛"] } },
  });
  check("옵시디언 원본에서 태그를 모두 지우면 tags 키가 사라진다", !obsidianRemoved.content.includes("tags:"));

  const obsidianUntouched = buildNoteSaveDocument({
    ...base,
    meta: { createdAt: undefined, aliases: [], previousTitle: undefined, todoMeta: {}, tags: undefined, frontmatter: { id: "n", tags: ["옛"] } },
  });
  check("tags undefined면 옵시디언 원본의 tags를 건드리지 않는다(최소 필드)", obsidianUntouched.content.includes('tags: ["옛"]'));
}

{
  const frontmatter = { type: 'todo', done: false, dueDate: '2026-09-01', priority: '낮음' };
  const saved = buildNoteSaveDocument({
    noteId: 'changed-before-disable', title: '원본', markdownBody: '# 원본\n본문', now: 1770000000000,
    meta: { aliases: [], frontmatter, todoMeta: { type: undefined, done: true, dueDate: '2026-09-30', priority: '높음' } },
  });
  check('날짜 수정 직후 표시를 꺼도 로드 때 옛 날짜로 되돌리지 않는다',
    saved.content.includes('2026-09-30') && !saved.content.includes('2026-09-01') && saved.content.includes('done: true') && saved.content.includes('높음'));
  const cleared = buildNoteSaveDocument({
    noteId: 'cleared-before-disable', title: '원본', markdownBody: '# 원본', now: 1770000000000,
    meta: { aliases: [], frontmatter, todoMeta: { type: undefined, done: false, dueDate: undefined, priority: undefined } },
  });
  check('지운 마감일도 표시 해제로 되살리지 않는다', !cleared.content.includes('dueDate:') && !cleared.content.includes('priority:'));
}
{
  // DEF-DATA-002: 머리말을 읽지 못하면 error 신호를 준다(읽기는 빈 머리말로 관용).
  const tab = parseFrontmatter("---\naliases:\n\t- 별칭\n---\n본문");
  check("탭 들여쓰기 머리말은 error 신호가 있다", typeof tab.error === "string");
  check("읽기는 빈 머리말과 본문으로 관용한다", Object.keys(tab.frontmatter).length === 0 && tab.body === "본문");
  const dup = parseFrontmatter("---\ntitle: a\ntitle: b\n---\n본문");
  check("중복 키 머리말은 error 신호가 있다", typeof dup.error === "string");
  const scalar = parseFrontmatter("---\njust text\n---\n본문");
  check("매핑이 아닌 머리말도 error 신호가 있다", typeof scalar.error === "string");
  check("정상 머리말은 error가 없다", parseFrontmatter("---\ntitle: a\n---\n본문").error === undefined);
  check("빈 머리말 블록은 error가 없다", parseFrontmatter("---\n\n---\n본문").error === undefined);
  check("머리말이 없는 문서는 error가 없다", parseFrontmatter("본문만").error === undefined);
}
{
  // DEF-DATA-001: 닫힌 노트 경로와 편집기 경로가 같은 직렬화 규칙을 쓴다.
  check("객체 값은 JSON 호환 YAML이다", formatYamlValueStrict("meta", { a: 1, b: [2] }) === '{"a":1,"b":[2]}');
  check("엄격 직렬화는 편집기 직렬화와 같은 결과를 낸다",
    ["x", true, 3, ["a"], { k: "v" }].every((v) => formatYamlValueStrict("k", v) === formatYamlValue(v)));
  check("키는 영숫자만 맨 키, 나머지는 따옴표다", formatYamlKey("due-date") === "due-date" && formatYamlKey("마감") === '"마감"');
  const circular = {}; circular.self = circular;
  let threw = false;
  try { formatYamlValueStrict("loop", circular); } catch { threw = true; }
  check("직렬화할 수 없는 값(순환 참조)은 던진다", threw);
  threw = false;
  try { formatYamlValueStrict("fn", () => 1); } catch { threw = true; }
  check("직렬화할 수 없는 값(함수)은 던진다", threw);
}
const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);
