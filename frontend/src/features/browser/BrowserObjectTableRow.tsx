import type { MouseEvent as ReactMouseEvent } from "react";

import {
  ListActionButton,
  ListSelectionCheckbox,
} from "../../components/list/ListControls";
import { BrowserDirectItemActionButton } from "./BrowserActionPresentation";
import { storageClassChipClasses } from "./browserConstants";
import { FileIcon, FolderIcon, MoreIcon, TrashIcon } from "./browserIcons";
import { resolveBrowserItemOpenLabel } from "./browserObjectItemPresentation";
import { BrowserObjectColumnValue } from "./BrowserObjectTablePresentation";
import { objectPreviewKind } from "../shared/ObjectPreview";
import type { BrowserActionId, BrowserActionState } from "./browserActions";
import type {
  ColumnDefinition,
  LazyColumnCacheEntry,
} from "./browserObjectTableModel";
import type { BrowserItem } from "./browserTypes";
import { useBrowserI18n } from "./browserI18n";

const comfortableMetadataLabelClasses =
  "inline-flex items-center rounded border px-1 ui-badge font-semibold";

type BrowserObjectTableRowProps = {
  item: BrowserItem;
  selected: boolean;
  viewed?: boolean;
  compactMode: boolean;
  nameColumnWidthPx: number;
  visibleColumns: readonly ColumnDefinition[];
  lazyEntry?: LazyColumnCacheEntry;
  directActions: readonly BrowserActionState[];
  rowHeightClasses: string;
  rowCellClasses: string;
  iconBoxClasses: string;
  nameGapClasses: string;
  primaryItemButtonHeightClasses: string;
  onClick: (event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onToggleSelection: (extendRange: boolean) => void;
  onNameClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRunAction: (actionId: BrowserActionId) => void;
  onOpenActions: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

function resolveObjectTypeLabel(
  item: BrowserItem,
  text: (message: string) => string,
  contentType?: string | null,
): string {
  if (item.type === "folder") {
    if (item.isHistorical) return text("Historical folder");
    return item.isDeleted ? text("Deleted folder") : text("Prefix");
  }
  if (item.isDeleted) return text("Deleted object");
  const kind = objectPreviewKind(item.name, contentType);
  return kind === "generic"
    ? text("Binary")
    : kind === "pdf"
      ? "PDF"
      : text({ image: "Image", video: "Video", audio: "Audio", text: "Text" }[kind]);
}

export default function BrowserObjectTableRow({
  item,
  selected,
  viewed = false,
  compactMode,
  nameColumnWidthPx,
  visibleColumns,
  lazyEntry,
  directActions,
  rowHeightClasses,
  rowCellClasses,
  iconBoxClasses,
  nameGapClasses,
  primaryItemButtonHeightClasses,
  onClick,
  onContextMenu,
  onToggleSelection,
  onNameClick,
  onRunAction,
  onOpenActions,
}: BrowserObjectTableRowProps) {
  const { text } = useBrowserI18n();
  const isDeleted = Boolean(item.isDeleted);
  const isHistorical = Boolean(item.isHistorical);
  return (
    <tr
      data-browser-item
      data-browser-item-id={item.id}
      data-viewed={viewed || undefined}
      data-selected={(!isDeleted && selected) || undefined}
      data-lazy-item-id={
        item.type === "file" && !item.isDeleted ? item.id : undefined
      }
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`ui-browser-row ui-current-item ${rowHeightClasses} cursor-pointer transition-colors`}
    >
      <td className={`px-2 ${rowCellClasses} !align-middle`}>
        <ListSelectionCheckbox
          checked={!isDeleted && selected}
          onClick={(event) => onToggleSelection(event.shiftKey)}
          onChange={() => undefined}
          aria-label={text("Select {name}", { name: item.name })}
          disabled={isDeleted}
        />
      </td>
      <td
        className={`ui-table-primary min-w-0 px-4 ${rowCellClasses} !align-middle ui-body ${
          isHistorical
            ? "text-amber-800 dark:text-amber-200"
            : isDeleted
              ? "text-rose-700 dark:text-rose-200"
              : "text-slate-700 dark:text-slate-200"
        }`}
        style={{ maxWidth: `${nameColumnWidthPx}px` }}
      >
        <button
          type="button"
          data-browser-open-item
          aria-current={viewed ? "true" : undefined}
          onClick={onNameClick}
          onDoubleClick={(event) => event.preventDefault()}
          aria-label={resolveBrowserItemOpenLabel(item, text)}
          className={`flex ${primaryItemButtonHeightClasses} w-full min-w-0 items-center ${nameGapClasses} text-left`}
          title={item.name}
        >
          <span
            className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-md border shadow-sm ${
              isHistorical
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                : isDeleted
                  ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/20 dark:text-rose-200"
                  : item.type === "folder"
                    ? "border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                    : "border-sky-200 bg-sky-50/90 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200"
            }`}
          >
            {item.type === "folder" ? (
              <FolderIcon />
            ) : isDeleted ? (
              <TrashIcon />
            ) : (
              <FileIcon />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <span
              className={`flex w-full min-w-0 items-baseline gap-1 text-left font-semibold ${
                isHistorical
                  ? "text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
                  : isDeleted
                    ? "text-rose-700 hover:text-rose-800 dark:text-rose-200 dark:hover:text-rose-100"
                    : "text-slate-900 hover:text-primary-700 dark:text-slate-100 dark:hover:text-primary-200"
              }`}
            >
              <span className="truncate">{item.name}</span>
              {(isDeleted || isHistorical) && (
                <span
                  className={`shrink-0 ui-caption font-semibold ${
                    isHistorical
                      ? "text-amber-600 dark:text-amber-300"
                      : "text-rose-500 dark:text-rose-300"
                  }`}
                >
                  {isHistorical ? text("(history)") : text("(deleted)")}
                </span>
              )}
            </span>
            {!compactMode && (
              <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden ui-caption text-slate-500 dark:text-slate-400">
                <span
                  className={`${comfortableMetadataLabelClasses} border-slate-200 dark:border-slate-700`}
                >
                  {resolveObjectTypeLabel(item, text, lazyEntry?.contentType)}
                </span>
                {(isDeleted || isHistorical) && (
                  <span
                    className={`${comfortableMetadataLabelClasses} ${
                      isHistorical
                        ? "border-amber-200 text-amber-700 dark:border-amber-500/40 dark:text-amber-200"
                        : "border-rose-200 text-rose-700 dark:border-rose-500/40 dark:text-rose-200"
                    }`}
                  >
                    {isHistorical
                      ? text("Version history")
                      : item.type === "folder"
                        ? text("Delete markers")
                        : text("Delete marker")}
                  </span>
                )}
                {item.storageClass && (
                  <span
                    className={`${comfortableMetadataLabelClasses} ${
                      storageClassChipClasses[item.storageClass] ??
                      "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {item.storageClass}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
      </td>
      {visibleColumns.map((column) => (
        <td
          key={column.id}
          className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-600 dark:text-slate-300 whitespace-nowrap overflow-hidden text-ellipsis ${
            column.align === "right" ? "text-right" : ""
          }`}
        >
          <BrowserObjectColumnValue
            item={item}
            columnId={column.id}
            lazyEntry={lazyEntry}
          />
        </td>
      ))}
      <td className={`px-2 ${rowCellClasses} !align-middle text-right`}>
        <div className="flex items-center justify-end gap-1">
          {directActions.map((action) => (
            <BrowserDirectItemActionButton
              key={action.id}
              action={action}
              itemName={item.name}
              onSelect={() => onRunAction(action.id)}
            />
          ))}
          <ListActionButton
            iconOnly
            aria-label={text("More actions for {name}", { name: item.name })}
            title={text("More")}
            onClick={onOpenActions}
          >
            <MoreIcon />
          </ListActionButton>
        </div>
      </td>
    </tr>
  );
}
