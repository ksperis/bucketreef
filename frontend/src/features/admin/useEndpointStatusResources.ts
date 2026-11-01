/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import {
  fetchHealthGlobalIncidents,
  fetchHealthLatencyOverview,
  fetchHealthOverview,
  type EndpointHealthGlobalIncident,
  type EndpointHealthLatencyOverviewEndpoint,
  type EndpointHealthOverviewEndpoint,
  type HealthWindow,
} from "../../api/healthchecks";
import { extractApiError } from "../../utils/apiError";

const GLOBAL_INCIDENT_LIMIT = 300;

export function useEndpointStatusResources({
  timelineWindow,
  incidentWindow,
  latencyErrorText,
  timelineErrorText,
  incidentsErrorText,
}: {
  timelineWindow: HealthWindow;
  incidentWindow: HealthWindow;
  latencyErrorText: string;
  timelineErrorText: string;
  incidentsErrorText: string;
}) {
  const [latencyEndpoints, setLatencyEndpoints] = useState<EndpointHealthLatencyOverviewEndpoint[]>([]);
  const [latencyUpdatedAt, setLatencyUpdatedAt] = useState<string | null>(null);
  const [latencyLoading, setLatencyLoading] = useState(true);
  const [latencyError, setLatencyError] = useState<string | null>(null);
  const [timelineEndpoints, setTimelineEndpoints] = useState<EndpointHealthOverviewEndpoint[]>([]);
  const [timelineStart, setTimelineStart] = useState<string | null>(null);
  const [timelineEnd, setTimelineEnd] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [globalIncidents, setGlobalIncidents] = useState<EndpointHealthGlobalIncident[]>([]);
  const [globalIncidentsTotal, setGlobalIncidentsTotal] = useState(0);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const loadLatencyOverview = useCallback(async () => {
    setLatencyLoading(true);
    setLatencyError(null);
    try {
      const payload = await fetchHealthLatencyOverview("day");
      setLatencyEndpoints(payload.endpoints);
      setLatencyUpdatedAt(payload.generated_at);
    } catch (err) {
      setLatencyEndpoints([]);
      setLatencyError(extractApiError(err, latencyErrorText));
    } finally {
      setLatencyLoading(false);
    }
  }, [latencyErrorText]);

  const loadTimelineOverview = useCallback(
    async (windowValue: HealthWindow) => {
      setTimelineLoading(true);
      setTimelineError(null);
      try {
        const payload = await fetchHealthOverview(windowValue);
        setTimelineEndpoints(payload.endpoints);
        setTimelineStart(payload.start);
        setTimelineEnd(payload.end);
      } catch (err) {
        setTimelineEndpoints([]);
        setTimelineStart(null);
        setTimelineEnd(null);
        setTimelineError(extractApiError(err, timelineErrorText));
      } finally {
        setTimelineLoading(false);
      }
    },
    [timelineErrorText],
  );

  const loadGlobalIncidents = useCallback(
    async (windowValue: HealthWindow) => {
      setIncidentsLoading(true);
      setIncidentsError(null);
      try {
        const payload = await fetchHealthGlobalIncidents(windowValue, GLOBAL_INCIDENT_LIMIT);
        setGlobalIncidents(payload.incidents);
        setGlobalIncidentsTotal(payload.total);
      } catch (err) {
        setGlobalIncidents([]);
        setGlobalIncidentsTotal(0);
        setIncidentsError(extractApiError(err, incidentsErrorText));
      } finally {
        setIncidentsLoading(false);
      }
    },
    [incidentsErrorText],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      loadLatencyOverview(),
      loadTimelineOverview(timelineWindow),
      loadGlobalIncidents(incidentWindow),
    ]);
  }, [incidentWindow, loadGlobalIncidents, loadLatencyOverview, loadTimelineOverview, timelineWindow]);

  useEffect(() => {
    void loadLatencyOverview();
  }, [loadLatencyOverview]);

  useEffect(() => {
    void loadTimelineOverview(timelineWindow);
  }, [loadTimelineOverview, timelineWindow]);

  useEffect(() => {
    void loadGlobalIncidents(incidentWindow);
  }, [incidentWindow, loadGlobalIncidents]);

  return {
    latencyEndpoints,
    latencyUpdatedAt,
    latencyLoading,
    latencyError,
    timelineEndpoints,
    timelineStart,
    timelineEnd,
    timelineLoading,
    timelineError,
    globalIncidents,
    globalIncidentsTotal,
    incidentsLoading,
    incidentsError,
    refresh,
  };
}
