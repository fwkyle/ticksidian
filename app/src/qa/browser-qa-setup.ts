/**
 * 브라우저 QA 픽스처 셋업 (TICK-P1-016)
 *
 * VITE_TICKSIDIAN_BROWSER_QA=1 일 때만 main.tsx에서 동적 import로 로드된다.
 * 일반 빌드/dev에는 포함되지 않는다.
 *
 * 역할:
 * 1. @tauri-apps/api/mocks의 mockIPC/mockWindows를 설치해 invoke()를 가로챈다.
 * 2. MemoryVaultAdapter 위에 mock 백엔드를 구축해 파일 명령을 처리한다.
 * 3. vault/db 명령은 in-memory 구현으로 처리한다.
 * 4. watcher 명령(start/stop)과 event listen은 no-op으로 처리한다.
 * 5. setActiveVaultAdapter로 tauri-vault-adapter의 singleton을 교체한다.
 * 6. localStorage에 볼트 경로를 심어 앱 초기화가 볼트 선택 화면을 건너뛰게 한다.
 *
 * 한계(브라우저 QA 원칙과 동일):
 * - 실제 OS 파일 IO, macOS keychain, Tauri capability는 검증하지 않는다.
 * - 이 QA는 "브라우저 fixture QA"로 기록한다.
 */

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createMemoryVaultAdapter } from "../lib/memory-vault-adapter";
import type { VaultAdapter } from "../lib/vault-adapter";
import { setActiveVaultAdapter } from "../lib/tauri-vault-adapter";
import { createInboxOrganizerFixture } from "./inbox-organizer-fixture";

// ── seed 노트 콘텐츠 ─────────────────────────────────────────────────────────

/**
 * seed 노트: 브라우저 QA용 in-memory 볼트에 미리 심는 파일들.
 * 경로 형식: /mock-vault/notes/{filename}.md
 */
const VAULT_PATH = "/mock-vault";
const NOTES_DIR = `${VAULT_PATH}/notes`;

/**
 * 1x1 유효 PNG(70바이트) — 이미지 임베드 보기 QA용 fixture(2026-08-19 TICK-IMG-001).
 * zlib deflate로 직접 만들어 sips로 유효성을 확인했다.
 */
const FIXTURE_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
  0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 16, 16, 0, 0, 4,
  241, 1, 160, 137, 202, 111, 191, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function makeSeedNote(
  id: string,
  title: string,
  aliases: string[],
  body: string,
  updatedAt: string,
): string {
  const aliasesLine =
    aliases.length > 0
      ? `aliases: ${JSON.stringify(aliases)}\n`
      : "aliases: []\n";
  return (
    `---\n` +
    `id: "${id}"\n` +
    aliasesLine +
    `updatedAt: "${updatedAt}"\n` +
    `---\n` +
    `# ${title}\n\n` +
    body
  );
}

const SEED_NOTES: Record<string, string> = {
  [`${NOTES_DIR}/note-alpha.md`]: makeSeedNote(
    "note-alpha",
    "알파 노트",
    ["alpha", "첫 번째"],
    "브라우저 QA 테스트용 첫 번째 노트입니다.\n\n"
      // 2026-08-18: 위키링크 배너(기본 접힘) 검증용. 미해결 링크가 있어야 배너가 뜬다.
      + "관련 문서: [[아직 없는 노트]]\n",
    "2026-06-10T00:00:00.000Z",
  ),
  [`${NOTES_DIR}/note-beta.md`]: makeSeedNote(
    "note-beta",
    "베타 노트",
    ["beta"],
    "브라우저 QA 테스트용 두 번째 노트입니다.\n",
    "2026-06-10T00:01:00.000Z",
  ),
  [`${NOTES_DIR}/note-gamma.md`]: makeSeedNote(
    "note-gamma",
    "감마 노트",
    [],
    "브라우저 QA 테스트용 세 번째 노트입니다. 외부 수정 시뮬레이션 대상.\n",
    "2026-06-10T00:02:00.000Z",
  ),
  // 2026-08-16 볼트 전체 스캔: `notes/` 밖 폴더의 노트도 목록에 나와야 한다.
  // 옵시디언 볼트처럼 루트에 여러 폴더가 있는 구조를 재현한다.
  [`${VAULT_PATH}/lectures/강의-노트.md`]: makeSeedNote(
    "강의-노트",
    "강의 노트",
    [],
    "notes 폴더 밖(lectures)에 있는 문서입니다.\n",
    "2026-06-10T00:03:00.000Z",
  ),
  // frontmatter 없는 순수 마크다운(옵시디언 원본과 같은 형태)도 읽혀야 한다.
  [`${VAULT_PATH}/inbox/맨몸-메모.md`]: "# 맨몸 메모\n\nfrontmatter 없는 옵시디언 노트입니다.\n",
  // TICK-UX-001: 보관 폴더는 실제 최상위 폴더로 심는다. 스캔/검색에는 계속 포함된다.
  [`${VAULT_PATH}/archive/오래된 노트.md`]:
    '---\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n# 오래된 노트\n',
  // 2026-08-30 TICK-REVIEW-002 단계 2: 내 노트 검토 후보(fixture).
  // notes 폴더의 오래된 노트(90일↑)와 임시 흔적 노트. archive는 대상에서 제외되므로 위 노트는 후보가 아니다.
  [`${VAULT_PATH}/notes/2019-여행-기록.md`]:
    '---\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n# 2019 여행 기록\n',
  [`${VAULT_PATH}/notes/QA-화면-테스트.md`]:
    '---\nupdatedAt: "2026-08-29T00:00:00.000Z"\n---\n# QA 화면 테스트\n',
  [`${VAULT_PATH}/archive/내부/오래된 메모.md`]:
    '---\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n# 오래된 메모\n',
  // 2026-08-18: 종류 필터 검증용 투두. 노트와 같은 폴더에 섞여 있어야 한다
  // ([kyle] 결정: 폴더는 맥락만 맡고 노트·투두가 함께 들어간다).
  [`${NOTES_DIR}/todo-alpha.md`]:
    '---\nid: "todo-alpha"\ntype: "todo"\ndone: false\n'
    + 'tags: ["ticktick-import","ticktick-inbox"]\nupdatedAt: "2026-06-10T00:05:00.000Z"\n---\n'
    + "# 세금계산서 발행\n",
  [`${NOTES_DIR}/todo-beta.md`]:
    '---\nid: "todo-beta"\ntype: "todo"\ndone: false\ndueDate: "2026-01-15"\n'
    + 'tags: ["ticktick-import","ticktick-inbox","manual-review"]\nupdatedAt: "2026-06-10T00:06:00.000Z"\n---\n'
    + "# 멘토님 연락\n",
  // 2026-08-16: 편집기 한계(50만 자)를 넘는 노트. 실볼트의 `팅김.md`(12MB 크래시 로그)가
  // 앱을 프리징시킨 사고를 재현한다. 번들을 키우지 않도록 런타임에 생성한다.
  [`${VAULT_PATH}/inbox/거대-덤프.md`]: `# 거대 덤프\n\n${"x".repeat(520_000)}\n`,
};

// ── in-memory vault adapter ──────────────────────────────────────────────────

/**
 * 페이지 리로드 사이에 파일 쓰기를 유지하기 위한 localStorage 미러.
 * MemoryVaultAdapter는 휘발성이라 재접속 유지 QA(검토 큐 등)가 불가능하므로,
 * write/delete만 localStorage에 반영하고 다음 로드에서 initialFiles로 되살린다.
 * Playwright 테스트별 컨텍스트가 새로 만들어지므로 테스트 간 오염은 없다.
 */
const QA_VAULT_FILES_STORAGE_KEY = "ticksidian-qa-vault-files";
/** 이미지 등 바이너리 쓰기 미러(2026-08-19 이미지 넣기). number[]로 JSON 저장한다. */
const QA_VAULT_BINARIES_STORAGE_KEY = "ticksidian-qa-vault-binaries";

function loadPersistedFiles(): Record<string, string> {
  try {
    const raw = localStorage.getItem(QA_VAULT_FILES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, value]) => typeof value === "string",
    ) as [string, string][];
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

const persistedVaultFiles = loadPersistedFiles();

function loadPersistedBinaries(): Record<string, Uint8Array> {
  try {
    const raw = localStorage.getItem(QA_VAULT_BINARIES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, value]) => Array.isArray(value),
    ) as [string, number[]][];
    return Object.fromEntries(entries.map(([path, bytes]) => [path, new Uint8Array(bytes)]));
  } catch {
    return {};
  }
}

const persistedVaultBinaries = loadPersistedBinaries();

const memAdapter = createMemoryVaultAdapter({
  initialVaultPath: VAULT_PATH,
  // attachments 하위 폴더 시드(2-C): 접힘 토글은 하위 폴더가 있을 때만 생긴다.
  initialDirectories: [NOTES_DIR, `${VAULT_PATH}/attachments/이미지 노트`],
  initialFiles: {
    ...Object.fromEntries(Object.entries(SEED_NOTES).filter(([path]) =>
      !(window as Window & { __qa_omitInboxSeed?: boolean }).__qa_omitInboxSeed ||
      !path.startsWith(`${VAULT_PATH}/inbox/`))),
    ...persistedVaultFiles,
  },
  initialBinaryFiles: {
    [`${VAULT_PATH}/attachments/픽스처-이미지.png`]: FIXTURE_PNG,
    [`${VAULT_PATH}/attachments/픽스처-이미지2.png`]: FIXTURE_PNG,
    // 20MB 상한 초과 재현용(읽기 차단 문구 QA). 런타임 생성이라 번들이 커지지 않는다.
    [`${VAULT_PATH}/attachments/거대-이미지.png`]: new Uint8Array(21 * 1024 * 1024),
    ...persistedVaultBinaries,
  },
});

// 시작 화면(VaultSelectionScreen) 검증용: 볼트 시딩을 건너뛰는 경우 메모리 어댑터의
// 현재 볼트도 비운다. 어댑터가 initialVaultPath를 이미 품고 있어 localStorage만
// 비우면 앱이 여전히 볼트가 있는 것으로 부팅하기 때문이다.
if ((window as Window & { __qa_skipVaultSeed?: boolean }).__qa_skipVaultSeed) {
  memAdapter.setVaultPath(null);
}

const trackedVaultFiles: Record<string, string> = { ...persistedVaultFiles };
const trackedVaultBinaries = new Map<string, Uint8Array>(
  Object.entries(persistedVaultBinaries),
);

function saveTrackedFiles(): void {
  try {
    localStorage.setItem(QA_VAULT_FILES_STORAGE_KEY, JSON.stringify(trackedVaultFiles));
  } catch {
    // 저장 용량 초과 등은 QA 편의 기능이므로 조용히 무시한다
  }
}

function saveTrackedBinaries(): void {
  try {
    localStorage.setItem(
      QA_VAULT_BINARIES_STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          [...trackedVaultBinaries].map(([path, bytes]) => [path, [...bytes]]),
        ),
      ),
    );
  } catch {
    // 저장 용량 초과 등은 QA 편의 기능이므로 조용히 무시한다.
  }
}

/**
 * 파일 읽기를 지정 횟수만큼 강제로 실패시키는 주입 장치(2026-08-16 F1 회귀 QA).
 * "외부 수정 감지 → 자동 재로드 시도 → 읽기 실패" 경로를 재현하기 위한 것이다.
 * 키는 절대경로, 값은 남은 실패 횟수.
 */
const heldReads = new Map<string, { started: boolean; promise: Promise<void>; release: () => void }>();
const forcedReadFailures = new Map<string, number>();

// 볼트 어댑터를 메모리 fixture로 교체. 쓰기/삭제는 localStorage에도 반영한다.
const qaVaultAdapter: VaultAdapter = {
  ...memAdapter,
  // 볼트 전환 실패 QA(DEF-CONC-001): 다음 선택 경로를 정하고, 지정 경로는 "경로가 바뀐 뒤 권한 거부"로 실패시킨다.
  selectVaultFolder: async () => {
    const w = window as Window & { __qa_nextVaultSelection?: string };
    return w.__qa_nextVaultSelection ?? memAdapter.selectVaultFolder();
  },
  registerVaultPath: async (vaultPath) => {
    await memAdapter.registerVaultPath(vaultPath);
    if ((window as Window & { __qa_denyVaultPath?: string }).__qa_denyVaultPath === vaultPath) {
      throw new Error(`QA 권한 거부 볼트: ${vaultPath}`);
    }
  },
  readTextFile: async (path) => {
    const held = heldReads.get(path);
    if (held && !held.started) {
      held.started = true;
      await held.promise;
      heldReads.delete(path);
    }
    const remainingFailures = forcedReadFailures.get(path) ?? 0;
    if (remainingFailures > 0) {
      forcedReadFailures.set(path, remainingFailures - 1);
      throw new Error(`QA 강제 읽기 실패(F1 회귀 재현): ${path}`);
    }
    return memAdapter.readTextFile(path);
  },
  writeTextFile: async (path, content, expectedMtime) => {
    await (window as Window & {
      __qa_beforeVaultWrite?: (path: string, content: string) => Promise<void>;
    }).__qa_beforeVaultWrite?.(path, content);
    const writtenMtime = await memAdapter.writeTextFile(path, content, expectedMtime);
    trackedVaultFiles[path] = content;
    saveTrackedFiles();
    // 게시 직후·반환 직전에 외부 쓰기가 끼어드는 틈을 재현한다(DEF-CONC-002 QA).
    // 반환값은 훅 실행 전에 확정된 "내가 쓴 mtime"이라 외부 쓰기가 섞이지 않는다.
    await (window as Window & {
      __qa_afterVaultWrite?: (path: string) => Promise<void>;
    }).__qa_afterVaultWrite?.(path);
    return writtenMtime;
  },
  readBinaryFile: async (path) => {
    // Rust read_binary_file의 20MiB 상한을 어댑터 경로(앱 코드가 쓰는 경로)에서도
    // 같은 의미로 재현한다. mockIPC 핸들러만 재현하면 어댑터 직접 호출이 21MB를 실어 온다.
    const stat = await memAdapter.getFileStat(path);
    if (stat.size > 20 * 1024 * 1024) {
      throw new Error(
        `file is too large: ${stat.size} bytes exceeds the ${20 * 1024 * 1024} byte limit`,
      );
    }
    return memAdapter.readBinaryFile(path);
  },
  deleteFile: async (path) => {
    await memAdapter.deleteFile(path);
    delete trackedVaultFiles[path];
    saveTrackedFiles();
  },
  writeBinaryFile: async (path, bytes) => {
    // Rust write_binary_file의 ensure_binary_within_limit(20MiB)를 같은 뜻으로 재현한다.
    // 읽기 쪽만 재현돼 있어서 "20MB 초과 붙여넣기가 조용히 무시되는" 결함을 fixture가
    // 구조적으로 못 잡았다(2026-08-23 [kyle] B5 실창 발견 → TICK-BUG-002).
    if (bytes.length > 20 * 1024 * 1024) {
      throw new Error(
        `file is too large: ${bytes.length} bytes exceeds the ${20 * 1024 * 1024} byte limit`,
      );
    }
    await memAdapter.writeBinaryFile(path, bytes);
    trackedVaultBinaries.set(path, new Uint8Array(bytes));
    saveTrackedBinaries();
  },
};
setActiveVaultAdapter(qaVaultAdapter);
const inboxOrganizerFixture = createInboxOrganizerFixture(qaVaultAdapter);

// localStorage에 볼트 경로를 심어 앱이 볼트 선택 화면 없이 바로 로드.
// 테스트가 시작 화면(VaultSelectionScreen)을 검증해야 할 때는 init script에서
// window.__qa_skipVaultSeed = true 를 심어 이 시딩을 건너뛴다(2026-08-18 TICK-UX-008 1단계).
if (!(window as Window & { __qa_skipVaultSeed?: boolean }).__qa_skipVaultSeed) {
  localStorage.setItem("ticksidian-vault-path", VAULT_PATH);
}

// ── in-memory vault binding store ────────────────────────────────────────────

interface VaultBindingRow {
  local_vault_id: string;
  local_vault_path: string;
  sync_mode: string;
  account_id: string | null;
  remote_vault_id: string | null;
  auth_state: string;
  last_sync_cursor: string | null;
  last_sync_summary_json: string | null;
  created_at: number;
  updated_at: number;
}

const vaultBindings = new Map<string, VaultBindingRow>();

function defaultBinding(vaultPath: string): VaultBindingRow {
  const now = Date.now();
  return {
    local_vault_id: "mock-vault-id",
    local_vault_path: vaultPath,
    sync_mode: "local_only",
    account_id: null,
    remote_vault_id: null,
    auth_state: "signed_out",
    last_sync_cursor: null,
    last_sync_summary_json: null,
    created_at: now,
    updated_at: now,
  };
}

// ── sync meta store ───────────────────────────────────────────────────────────

const syncMetaStore = new Map<string, unknown>();

// ── 보안 메모 뷰어 fixture 스토어 (TICK-SEC-002 쓰기 동등 구현) ──────────────
// 실제 비밀 폴더 접근은 Rust command만 하므로 브라우저 QA는 가짜 저장소다.
// mtime/백업 회전도 Rust 의미를 같은 뜻으로 재현한다(파일 권한·open -R은 재현 불가).

interface SecretFixtureFile {
  content: string;
  mtime: number;
}

const secretFixtureFiles = new Map<string, SecretFixtureFile>([
  [
    "gemini/projects/memory-core.env",
    {
      content: "# Gemini 프로젝트 키\nGEMINI_API_KEY=fake-key-for-qa\nEMPTY=\n",
      mtime: 1700000000000,
    },
  ],
  [
    "aws/test-key.pem",
    {
      content:
        "-----BEGIN OPENSSH PRIVATE KEY-----\nfakekeybodyline1\nfakekeybodyline2\n-----END OPENSSH PRIVATE KEY-----\n",
      mtime: 1700000000001,
    },
  ],
  ["notion.env", { content: "NOTION_TOKEN=fake-notion-token\n", mtime: 1700000000002 }],
]);
const secretFixtureBackups: string[] = [];
// 비밀 폴더 설정 fixture: 기본은 설정됨(기존 QA 유지). `?secretsUnset=1`이면 미설정으로 시작한다.
const QA_SECRETS_PATH = "/qa/secrets-folder";
const secretsQuery = new URLSearchParams(window.location.search);
const secretsRejectedReason = secretsQuery.has("secretsRejected")
  ? "설정된 폴더가 허용되지 않아 무시했습니다. 다시 고르세요. (홈 폴더 전체는 비밀 폴더로 쓸 수 없습니다.)"
  : null;
let secretsFolderConfigured = !secretsQuery.has("secretsUnset") && !secretsQuery.has("secretsRejected");
let secretsSelectCalls = 0;
const SECRET_FIXTURE_BACKUP_KEEP = 5;
let secretRevealCalls = 0;

// ── mockIPC 설치 ─────────────────────────────────────────────────────────────

/**
 * mockWindows: 메인 창 라벨 설정. @tauri-apps/api/window 모듈 사용 전에 필요.
 */
mockWindows("main");

/**
 * mockIPC: invoke()를 가로채 in-memory 백엔드로 응답.
 *
 * 처리하는 명령 목록:
 * - 파일 IO: read_text_file, write_text_file, list_directory_entries,
 *            read_markdown_file, write_markdown_file, delete_file,
 *            rename_directory, trash_directory,
 *            get_file_stat, list_directory, check_file_exists, create_directory
 * - vault: register_vault_path, list_vault_notes
 * - db: get_vault_binding, upsert_vault_binding, list_vault_bindings,
 *       get_sync_meta, upsert_sync_meta, delete_sync_meta, list_sync_meta_by_state
 * - watcher: start_vault_watch, stop_vault_watch (no-op)
 * - keychain: secure_get_refresh_token, secure_set_refresh_token, secure_clear_refresh_token (no-op)
 * - dialog: plugin:dialog|open → 볼트 선택 취소(null) 반환
 */
mockIPC(async (cmd, payload) => {
  const p = (payload ?? {}) as Record<string, unknown>;

  // ── 파일 IO: MemoryVaultAdapter 위임(쓰기/삭제는 localStorage 미러 경유) ────
  // 읽기 강제 실패 주입은 qaVaultAdapter.readTextFile에 있으므로 여기서 중복 처리하지 않는다.
  if (cmd === "read_text_file" || cmd === "read_markdown_file") {
    const path = p["path"] as string;
    return qaVaultAdapter.readTextFile(path);
  }

  if (cmd === "read_binary_file") {
    const path = p["path"] as string;
    // Rust read_binary_file의 20MiB 상한을 fixture에서 같은 뜻으로 재현한다.
    const stat = await qaVaultAdapter.getFileStat(path);
    if (stat.size > 20 * 1024 * 1024) {
      throw new Error(
        `file is too large: ${stat.size} bytes exceeds the ${20 * 1024 * 1024} byte limit`,
      );
    }
    return await qaVaultAdapter.readBinaryFile(path);
  }


  if (cmd === "create_markdown_file_if_absent") {
    const path = p["path"] as string;
    const content = p["content"] as string;
    const parent = path.slice(0, path.lastIndexOf("/"));
    await qaVaultAdapter.createDirectory(parent, { recursive: true });
    const entries = await qaVaultAdapter.listDirectoryEntries(parent);
    if (entries.some((entry) => entry.path === path)) return false;
    await qaVaultAdapter.writeTextFile(path, content);
    return true;
  }

  // UI 계약용 모형이다. 실제 OS의 원자적 rename 보장은 Rust 검증에서 확인한다.
  if (cmd === "move_markdown_file") {
    const path = String(p["path"]);
    const root = String(p["vaultPath"]);
    const folder = String(p["toFolder"]);
    if (!path.startsWith(`${root}/`) || (folder !== root && !folder.startsWith(`${root}/`))
      || path.includes('/../') || folder.includes('/../') || !path.endsWith('.md') || path.endsWith('.excalidraw.md')) {
      throw new Error('허용되지 않는 이동 경로입니다.');
    }
    const stat = await qaVaultAdapter.getFileStat(path);
    if (stat.modifiedAt !== p["expectedMtime"]) throw new Error('원본이 바뀌었습니다.');
    const target = `${folder}/${path.slice(path.lastIndexOf('/') + 1)}`;
    if (target === path) return null;
    const entries = await qaVaultAdapter.listDirectoryEntries(folder);
    if (entries.some((entry) => entry.path.toLowerCase() === target.toLowerCase())) throw new Error('같은 이름의 파일이 있습니다.');
    await qaVaultAdapter.writeTextFile(target, await qaVaultAdapter.readTextFile(path));
    await qaVaultAdapter.deleteFile(path);
    return null;
  }

  // UI 계약용 모형이다. 실제 덮어쓰기 금지 rename은 Rust 테스트(note_move.rs)가 보장한다.
  if (cmd === "rename_markdown_file") {
    const path = String(p["path"]);
    const root = String(p["vaultPath"]);
    const newName = String(p["newName"]);
    if (!path.startsWith(`${root}/`) || path.includes('/../') || !path.endsWith('.md') || path.endsWith('.excalidraw.md')
      || !newName.endsWith('.md') || newName.endsWith('.excalidraw.md') || newName.startsWith('.')
      || newName.includes('/') || newName.includes('\\')) {
      throw new Error('허용되지 않는 파일 이름입니다.');
    }
    const stat = await qaVaultAdapter.getFileStat(path);
    if (stat.modifiedAt !== p["expectedMtime"]) throw new Error('원본이 바뀌었습니다.');
    const folder = path.slice(0, path.lastIndexOf('/'));
    const target = `${folder}/${newName}`;
    if (target === path) return null;
    const entries = await qaVaultAdapter.listDirectoryEntries(folder);
    if (entries.some((entry) => entry.path.toLowerCase() === target.toLowerCase())) throw new Error('같은 이름의 파일이 있습니다.');
    await qaVaultAdapter.writeTextFile(target, await qaVaultAdapter.readTextFile(path));
    await qaVaultAdapter.deleteFile(path);
    return null;
  }

  if (cmd === "write_text_file" || cmd === "write_markdown_file") {
    const path = p["path"] as string;
    const content = p["content"] as string;
    const expectedMtime = typeof p['expectedMtime'] === 'number' ? p['expectedMtime'] : undefined;
    return qaVaultAdapter.writeTextFile(path, content, expectedMtime);
  }

  if (cmd === "list_directory_entries") {
    const dirPath = p["dirPath"] as string;
    const entries = await qaVaultAdapter.listDirectoryEntries(dirPath);
    // Rust DTO 형식으로 변환 (camelCase → snake_case는 여기선 불필요 — JS 레이어가 받는 형식)
    return entries.map((e) => ({
      path: e.path,
      name: e.name,
      is_dir: e.isDir,
      is_file: e.isFile,
      modified_at: e.modifiedAt ?? null,
      created_at: e.createdAt ?? null,
    }));
  }

  if (cmd === "list_directory") {
    const dirPath = p["dirPath"] as string;
    const entries = await qaVaultAdapter.listDirectoryEntries(dirPath);
    return entries.map((e) => e.path);
  }

  if (cmd === "delete_file") {
    const path = p["path"] as string;
    await qaVaultAdapter.deleteFile(path);
    return null;
  }

  if (cmd === "rename_directory") {
    const path = p["path"] as string;
    const newName = p["newName"] as string;
    await qaVaultAdapter.renameDirectory(path, newName);
    return null;
  }

  if (cmd === "trash_directory") {
    const path = p["path"] as string;
    await qaVaultAdapter.trashDirectory(path);
    return null;
  }

  if (cmd === "get_file_stat") {
    const path = p["path"] as string;
    const stat = await qaVaultAdapter.getFileStat(path);
    return {
      path: stat.path,
      size: stat.size,
      modified_at: stat.modifiedAt,
      created_at: stat.createdAt,
    };
  }

  if (cmd === "check_file_exists") {
    const filePath = p["filePath"] as string;
    try {
      await qaVaultAdapter.readTextFile(filePath);
      return true;
    } catch {
      return false;
    }
  }

  if (cmd === "create_directory") {
    const dirPath = p["dirPath"] as string;
    const recursive = (p["recursive"] as boolean | undefined) ?? true;
    await qaVaultAdapter.createDirectory(dirPath, { recursive });
    return null;
  }

  // ── vault 명령 ──────────────────────────────────────────────────────────────
  if (cmd === "register_vault_path") {
    const vaultPath = p["vaultPath"] as string;
    await memAdapter.registerVaultPath(vaultPath);
    return null;
  }

  if (cmd === "list_vault_notes") {
    const vaultPath = p["vaultPath"] as string;
    const notesDir = `${vaultPath}/notes`;
    try {
      const entries = await memAdapter.listDirectoryEntries(notesDir);
      return entries.filter((e) => e.isFile && e.name.endsWith(".md")).map((e) => e.path);
    } catch {
      return [];
    }
  }

  // ── vault binding DB ────────────────────────────────────────────────────────
  if (cmd === "get_vault_binding") {
    const localVaultId = p["localVaultId"] as string;
    const binding = vaultBindings.get(localVaultId) ?? null;
    return binding;
  }

  if (cmd === "upsert_vault_binding") {
    const binding = p["binding"] as VaultBindingRow;
    vaultBindings.set(binding.local_vault_id, {
      ...binding,
      updated_at: Date.now(),
    });
    return null;
  }

  if (cmd === "list_vault_bindings") {
    return Array.from(vaultBindings.values());
  }

  // ── sync meta DB ────────────────────────────────────────────────────────────
  if (cmd === "get_sync_meta") {
    const noteId = p["noteId"] as string;
    return syncMetaStore.get(noteId) ?? null;
  }

  if (cmd === "upsert_sync_meta") {
    const state = p["state"] as { note_id: string };
    syncMetaStore.set(state.note_id, state);
    return null;
  }

  if (cmd === "delete_sync_meta") {
    const noteId = p["noteId"] as string;
    syncMetaStore.delete(noteId);
    return null;
  }

  if (cmd === "list_sync_meta_by_state") {
    const targetState = p["state"] as string;
    return Array.from(syncMetaStore.values()).filter(
      (m) => (m as Record<string, unknown>)["sync_state"] === targetState,
    );
  }

  // ── watcher 명령 (no-op) ────────────────────────────────────────────────────
  if (cmd === "start_vault_watch") {
    return null;
  }

  if (cmd === "stop_vault_watch") {
    return null;
  }

  // ── keychain 명령 (no-op, 메모리 fallback은 auth-token-store.ts가 담당) ────
  if (cmd === "secure_get_refresh_token") {
    return null;
  }

  if (cmd === "secure_set_refresh_token") {
    return null;
  }

  if (cmd === "secure_clear_refresh_token") {
    return null;
  }

  // ── RAG 명령 (mock fixture) ─────────────────────────────────────────────────
  // 실제 검색은 Rust+Gemini라 브라우저 QA에서는 고정 결과를 반환한다.
  // Rust는 serde(rename_all = "camelCase")로 직렬화하므로 픽스처도 camelCase로 준다
  // (tauri-commands.ts의 RawRag*/toRag* 변환과 일치).
  // fixture 한계: 파일 권한/keychain/capability/실제 임베딩은 검증하지 않는다.
  if (cmd === "rag_index_status") {
    return {
      exists: true,
      indexComplete: true,
      embeddingModel: "fixture",
      embeddingDimensions: 768,
      documentCount: 3,
      chunkCount: 3,
      builtAt: "2026-06-10T00:00:00.000Z",
    };
  }

  if (cmd === "rag_search") {
    const query = (p["query"] as string | undefined) ?? "";
    const hits = [
      {
        filePath: "notes/note-alpha.md",
        title: "알파 노트",
        heading: "",
        preview: "브라우저 QA 테스트용 첫 번째 노트입니다.",
        sources: ["fts5", "sqlite-vec"],
        score: 0.03,
      },
      {
        filePath: "notes/note-beta.md",
        title: "베타 노트",
        heading: "소개",
        preview: "브라우저 QA 테스트용 두 번째 노트입니다.",
        sources: ["sqlite-vec"],
        score: 0.02,
      },
    ];
    if (query.trim().length === 0) return [];
    return hits;
  }

  // ── 검토 큐 AI 분류 명령 (mock fixture) ────────────────────────────────────
  // 실제 분류는 Rust + gemini-3.8-flash라 브라우저 QA에서는 고정 결과를 반환한다.
  // fixture 한계: 실제 프롬프트/모델 응답 품질은 검증하지 않는다(별도 curl/Rust 단위 테스트 담당).
  if (cmd === "classify_review_item") {
    const title = (p["title"] as string | undefined) ?? "";
    if (title.trim().length === 0) {
      throw new Error("제목이 비어 있습니다.");
    }
    return {
      classification: "아이디어",
      reason: "fixture 분류: 아직 구체화되지 않은 가능성으로 판단했다.",
      confidence: 0.7,
    };
  }

  if (["read_inbox_organizer_note", "recommend_inbox_folder", "move_inbox_organizer_note"].includes(cmd)) {
    return inboxOrganizerFixture(cmd, p);
  }

  // ── dialog plugin: 볼트 선택 → 취소(null) 반환 ─────────────────────────────
  if (cmd === "plugin:dialog|open") {
    return null;
  }

  if (cmd === "get_secrets_folder_status") {
    return {
      configured: secretsFolderConfigured,
      path: secretsFolderConfigured ? QA_SECRETS_PATH : null,
      reason: secretsFolderConfigured ? null : secretsRejectedReason,
    };
  }
  if (cmd === "select_secrets_folder") {
    secretsSelectCalls += 1;
    secretsFolderConfigured = true;
    return { configured: true, path: QA_SECRETS_PATH };
  }
  if (cmd === "list_secret_files") {
    if (!secretsFolderConfigured) {
      throw { code: "invalidPath", message: "비밀 폴더가 설정되지 않았습니다. 폴더를 먼저 고르세요." };
    }
    return Array.from(secretFixtureFiles.entries()).map(([path, file]) => ({
      path,
      sizeBytes: file.content.length,
      modifiedMs: file.mtime,
    }));
  }
  if (cmd === "read_secret_file") {
    const relPath = p["relPath"] as string | undefined;
    const file = relPath ? secretFixtureFiles.get(relPath) : undefined;
    if (!file) {
      throw new Error(`파일을 찾지 못했습니다: ${relPath ?? ""}`);
    }
    return file.content;
  }
  if (cmd === "create_secret_file") {
    const relPath = p["relPath"] as string | undefined;
    const content = (p["content"] as string | undefined) ?? "";
    if (
      !relPath ||
      relPath.startsWith("/") ||
      relPath.split("/").some((s) => !s || s === "." || s === ".." || s === ".backup")
    ) {
      throw new Error("경로 세그먼트가 올바르지 않습니다.");
    }
    if (secretFixtureFiles.has(relPath)) {
      throw new Error(`이미 존재하는 파일입니다: ${relPath}`);
    }
    const mtime = Date.now();
    secretFixtureFiles.set(relPath, { content, mtime });
    return { path: relPath, sizeBytes: content.length, modifiedMs: mtime };
  }
  if (cmd === "begin_secret_edit") {
    const relPath = p["relPath"] as string | undefined;
    if (!relPath) throw new Error("파일을 찾지 못했습니다.");
    const file = secretFixtureFiles.get(relPath);
    if (!file) throw new Error(`파일을 찾지 못했습니다: ${relPath}`);
    const name = relPath.split("/").pop() ?? relPath;
    secretFixtureBackups.push(`${name}.${String(secretFixtureBackups.length + 1).padStart(4, "0")}`);
    const mine = secretFixtureBackups.filter((b) => b.startsWith(`${name}.`));
    if (mine.length > SECRET_FIXTURE_BACKUP_KEEP) {
      secretFixtureBackups.splice(secretFixtureBackups.indexOf(mine[0]), 1);
    }
    return String(file.mtime);
  }
  if (cmd === "write_secret_file") {
    const relPath = p["relPath"] as string | undefined;
    const content = (p["content"] as string | undefined) ?? "";
    const expectedMtime = p["expectedMtime"] as string | undefined;
    if (!relPath) throw new Error("파일을 찾지 못했습니다.");
    const file = secretFixtureFiles.get(relPath);
    if (!file) throw new Error(`파일을 찾지 못했습니다: ${relPath}`);
    if (expectedMtime === undefined || String(file.mtime) !== expectedMtime) {
      throw new Error(`파일이 열려 있는 동안 외부에서 바뀌었습니다: ${relPath}`);
    }
    file.content = content;
    file.mtime = Date.now();
    return String(file.mtime);
  }
  if (cmd === "reveal_secret_in_finder") {
    const relPath = p["relPath"] as string | undefined;
    if (!relPath || !secretFixtureFiles.has(relPath)) {
      throw new Error(`파일을 찾지 못했습니다: ${relPath ?? ""}`);
    }
    secretRevealCalls += 1;
    return null;
  }

  // 미구현 명령은 콘솔에 남기고 null 반환
  console.warn(`[browser-qa] unhandled IPC command: "${cmd}"`, payload);
  return null;
}, { shouldMockEvents: true });

// ── 외부에서 "가짜 외부 수정"을 트리거하는 헬퍼 ──────────────────────────────

/**
 * 테스트에서 특정 파일의 내용과 mtime을 "외부에서 바꾼 것처럼" 시뮬레이션하기 위한
 * 전역 헬퍼. Playwright의 page.evaluate()에서 호출한다.
 *
 * 사용 예:
 *   await page.evaluate((path) => window.__qa_simulateExternalEdit(path, '새 내용'), filePath);
 */
(window as Window & { __qa_simulateExternalEdit?: (path: string, content: string) => Promise<void> }).__qa_simulateExternalEdit = async (
  path: string,
  content: string,
): Promise<void> => {
  await memAdapter.writeTextFile(path, content);
};

/**
 * 다음 N번의 해당 파일 읽기를 실패시킨다(2026-08-16 F1 회귀 QA).
 * 외부 편집기가 파일을 잠시 못 읽게 만든 상황(교체/권한/동기화 중)을 재현한다.
 */
(window as Window & { __qa_currentVaultPath?: () => string | null }).__qa_currentVaultPath = () =>
  memAdapter.getVaultPath();

(window as Window & { __qa_failNextReads?: (path: string, count: number) => void }).__qa_failNextReads = (
  path: string,
  count: number,
): void => {
  forcedReadFailures.set(path, count);
};

/**
 * 메모리 볼트의 현재 파일 내용을 그대로 돌려준다(2026-08-16 F1 회귀 QA).
 * "자동 저장이 실제로 디스크(=fixture)까지 갔는가"를 확인하는 용도다.
 */
(window as Window & { __qa_readVaultFile?: (path: string) => Promise<string> }).__qa_readVaultFile = async (
  path: string,
): Promise<string> => memAdapter.readTextFile(path);

/** 바이너리 파일 존재 확인용(2026-08-19 이미지 삭제 동반 정리 QA). */
(window as Window & { __qa_readVaultBinary?: (path: string) => Promise<Uint8Array> }).__qa_readVaultBinary =
  async (path: string): Promise<Uint8Array> => memAdapter.readBinaryFile(path);

/** 테스트가 바이너리 파일을 fixture에 심는다(삭제 동반 정리 QA). 미러에도 남긴다. */
(window as Window & { __qa_writeVaultBinary?: (path: string, bytes: Uint8Array) => Promise<void> }).__qa_writeVaultBinary =
  async (path: string, bytes: Uint8Array): Promise<void> => {
    await qaVaultAdapter.writeBinaryFile(path, bytes);
  };

/**
 * 파일 내용을 fixture에 쓰고 localStorage 미러에도 남긴다(2026-08-18 자동 오픈 회귀).
 * page.reload() 뒤에도 내용/수정 상태가 살아있어야 하는 테스트에서 쓴다.
 */
(window as Window & { __qa_writeVaultFile?: (path: string, content: string) => Promise<void> }).__qa_writeVaultFile = async (
  path: string,
  content: string,
): Promise<void> => {
  await qaVaultAdapter.writeTextFile(path, content);
};

/** fixture에서 테스트 폴더를 만든다. localStorage 미러 파일은 그대로 둔다. */
(window as Window & { __qa_createVaultDirectory?: (path: string) => Promise<void> }).__qa_createVaultDirectory = async (
  path: string,
): Promise<void> => {
  await qaVaultAdapter.createDirectory(path, { recursive: true });
};

/**
 * 메모리 볼트의 파일 경로 목록(2026-08-18). "새로 만든 파일이 어느 폴더에 떨어졌는가"를
 * 확인하는 용도다 — [kyle] 질문: "투두가 어떤 기본폴더에 귀속돼?"
 */
(window as Window & { __qa_listVaultFiles?: () => Promise<string[]> }).__qa_listVaultFiles =
  async (): Promise<string[]> => {
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await memAdapter.listDirectoryEntries(dir);
      const found: string[] = [];
      for (const entry of entries) {
        if (entry.isDir) found.push(...(await walk(entry.path)));
        else found.push(entry.path);
      }
      return found;
    };
    return walk(VAULT_PATH);
  };

/** 보안 메모 fixture를 외부에서 바꾼 것처럼 시뮬레이션한다(TICK-SEC-002 mtime 감지 QA). */
(window as Window & {
  __qa_writeSecretFileExternal?: (path: string, content: string) => void;
}).__qa_writeSecretFileExternal = (path: string, content: string): void => {
  const file = secretFixtureFiles.get(path);
  if (file) {
    file.content = content;
    file.mtime = Date.now() + 1;
  }
};

/** 보안 메모 fixture의 백업 목록(진입 시점 생성·회전 검증용). */
(window as Window & { __qa_secretBackups?: () => string[] }).__qa_secretBackups = (): string[] => [
  ...secretFixtureBackups,
];

/** select_secrets_folder 호출 횟수(실제 네이티브 선택 창은 열리지 않는다 — fixture 한계). */
(window as Window & { __qa_secretsSelectCalls?: () => number }).__qa_secretsSelectCalls =
  (): number => secretsSelectCalls;

/** reveal_secret_in_finder 호출 횟수(실제 Finder는 열리지 않는다 — fixture 한계). */
(window as Window & { __qa_revealFinderCalls?: () => number }).__qa_revealFinderCalls =
  (): number => secretRevealCalls;

/**
 * 기본 볼트 binding을 메모리 스토어에 심는다. useVaultBinding이 binding을 찾지 못할 때
 * in-memory로 직접 접근해 삽입하는 경로가 없으므로, 필요하면 이 함수로 초기화한다.
 * 실제로는 upsert_vault_binding IPC가 불려 자동으로 등록된다.
 */
export function seedVaultBinding(): void {
  vaultBindings.set("mock-vault-id", defaultBinding(VAULT_PATH));
}

// 외부 재로드 IO 중 새 입력을 넣는 회귀 검사 전용. 개인 볼트 IO를 사용하지 않는다.
Object.assign(window, {
  __qa_holdNextRead(path: string): void {
    let release: () => void = () => {};
    const promise = new Promise<void>(resolve => { release = resolve; });
    heldReads.set(path, { started: false, promise, release });
  },
  __qa_isReadHeld(path: string): boolean { return heldReads.get(path)?.started === true; },
  __qa_releaseHeldRead(path: string): void { heldReads.get(path)?.release(); },
});
