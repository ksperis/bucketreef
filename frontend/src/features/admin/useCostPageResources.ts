/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import {
  getCostAnalytics,
  getCostSubjects,
  getCostSummary,
  type CostAnalyticsResponse,
  type CostSubjectSummary,
  type CostSummary,
} from "../../api/cost";
import { extractApiError, extractApiErrorCode } from "../../utils/apiError";
import useAdminResourceController from "./useAdminResourceController";

type CostSubjectsResource = {
  items: CostSubjectSummary[];
  total: number;
};

const emptyCostSubjects: CostSubjectsResource = { items: [], total: 0 };

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
  const loadSummary = useCallback(
    () => getCostSummary(month, selectedEndpointId),
    [month, selectedEndpointId],
  );
  const formatSummaryError = useCallback(
    (error: unknown) => extractApiError(error, summaryErrorText),
    [summaryErrorText],
  );
  const {
    resource: summary,
    error: summaryError,
    errorCause: summaryErrorCause,
    loading: summaryLoading,
  } = useAdminResourceController<CostSummary | null>({
    loadResource: loadSummary,
    initialResource: null,
    formatError: formatSummaryError,
    reloadToken,
    resetResourceOnError: true,
    initialLoading: false,
  });
  const costDisabled = extractApiErrorCode(summaryErrorCause) === "cost_disabled";

  const loadSubjects = useCallback(
    () => getCostSubjects(
      month,
      selectedEndpointId,
      subjectType,
      page,
      pageSize,
      sortBy,
      sortDir,
      search,
    ),
    [
      month,
      page,
      pageSize,
      search,
      selectedEndpointId,
      sortBy,
      sortDir,
      subjectType,
    ],
  );
  const formatSubjectsError = useCallback(
    (error: unknown) => extractApiError(error, subjectsErrorText),
    [subjectsErrorText],
  );
  const {
    resource: subjectsResource,
    error: subjectsError,
    loading: subjectsLoading,
  } = useAdminResourceController<CostSubjectsResource>({
    loadResource: loadSubjects,
    initialResource: emptyCostSubjects,
    formatError: formatSubjectsError,
    reloadToken,
    resetResourceOnError: true,
    initialLoading: false,
  });
  const { items: subjects, total: subjectsTotal } = subjectsResource;

  const loadAnalytics = useCallback(
    () => getCostAnalytics(month, selectedEndpointId, subjectType),
    [month, selectedEndpointId, subjectType],
  );
  const formatAnalyticsError = useCallback(
    (error: unknown) => extractApiError(error, analyticsErrorText),
    [analyticsErrorText],
  );
  const {
    resource: analytics,
    error: analyticsError,
    loading: analyticsLoading,
  } = useAdminResourceController<CostAnalyticsResponse | null>({
    loadResource: loadAnalytics,
    initialResource: null,
    formatError: formatAnalyticsError,
    enabled: analyticsEnabled,
    reloadToken,
    resetResourceOnError: true,
    initialLoading: false,
  });

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
