/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import UiSelect from "../ui/UiSelect";

type MobileTableSortProps<Field extends string> = {
  options: ReadonlyArray<{ value: Field; label: string }>;
  field: Field;
  direction: "asc" | "desc";
  onFieldChange: (field: Field) => void;
  onDirectionChange: (direction: "asc" | "desc") => void;
};

/** Responsive table cards hide their column headers below 768px. */
export default function MobileTableSort<Field extends string>({
  options, field, direction, onFieldChange, onDirectionChange,
}: MobileTableSortProps<Field>) {
  return (
    <div className="flex flex-wrap items-end gap-2 md:hidden">
      <UiSelect label="Sort by" size="compact" value={field} onChange={(event) => onFieldChange(event.target.value as Field)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </UiSelect>
      <UiSelect label="Direction" size="compact" value={direction} onChange={(event) => onDirectionChange(event.target.value as "asc" | "desc")}>
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </UiSelect>
    </div>
  );
}
