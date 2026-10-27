/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import {
  getMultisiteBucketStatus,
  type MultisiteBucketDiagnostic,
  type MultisiteObservation,
  type MultisiteShard,
} from "../../../api/cephMultisite";
import InlineSummary from "../../../components/InlineSummary";
import DataTableShell, { dataTableDefaultActionProps, type DataTableColumn } from "../../../components/list/DataTableShell";
import { ListActionButton, ListActionLink } from "../../../components/list/ListControls";
import ListPageSection from "../../../components/list/ListPageSection";
import PageTabs from "../../../components/PageTabs";
import UiButton from "../../../components/ui/UiButton";
import UiDetails from "../../../components/ui/UiDetails";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiInput from "../../../components/ui/UiInput";
import UiSelect from "../../../components/ui/UiSelect";
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
import { initialBucketScopeForm, resolveBucketScope, type BucketScopeForm } from "./multisiteBucketScope";
import { buildMultisiteHref, formatTimestamp, getDeclaredEndpointOptions } from "./multisiteUtils";
import { useMultisiteTopology } from "./useMultisiteTopology";

type BucketTab = "shards" | "generations";
const SHARD_PAGE_SIZE = 1000;

function observationNeedsDetails(observation: MultisiteObservation<unknown>) {
  return observation.availability !== "available" || observation.stale || Boolean(observation.reason_code);
}

function ObservationDetails({
  label,
  observation,
  text,
}: {
  label: string;
  observation: MultisiteObservation<unknown>;
  text: ReturnType<typeof useCephAdminI18n>["text"];
}) {
  if (!observationNeedsDetails(observation)) return null;
  return (
    <UiDetails className="rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)]">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 ui-caption font-semibold">
        <ObservationBadge observation={observation} text={text} />
        <span>{label}</span>
      </summary>
      <div className="space-y-3 border-t border-[color:var(--ui-border-soft)] p-3">
        <ObservationNotice observation={observation} text={text} />
        <div>
          <h3 className="mb-2 ui-caption font-semibold">{text("Provenance")}</h3>
          <ProvenanceSummary observation={observation} text={text} />
        </div>
        <JsonDetails value={observation} text={text} summary={text("Observation JSON")} />
      </div>
    </UiDetails>
  );
}

export default function BucketReplicationPage() {
  const { text } = useCephAdminI18n();
  const { selectedEndpointId } = useCephAdminEndpoint();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const topology = useMultisiteTopology(selectedEndpointId, text("Unable to load multisite topology."));
  const endpointOptions = useMemo(() => getDeclaredEndpointOptions(topology.data), [topology.data]);
  const [form, setForm] = useState<BucketScopeForm>({
    sourceEndpointId: "", destinationEndpointId: "", sourceBucket: "", sourceTenant: "", destinationBucket: "", destinationTenant: "",
  });
  const [result, setResult] = useState<MultisiteBucketDiagnostic | null>(null);
  const [resultScope, setResultScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BucketTab>("shards");
  const [shardSearch, setShardSearch] = useState("");
  const [shardPage, setShardPage] = useState(1);
  const [selectedShardId, setSelectedShardId] = useState<number | null>(null);
  const initializedFor = useRef<string | null>(null);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const formScope = useMemo(() => JSON.stringify({ entry: selectedEndpointId, form }), [form, selectedEndpointId]);
  const resolvedScope = useMemo(() => resolveBucketScope(form, endpointOptions), [endpointOptions, form]);

  useEffect(() => {
    if (endpointOptions.length === 0) return;
    const key = `${selectedEndpointId ?? "none"}:${searchParams.toString()}`;
    if (initializedFor.current === key) return;
    initializedFor.current = key;
    setForm(initialBucketScopeForm(searchParams, endpointOptions, selectedEndpointId));
  }, [endpointOptions, searchParams, selectedEndpointId]);

  useEffect(() => {
    requestController.current?.abort();
    requestId.current += 1;
    setResult(null);
    setResultScope(null);
    setError(null);
    setLoading(false);
    setShardSearch("");
    setShardPage(1);
    setSelectedShardId(null);
  }, [formScope]);

  useEffect(() => () => requestController.current?.abort(), []);

  const fetchDiagnostic = useCallback(() => {
    if (selectedEndpointId == null || !resolvedScope) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const id = ++requestId.current;
    const scopeAtRequest = formScope;
    setLoading(true);
    setError(null);
    void getMultisiteBucketStatus(selectedEndpointId, resolvedScope, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        setResult(next);
        setResultScope(scopeAtRequest);
        const params = new URLSearchParams(searchParams);
        params.set("destination_endpoint_id", String(resolvedScope.destination_endpoint_id));
        params.set("source_endpoint_id", String(resolvedScope.source_endpoint_id));
        params.set("bucket", resolvedScope.bucket);
        params.set("source_bucket", resolvedScope.source_bucket);
        if (resolvedScope.tenant) params.set("tenant", resolvedScope.tenant); else params.delete("tenant");
        if (resolvedScope.source_tenant) params.set("source_tenant", resolvedScope.source_tenant); else params.delete("source_tenant");
        if (selectedShardId == null) params.delete("shard");
        if (params.toString() !== searchParams.toString()) setSearchParams(params, { replace: true });
      })
      .catch((failure) => {
        if (controller.signal.aborted || requestId.current !== id || isCancelledError(failure)) return;
        setError(extractApiError(failure, text("Unable to read bucket replication diagnostic.")));
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId.current === id) setLoading(false);
      });
  }, [formScope, resolvedScope, searchParams, selectedEndpointId, selectedShardId, setSearchParams, text]);

  const readDiagnostic = useCallback(() => {
    fetchDiagnostic();
  }, [fetchDiagnostic]);
  const visibleResult = resultScope === formScope ? result : null;
  const sameEndpoint = Boolean(
    form.sourceEndpointId
      && form.destinationEndpointId
      && form.sourceEndpointId === form.destinationEndpointId,
  );
  const loadedShards = useMemo(() => visibleResult?.status.data?.shards ?? [], [visibleResult]);
  const filteredShards = useMemo(() => {
    const query = shardSearch.trim().toLocaleLowerCase();
    if (!query) return loadedShards;
    return loadedShards.filter((shard) => [
      shard.shard_id,
      shard.phase,
      shard.raw_status,
      shard.marker,
      shard.timestamp,
      JSON.stringify(shard.details),
    ].some((value) => value != null && String(value).toLocaleLowerCase().includes(query)));
  }, [loadedShards, shardSearch]);
  const shardPageCount = Math.max(1, Math.ceil(filteredShards.length / SHARD_PAGE_SIZE));
  const safeShardPage = Math.min(shardPage, shardPageCount);
  const pagedShards = filteredShards.slice((safeShardPage - 1) * SHARD_PAGE_SIZE, safeShardPage * SHARD_PAGE_SIZE);
  const selectedShard = selectedShardId == null ? null : loadedShards.find((shard) => shard.shard_id === selectedShardId) ?? null;
  const phaseCounts = useMemo(() => {
    const counts = new Map<string, number>();
    loadedShards.forEach((shard) => counts.set(shard.phase || text("Unknown"), (counts.get(shard.phase || text("Unknown")) ?? 0) + 1));
    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([phase, count]) => `${phase}: ${count}`)
      .join(" · ") || "—";
  }, [loadedShards, text]);

  useEffect(() => {
    if (!visibleResult) return;
    const value = searchParams.get("shard");
    if (!value) return;
    const shardId = Number(value);
    if (Number.isInteger(shardId) && loadedShards.some((shard) => shard.shard_id === shardId)) {
      setSelectedShardId(shardId);
    }
  }, [loadedShards, searchParams, visibleResult]);

  const setShardInUrl = useCallback((shardId: number | null) => {
    const params = new URLSearchParams(searchParams);
    if (shardId == null) params.delete("shard"); else params.set("shard", String(shardId));
    if (params.toString() !== searchParams.toString()) setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const openShardDetails = useCallback((shard: MultisiteShard) => {
    setSelectedShardId(shard.shard_id);
    setShardInUrl(shard.shard_id);
  }, [setShardInUrl]);

  const closeShardDetails = useCallback(() => {
    setSelectedShardId(null);
    setShardInUrl(null);
  }, [setShardInUrl]);

  const updateForm = <K extends keyof BucketScopeForm>(key: K, value: BucketScopeForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const endpointLabel = (endpoint: (typeof endpointOptions)[number]) => text("{zone} — {endpoint} (#{id})", {
    zone: endpoint.zoneName,
    endpoint: endpoint.endpointName,
    id: endpoint.endpointId,
  });

  const shardColumns: Array<DataTableColumn<MultisiteShard>> = [
    {
      id: "shard",
      label: text("Shard"),
      primary: true,
      render: (row) => (
        <ListActionButton
          {...dataTableDefaultActionProps}
          data-multisite-shard-open={row.shard_id}
          variant="ghost"
          className="font-mono"
          aria-current={selectedShardId === row.shard_id ? "true" : undefined}
          onClick={() => openShardDetails(row)}
        >
          {row.shard_id}
        </ListActionButton>
      ),
    },
    { id: "phase", label: text("Phase"), render: (row) => <PhaseBadge phase={row.phase} text={text} /> },
    { id: "marker", label: text("Destination marker"), cellClassName: "max-w-[24rem] truncate font-mono", render: (row) => <span title={row.marker ?? undefined}>{row.marker ?? "—"}</span> },
    { id: "timestamp", label: text("Ceph timestamp"), render: (row) => formatTimestamp(row.timestamp) },
  ];

  const generationRows = visibleResult?.bilog.data?.generations ?? [];
  const generationColumns: Array<DataTableColumn<(typeof generationRows)[number]>> = [
    { id: "generation", label: text("Generation"), primary: true, render: (row) => <span className="font-mono">{row.gen}</span> },
    { id: "shards", label: text("Shards"), render: (row) => row.num_shards },
    { id: "followed", label: text("Followed"), render: (row) => row.gen === visibleResult?.status.data?.generation ? text("Yes") : text("No") },
    { id: "latest", label: text("Newest source generation"), render: (row) => row.gen === visibleResult?.bilog.data?.latest_gen ? text("Yes") : text("No") },
  ];

  const logHref = visibleResult && resolvedScope
    ? buildMultisiteHref("/ceph-admin/multisite/logs", new URLSearchParams(location.search), {
      family: "bucket-index",
      target_endpoint_id: resolvedScope.source_endpoint_id,
      bucket: visibleResult.source.data?.name ?? resolvedScope.source_bucket,
      tenant: visibleResult.source.data?.tenant ?? resolvedScope.source_tenant,
      instance_id: visibleResult.source.data?.instance_id,
      generation: visibleResult.status.data?.generation ?? visibleResult.bilog.data?.latest_gen,
    })
    : null;

  const resultContent = !visibleResult ? null : (
    <div className="space-y-4">
      <ObservationNotice observation={visibleResult.status} text={text} />
      <InlineSummary
        label={text("Resolved bucket pair")}
        items={[
          { label: text("Source"), value: visibleResult.source.data ? text("{tenant}{bucket}", { tenant: visibleResult.source.data.tenant ? `${visibleResult.source.data.tenant}/` : "", bucket: visibleResult.source.data.name }) : text("Not observed") },
          { label: text("Source instance"), value: visibleResult.source.data?.instance_id ?? "—" },
          { label: text("Destination"), value: visibleResult.destination.data ? text("{tenant}{bucket}", { tenant: visibleResult.destination.data.tenant ? `${visibleResult.destination.data.tenant}/` : "", bucket: visibleResult.destination.data.name }) : text("Not observed") },
          { label: text("Destination instance"), value: visibleResult.destination.data?.instance_id ?? "—" },
          { label: text("Phase"), value: visibleResult.status.data?.phase ?? text("Unknown") },
          { label: text("Phase counts"), value: phaseCounts },
          { label: text("Received shard states"), value: visibleResult.status.data ? `${visibleResult.status.data.shards.length} / ${visibleResult.status.data.expected_shards ?? "—"}` : "—" },
          { label: text("Followed generation"), value: visibleResult.status.data?.generation ?? "—" },
          { label: text("Newest source generation"), value: visibleResult.bilog.data?.latest_gen ?? "—" },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-2">
            <span className="ui-caption text-[var(--ui-text-muted)]">{text("Source identity")}</span>
            <ObservationBadge observation={visibleResult.source} text={text} />
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="ui-caption text-[var(--ui-text-muted)]">{text("Destination identity")}</span>
            <ObservationBadge observation={visibleResult.destination} text={text} />
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="ui-caption text-[var(--ui-text-muted)]">{text("Source generations")}</span>
            <ObservationBadge observation={visibleResult.bilog} text={text} />
          </span>
        </div>
        {logHref ? <ListActionLink to={logHref}>{text("Open source log")}</ListActionLink> : null}
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        <ObservationDetails label={text("Source identity")} observation={visibleResult.source} text={text} />
        <ObservationDetails label={text("Destination identity")} observation={visibleResult.destination} text={text} />
        <ObservationDetails label={text("Replication status")} observation={visibleResult.status} text={text} />
        <ObservationDetails label={text("Source generations")} observation={visibleResult.bilog} text={text} />
      </div>
      <PageTabs
        tabs={[
          { id: "shards", label: text("Shards") },
          { id: "generations", label: text("Source generations") },
        ]}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as BucketTab)}
        variant="line"
        ariaLabel={text("Bucket diagnostic views")}
        idPrefix="multisite-bucket"
      />
      {activeTab === "shards" ? (
        <ListPageSection
          variant="section"
          title={text("Destination shard states")}
          search={(
            <UiInput
              aria-label={text("Search loaded shard states")}
              type="search"
              size="compact"
              value={shardSearch}
              onChange={(event) => {
                setShardSearch(event.target.value);
                setShardPage(1);
              }}
              placeholder={text("Search loaded shard states")}
            />
          )}
          countLabel={text("{count} shards", { count: visibleResult.status.data?.shards.length ?? 0 })}
        >
          <DataTableShell
            columns={shardColumns}
            rows={pagedShards}
            rowKey={(row) => row.shard_id}
            rowClassName="ui-current-item"
            rowAttributes={(row) => ({ "data-viewed": selectedShardId === row.shard_id || undefined })}
            status={loadedShards.length === 0 ? "empty" : filteredShards.length === 0 ? "empty" : "ready"}
            loadingMessage={text("Loading shard states…")}
            errorMessage={text("Unable to display shard states.")}
            emptyMessage={loadedShards.length === 0 ? text("No shard state was returned.") : text("No loaded shard state matches the local search.")}
            pagination={{ page: safeShardPage, pageSize: SHARD_PAGE_SIZE, total: filteredShards.length, onPageChange: setShardPage }}
            responsiveCards
          />
        </ListPageSection>
      ) : activeTab === "generations" ? (
        <ListPageSection variant="section" title={text("Source generations")} description={text("Generation identifiers are kept as opaque source values.")} countLabel={text("{count} generations", { count: generationRows.length })}>
          <DataTableShell columns={generationColumns} rows={generationRows} rowKey={(row) => row.gen} status={generationRows.length ? "ready" : "empty"} loadingMessage={text("Loading source generations…")} errorMessage={text("Unable to display source generations.")} emptyMessage={text("No source generation was returned.")} responsiveCards />
        </ListPageSection>
      ) : null}
      {selectedShard && visibleResult ? (
        <MultisiteDetailDrawer
          title={text("Shard {id} details", { id: selectedShard.shard_id })}
          subtitle={text("Destination shard state")}
          onClose={closeShardDetails}
          text={text}
          returnFocus={() => document.querySelector<HTMLElement>(`[data-multisite-shard-open="${selectedShard.shard_id}"]`)}
        >
          <InlineSummary
            label={text("Shard state")}
            items={[
              { label: text("Shard"), value: selectedShard.shard_id },
              { label: text("Phase"), value: selectedShard.phase || text("Unknown") },
              { label: text("Raw status"), value: selectedShard.raw_status ?? "—" },
              { label: text("Ceph timestamp"), value: formatTimestamp(selectedShard.timestamp) },
            ]}
          />
          <div>
            <h3 className="mb-2 ui-caption font-semibold">{text("Full marker")}</h3>
            <pre className="max-h-48 overflow-auto rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)] p-3 ui-caption whitespace-pre-wrap [overflow-wrap:anywhere]">
              {selectedShard.marker ?? "—"}
            </pre>
          </div>
          <div>
            <h3 className="mb-2 ui-caption font-semibold">{text("Provenance")}</h3>
            <ProvenanceSummary observation={visibleResult.status} text={text} />
          </div>
          <JsonDetails value={selectedShard} text={text} summary={text("Shard JSON")} />
        </MultisiteDetailDrawer>
      ) : null}
    </div>
  );

  return (
    <MultisitePage
      activeTab="bucket"
      actions={[
        {
          label: text("Refresh"),
          variant: "secondary",
          disabled: loading || visibleResult == null,
          onClick: fetchDiagnostic,
        },
      ]}
    >
      <div className="space-y-4">
        <section className="rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="min-w-0 space-y-3">
              <legend className="mb-2 ui-caption font-semibold text-[var(--ui-text-muted)]">{text("Source")}</legend>
              <UiSelect label={text("Source zone and endpoint")} value={form.sourceEndpointId} onChange={(event) => updateForm("sourceEndpointId", event.target.value)} disabled={topology.loading}>
                <option value="">{text("Select source")}</option>
                {endpointOptions.map((endpoint) => <option key={endpoint.endpointId} value={endpoint.endpointId}>{endpointLabel(endpoint)}</option>)}
              </UiSelect>
              <UiInput label={text("Source bucket")} value={form.sourceBucket} onChange={(event) => updateForm("sourceBucket", event.target.value)} />
              <UiInput label={text("Source tenant")} value={form.sourceTenant} onChange={(event) => updateForm("sourceTenant", event.target.value)} />
            </fieldset>
            <fieldset className="min-w-0 space-y-3">
              <legend className="mb-2 ui-caption font-semibold text-[var(--ui-text-muted)]">{text("Destination")}</legend>
              <UiSelect label={text("Destination zone and endpoint")} value={form.destinationEndpointId} onChange={(event) => updateForm("destinationEndpointId", event.target.value)} disabled={topology.loading}>
                <option value="">{text("Select destination")}</option>
                {endpointOptions.map((endpoint) => <option key={endpoint.endpointId} value={endpoint.endpointId}>{endpointLabel(endpoint)}</option>)}
              </UiSelect>
              <UiInput label={text("Destination bucket")} value={form.destinationBucket} onChange={(event) => updateForm("destinationBucket", event.target.value)} />
              <UiInput label={text("Destination tenant")} value={form.destinationTenant} onChange={(event) => updateForm("destinationTenant", event.target.value)} />
            </fieldset>
          </div>
          <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-[color:var(--ui-border-soft)] pt-3">
            <UiButton size="sm" onClick={readDiagnostic} loading={loading} disabled={!resolvedScope}>{text("Read diagnostic")}</UiButton>
            {sameEndpoint ? <UiInlineMessage tone="warning">{text("Source and destination endpoints must be different.")}</UiInlineMessage> : null}
          </div>
        </section>
        {topology.error ? <UiInlineMessage tone="error">{topology.error}</UiInlineMessage> : null}
        {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
        {resultContent}
      </div>
    </MultisitePage>
  );
}
