import { useState, useMemo, useCallback } from "react";
import { DataSheetGrid } from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import type { DatabaseData, ColumnDef, DatabaseRow, FieldType, FilterCondition, SortCondition } from "../../types/database";
import { applyFilters, applySorts, createEmptyRow, createSelectOption, getOperatorsForType } from "../../lib/database-helpers";
import { buildDatasheetColumns } from "../../lib/database-columns";
import { generateId } from "../../lib/id";
import "./database-block.css";

interface DatabaseBlockRendererProps {
  data: DatabaseData;
  onChange: (data: DatabaseData) => void;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  title: "제목",
  text: "텍스트",
  number: "숫자",
  select: "셀렉트",
  multi_select: "멀티셀렉트",
  date: "날짜",
  checkbox: "체크박스",
};

export function DatabaseBlockRenderer({ data, onChange }: DatabaseBlockRendererProps) {
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);

  const handleCreateSelectOption = useCallback(
    (columnId: string, label: string) => {
      const newOption = createSelectOption(label);
      const newColumns = data.columns.map((col) =>
        col.id === columnId
          ? { ...col, options: [...(col.options ?? []), newOption] }
          : col
      );
      onChange({ ...data, columns: newColumns });
    },
    [data, onChange]
  );

  const dsgColumns = useMemo(
    () => buildDatasheetColumns(data.columns, handleCreateSelectOption),
    [data.columns, handleCreateSelectOption]
  );

  const displayRows = useMemo(() => {
    let result = data.rows;
    result = applyFilters(result, data.filters, data.columns);
    result = applySorts(result, data.sorts);
    return result;
  }, [data.rows, data.filters, data.sorts, data.columns]);

  const handleRowsChange = (newRows: DatabaseRow[]) => {
    // 필터/정렬이 적용된 뷰의 변경을 원본에 반영
    const rowMap = new Map(data.rows.map((r) => [r.id, r]));
    for (const row of newRows) {
      rowMap.set(row.id, row);
    }
    onChange({ ...data, rows: Array.from(rowMap.values()) });
  };

  const handleAddRow = () => {
    const newRow = createEmptyRow(data.columns);
    onChange({ ...data, rows: [...data.rows, newRow] });
  };

  const handleAddColumn = () => {
    const newCol: ColumnDef = {
      id: generateId(),
      name: `Column ${data.columns.length + 1}`,
      type: "text",
    };
    onChange({ ...data, columns: [...data.columns, newCol] });
  };

  const handleDeleteColumn = (columnId: string) => {
    const newColumns = data.columns.filter((c) => c.id !== columnId);
    const newRows = data.rows.map((row) => {
      const rest = { ...row };
      delete rest[columnId];
      return rest as DatabaseRow;
    });
    onChange({ ...data, columns: newColumns, rows: newRows });
  };

  const handleRenameColumn = (columnId: string, name: string) => {
    const newColumns = data.columns.map((c) =>
      c.id === columnId ? { ...c, name } : c
    );
    onChange({ ...data, columns: newColumns });
  };

  const handleChangeColumnType = (columnId: string, type: FieldType) => {
    const newColumns = data.columns.map((c) =>
      c.id === columnId
        ? { ...c, type, options: type === "select" || type === "multi_select" ? c.options ?? [] : undefined }
        : c
    );
    onChange({ ...data, columns: newColumns });
  };

  const handleAddFilter = () => {
    if (data.columns.length === 0) return;
    const newFilter: FilterCondition = {
      columnId: data.columns[0].id,
      operator: "contains",
      value: "",
    };
    onChange({ ...data, filters: [...data.filters, newFilter] });
  };

  const handleUpdateFilter = (index: number, filter: FilterCondition) => {
    const newFilters = [...data.filters];
    newFilters[index] = filter;
    onChange({ ...data, filters: newFilters });
  };

  const handleDeleteFilter = (index: number) => {
    onChange({ ...data, filters: data.filters.filter((_, i) => i !== index) });
  };

  const handleAddSort = () => {
    if (data.columns.length === 0) return;
    const newSort: SortCondition = {
      columnId: data.columns[0].id,
      direction: "asc",
    };
    onChange({ ...data, sorts: [...data.sorts, newSort] });
  };

  const handleUpdateSort = (index: number, sort: SortCondition) => {
    const newSorts = [...data.sorts];
    newSorts[index] = sort;
    onChange({ ...data, sorts: newSorts });
  };

  const handleDeleteSort = (index: number) => {
    onChange({ ...data, sorts: data.sorts.filter((_, i) => i !== index) });
  };

  return (
    <div className="bn-database-block" onKeyDown={(e) => e.stopPropagation()}>
      {/* Toolbar */}
      <div className="bn-database-toolbar">
        <button onClick={handleAddColumn} className="bn-db-btn" title="컬럼 추가">
          + 컬럼
        </button>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className={`bn-db-btn ${data.filters.length > 0 ? "active" : ""}`}
        >
          필터{data.filters.length > 0 ? ` (${data.filters.length})` : ""}
        </button>
        <button
          onClick={() => setShowSort(!showSort)}
          className={`bn-db-btn ${data.sorts.length > 0 ? "active" : ""}`}
        >
          정렬{data.sorts.length > 0 ? ` (${data.sorts.length})` : ""}
        </button>
      </div>

      {/* Column Manager - 인라인 편집 */}
      <div className="bn-database-columns">
        {data.columns.map((col) => (
          <div key={col.id} className="bn-col-chip">
            <input
              className="bn-col-name-input"
              value={col.name}
              onChange={(e) => handleRenameColumn(col.id, e.target.value)}
            />
            <select
              className="bn-col-type-select"
              value={col.type}
              onChange={(e) => handleChangeColumnType(col.id, e.target.value as FieldType)}
            >
              {Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </select>
            {data.columns.length > 1 && (
              <button
                className="bn-col-delete"
                onClick={() => handleDeleteColumn(col.id)}
                title="컬럼 삭제"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Filter Panel */}
      {showFilter && (
        <div className="bn-database-panel">
          {data.filters.map((filter, i) => {
            const col = data.columns.find((c) => c.id === filter.columnId);
            const operators = col ? getOperatorsForType(col.type) : [];
            return (
              <div key={i} className="bn-filter-row">
                <select
                  value={filter.columnId}
                  onChange={(e) => handleUpdateFilter(i, { ...filter, columnId: e.target.value })}
                >
                  {data.columns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={filter.operator}
                  onChange={(e) => handleUpdateFilter(i, { ...filter, operator: e.target.value as FilterCondition["operator"] })}
                >
                  {operators.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
                {!["is_empty", "is_not_empty", "is_true", "is_false"].includes(filter.operator) && (
                  <input
                    type="text"
                    value={String(filter.value ?? "")}
                    onChange={(e) => handleUpdateFilter(i, { ...filter, value: e.target.value })}
                    placeholder="값 입력…"
                  />
                )}
                <button onClick={() => handleDeleteFilter(i)} className="bn-panel-delete">×</button>
              </div>
            );
          })}
          <button onClick={handleAddFilter} className="bn-db-btn">+ 필터 추가</button>
        </div>
      )}

      {/* Sort Panel */}
      {showSort && (
        <div className="bn-database-panel">
          {data.sorts.map((sort, i) => (
            <div key={i} className="bn-filter-row">
              <select
                value={sort.columnId}
                onChange={(e) => handleUpdateSort(i, { ...sort, columnId: e.target.value })}
              >
                {data.columns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                value={sort.direction}
                onChange={(e) => handleUpdateSort(i, { ...sort, direction: e.target.value as "asc" | "desc" })}
              >
                <option value="asc">오름차순</option>
                <option value="desc">내림차순</option>
              </select>
              <button onClick={() => handleDeleteSort(i)} className="bn-panel-delete">×</button>
            </div>
          ))}
          <button onClick={handleAddSort} className="bn-db-btn">+ 정렬 추가</button>
        </div>
      )}

      {/* Table */}
      <div className="bn-database-content">
        <DataSheetGrid
          value={displayRows}
          onChange={handleRowsChange}
          columns={dsgColumns}
          createRow={() => createEmptyRow(data.columns)}
          height={Math.min(400, Math.max(120, (displayRows.length + 1) * 34 + 40))}
        />
      </div>

      {/* Add Row */}
      <button onClick={handleAddRow} className="bn-db-add-row">
        + 새 행
      </button>
    </div>
  );
}
