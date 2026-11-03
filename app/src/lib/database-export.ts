import type { ColumnDef } from "../types/database";

function findOptionLabel(column: ColumnDef, optionId: string): string {
  return column.options?.find((option) => option.id === optionId)?.label ?? optionId;
}

export function formatDatabaseCellValue(value: unknown, column: ColumnDef): string {
  if (value == null) {
    return "";
  }

  switch (column.type) {
    case "checkbox":
      return value === true ? "true" : "false";
    case "select":
      return typeof value === "string" ? findOptionLabel(column, value) : "";
    case "multi_select":
      return Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === "string")
            .map((item) => findOptionLabel(column, item))
            .join(", ")
        : "";
    default:
      return String(value);
  }
}
