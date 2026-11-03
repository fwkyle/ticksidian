import { Suspense } from "react";
import type { BlockIdentifier } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { DatabaseBlockRendererLazy } from "./DatabaseBlockRendererLazy";
import { createDefaultColumns, createTodoColumns } from "../../lib/database-helpers";
import { formatDatabaseCellValue } from "../../lib/database-export";
import { parseJsonWithFallback } from "../../lib/error-utils";
import type { DatabaseData } from "../../types/database";

interface SlashMenuEditor {
  insertBlocks: (
    blocks: Array<{ type: "database"; props: { data: string } }>,
    referenceBlock: BlockIdentifier,
    placement: "after"
  ) => void;
  getTextCursorPosition: () => { block: BlockIdentifier };
}

function createDefaultDatabaseData(): DatabaseData {
  return {
    columns: createDefaultColumns(),
    rows: [],
    filters: [],
    sorts: [],
  };
}

/** 기본 DB 데이터를 JSON 문자열로 생성 */
function createDefaultDatabaseJson(): string {
  return JSON.stringify(createDefaultDatabaseData());
}

/** Database 커스텀 블록 정의 */
export const DatabaseBlockSpec = createReactBlockSpec(
  {
    type: "database" as const,
    content: "none" as const,
    propSchema: {
      data: { default: createDefaultDatabaseJson() },
    },
  },
  {
    render: ({ block, editor }) => {
      const dbData = parseJsonWithFallback<DatabaseData>(
        block.props.data,
        createDefaultDatabaseData,
        "DatabaseBlock.render",
      );

      const handleChange = (newData: DatabaseData) => {
        editor.updateBlock(block, {
          props: { data: JSON.stringify(newData) },
        });
      };

      return (
        <Suspense
          fallback={
            <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500">
              테이블 로딩 중…
            </div>
          }
        >
          <DatabaseBlockRendererLazy data={dbData} onChange={handleChange} />
        </Suspense>
      );
    },
    toExternalHTML: ({ block }) => {
      const dbData = parseJsonWithFallback<DatabaseData | null>(
        block.props.data,
        () => null,
        "DatabaseBlock.toExternalHTML",
      );

      if (!dbData) {
        return <div>[Database]</div>;
      }

      return (
        <table>
          <thead>
            <tr>
              {dbData.columns.map((col) => (
                <th key={col.id}>{col.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dbData.rows.map((row) => (
              <tr key={row.id}>
                {dbData.columns.map((col) => (
                  <td key={col.id}>{formatDatabaseCellValue(row[col.id], col)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
  }
);

/** 투두 프리셋 DB 데이터를 JSON 문자열로 생성 */
function createTodoDatabaseJson(): string {
  const todoData: DatabaseData = {
    columns: createTodoColumns(),
    rows: [],
    filters: [],
    sorts: [],
  };
  return JSON.stringify(todoData);
}

/** 슬래시 메뉴 아이템 생성 (editor를 클로저로 캡처) */
export function createInsertTodoItem(editor: SlashMenuEditor) {
  return {
    key: "todo-database" as const,
    title: "투두 테이블",
    subtext: "투두 관리용 DB 테이블 삽입",
    aliases: ["todo", "투두", "할일", "checklist"],
    group: "Advanced",
    onItemClick: () => {
      editor.insertBlocks(
        [
          {
            type: "database",
            props: { data: createTodoDatabaseJson() },
          },
        ],
        editor.getTextCursorPosition().block,
        "after"
      );
    },
  };
}

/** 슬래시 메뉴 아이템 생성 (editor를 클로저로 캡처) */
export function createInsertDatabaseItem(editor: SlashMenuEditor) {
  return {
    key: "database" as const,
    title: "Database",
    subtext: "인라인 데이터베이스 테이블 삽입",
    aliases: ["database", "db", "table", "데이터베이스", "테이블"],
    group: "Advanced",
    onItemClick: () => {
      editor.insertBlocks(
        [
          {
            type: "database",
            props: { data: createDefaultDatabaseJson() },
          },
        ],
        editor.getTextCursorPosition().block,
        "after"
      );
    },
  };
}
