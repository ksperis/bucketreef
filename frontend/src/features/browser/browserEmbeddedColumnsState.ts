/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { CLIENT_STORAGE_KEYS, readClientJson, writeClientJson } from "../../utils/clientStorage";
import {
  normalizePersistedBrowserColumns,
  normalizePersistedBrowserColumnWidths,
} from "./browserColumnPersistence";

export const BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY =
  CLIENT_STORAGE_KEYS.browserEmbeddedObjectColumns;
export const BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY =
  CLIENT_STORAGE_KEYS.browserEmbeddedObjectColumnWidths;

export const readBrowserEmbeddedObjectColumns = (): string[] => {
  if (typeof window === "undefined") return [];
  return normalizePersistedBrowserColumns(
    readClientJson<unknown>(BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY),
  );
};

export const writeBrowserEmbeddedObjectColumns = (columns: string[]) => {
  if (typeof window === "undefined") return;
  writeClientJson(
    BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY,
    normalizePersistedBrowserColumns(columns),
  );
};

export const readBrowserEmbeddedObjectColumnWidths = (): Record<
  string,
  number
> => {
  if (typeof window === "undefined") return {};
  return normalizePersistedBrowserColumnWidths(
    readClientJson<unknown>(BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY),
  );
};

export const writeBrowserEmbeddedObjectColumnWidths = (
  widths: Record<string, number>,
) => {
  if (typeof window === "undefined") return;
  writeClientJson(
    BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY,
    normalizePersistedBrowserColumnWidths(widths),
  );
};
