/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps } from "react";
import MobileTableSort from "./MobileTableSort";

type TableSortControlsProps<Field extends string> = {
  columns: ReadonlyArray<{ label: string; field?: Field | null }>;
  sort: { field: Field; direction: "asc" | "desc"; onSort: (field: Field) => void };
  labels?: ComponentProps<typeof MobileTableSort>["labels"];
};

/** Reuses the table's supported columns and its existing sort transition. */
export default function TableSortControls<Field extends string>({ columns, sort, labels }: TableSortControlsProps<Field>) {
  const options = columns.flatMap((column) => column.field ? [{ value: column.field, label: column.label }] : []);
  if (options.length === 0) return null;
  return <MobileTableSort options={options} field={sort.field} direction={sort.direction} labels={labels}
    onFieldChange={sort.onSort}
    onDirectionChange={(direction) => { if (direction !== sort.direction) sort.onSort(sort.field); }} />;
}
