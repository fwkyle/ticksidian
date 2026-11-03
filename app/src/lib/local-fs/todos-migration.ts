/**
 * todos-migration.ts
 *
 * 기존 todos.json + todo-memos/ → 개별 .md 파일로 1회 마이그레이션.
 *
 * 반환 타입: 'done' | 'noop' | 'blocked'
 *   - 'done'    : 마이그레이션이 성공적으로 완료됨 (충돌/실패 0건)
 *   - 'noop'    : todos.json이 없거나 빈 파일이어서 마이그레이션 불필요
 *   - 'blocked' : 이전 마이그레이션에서 충돌이 남아 sentinel로 차단됨,
 *                 또는 이번 마이그레이션에서 충돌/실패가 발생해 todos.json을 보존함
 *                 → 호출자는 'blocked'일 때 완료 표시(todosMigrationDone=1)를 하지 않는다.
 */

import type { DatabaseData } from '../../types/database';
import { parseJsonWithFallback } from '../error-utils';
import { buildMarkdownExportDocument } from '../markdown-export';
import { tauriVaultAdapter } from '../tauri-vault-adapter';
import { ensureNotesDirectory, getNotePath, getVaultPath, readTextFile, writeTextFile } from './vault-paths';
import { writeNoteFile } from './note-crud';

export type MigrationResult = 'done' | 'noop' | 'blocked';

/**
 * migration 결과를 받아 SQLite binding을 done:1 로 표시해야 하는지 판단한다.
 * 순수 함수 — IO/side-effect 없음.
 *
 *   - 'blocked' → false (충돌이 남아있으므로 절대 표시 안 함)
 *   - 'done' | 'noop' → true
 */
export function decideMigrationMarkDone(result: MigrationResult): boolean {
  return result !== 'blocked';
}

const TODOS_FILE = 'todos.json';
const TODO_MEMOS_DIR = 'todo-memos';

function getTodoMemosDir(vaultPath: string): string {
  return `${vaultPath}/${TODO_MEMOS_DIR}`;
}

function getTodoMemoPath(vaultPath: string, todoId: string): string {
  return `${getTodoMemosDir(vaultPath)}/${todoId}.json`;
}

async function getTodoMemoBlocks(vaultPath: string, todoId: string): Promise<unknown[] | null> {
  try {
    const path = getTodoMemoPath(vaultPath, todoId);
    const content = await readTextFile(path);
    const doc = parseJsonWithFallback<{ blocksJson: string } | null>(
      content, () => null, 'localFs.getTodoMemoBlocks',
    );
    if (!doc?.blocksJson) return null;
    const blocks = parseJsonWithFallback<unknown[]>(
      doc.blocksJson, () => [], 'localFs.getTodoMemoBlocks.blocks',
    );
    return Array.isArray(blocks) && blocks.length > 0 ? blocks : null;
  } catch {
    return null;
  }
}

/**
 * 기존 todos.json + todo-memos/ → 개별 .md 파일로 1회 마이그레이션.
 * 마이그레이션 완료 후 todos.json → todos.json.migrated 로 리네임.
 *
 * 충돌/실패가 있으면 todos.json을 보존하고 migration-report.json에 기록한다.
 * 이전 마이그레이션에서 충돌이 남은 경우 sentinel 파일로 재시도를 차단한다.
 */
export async function migrateTodosToMarkdown(): Promise<MigrationResult> {
  const currentVaultPath = getVaultPath();
  if (!currentVaultPath) return 'noop';

  const todosPath = `${currentVaultPath}/${TODOS_FILE}`;
  const sentinelPath = `${currentVaultPath}/.todos-migration-blocked`;

  // sentinel 파일이 있으면 이전 마이그레이션에서 충돌이 남은 것 → 재시도 차단
  try {
    await readTextFile(sentinelPath);
    console.warn('[migrateTodos] previous migration left conflicts; skipping. Manual resolution required.');
    return 'blocked';
  } catch {
    /* sentinel 없음 → 진행 */
  }

  // todos.json이 없으면 마이그레이션 불필요
  let todosContent: string;
  try {
    todosContent = await readTextFile(todosPath);
  } catch {
    return 'noop'; // 파일 없음
  }

  const data = parseJsonWithFallback<DatabaseData | null>(todosContent, () => null, 'migrateTodos');
  if (!data || !data.rows || data.rows.length === 0) {
    // 빈 todos.json이면 그냥 리네임
    try {
      await writeTextFile(`${todosPath}.migrated`, todosContent);
      await tauriVaultAdapter.deleteFile(todosPath);
    } catch {
      // 리네임 실패해도 진행
    }
    return 'done';
  }

  // 컬럼 이름 → ID 매핑
  const colByName: Record<string, string> = {};
  for (const col of data.columns) {
    colByName[col.name] = col.id;
  }

  const doneColId = colByName['완료'] ?? '';
  const titleColId = colByName['할 일'] ?? '';
  const dateColId = colByName['마감일'] ?? '';
  const priorityColId = colByName['우선순위'] ?? '';
  const tagColId = colByName['태그'] ?? '';

  const priorityOptions = data.columns.find((c) => c.name === '우선순위')?.options ?? [];
  const tagOptions = data.columns.find((c) => c.name === '태그')?.options ?? [];
  const priorityMap = new Map(priorityOptions.map((o) => [o.id, o.label]));
  const tagMap = new Map(tagOptions.map((o) => [o.id, o.label]));

  await ensureNotesDirectory();

  let success = 0;
  let skipped = 0;
  let failed = 0;
  const skippedIds: string[] = [];
  const failedRows: Array<{ id: string; error: string }> = [];
  const startedAt = new Date().toISOString();

  for (const row of data.rows) {
    const noteId = row.id;
    const done = row[doneColId] === true;
    const title = typeof row[titleColId] === 'string' ? (row[titleColId] as string) : '';
    const dueDate = typeof row[dateColId] === 'string' ? (row[dateColId] as string) : undefined;
    const priorityId = typeof row[priorityColId] === 'string' ? (row[priorityColId] as string) : '';
    const tagIds = Array.isArray(row[tagColId]) ? (row[tagColId] as string[]) : [];

    const priority = priorityMap.get(priorityId) ?? undefined;
    const tags = tagIds.map((id) => tagMap.get(id)).filter((t): t is string => !!t);

    let memoMarkdown = '';
    try {
      const memoBlocks = await getTodoMemoBlocks(currentVaultPath, noteId);
      if (memoBlocks && memoBlocks.length > 0) {
        memoMarkdown = blocksToSimpleMarkdown(memoBlocks);
      }
    } catch {
      // 메모 없으면 무시
    }

    const now = Date.now();
    const markdownBody = memoMarkdown || `# ${title || '제목 없음'}\n\n`;

    const content = buildMarkdownExportDocument({
      noteId,
      title: title || '제목 없음',
      createdAt: now,
      updatedAt: now,
      exportedAt: now,
      markdownBody,
      type: 'todo',
      done,
      dueDate: dueDate || undefined,
      priority,
      tags: tags.length > 0 ? tags : undefined,
    });

    // 이미 같은 ID의 .md가 있으면 충돌로 기록하고 스킵
    try {
      await readTextFile(getNotePath(`${noteId}.md`));
      skipped++;
      skippedIds.push(noteId);
      continue;
    } catch {
      // 없으면 생성
    }

    try {
      await writeNoteFile(noteId, content);
      success++;
    } catch (err) {
      failed++;
      failedRows.push({ id: noteId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 충돌/실패가 없으면 정상 완료 처리
  if (skipped + failed === 0) {
    try {
      await writeTextFile(`${todosPath}.migrated`, todosContent);
      await tauriVaultAdapter.deleteFile(todosPath);
    } catch {
      console.error('[migrateTodos] Failed to rename todos.json after migration');
    }
    console.log(`[migrateTodos] ${data.rows.length}건 마이그레이션 완료 (성공: ${success})`);
    return 'done';
  }

  // 충돌/실패가 있으면: todos.json 보존 + report 저장 + sentinel 생성
  console.warn(
    `[migrateTodos] 투두 유실 위험 감지: todos.json 보존됨. ` +
    `총 ${data.rows.length}건 중 성공 ${success}, 충돌 ${skipped}, 실패 ${failed}.`,
  );

  const report = {
    startedAt,
    total: data.rows.length,
    success,
    skipped,
    failed,
    skippedIds,
    failedRows,
  };

  try {
    await writeTextFile(
      `${currentVaultPath}/todos.json.migration-report.json`,
      JSON.stringify(report, null, 2),
    );
  } catch {
    console.error('[migrateTodos] Failed to write migration-report.json');
  }

  // sentinel 생성: 다음 launch에서 재시도하지 않도록
  try {
    await writeTextFile(sentinelPath, JSON.stringify({ blockedAt: startedAt, reason: 'conflicts_detected' }));
  } catch {
    console.error('[migrateTodos] Failed to write sentinel file');
  }

  return 'blocked';
}

/** 간단한 블록 배열을 마크다운 텍스트로 변환 (마이그레이션 전용) */
export function blocksToSimpleMarkdown(blocks: unknown[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const b = block as Record<string, unknown>;
    const type = b.type as string;
    const content = b.content as Array<{ text?: string }> | undefined;
    const text = content?.map((c) => c.text ?? '').join('') ?? '';

    switch (type) {
      case 'heading': {
        const level = (b.props as Record<string, unknown>)?.level ?? 1;
        lines.push(`${'#'.repeat(level as number)} ${text}`);
        break;
      }
      case 'bulletListItem':
        lines.push(`- ${text}`);
        break;
      case 'numberedListItem':
        lines.push(`1. ${text}`);
        break;
      case 'checkListItem': {
        const checked = (b.props as Record<string, unknown>)?.checked === true;
        lines.push(`- [${checked ? 'x' : ' '}] ${text}`);
        break;
      }
      case 'paragraph':
      default:
        lines.push(text);
        break;
    }
  }

  return lines.join('\n') + '\n';
}

