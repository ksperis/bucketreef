/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import ListToolbar, { type ListToolbarProps } from "../ListToolbar";
import { cx, uiCardClass } from "../ui/styles";

type ListPageSectionProps = Omit<
  ListToolbarProps,
  "className"
> & {
  children: ReactNode;
  className?: string;
  toolbarClassName?: string;
};

/**
 * Standard inventory surface used by the main workspace list pages.
 * It keeps toolbar, filters, table, and pagination in one shared card layout.
 */
export default function ListPageSection({
  children,
  className,
  toolbarClassName,
  ...toolbarProps
}: ListPageSectionProps) {
  return (
    <section className={cx("ui-listing", uiCardClass, className)}>
      <ListToolbar
        {...toolbarProps}
        className={toolbarClassName}
      />
      {children}
    </section>
  );
}
