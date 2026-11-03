/** DB 테이블 필드 타입 */
export type FieldType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox";

/** 셀렉트 옵션 (색상 태그) */
export interface SelectOption {
  id: string;
  label: string;
  color: string;
}

/** 컬럼(필드) 정의 */
export interface ColumnDef {
  id: string;
  name: string;
  type: FieldType;
  width?: number;
  options?: SelectOption[]; // select, multi_select 전용
}

/** 데이터 행 */
export interface DatabaseRow {
  id: string;
  [columnId: string]: unknown;
}

/** 필터 조건 */
export interface FilterCondition {
  columnId: string;
  operator: FilterOperator;
  value: unknown;
}

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than"
  | "before"
  | "after"
  | "is_empty"
  | "is_not_empty"
  | "is_true"
  | "is_false";

/** 정렬 조건 */
export interface SortCondition {
  columnId: string;
  direction: "asc" | "desc";
}

/** DB 테이블 전체 데이터 */
export interface DatabaseData {
  columns: ColumnDef[];
  rows: DatabaseRow[];
  filters: FilterCondition[];
  sorts: SortCondition[];
}

/** 노션 색상 팔레트 */
export const NOTION_COLORS: Record<string, { background: string; text: string }> = {
  gray:   { background: "#E3E2E0", text: "#333" },
  brown:  { background: "#E9E5E3", text: "#333" },
  orange: { background: "#FADEC9", text: "#333" },
  yellow: { background: "#FDECC8", text: "#333" },
  green:  { background: "#DBEDDB", text: "#333" },
  blue:   { background: "#D3E5EF", text: "#333" },
  purple: { background: "#E8DFF5", text: "#333" },
  pink:   { background: "#F5E0E9", text: "#333" },
  red:    { background: "#FFE2DD", text: "#333" },
};
