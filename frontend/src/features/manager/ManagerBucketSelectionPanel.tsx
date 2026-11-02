/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton, ListSelectionCheckbox } from "../../components/list/ListControls";
import { ReactNode } from "react";

import type { Bucket } from "../../api/bucketContracts";
import ListToolbar from "../../components/ListToolbar";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import PaginationControls from "../../components/PaginationControls";
import { ListTableStatus } from "../../components/list/listTableStatus";

import UiInput from "../../components/ui/UiInput";
import { useManagerI18n } from "./managerI18n";

type ManagerBucketSelectionPanelProps = {
  className?: string;
  countLabel?: ReactNode;
  title?: string;
  description: string;
  filter: string;
  filterPlaceholder: string;
  onFilterChange: (filter: string) => void;
  buckets: Bucket[];
  selectedBuckets: Set<string>;
  onToggleBucket: (bucketName: string) => void;
  onSelectFiltered: () => void;
  onClearSelection: () => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  action?: ReactNode;
  tableStatus: ListTableStatus;
  loadingMessage: string;
  errorMessage: string;
  emptyMessage: string;
};

export default function ManagerBucketSelectionPanel({
  className = "ui-surface-card",
  countLabel,
  title,
  description,
  filter,
  filterPlaceholder,
  onFilterChange,
  buckets,
  selectedBuckets,
  onToggleBucket,
  onSelectFiltered,
  onClearSelection,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  action,
  tableStatus,
  loadingMessage,
  errorMessage,
  emptyMessage,
}: ManagerBucketSelectionPanelProps) {
  const { text } = useManagerI18n();
  const columns: Array<DataTableColumn<Bucket>> = [
    {
      id: "select",
      label: text("Select"),
      header: <span className="sr-only">{text("Select")}</span>,
      headerClassName: "w-12",
      cellClassName: "w-12",
      mobileLabel: text("Select"),
      render: (bucket) => (
        <ListSelectionCheckbox
          aria-label={text("Select {bucket}", { bucket: bucket.name })}
          checked={selectedBuckets.has(bucket.name)}
          onChange={() => onToggleBucket(bucket.name)}
        />
      ),
    },
    { id: "bucket", label: text("Bucket"), primary: true, mobileRole: "primary", render: (bucket) => bucket.name },
  ];

  return (
    <div className={className}>
      <ListToolbar
        title={title ?? text("Buckets")}
        description={description}
        variant="section"
        countLabel={countLabel ?? text(total === 1 ? "{count} result" : "{count} results", { count: total })}
        search={
          <UiInput
            type="search"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
            fieldClassName="w-full sm:w-80"
            size="compact"
          />
        }
        actions={
          <>
            <ListActionButton
              type="button"
              onClick={onSelectFiltered}
              disabled={buckets.length === 0}
              variant="secondary"

            >
              {text("Select page")}
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={onClearSelection}
              disabled={selectedBuckets.size === 0}
              variant="secondary"

            >
              {text("Clear")}
            </ListActionButton>
          </>
        }
        headingActions={action}
      />
      <DataTableShell
        responsiveCards
        columns={columns}
        rows={buckets}
        rowKey={(bucket) => bucket.name}
        status={tableStatus}
        loadingMessage={loadingMessage}
        errorMessage={errorMessage}
        emptyMessage={emptyMessage}
        tableLayout="fixed"
      />
      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        disabled={tableStatus === "loading"}
      />
    </div>
  );
}
