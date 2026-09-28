/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { BrowserObjectsQuery } from "../../api/browserContracts";
export type BrowserFileFilterDraft = { minSize: string; maxSize: string; modifiedAfter: string; modifiedBefore: string; extensions: string };
export const EMPTY_BROWSER_FILE_FILTERS: BrowserFileFilterDraft = { minSize: "", maxSize: "", modifiedAfter: "", modifiedBefore: "", extensions: "" };
export function browserFileFilterQuery(draft: BrowserFileFilterDraft): Pick<BrowserObjectsQuery, "minSize" | "maxSize" | "modifiedAfter" | "modifiedBefore" | "extensions"> {
  const date = (value: string) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : undefined;
  return { minSize: draft.minSize === "" ? undefined : Number(draft.minSize), maxSize: draft.maxSize === "" ? undefined : Number(draft.maxSize), modifiedAfter: date(draft.modifiedAfter), modifiedBefore: date(draft.modifiedBefore), extensions: draft.extensions || undefined };
}
