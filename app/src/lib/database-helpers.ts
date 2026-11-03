import { generateId } from "./id";
import type {
  ColumnDef,
  DatabaseRow,
  FilterCondition,
  SortCondition,
  SelectOption,
  FieldType,
} from "../types/database";
import { NOTION_COLORS as COLORS } from "../types/database";

/** 투두 프리셋 컬럼 생성 */
export function createTodoColumns(): ColumnDef[] {
  return [
    { id: generateId(), name: "완료", type: "checkbox" },
    { id: generateId(), name: "할 일", type: "title" },
    { id: generateId(), name: "마감일", type: "date" },
    {
      id: generateId(),
      name: "우선순위",
      type: "select",
      options: [
        { id: generateId(), label: "긴급", color: "#FFE2DD" },
        { id: generateId(), label: "높음", color: "#FADEC9" },
        { id: generateId(), label: "중간", color: "#FDECC8" },
        { id: generateId(), label: "낮음", color: "#E3E2E0" },
      ],
    },
    {
      id: generateId(),
      name: "태그",
      type: "multi_select",
      options: [
        { id: generateId(), label: "업무", color: "#D3E5EF" },
        { id: generateId(), label: "개인", color: "#E8DFF5" },
        { id: generateId(), label: "건강", color: "#DBEDDB" },
      ],
    },
  ];
}

/** 기본 컬럼 2개 생성 */
export function createDefaultColumns(): ColumnDef[] {
  return [
    { id: generateId(), name: "Title", type: "title" },
    {
      id: generateId(),
      name: "Status",
      type: "select",
      options: [
        { id: generateId(), label: "To Do", color: COLORS.gray.background },
        { id: generateId(), label: "In Progress", color: COLORS.yellow.background },
        { id: generateId(), label: "Done", color: COLORS.green.background },
      ],
    },
  ];
}

/** 빈 행 생성 */
export function createEmptyRow(columns: ColumnDef[]): DatabaseRow {
  const row: DatabaseRow = { id: generateId() };
  for (const col of columns) {
    if (col.type === "checkbox") {
      row[col.id] = false;
    } else if (col.type === "multi_select") {
      row[col.id] = [];
    } else if (col.type === "number") {
      row[col.id] = null;
    } else {
      row[col.id] = "";
    }
  }
  return row;
}

/** 랜덤 노션 색상 */
export function getRandomColor(): string {
  const keys = Object.keys(COLORS);
  const key = keys[Math.floor(Math.random() * keys.length)];
  return COLORS[key].background;
}

/** 새 셀렉트 옵션 생성 */
export function createSelectOption(label: string): SelectOption {
  return {
    id: generateId(),
    label,
    color: getRandomColor(),
  };
}

/** 필터 적용 */
export function applyFilters(
  rows: DatabaseRow[],
  filters: FilterCondition[],
  columns: ColumnDef[]
): DatabaseRow[] {
  if (filters.length === 0) return rows;

  return rows.filter((row) => {
    return filters.every((filter) => {
      const value = row[filter.columnId];
      const col = columns.find((c) => c.id === filter.columnId);
      if (!col) return true;

      return evaluateFilter(value, filter.operator, filter.value, col.type);
    });
  });
}

function evaluateFilter(
  cellValue: unknown,
  operator: string,
  filterValue: unknown,
  fieldType: FieldType
): boolean {
  const strValue = String(cellValue ?? "");

  switch (operator) {
    case "equals":
      return strValue === String(filterValue);
    case "not_equals":
      return strValue !== String(filterValue);
    case "contains":
      return strValue.toLowerCase().includes(String(filterValue).toLowerCase());
    case "not_contains":
      return !strValue.toLowerCase().includes(String(filterValue).toLowerCase());
    case "greater_than":
      return Number(cellValue) > Number(filterValue);
    case "less_than":
      return Number(cellValue) < Number(filterValue);
    case "before":
      return new Date(strValue) < new Date(String(filterValue));
    case "after":
      return new Date(strValue) > new Date(String(filterValue));
    case "is_empty":
      if (fieldType === "multi_select") return (cellValue as string[])?.length === 0;
      return !cellValue && cellValue !== 0 && cellValue !== false;
    case "is_not_empty":
      if (fieldType === "multi_select") return (cellValue as string[])?.length > 0;
      return !!cellValue || cellValue === 0 || cellValue === false;
    case "is_true":
      return cellValue === true;
    case "is_false":
      return cellValue === false || !cellValue;
    default:
      return true;
  }
}

/** 정렬 적용 */
export function applySorts(
  rows: DatabaseRow[],
  sorts: SortCondition[]
): DatabaseRow[] {
  if (sorts.length === 0) return rows;

  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const aVal = a[sort.columnId];
      const bVal = b[sort.columnId];
      const direction = sort.direction === "asc" ? 1 : -1;

      if (aVal == null && bVal == null) continue;
      if (aVal == null) return direction;
      if (bVal == null) return -direction;

      if (typeof aVal === "number" && typeof bVal === "number") {
        if (aVal !== bVal) return (aVal - bVal) * direction;
      } else if (typeof aVal === "boolean" && typeof bVal === "boolean") {
        if (aVal !== bVal) return (aVal ? -1 : 1) * direction;
      } else {
        const cmp = String(aVal).localeCompare(String(bVal));
        if (cmp !== 0) return cmp * direction;
      }
    }
    return 0;
  });
}

/** 필드 타입에 사용 가능한 필터 연산자 목록 */
export function getOperatorsForType(type: FieldType): { value: string; label: string }[] {
  const common = [
    { value: "is_empty", label: "비어있음" },
    { value: "is_not_empty", label: "비어있지 않음" },
  ];

  switch (type) {
    case "title":
    case "text":
      return [
        { value: "contains", label: "포함" },
        { value: "not_contains", label: "포함하지 않음" },
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        ...common,
      ];
    case "number":
      return [
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        { value: "greater_than", label: "초과" },
        { value: "less_than", label: "미만" },
        ...common,
      ];
    case "select":
      return [
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        ...common,
      ];
    case "multi_select":
      return [
        { value: "contains", label: "포함" },
        { value: "not_contains", label: "포함하지 않음" },
        ...common,
      ];
    case "date":
      return [
        { value: "equals", label: "같음" },
        { value: "before", label: "이전" },
        { value: "after", label: "이후" },
        ...common,
      ];
    case "checkbox":
      return [
        { value: "is_true", label: "체크됨" },
        { value: "is_false", label: "체크 안 됨" },
      ];
    default:
      return common;
  }
}
