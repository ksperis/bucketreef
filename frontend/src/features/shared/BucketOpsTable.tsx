/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import type { ListTableStatus } from "../../components/list/listTableStatus";
import SortableHeader from "../../components/SortableHeader";
import TableEmptyState from "../../components/TableEmptyState";
import type { SortField } from "./bucketOpsListState";
import { isStatsSortField } from "./bucketOpsPresentation";
import "./bucketOpsTable.css";

export type BucketOpsTableColumn = {
  id: string;
  label: string;
  field?: SortField | null;
  align?: "left" | "right";
  expensive?: boolean;
  header?: ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  render: (bucket: CephAdminBucket) => ReactNode;
};

type BucketOpsTableProps = {
  columns: readonly BucketOpsTableColumn[];
  detailLoadingColumnIds: ReadonlySet<string>;
  items: readonly CephAdminBucket[];
  loadingDetails: boolean;
  onSort: (field: SortField) => void;
  showAdvancedFilter: boolean;
  sort: { field: SortField; direction: "asc" | "desc" };
  status: ListTableStatus;
  usageFeatureEnabled: boolean;
};

const expensiveColumnClass = "bg-amber-50/60 dark:bg-amber-900/20";
const defaultColumnMinWidthClass = "min-w-[9rem]";
function pinnedColumnClass(columnId: string) {
  if (columnId === "select") return "bucket-ops-table-select";
  if (columnId === "name") return "bucket-ops-table-name";
  return "";
}

function headerClassName(
  column: BucketOpsTableColumn,
  loadingDetails: boolean,
  detailLoadingColumnIds: ReadonlySet<string>,
) {
  const minWidthClass =
    column.id !== "select" && !column.headerClassName
      ? defaultColumnMinWidthClass
      : "";
  const detailLoadingClass =
    loadingDetails && detailLoadingColumnIds.has(column.id)
      ? "animate-pulse"
      : "";
  return `${minWidthClass} ${column.headerClassName ?? ""} ${column.expensive ? expensiveColumnClass : ""} ${detailLoadingClass} ${pinnedColumnClass(column.id)}`;
}

function cellClassName(
  column: BucketOpsTableColumn,
  loadingDetails: boolean,
  detailLoadingColumnIds: ReadonlySet<string>,
) {
  const align = column.align ?? (column.id === "actions" ? "right" : "left");
  const cellBase =
    align === "right"
      ? "px-6 py-4 text-right"
      : column.id === "select"
        ? "w-10 px-3 py-4"
        : "px-6 py-4";
  const textClass =
    column.id === "select"
      ? ""
      : column.id === "name"
        ? "ui-table-primary"
        : "ui-table-secondary";
  const detailLoadingCellClass =
    loadingDetails && detailLoadingColumnIds.has(column.id)
      ? column.expensive
        ? "animate-pulse bg-amber-100/70 dark:bg-amber-900/30"
        : "animate-pulse bg-slate-100/70 dark:bg-slate-800/60"
      : "";
  return `${cellBase} ${textClass} ${column.cellClassName ?? ""} ${column.expensive ? expensiveColumnClass : ""} ${detailLoadingCellClass} ${pinnedColumnClass(column.id)}`;
}

export default function BucketOpsTable({
  columns,
  detailLoadingColumnIds,
  items,
  loadingDetails,
  onSort,
  showAdvancedFilter,
  sort,
  status,
  usageFeatureEnabled,
}: BucketOpsTableProps) {
  return (
    <div
      role="region"
      aria-label="Bucket list"
      tabIndex={showAdvancedFilter ? -1 : 0}
      className={`bucket-ops-table-scroll ${showAdvancedFilter ? "overflow-x-hidden" : "overflow-x-auto"}`}
    >
      <table className="ui-data-table !table-auto !w-max min-w-full divide-y divide-slate-200 dark:divide-slate-800">
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            {columns.map((column) => {
              const className = headerClassName(
                column,
                loadingDetails,
                detailLoadingColumnIds,
              );
              if (column.header || !column.field) {
                return (
                  <th
                    key={column.id}
                    className={`${
                      column.align === "right" ? "text-right" : "text-left"
                    } ${column.id === "select" ? "w-10" : ""} ${className}`}
                  >
                    <div className="flex items-start">
                      {column.header ?? column.label}
                    </div>
                  </th>
                );
              }
              return (
                <SortableHeader
                  key={column.id}
                  label={column.label}
                  field={column.field}
                  activeField={sort.field}
                  direction={sort.direction}
                  align={
                    column.align ??
                    (column.label === "Actions" ? "right" : "left")
                  }
                  className={className}
                  onSort={
                    usageFeatureEnabled || !isStatsSortField(column.field)
                      ? onSort
                      : undefined
                  }
                />
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {status === "loading" && (
            <TableEmptyState
              colSpan={columns.length}
              message="Loading buckets..."
            />
          )}
          {status === "error" && (
            <TableEmptyState
              colSpan={columns.length}
              message="Unable to load buckets."
              tone="error"
            />
          )}
          {status === "empty" && (
            <TableEmptyState colSpan={columns.length} message="No buckets." />
          )}
          {items.map((bucket) => (
            <tr
              key={`${bucket.tenant ?? ""}:${bucket.name}`}
              className="group hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              {columns.map((column) => (
                <td
                  key={`${bucket.name}:${column.id}`}
                  className={cellClassName(
                    column,
                    loadingDetails,
                    detailLoadingColumnIds,
                  )}
                >
                  {column.render(bucket)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
