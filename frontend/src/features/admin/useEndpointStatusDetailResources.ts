/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import {
  fetchHealthIncidents,
  fetchHealthRawChecks,
  fetchHealthSeries,
  fetchHealthSummary,
  type EndpointHealthIncident,
  type EndpointHealthRawCheck,
  type EndpointHealthSeries,
  type EndpointHealthSummary,
  type HealthWindow,
} from "../../api/healthchecks";
import { extractApiError } from "../../utils/apiError";

export function useEndpointStatusDetailResources({
  endpointId,
  hasValidEndpointId,
  windowValue,
  rawChecksPage,
  rawChecksPageSize,
  summaryErrorText,
  seriesErrorText,
  incidentsErrorText,
  rawChecksErrorText,
}: {
  endpointId: number;
  hasValidEndpointId: boolean;
  windowValue: HealthWindow;
  rawChecksPage: number;
  rawChecksPageSize: number;
  summaryErrorText: string;
  seriesErrorText: string;
  incidentsErrorText: string;
  rawChecksErrorText: string;
}) {
  const [summary, setSummary] = useState<EndpointHealthSummary[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [series, setSeries] = useState<EndpointHealthSeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<EndpointHealthIncident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [rawChecks, setRawChecks] = useState<EndpointHealthRawCheck[]>([]);
  const [rawChecksTotal, setRawChecksTotal] = useState(0);
  const [rawChecksLoading, setRawChecksLoading] = useState(false);
  const [rawChecksError, setRawChecksError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const payload = await fetchHealthSummary();
      setSummary(payload.endpoints);
    } catch (err) {
      setSummary([]);
      setSummaryError(extractApiError(err, summaryErrorText));
    } finally {
      setSummaryLoading(false);
    }
  }, [summaryErrorText]);

  const loadDetails = useCallback(
    async (selectedEndpointId: number, window: HealthWindow) => {
      setSeriesLoading(true);
      setSeriesError(null);
      setIncidentsLoading(true);
      setIncidentsError(null);
      try {
        const [seriesData, incidentsData] = await Promise.all([
          fetchHealthSeries(selectedEndpointId, window),
          fetchHealthIncidents(selectedEndpointId, window),
        ]);
        setSeries(seriesData);
        setIncidents(incidentsData.incidents);
      } catch (err) {
        setSeries(null);
        setIncidents([]);
        setSeriesError(extractApiError(err, seriesErrorText));
        setIncidentsError(extractApiError(err, incidentsErrorText));
      } finally {
        setSeriesLoading(false);
        setIncidentsLoading(false);
      }
    },
    [incidentsErrorText, seriesErrorText],
  );

  const loadRawChecks = useCallback(
    async (selectedEndpointId: number, window: HealthWindow, page: number) => {
      setRawChecksLoading(true);
      setRawChecksError(null);
      try {
        const payload = await fetchHealthRawChecks(selectedEndpointId, window, page, rawChecksPageSize);
        setRawChecks(payload.checks);
        setRawChecksTotal(payload.total);
      } catch (err) {
        setRawChecks([]);
        setRawChecksTotal(0);
        setRawChecksError(extractApiError(err, rawChecksErrorText));
      } finally {
        setRawChecksLoading(false);
      }
    },
    [rawChecksErrorText, rawChecksPageSize],
  );

  const refresh = useCallback(async () => {
    if (!hasValidEndpointId) return;
    await Promise.all([
      loadSummary(),
      loadDetails(endpointId, windowValue),
      loadRawChecks(endpointId, windowValue, rawChecksPage),
    ]);
  }, [endpointId, hasValidEndpointId, loadDetails, loadRawChecks, loadSummary, rawChecksPage, windowValue]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!hasValidEndpointId) {
      setSeries(null);
      setIncidents([]);
      setRawChecks([]);
      setRawChecksTotal(0);
      return;
    }
    void loadDetails(endpointId, windowValue);
  }, [endpointId, hasValidEndpointId, loadDetails, windowValue]);

  useEffect(() => {
    if (!hasValidEndpointId) return;
    void loadRawChecks(endpointId, windowValue, rawChecksPage);
  }, [endpointId, hasValidEndpointId, loadRawChecks, rawChecksPage, windowValue]);

  return {
    summary,
    summaryLoading,
    summaryError,
    series,
    seriesLoading,
    seriesError,
    incidents,
    incidentsLoading,
    incidentsError,
    rawChecks,
    rawChecksTotal,
    rawChecksLoading,
    rawChecksError,
    refresh,
  };
}
