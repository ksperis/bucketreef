/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";

import {
  getCostAnalytics,
  getCostSubjects,
  getCostSummary,
  type CostAnalyticsResponse,
  type CostSubjectSummary,
  type CostSummary,
} from "../../api/cost";
import { extractApiError, extractApiErrorCode } from "../../utils/apiError";

export function useCostPageResources({
  month,
  selectedEndpointId,
  subjectType,
  page,
  pageSize,
  sortBy,
  sortDir,
  search,
  analyticsEnabled,
  reloadToken,
  summaryErrorText,
  subjectsErrorText,
  analyticsErrorText,
}: {
  month: string;
  selectedEndpointId: number | null;
  subjectType: "all" | "account" | "s3_user";
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  search: string;
  analyticsEnabled: boolean;
  reloadToken: number;
  summaryErrorText: string;
  subjectsErrorText: string;
  analyticsErrorText: string;
}) {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [costDisabled, setCostDisabled] = useState(false);
  const [subjects, setSubjects] = useState<CostSubjectSummary[]>([]);
  const [subjectsTotal, setSubjectsTotal] = useState(0);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [analytics, setAnalytics] = useState<CostAnalyticsResponse | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      setSummaryLoading(true);
      setSummaryError(null);
      setCostDisabled(false);
      try {
        const data = await getCostSummary(month, selectedEndpointId);
        if (!cancelled) setSummary(data);
      } catch (err) {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(extractApiError(err, summaryErrorText));
        setCostDisabled(extractApiErrorCode(err) === "cost_disabled");
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }
    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [month, reloadToken, selectedEndpointId, summaryErrorText]);

  useEffect(() => {
    let cancelled = false;
    async function loadSubjects() {
      setSubjectsLoading(true);
      setSubjectsError(null);
      try {
        const data = await getCostSubjects(
          month,
          selectedEndpointId,
          subjectType,
          page,
          pageSize,
          sortBy,
          sortDir,
          search,
        );
        if (!cancelled) {
          setSubjects(data.items);
          setSubjectsTotal(data.total);
        }
      } catch (err) {
        if (cancelled) return;
        setSubjects([]);
        setSubjectsTotal(0);
        setSubjectsError(extractApiError(err, subjectsErrorText));
      } finally {
        if (!cancelled) setSubjectsLoading(false);
      }
    }
    void loadSubjects();
    return () => {
      cancelled = true;
    };
  }, [
    month,
    page,
    pageSize,
    reloadToken,
    search,
    selectedEndpointId,
    sortBy,
    sortDir,
    subjectType,
    subjectsErrorText,
  ]);

  useEffect(() => {
    if (!analyticsEnabled) return;
    let cancelled = false;
    async function loadAnalytics() {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      try {
        const data = await getCostAnalytics(month, selectedEndpointId, subjectType);
        if (!cancelled) setAnalytics(data);
      } catch (err) {
        if (cancelled) return;
        setAnalytics(null);
        setAnalyticsError(extractApiError(err, analyticsErrorText));
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    }
    void loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [analyticsEnabled, analyticsErrorText, month, reloadToken, selectedEndpointId, subjectType]);

  return {
    summary,
    summaryError,
    summaryLoading,
    costDisabled,
    subjects,
    subjectsTotal,
    subjectsError,
    subjectsLoading,
    analytics,
    analyticsError,
    analyticsLoading,
  };
}
