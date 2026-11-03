import {
  textColumn,
  checkboxColumn,
  keyColumn,
  type Column,
} from "react-datasheet-grid";
import type { ColumnDef } from "../types/database";
import { notionSelectColumn } from "../components/database/columns/selectColumn";
import { notionMultiSelectColumn } from "../components/database/columns/multiSelectColumn";

/** ColumnDef[] → react-datasheet-grid Column[] 변환 */
export function buildDatasheetColumns(
  columns: ColumnDef[],
  onCreateSelectOption?: (columnId: string, label: string) => void
): Column[] {
  return columns.map((col) => {
    const base = { title: col.name, id: col.id };

    switch (col.type) {
      case "title":
      case "text":
        return { ...keyColumn(col.id, textColumn), ...base };

      case "number":
        return { ...keyColumn(col.id, textColumn), ...base };

      case "checkbox":
        return { ...keyColumn(col.id, checkboxColumn), ...base };

      case "date":
        return {
          ...keyColumn(col.id, textColumn),
          ...base,
          component: ({ rowData, setRowData }: { rowData: string; setRowData: (v: string) => void }) => (
            <input
              type="date"
              value={rowData ?? ""}
              onChange={(e) => setRowData(e.target.value)}
              style={{
                border: "none",
                outline: "none",
                width: "100%",
                height: "100%",
                background: "transparent",
                fontSize: "13px",
              }}
            />
          ),
        };

      case "select":
        return {
          ...notionSelectColumn({
            choices: col.options ?? [],
            onCreateOption: onCreateSelectOption
              ? (label: string) => onCreateSelectOption(col.id, label)
              : undefined,
          }),
          ...base,
        };

      case "multi_select":
        return {
          ...notionMultiSelectColumn({
            choices: col.options ?? [],
          }),
          ...base,
        };

      default:
        return { ...keyColumn(col.id, textColumn), ...base };
    }
  });
}
