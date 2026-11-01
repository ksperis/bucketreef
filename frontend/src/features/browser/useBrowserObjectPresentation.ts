/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import type {
  BrowserCapabilityFacts,
  BrowserDensity,
  BrowserFunctionalProfile,
} from "./browserActions";
import {
  DEFAULT_VISIBLE_COLUMN_IDS,
  buildBrowserObjectTableLayout,
} from "./browserObjectTableModel";
import { useBrowserDensity } from "./useBrowserDensity";
import { useBrowserObjectColumns } from "./useBrowserObjectColumns";
import { useBrowserObjectSort } from "./useBrowserObjectSort";

type UseBrowserObjectPresentationOptions = {
  canOpenExternalObjectDetails: boolean;
  capabilityFacts: BrowserCapabilityFacts;
  densityOverride?: BrowserDensity;
  functionalProfile: BrowserFunctionalProfile;
  initialStoredDensity?: BrowserDensity | null;
  isMainBrowserPath: boolean;
  isPortalProfile: boolean;
};

export function useBrowserObjectPresentation({
  canOpenExternalObjectDetails,
  capabilityFacts,
  densityOverride,
  functionalProfile,
  initialStoredDensity,
  isMainBrowserPath,
  isPortalProfile,
}: UseBrowserObjectPresentationOptions) {
  const {
    activeColumnResize,
    columnWidths,
    resetColumnWidth,
    resetColumns,
    startColumnResize,
    toggleVisibleColumn,
    visibleColumns,
  } = useBrowserObjectColumns({ isMainBrowserPath });
  const effectiveVisibleColumns = isPortalProfile
    ? DEFAULT_VISIBLE_COLUMN_IDS
    : visibleColumns;
  const visibleColumnSet = useMemo(
    () => new Set(effectiveVisibleColumns),
    [effectiveVisibleColumns],
  );
  const {
    backendSortBy,
    sortDirection,
    sortId,
    sortKey,
    toggleSort,
  } = useBrowserObjectSort({ visibleColumns: visibleColumnSet });
  const {
    canConfigure: canConfigureDensity,
    compactMode,
    setCompactMode,
  } = useBrowserDensity({
    densityOverride,
    initialStoredDensity,
    isMainBrowserPath,
  });
  const canConfigureColumns =
    isMainBrowserPath && functionalProfile === "advanced";
  const directItemActionCount =
    1 +
    Number(capabilityFacts.canDeleteObjects) +
    Number(
      isPortalProfile &&
        capabilityFacts.canCreatePublicLinks &&
        canOpenExternalObjectDetails,
    );
  const tableLayout = useMemo(
    () =>
      buildBrowserObjectTableLayout({
        visibleColumns: visibleColumnSet,
        columnWidths,
        compactMode,
        directItemActionCount,
      }),
    [columnWidths, compactMode, directItemActionCount, visibleColumnSet],
  );

  return {
    activeColumnResize,
    backendSortBy,
    canConfigureColumns,
    canConfigureDensity,
    compactMode,
    effectiveVisibleColumns,
    headerPaddingClasses: compactMode ? "!py-1" : "py-3",
    iconBoxClasses: compactMode ? "h-6 w-6" : "h-9 w-9",
    nameGapClasses: compactMode ? "gap-1.5" : "gap-3",
    primaryItemButtonHeightClasses: compactMode ? "" : "min-h-11",
    resetColumnWidth,
    resetVisibleColumns: resetColumns,
    rowCellClasses: compactMode ? "!py-0.5" : "py-2.5",
    rowHeightClasses: compactMode ? "h-9" : "h-16",
    setCompactMode,
    sortDirection,
    sortId,
    sortKey,
    startColumnResize,
    tableLayout,
    toggleSort,
    toggleVisibleColumn,
    visibleColumnSet,
  };
}
