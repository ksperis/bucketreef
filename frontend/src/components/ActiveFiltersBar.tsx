/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton, ListBadge } from "./list/ListControls";
import type { ReactNode } from "react";
import UiRemoveIcon from "./ui/UiRemoveIcon";
import { cx, uiMutedTextClass } from "./ui/styles";

type ActiveFilterBarItem = {
  id: string;
  label: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
};

type ActiveFiltersBarProps = {
  items: ActiveFilterBarItem[];
  onClearAll: () => void;
  label?: ReactNode;
  clearLabel?: ReactNode;
  className?: string;
};

export default function ActiveFiltersBar({
  items,
  onClearAll,
  label = "Active filters:",
  clearLabel = "Clear all",
  className,
}: ActiveFiltersBarProps) {
  if (items.length === 0) return null;

  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      <span className={cx("shrink-0 ui-caption font-semibold", uiMutedTextClass)}>{label}</span>
      {items.map((item) => (
        <ListBadge tone="primary"
          key={item.id}
          className="inline-flex max-w-full items-center gap-1"
        >
          <span className="min-w-0 truncate">{item.label}</span>
          {item.onRemove ? (
            <ListActionButton
              type="button"
              onClick={item.onRemove}
              iconOnly variant="ghost"
              title={item.removeLabel}
              aria-label={item.removeLabel ?? "Remove filter"}
            >
              <UiRemoveIcon className="h-3 w-3" />
            </ListActionButton>
          ) : null}
        </ListBadge>
      ))}
      <ListActionButton
        type="button"
        onClick={onClearAll}
        variant="danger"
      >
        {clearLabel}
      </ListActionButton>
    </div>
  );
}
