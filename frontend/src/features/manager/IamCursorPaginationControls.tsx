/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../components/list/ListControls";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { usePaginationControlsI18n } from "../../components/paginationControlsMessage";

export default function IamCursorPaginationControls({
  page,
  pageSize,
  canPrevious,
  canNext,
  disabled,
  onPrevious,
  onNext,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  canPrevious: boolean;
  canNext: boolean;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { text } = usePaginationControlsI18n();
  return (
    <div className={cx("ui-list-pagination flex flex-col gap-2 border-t md:flex-row md:items-center md:justify-between", uiMutedTextClass)}>
      <div className="flex items-center gap-2">
        <ListActionButton type="button" onClick={onPrevious} disabled={disabled || !canPrevious}>
          {text("previous")}
        </ListActionButton>
        <ListActionButton type="button" onClick={onNext} disabled={disabled || !canNext}>
          {text("next")}
        </ListActionButton>
        <span className="ui-caption">{`Page ${page}`}</span>
      </div>
      <UiSelect
        size="compact"
        className="ui-list-control"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        disabled={disabled}
        aria-label="Items per page"
      >
        {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
      </UiSelect>
    </div>
  );
}
