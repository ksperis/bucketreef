/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "./list/ListControls";
import { cx, uiDividerClass, uiLabelClass, uiMutedTextClass } from "./ui/styles";
import { toolbarCompactSelectClasses } from "./toolbarControlClasses";

type PaginationControlsProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  disabled?: boolean;
};

export default function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  disabled = false,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / (pageSize || 1)));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;

  return (
    <div className={cx("ui-list-pagination flex flex-col gap-2 border-t md:flex-row md:items-center md:justify-between", uiDividerClass, uiMutedTextClass)}>
      <div className="flex items-center gap-2">
        <ListActionButton
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={!canPrev || disabled}
        >
          Previous
        </ListActionButton>
        <ListActionButton
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={!canNext || disabled}
        >
          Next
        </ListActionButton>
        <span className={cx("ui-caption", uiMutedTextClass)}>
          Page {safePage} of {totalPages} · {total} result{total === 1 ? "" : "s"}
        </span>
      </div>
      {onPageSizeChange && (
        <label className={cx("flex items-center gap-2", uiLabelClass)}>
          Page size
          <select
            className={cx(toolbarCompactSelectClasses, "ui-list-control")}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            disabled={disabled}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
