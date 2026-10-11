import type { PointerEventHandler, ReactNode } from "react";

import { ChevronDownIcon } from "./browserIcons";
import {
  COLUMN_RESIZER_HITBOX_WIDTH_PX,
  createLazyColumnCacheEntry,
  type BrowserColumnId,
  type BrowserSortKey,
  type ColumnDefinition,
  type LazyColumnCacheEntry,
  type LazyFieldStatus,
} from "./browserObjectTableModel";
import type { BrowserItem } from "./browserTypes";
import { formatDateTime } from "./browserUtils";
import { useBrowserI18n, type BrowserTextFn } from "./browserI18n";

function renderLazyCellValue(
  status: LazyFieldStatus,
  value: string | number | null,
  text: BrowserTextFn,
  intlLocale: string,
): ReactNode {
  if (status === "idle") {
    return "—";
  }
  if (status === "error") {
    return text("Unavailable");
  }
  if (status === "ready") {
    if (typeof value === "number") {
      return value.toLocaleString(intlLocale);
    }
    return value || "—";
  }
  return (
    <span className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500">
      <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300 dark:bg-slate-600" />
      {text("Loading...")}
    </span>
  );
}

function formatExpiresCellValue(value: string | null): string | null {
  return value ? formatDateTime(value) : null;
}

function formatRestoreStatusCellValue(value: string | null, text: BrowserTextFn): string | null {
  if (!value) return null;
  const prefixLabel = "Restored until ";
  if (!value.startsWith(prefixLabel)) {
    return value;
  }
  const rawDate = value.slice(prefixLabel.length).trim();
  if (!rawDate) return text("Restored");
  return text("Restored until {date}", { date: formatDateTime(rawDate) });
}

type BrowserObjectColumnValueProps = {
  item: BrowserItem;
  columnId: BrowserColumnId;
  lazyEntry?: LazyColumnCacheEntry;
};

export function BrowserObjectColumnValue({
  item,
  columnId,
  lazyEntry,
}: BrowserObjectColumnValueProps): ReactNode {
  const { text, intlLocale } = useBrowserI18n();
  if (columnId === "type") {
    if (item.type === "folder") {
      return item.isHistorical
        ? text("Historical folder")
        : item.isDeleted
          ? text("Deleted folder")
          : text("Folder");
    }
    return item.isDeleted ? text("Deleted object") : text("Object");
  }
  if (columnId === "size") {
    return item.size;
  }
  if (columnId === "modified") {
    return item.modified;
  }
  if (columnId === "storageClass") {
    return item.storageClass ?? "—";
  }
  if (columnId === "etag") {
    return item.etag ?? "—";
  }

  if (item.type !== "file" || item.isDeleted) {
    return "—";
  }
  const resolvedLazyEntry = lazyEntry ?? createLazyColumnCacheEntry();
  if (columnId === "contentType") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      resolvedLazyEntry.contentType,
      text,
      intlLocale,
    );
  }
  if (columnId === "tagsCount") {
    return renderLazyCellValue(
      resolvedLazyEntry.tagsStatus,
      resolvedLazyEntry.tagsCount,
      text,
      intlLocale,
    );
  }
  if (columnId === "metadataCount") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      resolvedLazyEntry.metadataCount,
      text,
      intlLocale,
    );
  }
  if (columnId === "cacheControl") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      resolvedLazyEntry.cacheControl,
      text,
      intlLocale,
    );
  }
  if (columnId === "expires") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      formatExpiresCellValue(resolvedLazyEntry.expires),
      text,
      intlLocale,
    );
  }
  if (columnId === "restoreStatus") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      formatRestoreStatusCellValue(resolvedLazyEntry.restoreStatus, text),
      text,
      intlLocale,
    );
  }
  return "—";
}

type BrowserObjectColumnHeaderContentProps = {
  column: ColumnDefinition;
  sortKey: BrowserSortKey;
  sortDirection: "asc" | "desc";
  onSort: (sortKey: BrowserSortKey) => void;
};

export function BrowserObjectColumnHeaderContent({
  column,
  sortKey,
  sortDirection,
  onSort,
}: BrowserObjectColumnHeaderContentProps) {
  const { text } = useBrowserI18n();
  const sortable = column.sortable;
  if (!sortable) {
    return <span className="inline-flex h-6 items-center">{text(column.label)}</span>;
  }
  const active = sortKey === sortable;
  return (
    <button
      type="button"
      onClick={() => onSort(sortable)}
      className="group inline-flex h-6 items-center gap-1 text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
    >
      <span>{text(column.label)}</span>
      <ChevronDownIcon
        className={`h-3 w-3 transition ${active ? "opacity-100" : "opacity-30"} ${
          active && sortDirection === "asc" ? "-rotate-180" : ""
        }`}
      />
    </button>
  );
}

type BrowserColumnResizeHandleProps = {
  label: string;
  active: boolean;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onReset: () => void;
};

export function BrowserColumnResizeHandle({
  label,
  active,
  onPointerDown,
  onReset,
}: BrowserColumnResizeHandleProps) {
  const { text } = useBrowserI18n();
  const translatedLabel = text(label);
  const resizeLabel = text("Resize {label} column", { label: translatedLabel });
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={resizeLabel}
      title={resizeLabel}
      className="absolute inset-y-0 right-0 z-10 translate-x-1/2 cursor-col-resize touch-none select-none"
      style={{ width: `${COLUMN_RESIZER_HITBOX_WIDTH_PX}px` }}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        className={`mx-auto h-full w-0.5 rounded-full bg-slate-200 transition dark:bg-slate-700 ${
          active
            ? "bg-primary dark:bg-primary-300"
            : "hover:bg-slate-300 dark:hover:bg-slate-500"
        }`}
      />
    </div>
  );
}
