import { type CellProps, type Column } from "react-datasheet-grid";
import Select from "react-select";
import type { MultiValue } from "react-select";
import type { SelectOption } from "../../../types/database";

interface MultiSelectColumnOptions {
  choices: SelectOption[];
}

interface OptionValue {
  value: string;
  label: string;
  color: string;
}

export function notionMultiSelectColumn({
  choices,
}: MultiSelectColumnOptions): Partial<Column<string[]>> {
  return {
    component: ({
      rowData = [],
      setRowData,
      focus,
    }: CellProps<string[]>) => {
      const selectedItems = choices.filter((c) => rowData?.includes(c.id));
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      if (!focus) {
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {selectedItems.map((item) => (
              <span
                key={item.id}
                style={{
                  backgroundColor: item.color,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: isDark ? "#e4e4e7" : "#333",
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
        );
      }

      const options: OptionValue[] = choices.map((c) => ({
        value: c.id,
        label: c.label,
        color: c.color,
      }));

      return (
        <Select<OptionValue, true>
          isMulti
          options={options}
          value={selectedItems.map((c) => ({
            value: c.id,
            label: c.label,
            color: c.color,
          }))}
          onChange={(newValue: MultiValue<OptionValue>) => {
            setRowData(newValue.map((v) => v.value));
          }}
          closeMenuOnSelect={false}
          hideSelectedOptions={false}
          formatOptionLabel={(option: OptionValue, { selectValue }) => {
            const isSelected = selectValue?.some(
              (v: OptionValue) => v.value === option.value
            );
            return (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "4px",
                    border: `2px solid ${isSelected ? "#2383E2" : "#ccc"}`,
                    backgroundColor: isSelected ? "#2383E2" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {isSelected && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <span
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "3px",
                    backgroundColor: option.color,
                    flexShrink: 0,
                  }}
                />
                <span>{option.label}</span>
              </div>
            );
          }}
          styles={{
            control: (base) => ({
              ...base,
              border: "none",
              boxShadow: "none",
              backgroundColor: "transparent",
              minHeight: "32px",
            }),
            multiValue: (base, { data }) => ({
              ...base,
              backgroundColor: (data as OptionValue).color,
              borderRadius: "4px",
              padding: "2px 6px",
            }),
            multiValueLabel: (base) => ({
              ...base,
              color: isDark ? "#e4e4e7" : "#333",
              fontSize: "13px",
              fontWeight: 500,
            }),
            multiValueRemove: (base) => ({
              ...base,
              color: isDark ? "#a1a1aa" : "#666",
              ":hover": { backgroundColor: "rgba(0,0,0,0.1)", color: isDark ? "#e4e4e7" : "#333" },
            }),
            menu: (base) => ({
              ...base,
              borderRadius: "8px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              zIndex: 9999,
            }),
            option: (base, state) => ({
              ...base,
              backgroundColor: state.isFocused ? (isDark ? "#3f3f46" : "#f5f5f5") : (isDark ? "#27272a" : "white"),
              padding: "8px 12px",
            }),
          }}
          autoFocus
          openMenuOnFocus
          menuPortalTarget={document.body}
          menuPosition="fixed"
        />
      );
    },
    copyValue: ({ rowData = [] }: { rowData: string[] }) => {
      return rowData
        .map((id) => choices.find((c) => c.id === id)?.label)
        .filter(Boolean)
        .join(", ");
    },
    pasteValue: ({ value }: { value: string }) => {
      return value
        .split(/,\s*/)
        .map((label) => choices.find((c) => c.label.toLowerCase() === label.toLowerCase())?.id)
        .filter(Boolean) as string[];
    },
    deleteValue: () => [],
    isCellEmpty: ({ rowData }: { rowData: string[] }) => !rowData?.length,
  };
}
