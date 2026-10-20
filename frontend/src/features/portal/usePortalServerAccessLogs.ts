/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import {
  downloadPortalServerAccessRawLogs,
  fetchPortalServerAccessLogPage,
  type PortalServerAccessLogEntry,
} from "../../api/portalActivity";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { triggerBlobDownload } from "../../utils/download";

export function todayDateInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function shiftDateInputValue(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return todayDateInputValue();
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

type UsePortalServerAccessLogsOptions = {
  accountId: S3AccountSelector;
  shouldLoad: boolean;
  advancedFilter?: string;
};

export function usePortalServerAccessLogs({
  accountId,
  shouldLoad,
  advancedFilter,
}: UsePortalServerAccessLogsOptions) {
  const { t } = useI18n();
  const [date, setDate] = useState(todayDateInputValue);
  const [spaceId, setSpaceId] = useState("");
  const [entries, setEntries] = useState<PortalServerAccessLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rawLogsModalOpen, setRawLogsModalOpen] = useState(false);
  const [rawLogsDateFrom, setRawLogsDateFrom] = useState(todayDateInputValue);
  const [rawLogsDateTo, setRawLogsDateTo] = useState(todayDateInputValue);
  const [rawLogsSpaceId, setRawLogsSpaceId] = useState("");
  const [rawLogsLoading, setRawLogsLoading] = useState(false);
  const [rawLogsError, setRawLogsError] = useState<string | null>(null);

  const resetResults = useCallback(() => {
    setEntries([]);
    setTotal(0);
    setLoaded(false);
    setError(null);
    setPage(1);
  }, []);

  const setDateAndReset = useCallback(
    (value: string) => {
      setDate(value);
      resetResults();
    },
    [resetResults],
  );

  const setSpaceIdAndReset = useCallback(
    (value: string) => {
      setSpaceId(value);
      resetResults();
    },
    [resetResults],
  );

  const setPageSizeAndReset = useCallback((value: number) => {
    setPageSize(value);
    setPage(1);
  }, []);

  useEffect(() => {
    if (!shouldLoad || !accountId || !date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLoaded(false);
    void fetchPortalServerAccessLogPage(accountId, {
      date,
      spaceId: spaceId || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      advancedFilter,
    })
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        setTotal(result.total);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setEntries([]);
        setTotal(0);
        setLoaded(true);
        setError(
          extractApiError(
            err,
            t({
              en: "Unable to retrieve access history.",
              fr: "Impossible de récupérer l'historique d'accès.",
              de: "Zugriffsverlauf kann nicht abgerufen werden.",
              zh: "无法获取访问历史。",
            }),
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, advancedFilter, date, page, pageSize, shouldLoad, spaceId, t]);

  const openRawLogsModal = useCallback(() => {
    setRawLogsDateFrom(date);
    setRawLogsDateTo(date);
    setRawLogsSpaceId(spaceId);
    setRawLogsError(null);
    setRawLogsModalOpen(true);
  }, [date, spaceId]);

  const closeRawLogsModal = useCallback(() => {
    setRawLogsModalOpen(false);
  }, []);

  const downloadRawLogs = useCallback(async () => {
    if (!accountId) return;
    if (!rawLogsDateFrom || !rawLogsDateTo) {
      setRawLogsError(
        t({
          en: "Select a start and end date.",
          fr: "Sélectionnez une date de début et de fin.",
          de: "Wählen Sie ein Start- und Enddatum.",
          zh: "请选择开始和结束日期。",
        }),
      );
      return;
    }
    if (rawLogsDateTo < rawLogsDateFrom) {
      setRawLogsError(
        t({
          en: "The end date must be after the start date.",
          fr: "La date de fin doit être après la date de début.",
          de: "Das Enddatum muss nach dem Startdatum liegen.",
          zh: "结束日期必须晚于开始日期。",
        }),
      );
      return;
    }
    setRawLogsLoading(true);
    setRawLogsError(null);
    try {
      const result = await downloadPortalServerAccessRawLogs(accountId, {
        dateFrom: rawLogsDateFrom,
        dateTo: rawLogsDateTo,
        spaceId: rawLogsSpaceId || undefined,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      });
      triggerBlobDownload(result.filename, result.blob);
      setRawLogsModalOpen(false);
    } catch (err) {
      console.error(err);
      setRawLogsError(
        extractApiError(
          err,
          t({
            en: "Unable to export raw access logs.",
            fr: "Impossible d'exporter les logs d'accès bruts.",
            de: "Rohe Zugriffslogs können nicht exportiert werden.",
            zh: "无法导出原始访问日志。",
          }),
        ),
      );
    } finally {
      setRawLogsLoading(false);
    }
  }, [accountId, rawLogsDateFrom, rawLogsDateTo, rawLogsSpaceId, t]);

  return {
    date,
    spaceId,
    entries,
    total,
    loading,
    loaded,
    error,
    page,
    pageSize,
    setPage,
    setPageSizeAndReset,
    setDateAndReset,
    setSpaceIdAndReset,
    resetResults,
    rawLogsModalOpen,
    rawLogsDateFrom,
    rawLogsDateTo,
    rawLogsSpaceId,
    rawLogsLoading,
    rawLogsError,
    setRawLogsDateFrom,
    setRawLogsDateTo,
    setRawLogsSpaceId,
    openRawLogsModal,
    closeRawLogsModal,
    downloadRawLogs,
  };
}
