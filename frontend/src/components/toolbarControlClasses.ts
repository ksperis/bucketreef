/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const toolbarCompactButtonClasses = "ui-list-action";

export const toolbarCompactToggleClasses =
  "ui-list-control inline-flex items-center gap-2 border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-muted)]";

export const toolbarMatchModeButtonClasses = (
  mode: "contains" | "exact",
  pending: boolean,
  locked: boolean = false,
) => `ui-list-action ui-list-action-icon ui-list-search-mode${locked ? " cursor-not-allowed ui-list-action-active" : pending ? " ui-list-action-warning" : mode === "exact" ? " ui-list-action-active" : ""}`;
