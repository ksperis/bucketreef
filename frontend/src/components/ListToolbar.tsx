/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";
import { SearchIcon } from "../features/browser/browserIcons";
import { cx, uiMutedTextClass, uiToolbarClass, uiToolbarSecondaryClass } from "./ui/styles";

export type ListToolbarProps = {
  variant: "page" | "section";
  title: ReactNode;
  description?: ReactNode;
  headingActions?: ReactNode;
  countLabel?: ReactNode;
  search?: ReactNode;
  filters?: ReactNode;
  columns?: ReactNode;
  actions?: ReactNode;
  mobileSort?: ReactNode;
  secondaryContent?: ReactNode;
  className?: string;
};

/** Both variants share the same search, filters, tools, then count layout. */
export default function ListToolbar({
  variant, title, description, headingActions, countLabel,
  search, filters, columns, actions, mobileSort, secondaryContent, className,
}: ListToolbarProps) {
  const headingId = useId();
  const hasControls = search || filters || columns || actions || mobileSort || countLabel != null;

  return (
    <div
      className={cx("ui-list-toolbar", uiToolbarClass, className)}
      data-list-variant={variant}
      role="region"
      aria-labelledby={variant === "section" ? headingId : undefined}
      aria-label={variant === "page" && typeof title === "string" ? title : undefined}
    >
      {variant === "section" ? (
        <div className="ui-list-toolbar-heading">
          <div className="min-w-0">
            <h2 id={headingId} className="ui-list-toolbar-title">{title}</h2>
            {description ? <p className={cx("ui-caption mt-1", uiMutedTextClass)}>{description}</p> : null}
          </div>
          {headingActions ? <div className="ui-list-toolbar-heading-actions">{headingActions}</div> : null}
        </div>
      ) : null}
      {hasControls ? (
        <div className="ui-list-toolbar-body">
          {search ? (
            <div className="ui-list-toolbar-search">
              <SearchIcon aria-hidden="true" className="ui-list-toolbar-search-icon" />
              {search}
            </div>
          ) : null}
          {filters ? <div className="ui-list-toolbar-filters">{filters}</div> : null}
          {columns || actions || mobileSort ? (
            <div className="ui-list-toolbar-tools">{columns}{actions}{mobileSort}</div>
          ) : null}
          {countLabel != null ? <span className="ui-list-toolbar-count">{countLabel}</span> : null}
        </div>
      ) : null}
      {secondaryContent ? (
        <div className={cx("ui-list-toolbar-secondary", uiToolbarSecondaryClass)}>{secondaryContent}</div>
      ) : null}
    </div>
  );
}
