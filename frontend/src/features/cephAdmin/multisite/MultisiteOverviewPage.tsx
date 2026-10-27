/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getMultisiteFlow,
  getMultisiteOverview,
  type MultisiteFlow,
  type MultisiteOverview,
  type MultisiteZone,
} from "../../../api/cephMultisite";
import ErrorState from "../../../components/errors/ErrorState";
import InlineSummary from "../../../components/InlineSummary";
import DataTableShell, { type DataTableColumn } from "../../../components/list/DataTableShell";
import { ListActionButton, ListActions } from "../../../components/list/ListControls";
import ListPageSection from "../../../components/list/ListPageSection";
import PageEmptyState from "../../../components/PageEmptyState";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { uiMutedTextClass } from "../../../components/ui/styles";
import { extractApiError, isCancelledError } from "../../../utils/apiError";
import { useCephAdminEndpoint } from "../CephAdminEndpointContext";
import { useCephAdminI18n } from "../cephAdminI18n";
import {
  JsonDetails,
  MultisiteDetailDrawer,
  ObservationBadge,
  ObservationNotice,
  PhaseBadge,
  ProvenanceSummary,
} from "./MultisiteCommon";
import MultisitePage from "./MultisitePage";
import { formatTimestamp } from "./multisiteUtils";

type FlowFamily = "metadata" | "data";
type FlowSelection = {
  endpointId: number;
  offset: number;
  family: FlowFamily;
  destinationEndpointId: number;
  sourceZoneId: string;
};
type OverviewSnapshot = { endpointId: number; offset: number; data: MultisiteOverview };

function zoneLabel(zones: MultisiteZone[], id: string | null | undefined) {
  if (!id) return "—";
  const zone = zones.find((candidate) => candidate.id === id);
  return zone ? `${zone.name} (${zone.id})` : id;
}

function hasNoDataSyncState(family: FlowFamily, flow: MultisiteFlow) {
  return family === "data" && flow.status.availability === "not_found" && !flow.status.data;
}

function FlowDrawer({
  endpointId,
  family,
  flow,
  zones,
  onFlowRefresh,
  onClose,
  returnFocus,
}: {
  endpointId: number;
  family: FlowFamily;
  flow: MultisiteFlow;
  zones: MultisiteZone[];
  onFlowRefresh: (flow: MultisiteFlow) => void;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const { text } = useCephAdminI18n();
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshRequestId = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const observation = flow.status;
  const status = observation.data;
  const shards = status?.shards ?? [];
  const chunk = shards.slice(offset, offset + 1000);

  useEffect(
    () => () => {
      refreshController.current?.abort();
      refreshRequestId.current += 1;
    },
    [],
  );

  useEffect(() => {
    setOffset(0);
    setRefreshError(null);
  }, [family, flow.destination_endpoint_id, flow.source_zone_id]);

  const refreshFlow = () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const id = ++refreshRequestId.current;
    setRefreshing(true);
    setRefreshError(null);
    void getMultisiteFlow(
      endpointId,
      flow.destination_endpoint_id,
      flow.source_zone_id,
      family,
      controller.signal,
    )
      .then((next) => {
        if (!controller.signal.aborted && refreshRequestId.current === id) onFlowRefresh(next);
      })
      .catch((failure) => {
        if (controller.signal.aborted || refreshRequestId.current !== id || isCancelledError(failure)) return;
        setRefreshError(extractApiError(failure, text("Unable to refresh replication flow.")));
      })
      .finally(() => {
        if (!controller.signal.aborted && refreshRequestId.current === id) setRefreshing(false);
      });
  };

  const shardColumns: Array<DataTableColumn<(typeof chunk)[number]>> = [
    {
      id: "shard",
      label: text("Shard"),
      primary: true,
      render: (row) => row.shard_id,
    },
    {
      id: "phase",
      label: text("Phase"),
      render: (row) => <PhaseBadge phase={row.phase} text={text} />,
    },
    {
      id: "marker",
      label: text("Marker"),
      cellClassName: "max-w-[24rem] truncate font-mono",
      render: (row) => <span title={row.marker ?? undefined}>{row.marker ?? "—"}</span>,
    },
    {
      id: "timestamp",
      label: text("Ceph timestamp"),
      render: (row) => <span title={row.timestamp ?? undefined}>{formatTimestamp(row.timestamp)}</span>,
    },
  ];

  return (
    <MultisiteDetailDrawer
      title={text("{family} replication flow", { family: family === "metadata" ? text("Metadata") : text("Data") })}
      subtitle={text("{source} → {destination}", {
        source: zoneLabel(zones, flow.source_zone_id),
        destination: zoneLabel(zones, flow.destination_zone_id),
      })}
      onClose={onClose}
      returnFocus={returnFocus}
      text={text}
      surfaceClassName="w-full lg:w-[64rem]"
    >
      <div className="flex justify-end">
        <ListActionButton loading={refreshing} onClick={refreshFlow}>
          {refreshing ? text("Refreshing flow…") : text("Refresh flow")}
        </ListActionButton>
      </div>
      {refreshError ? <UiInlineMessage tone="error">{refreshError}</UiInlineMessage> : null}
      <ObservationNotice observation={observation} text={text} />
      <InlineSummary
        items={[
          { label: text("Phase"), value: status?.phase ?? text("Unknown") },
          { label: text("Family"), value: status?.family ?? family },
          { label: text("Expected shards"), value: status?.expected_shards ?? "—" },
          { label: text("Received shard states"), value: shards.length },
          { label: text("Period"), value: status?.period ?? "—" },
          { label: text("Generation"), value: status?.generation ?? "—" },
        ]}
      />
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="ui-body font-semibold">{text("Shard states")}</h3>
          <span className="ui-caption text-[var(--ui-text-muted)]">
            {text("Showing {start}–{end} of {total}", {
              start: shards.length === 0 ? 0 : offset + 1,
              end: Math.min(offset + 1000, shards.length),
              total: shards.length,
            })}
          </span>
        </div>
        <DataTableShell
          columns={shardColumns}
          rows={chunk}
          rowKey={(row) => row.shard_id}
          status={chunk.length ? "ready" : "empty"}
          loadingMessage={text("Loading shard states…")}
          errorMessage={text("Unable to display shard states.")}
          emptyMessage={text("No shard state was returned for this flow.")}
          responsiveCards
          stickyActions={false}
        />
        {shards.length > 1000 ? (
          <div className="flex justify-end gap-2">
            <ListActionButton disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 1000))}>
              {text("Previous shards")}
            </ListActionButton>
            <ListActionButton
              disabled={offset + 1000 >= shards.length}
              onClick={() => setOffset((value) => value + 1000)}
            >
              {text("Next shards")}
            </ListActionButton>
          </div>
        ) : null}
      </section>
      <section className="space-y-2">
        <h3 className="ui-body font-semibold">{text("Provenance")}</h3>
        <ProvenanceSummary observation={observation} text={text} />
      </section>
      <JsonDetails value={status?.details ?? null} text={text} summary={text("Ceph status JSON")} />
    </MultisiteDetailDrawer>
  );
}

export default function MultisiteOverviewPage() {
  const { text } = useCephAdminI18n();
  const {
    endpoints,
    selectedEndpointId,
    loading: endpointLoading,
    error: endpointError,
    retryEndpoints,
  } = useCephAdminEndpoint();
  const [page, setPage] = useState<{ endpointId: number | null; offset: number; previousOffsets: number[] }>({
    endpointId: selectedEndpointId,
    offset: 0,
    previousOffsets: [],
  });
  const [overviewSnapshot, setOverviewSnapshot] = useState<OverviewSnapshot | null>(null);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ scope: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<FlowSelection | null>(null);
  const requestId = useRef(0);
  const triggerRef = useRef<HTMLElement | null>(null);

  const offset = page.endpointId === selectedEndpointId ? page.offset : 0;
  const previousOffsets = page.endpointId === selectedEndpointId ? page.previousOffsets : [];
  const scope = selectedEndpointId == null ? null : `${selectedEndpointId}:${offset}`;
  const overview =
    scope && overviewSnapshot && overviewSnapshot.endpointId === selectedEndpointId && overviewSnapshot.offset === offset
      ? overviewSnapshot.data
      : null;
  const loading = scope != null && pendingScope === scope;
  const error = scope != null && errorState?.scope === scope ? errorState.message : null;

  useEffect(() => {
    if (page.endpointId === selectedEndpointId) return;
    setPage({ endpointId: selectedEndpointId, offset: 0, previousOffsets: [] });
    setSelection(null);
  }, [page.endpointId, selectedEndpointId]);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    if (selectedEndpointId == null || scope == null) {
      setPendingScope(null);
      return () => controller.abort();
    }
    const endpointId = selectedEndpointId;
    const requestScope = scope;
    setPendingScope(requestScope);
    setErrorState((current) => (current?.scope === requestScope ? null : current));
    void getMultisiteOverview(endpointId, offset, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        setOverviewSnapshot({ endpointId, offset, data: next });
      })
      .catch((failure) => {
        if (controller.signal.aborted || requestId.current !== id || isCancelledError(failure)) return;
        setErrorState({ scope: requestScope, message: extractApiError(failure, text("Unable to load multisite overview.")) });
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId.current === id) setPendingScope(null);
      });
    return () => controller.abort();
  }, [offset, revision, scope, selectedEndpointId, text]);

  const refreshOverview = useCallback(() => setRevision((value) => value + 1), []);

  const zones = overview?.topology.period.data?.zones ?? [];
  const metadataReplicationFlows = overview?.metadata.filter(
    (flow) => flow.source_zone_id !== flow.destination_zone_id,
  ) ?? [];
  const dataReplicationFlows = overview?.data.filter(
    (flow) => !hasNoDataSyncState("data", flow),
  ) ?? [];
  const realmData = overview?.topology.realm?.data;
  const realmName =
    realmData && typeof realmData === "object" && "name" in realmData && typeof realmData.name === "string"
      ? realmData.name
      : overview?.topology.period.data?.realm_id ?? "—";
  const observableZoneCount = zones.filter((zone) => zone.diagnostic_endpoint_id != null).length;

  const selectedFlow = useMemo(() => {
    if (
      !selection ||
      !overview ||
      selection.endpointId !== selectedEndpointId ||
      selection.offset !== offset
    ) {
      return null;
    }
    const flows = selection.family === "metadata" ? overview.metadata : overview.data;
    return (
      flows.find(
        (flow) =>
          flow.destination_endpoint_id === selection.destinationEndpointId &&
          flow.source_zone_id === selection.sourceZoneId,
      ) ?? null
    );
  }, [offset, overview, selectedEndpointId, selection]);

  useEffect(() => {
    if (selection && overview && selection.endpointId === selectedEndpointId && selection.offset === offset && !selectedFlow) {
      setSelection(null);
    }
  }, [offset, overview, selectedEndpointId, selectedFlow, selection]);

  const applyFlowRefresh = useCallback(
    (currentSelection: FlowSelection, next: MultisiteFlow) => {
      setOverviewSnapshot((current) => {
        if (
          !current ||
          current.endpointId !== currentSelection.endpointId ||
          current.offset !== currentSelection.offset
        ) {
          return current;
        }
        const flows = current.data[currentSelection.family];
        const found = flows.some(
          (flow) =>
            flow.destination_endpoint_id === currentSelection.destinationEndpointId &&
            flow.source_zone_id === currentSelection.sourceZoneId,
        );
        if (!found) return current;
        const updated = flows.map((flow) =>
          flow.destination_endpoint_id === currentSelection.destinationEndpointId &&
          flow.source_zone_id === currentSelection.sourceZoneId
            ? next
            : flow,
        );
        return { ...current, data: { ...current.data, [currentSelection.family]: updated } };
      });
    },
    [],
  );

  const zoneColumns: Array<DataTableColumn<MultisiteZone>> = [
    {
      id: "zone",
      label: text("Zone"),
      primary: true,
      render: (zone) => (
        <div>
          <div className="font-semibold">{zone.name}</div>
          <div className="ui-caption text-[var(--ui-text-muted)]">{zone.id}</div>
        </div>
      ),
    },
    {
      id: "zonegroup",
      label: text("Zonegroup"),
      render: (zone) => (
        <div>
          <div>{zone.zonegroup_name}</div>
          <div className="ui-caption text-[var(--ui-text-muted)]">{zone.zonegroup_id}</div>
        </div>
      ),
    },
    {
      id: "role",
      label: text("Role"),
      render: (zone) => (
        <UiBadge tone={zone.metadata_master ? "primary" : "info"}>
          {zone.metadata_master ? text("Metadata master") : text("Replica")}
        </UiBadge>
      ),
    },
  ];

  const flowColumns = (family: FlowFamily): Array<DataTableColumn<MultisiteFlow>> => [
    {
      id: "source",
      label: text("Source"),
      primary: true,
      render: (flow) => zoneLabel(zones, flow.source_zone_id),
    },
    {
      id: "destination",
      label: text("Destination"),
      render: (flow) => zoneLabel(zones, flow.destination_zone_id),
    },
    {
      id: "availability",
      label: text("Availability"),
      render: (flow) => {
        const noSyncState = hasNoDataSyncState(family, flow);
        const reason = noSyncState
          ? text("Ceph returned no data sync status for this direction.")
          : flow.status.reason_code;
        return (
          <div className="flex flex-col items-start gap-1">
            {noSyncState
              ? <UiBadge tone="neutral">{text("No sync state")}</UiBadge>
              : <ObservationBadge observation={flow.status} text={text} />}
            {reason ? <span className={`ui-caption ${uiMutedTextClass}`}>{reason}</span> : null}
          </div>
        );
      },
    },
    {
      id: "phase",
      label: text("Phase"),
      render: (flow) => hasNoDataSyncState(family, flow) ? <span>—</span> : <PhaseBadge phase={flow.status.data?.phase} text={text} />,
    },
    {
      id: "shards",
      label: text("Shards"),
      render: (flow) =>
        hasNoDataSyncState(family, flow)
          ? "—"
          : text("{received} / {expected}", {
              received: flow.status.data?.shards.length ?? 0,
              expected: flow.status.data?.expected_shards ?? text("Unknown"),
            }),
    },
    {
      id: "actions",
      label: text("Actions"),
      mobileRole: "actions",
      render: (flow) => (
        <ListActions>
          <ListActionButton
            data-table-default-action="true"
            onClick={(event) => {
              if (selectedEndpointId == null) return;
              triggerRef.current = event.currentTarget;
              setSelection({
                endpointId: selectedEndpointId,
                offset,
                family,
                destinationEndpointId: flow.destination_endpoint_id,
                sourceZoneId: flow.source_zone_id,
              });
            }}
          >
            {text("View details")}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  const goPrevious = () => {
    if (selectedEndpointId == null || previousOffsets.length === 0) return;
    const nextPrevious = previousOffsets.slice(0, -1);
    const nextOffset = previousOffsets.at(-1) ?? 0;
    setSelection(null);
    setPage({ endpointId: selectedEndpointId, offset: nextOffset, previousOffsets: nextPrevious });
  };

  const goNext = () => {
    if (selectedEndpointId == null || overview?.next_offset == null) return;
    setSelection(null);
    setPage({
      endpointId: selectedEndpointId,
      offset: overview.next_offset,
      previousOffsets: [...previousOffsets, offset],
    });
  };

  let content = null;
  if (endpointLoading) {
    content = (
      <PageEmptyState
        eyebrow={text("Loading")}
        title={text("Loading Ceph endpoints")}
        description={text("The multisite overview will be available once the Ceph Admin endpoint list has loaded.")}
      />
    );
  } else if (endpointError) {
    content = (
      <ErrorState
        presentation="embedded"
        error={endpointError}
        title={text("Unable to load Ceph endpoints")}
        description={endpointError}
        onRetry={retryEndpoints}
      />
    );
  } else if (endpoints.length === 0 || selectedEndpointId == null) {
    content = (
      <PageEmptyState
        eyebrow={text("Unavailable")}
        title={text("Select a Ceph endpoint")}
        description={text("Select a Ceph Admin endpoint to inspect multisite replication.")}
        tone="warning"
      />
    );
  } else if (error) {
    content = (
      <ErrorState
        presentation="embedded"
        error={error}
        title={text("Unable to load multisite overview")}
        description={error}
        onRetry={refreshOverview}
      />
    );
  } else if (!overview) {
    content = (
      <PageEmptyState
        eyebrow={text("Loading")}
        title={text("Loading multisite overview")}
        description={text("Loading the current multisite topology and replication status.")}
      />
    );
  } else {
    content = (
      <div className="space-y-4">
        <InlineSummary
          label={text("Current topology")}
          items={[
            { label: text("Realm"), value: realmName },
            { label: text("Realm epoch"), value: overview.topology.period.data?.realm_epoch ?? "—" },
            { label: text("Zones"), value: zones.length },
            { label: text("Available diagnostic endpoints"), value: text("{declared} / {total}", { declared: observableZoneCount, total: zones.length }) },
          ]}
        />
        <ObservationNotice observation={overview.topology.period} text={text} />
        {overview.topology.configuration_reason ? (
          <UiInlineMessage tone="warning">
            {text("Multisite topology is not fully available: {reason}", {
              reason: overview.topology.configuration_reason,
            })}
          </UiInlineMessage>
        ) : null}
        {overview.uncollected.length > 0 ? (
          <UiInlineMessage tone="warning">
            {overview.uncollected.length === 1
              ? text("One flow scope was not collected in this overview page.")
              : text("{count} flow scopes were not collected in this overview page.", { count: overview.uncollected.length })}
          </UiInlineMessage>
        ) : null}
        {overview.next_offset != null ? (
          <UiInlineMessage tone="info">
            {text("Additional flow scopes are available from offset {offset}.", { offset: overview.next_offset })}
          </UiInlineMessage>
        ) : null}

        <ListPageSection
          variant="section"
          title={text("Zones")}
          description={text("Zones in the current multisite realm.")}
          countLabel={text("{count} zones", { count: zones.length })}
        >
          <DataTableShell
            columns={zoneColumns}
            rows={zones}
            rowKey={(zone) => zone.id}
            status={zones.length ? "ready" : "empty"}
            loadingMessage={text("Loading zones…")}
            errorMessage={text("Unable to display zones.")}
            emptyMessage={text("No zone was returned by the current period.")}
            responsiveCards
          />
        </ListPageSection>

        <ListPageSection
          variant="section"
          title={text("Metadata replication")}
          description={text("Metadata synchronization status from the metadata master to each replica zone.")}
          countLabel={text("{count} flows", { count: metadataReplicationFlows.length })}
        >
          <DataTableShell
            columns={flowColumns("metadata")}
            rows={metadataReplicationFlows}
            rowKey={(flow) => `metadata:${flow.destination_endpoint_id}:${flow.source_zone_id}`}
            status={metadataReplicationFlows.length ? "ready" : "empty"}
            loadingMessage={text("Loading metadata flows…")}
            errorMessage={text("Unable to display metadata flows.")}
            emptyMessage={text("No metadata flow observation was returned.")}
            responsiveCards
          />
        </ListPageSection>

        <ListPageSection
          variant="section"
          title={text("Data replication")}
          description={text("Data synchronization status between zones. Use Bucket replication to inspect a specific bucket.")}
          countLabel={text("{count} flows", { count: dataReplicationFlows.length })}
        >
          <DataTableShell
            columns={flowColumns("data")}
            rows={dataReplicationFlows}
            rowKey={(flow) => `data:${flow.destination_endpoint_id}:${flow.source_zone_id}`}
            status={dataReplicationFlows.length ? "ready" : "empty"}
            loadingMessage={text("Loading data flows…")}
            errorMessage={text("Unable to display data flows.")}
            emptyMessage={text("No data flow observation was returned.")}
            responsiveCards
          />
        </ListPageSection>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="ui-caption text-[var(--ui-text-muted)]">
            {text("Overview page offset {offset}", { offset })}
          </span>
          <div className="flex gap-2">
            <ListActionButton disabled={previousOffsets.length === 0 || loading} onClick={goPrevious}>
              {text("Previous page")}
            </ListActionButton>
            <ListActionButton disabled={overview.next_offset == null || loading} onClick={goNext}>
              {text("Next page")}
            </ListActionButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MultisitePage
      activeTab="overview"
      actions={[
        {
          label: text("Refresh"),
          variant: "secondary",
          disabled: endpointLoading || selectedEndpointId == null || loading,
          onClick: refreshOverview,
        },
      ]}
    >
      {content}
      {selection && selectedFlow && selectedEndpointId != null ? (
        <FlowDrawer
          key={`${selection.endpointId}:${selection.offset}:${selection.family}:${selection.destinationEndpointId}:${selection.sourceZoneId}`}
          endpointId={selectedEndpointId}
          family={selection.family}
          flow={selectedFlow}
          zones={zones}
          onFlowRefresh={(next) => applyFlowRefresh(selection, next)}
          onClose={() => setSelection(null)}
          returnFocus={() => (triggerRef.current?.isConnected ? triggerRef.current : null)}
        />
      ) : null}
    </MultisitePage>
  );
}
