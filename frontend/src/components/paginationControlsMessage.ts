/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { interpolateText, useI18n, type I18nMessage } from "../i18n";

const m = (en: string, zh: string): I18nMessage => ({ en, zh });

const paginationControlsMessage = {
  previous: m("Previous", "上一页"),
  next: m("Next", "下一页"),
  pageResult: m("Page {page} of {pages} · {total} result", "第 {page} 页，共 {pages} 页 · {total} 条结果"),
  pageResults: m("Page {page} of {pages} · {total} results", "第 {page} 页，共 {pages} 页 · {total} 条结果"),
  pageSize: m("Page size", "每页条数"),
};

type PaginationControlsMessageKey = keyof typeof paginationControlsMessage;

export function usePaginationControlsI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: PaginationControlsMessageKey, values?: Record<string, string | number>) =>
      interpolateText(t(paginationControlsMessage[key]), values),
    [t],
  );
  return { text };
}
