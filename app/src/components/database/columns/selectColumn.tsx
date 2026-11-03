import { type CellProps, type Column } from "react-datasheet-grid";
import Select, { type SingleValue } from "react-select";
import CreatableSelect from "react-select/creatable";
import type { SelectOption } from "../../../types/database";

interface OptionValue {
  value: string;
  label: string;
  color: string;
}

interface SelectColumnOptions {
  choices: SelectOption[];
  onCreateOption?: (label: string) => void;
}

export function notionSelectColumn({
  choices,
  onCreateOption,
}: SelectColumnOptions): Partial<Column<string | null>> {
  return {
    component: ({
      rowData,
      setRowData,
      stopEditing,
      focus,
    }: CellProps<string | null>) => {
      const selected = choices.find((c) => c.id === rowData);
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      if (!focus) {
        return selected ? (
          <span
            style={{
              backgroundColor: selected.color,
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 500,
              color: isDark ? "#e4e4e7" : "#333",
            }}
          >
            {selected.label}
          </span>
        ) : (
          <span />
        );
      }

      const options: OptionValue[] = choices.map((c) => ({
        value: c.id,
        label: c.label,
        color: c.color,
      }));

      const currentValue: OptionValue | null = selected
        ? { value: selected.id, label: selected.label, color: selected.color }
        : null;

      const handleChange = (option: SingleValue<OptionValue>) => {
        setRowData(option?.value ?? null);
        setTimeout(stopEditing, 0);
      };

      const commonProps = {
        options,
        value: currentValue,
        onChange: handleChange,
        formatOptionLabel: (option: OptionValue) => (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "3px",
                backgroundColor: option.color,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span>{option.label}</span>
          </div>
        ),
        styles: {
          control: (base: Record<string, unknown>) => ({
            ...base,
            border: "none",
            boxShadow: "none",
            backgroundColor: "transparent",
            minHeight: "28px",
          }),
          menu: (base: Record<string, unknown>) => ({
            ...base,
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 9999,
          }),
          option: (base: Record<string, unknown>, state: { isFocused: boolean }) => ({
            ...base,
            backgroundColor: state.isFocused ? (isDark ? "#3f3f46" : "#f5f5f5") : (isDark ? "#27272a" : "white"),
            color: isDark ? "#e4e4e7" : "#333",
            padding: "8px 12px",
          }),
        },
        isClearable: true,
        autoFocus: true,
        openMenuOnFocus: true,
        menuPortalTarget: document.body,
        menuPosition: "fixed" as const,
      };

      if (onCreateOption) {
        return (
          <CreatableSelect<OptionValue>
            {...commonProps}
            onCreateOption={(inputValue: string) => onCreateOption(inputValue)}
            formatCreateLabel={(input: string) => `"${input}" 추가`}
          />
        );
      }

      return <Select<OptionValue> {...commonProps} />;
    },
    copyValue: ({ rowData }: { rowData: string | null }) => {
      const choice = choices.find((c) => c.id === rowData);
      return choice?.label ?? "";
    },
    pasteValue: ({ value }: { value: string }) => {
      const choice = choices.find(
        (c) => c.label.toLowerCase() === value.toLowerCase()
      );
      return choice?.id ?? null;
    },
    deleteValue: () => null,
    isCellEmpty: ({ rowData }: { rowData: string | null }) => !rowData,
  };
}
