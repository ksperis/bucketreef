/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getMultisiteLogs, type MultisiteFamily, type MultisiteLogPage, type MultisiteLogScope, type MultisiteObservation } from "../../../api/cephMultisite";
import InlineSummary from "../../../components/InlineSummary";
import DataTableShell, { type DataTableColumn } from "../../../components/list/DataTableShell";
import { ListActionButton, ListActions } from "../../../components/list/ListControls";
import ListPageSection from "../../../components/list/ListPageSection";
import UiButton from "../../../components/ui/UiButton";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiInput from "../../../components/ui/UiInput";
import UiSelect from "../../../components/ui/UiSelect";
import { extractApiError, isCancelledError } from "../../../utils/apiError";
import { useCephAdminEndpoint } from "../CephAdminEndpointContext";
import { useCephAdminI18n } from "../cephAdminI18n";
import { JsonDetails, MultisiteDetailDrawer, ObservationNotice, ProvenanceSummary } from "./MultisiteCommon";
import MultisitePage from "./MultisitePage";
import { advanceLogCursor, canAdvanceToNextLog, retreatLogCursor, type LogCursorHistory } from "./multisiteLogState";
import { displayRecordValue, downloadTextFile, formatTimestamp, getDeclaredEndpointOptions, lookupRecordValue, matchesLoadedEntry, parseNonNegativeInteger, parsePositiveInteger, recordsToCsv, safeJson } from "./multisiteUtils";
import { useMultisiteTopology } from "./useMultisiteTopology";

type LogForm = {
  family: MultisiteFamily;
  targetEndpointId: string;
  shard: string;
  period: string;
  bucket: string;
  tenant: string;
  instanceId: string;
  generation: string;
  limit: string;
};

function initialLogForm(search: URLSearchParams): LogForm {
  const family = search.get("family");
  return {
    family: family === "metadata" || family === "data" || family === "bucket-index" ? family : "metadata",
    targetEndpointId: search.get("target_endpoint_id") ?? "",
    shard: search.get("shard") ?? "",
    period: search.get("period") ?? "",
    bucket: search.get("bucket") ?? "",
    tenant: search.get("tenant") ?? "",
    instanceId: search.get("instance_id") ?? "",
    generation: search.get("generation") ?? "",
    limit: search.get("limit") ?? "100",
  };
}

function buildScope(form: LogForm): MultisiteLogScope | null {
  const targetEndpointId = Number(form.targetEndpointId);
  const limit = parsePositiveInteger(form.limit);
  if (!Number.isInteger(targetEndpointId) || targetEndpointId <= 0 || !limit || limit > 500) return null;
  const scope: MultisiteLogScope = { target_endpoint_id: targetEndpointId, limit };
  const shard = parseNonNegativeInteger(form.shard);
  if (form.family === "metadata") {
    if (shard == null || !form.period.trim()) return null;
    scope.shard = shard;
    scope.period = form.period.trim();
  } else if (form.family === "data") {
    if (shard == null) return null;
    scope.shard = shard;
  } else {
    if (!form.bucket.trim() || !form.instanceId.trim() || !form.generation.trim()) return null;
    scope.bucket = form.bucket.trim();
    scope.instance_id = form.instanceId.trim();
    scope.generation = form.generation.trim();
    if (form.tenant.trim()) scope.tenant = form.tenant.trim();
    if (form.shard.trim()) {
      if (shard == null) return null;
      scope.shard = shard;
    }
  }
  return scope;
}

export default function MultisiteLogExplorerPage() {
  const { text } = useCephAdminI18n();
  const { selectedEndpointId } = useCephAdminEndpoint();
  const [searchParams, setSearchParams] = useSearchParams();
  const topology = useMultisiteTopology(selectedEndpointId, text("Unable to load multisite topology."));
  const endpointOptions = useMemo(() => getDeclaredEndpointOptions(topology.data), [topology.data]);
  const [form, setForm] = useState<LogForm>(() => initialLogForm(searchParams));
  const [observation, setObservation] = useState<MultisiteObservation<MultisiteLogPage> | null>(null);
  const [resultScope, setResultScope] = useState<string | null>(null);
  const [history, setHistory] = useState<LogCursorHistory>({ current: null, previous: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<Record<string, unknown> | null>(null);
  const [generationRead, setGenerationRead] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const urlScope = useRef<string | null>(null);

  useEffect(() => {
    const scope = `${selectedEndpointId}:${searchParams.toString()}`;
    if (urlScope.current === scope) return;
    urlScope.current = scope;
    setForm(initialLogForm(searchParams));
  }, [searchParams, selectedEndpointId]);

  useEffect(() => {
    if (form.targetEndpointId || endpointOptions.length === 0) return;
    const selected = endpointOptions.find((endpoint) => endpoint.endpointId === selectedEndpointId) ?? endpointOptions[0];
    setForm((current) => ({ ...current, targetEndpointId: String(selected.endpointId) }));
  }, [endpointOptions, form.targetEndpointId, selectedEndpointId]);

  const resolvedScope = useMemo(() => buildScope(form), [form]);
  const formIdentity = useMemo(() => JSON.stringify({ entry: selectedEndpointId, form }), [form, selectedEndpointId]);
  const visibleObservation = resultScope === formIdentity ? observation : null;
  const page = visibleObservation?.data ?? null;
  const filteredEntries = useMemo(() => (page?.entries ?? []).filter((entry) => matchesLoadedEntry(entry, search)), [page, search]);

  useEffect(() => {
    requestController.current?.abort();
    requestId.current += 1;
    setObservation(null);
    setResultScope(null);
    setHistory({ current: null, previous: [] });
    setError(null);
    setLoading(false);
    setSelectedEntry(null);
  }, [formIdentity]);
  useEffect(() => () => requestController.current?.abort(), []);

  const updateForm = <K extends keyof LogForm>(key: K, value: LogForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const endpointLabel = (endpoint: (typeof endpointOptions)[number]) => text("{zone} — {endpoint} (#{id})", { zone: endpoint.zoneName, endpoint: endpoint.endpointName, id: endpoint.endpointId });

  const load = useCallback((scope: MultisiteLogScope, cursorHistory: LogCursorHistory, identity: string, formForUrl: LogForm) => {
    if (selectedEndpointId == null) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const id = ++requestId.current;
    const requestScope = cursorHistory.current ? { ...scope, cursor: cursorHistory.current } : scope;
    setLoading(true);
    setError(null);
    setSelectedEntry(null);
    void getMultisiteLogs(selectedEndpointId, formForUrl.family, requestScope, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        setObservation(next);
        setResultScope(identity);
        setHistory(cursorHistory);
        const params = new URLSearchParams(searchParams);
        params.set("family", formForUrl.family);
        params.set("target_endpoint_id", formForUrl.targetEndpointId);
        for (const [key, value] of [["shard", formForUrl.shard], ["period", formForUrl.period], ["bucket", formForUrl.bucket], ["tenant", formForUrl.tenant], ["instance_id", formForUrl.instanceId], ["generation", formForUrl.generation], ["limit", formForUrl.limit]] as const) {
          if (value) params.set(key, value); else params.delete(key);
        }
        if (params.toString() !== searchParams.toString()) setSearchParams(params, { replace: true });
      })
      .catch((failure) => {
        if (controller.signal.aborted || requestId.current !== id || isCancelledError(failure)) return;
        setError(extractApiError(failure, text("Unable to read multisite log entries.")));
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId.current === id) setLoading(false);
      });
  }, [searchParams, selectedEndpointId, setSearchParams, text]);

  const readLogs = () => {
    if (!resolvedScope) return;
    load(resolvedScope, { current: null, previous: [] }, formIdentity, form);
  };
  const refreshLogs = () => {
    if (!resolvedScope || !visibleObservation) return;
    load(resolvedScope, history, formIdentity, form);
  };
  const nextPage = () => {
    if (!resolvedScope || !page?.truncated || !page.next_cursor) return;
    load(resolvedScope, advanceLogCursor(history, page.next_cursor), formIdentity, form);
  };
  const previousPage = () => {
    if (!resolvedScope) return;
    const previous = retreatLogCursor(history);
    if (!previous) return;
    load(resolvedScope, previous, formIdentity, form);
  };
  const nextLog = () => {
    if (!page || !canAdvanceToNextLog(page) || !page.next_log) return;
    const nextForm = { ...form, generation: page.next_log.generation };
    const nextScope = buildScope(nextForm);
    if (!nextScope) return;
    const nextIdentity = JSON.stringify({ entry: selectedEndpointId, form: nextForm });
    setForm(nextForm);
    // Let the old-scope cleanup abort the previous request before starting the
    // new generation. Starting it here would be aborted by that same cleanup.
    setGenerationRead(nextIdentity);
  };

  useEffect(() => {
    if (!generationRead || generationRead !== formIdentity || !resolvedScope) return;
    setGenerationRead(null);
    load(resolvedScope, { current: null, previous: [] }, formIdentity, form);
    // A generation hand-off is an explicit one-shot read. Other form changes
    // only invalidate the result and must never start a request automatically.
  }, [generationRead, formIdentity, resolvedScope, form, load]);

  const columns: Array<DataTableColumn<Record<string, unknown>>> = form.family === "metadata"
    ? [
      { id: "id", label: text("ID"), primary: true, render: (row) => displayRecordValue(lookupRecordValue(row, ["id", "key"])) },
      { id: "section", label: text("Section"), render: (row) => displayRecordValue(lookupRecordValue(row, ["section"])) },
      { id: "name", label: text("Name"), render: (row) => displayRecordValue(lookupRecordValue(row, ["name", "entry.name"])) },
      { id: "timestamp", label: text("Timestamp"), render: (row) => displayRecordValue(lookupRecordValue(row, ["timestamp"])) },
    ]
    : form.family === "data"
      ? [
        { id: "log", label: text("Log ID"), primary: true, render: (row) => displayRecordValue(lookupRecordValue(row, ["log_id", "id"])) },
        { id: "key", label: text("Key"), render: (row) => displayRecordValue(lookupRecordValue(row, ["key", "entry.key"])) },
        { id: "generation", label: text("Generation"), render: (row) => displayRecordValue(lookupRecordValue(row, ["gen", "entry.gen"])) },
        { id: "timestamp", label: text("Log timestamp"), render: (row) => displayRecordValue(lookupRecordValue(row, ["log_timestamp", "timestamp"])) },
      ]
      : [
        { id: "operation", label: text("Operation ID"), primary: true, render: (row) => displayRecordValue(lookupRecordValue(row, ["op_id", "id"])) },
        { id: "object", label: text("Object"), render: (row) => displayRecordValue(lookupRecordValue(row, ["object", "key"])) },
        { id: "op", label: text("Operation"), render: (row) => displayRecordValue(lookupRecordValue(row, ["op"])) },
        { id: "state", label: text("Source operation state"), render: (row) => displayRecordValue(lookupRecordValue(row, ["state"])) },
        { id: "timestamp", label: text("Timestamp"), render: (row) => displayRecordValue(lookupRecordValue(row, ["timestamp"])) },
      ];
  columns.push({
    id: "actions",
    label: text("Actions"),
    mobileRole: "actions",
    render: (row) => (
      <ListActions>
        <ListActionButton data-table-default-action="true" onClick={(event) => { triggerRef.current = event.currentTarget; setSelectedEntry(row); }}>{text("View details")}</ListActionButton>
      </ListActions>
    ),
  });

  return (
    <MultisitePage
      activeTab="logs"
      actions={[
        {
          label: text("Refresh"),
          variant: "secondary",
          disabled: loading || visibleObservation == null,
          onClick: refreshLogs,
        },
      ]}
    >
      <div className="space-y-4">
        <form onSubmit={(event) => { event.preventDefault(); readLogs(); }} className="grid gap-3 rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3 lg:grid-cols-3">
          <UiSelect label={text("Log family")} value={form.family} onChange={(event) => updateForm("family", event.target.value as MultisiteFamily)}>
            <option value="metadata">{text("Metadata")}</option>
            <option value="data">{text("Data")}</option>
            <option value="bucket-index">{text("Bucket index")}</option>
          </UiSelect>
          <UiSelect label={text("Target zone and endpoint")} value={form.targetEndpointId} onChange={(event) => updateForm("targetEndpointId", event.target.value)}>
            <option value="">{text("Select target endpoint")}</option>
            {endpointOptions.map((endpoint) => <option key={endpoint.endpointId} value={endpoint.endpointId}>{endpointLabel(endpoint)}</option>)}
          </UiSelect>
          <UiInput label={text("Page size")} type="number" min={1} max={500} value={form.limit} onChange={(event) => updateForm("limit", event.target.value)} />
          {form.family === "metadata" ? <>
            <UiInput label={text("Period")} value={form.period} onChange={(event) => updateForm("period", event.target.value)} />
            <UiInput label={text("Shard")} type="number" min={0} value={form.shard} onChange={(event) => updateForm("shard", event.target.value)} />
          </> : null}
          {form.family === "data" ? <UiInput label={text("Shard")} type="number" min={0} value={form.shard} onChange={(event) => updateForm("shard", event.target.value)} /> : null}
          {form.family === "bucket-index" ? <>
            <UiInput label={text("Bucket")} value={form.bucket} onChange={(event) => updateForm("bucket", event.target.value)} />
            <UiInput label={text("Tenant")} value={form.tenant} onChange={(event) => updateForm("tenant", event.target.value)} />
            <UiInput label={text("Bucket instance")} value={form.instanceId} onChange={(event) => updateForm("instanceId", event.target.value)} />
            <UiInput label={text("Generation")} value={form.generation} onChange={(event) => updateForm("generation", event.target.value)} />
            <UiInput label={text("Shard (optional)")} type="number" min={0} value={form.shard} onChange={(event) => updateForm("shard", event.target.value)} />
          </> : null}
          <div className="flex items-end border-t border-[color:var(--ui-border-soft)] pt-3 lg:col-span-3"><UiButton type="submit" size="sm" loading={loading} disabled={!resolvedScope}>{text("Read logs")}</UiButton></div>
        </form>
        {topology.error ? <UiInlineMessage tone="error">{topology.error}</UiInlineMessage> : null}
        {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
        {visibleObservation ? <>
          <ObservationNotice observation={visibleObservation} text={text} />
          {page ? <>
            <InlineSummary label={text("Loaded log page")} items={[
              { label: text("Family"), value: page.family },
              { label: text("Endpoint ID"), value: visibleObservation.provenance.endpoint_id },
              { label: text("Collected at"), value: formatTimestamp(visibleObservation.collected_at) },
              { label: text("Loaded entries"), value: page.entries.length },
              { label: text("Journal last update"), value: formatTimestamp(page.last_update) },
              { label: text("Page truncated"), value: page.truncated ? text("Yes") : text("No") },
            ]} />
            <ListPageSection
              variant="section"
              title={text("Loaded entries")}
              description={text("Search and export only the entries currently loaded on this page.")}
              search={<UiInput aria-label={text("Search loaded log entries")} type="search" size="compact" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text("Search loaded entries")} />}
              actions={<>
                <ListActionButton onClick={() => downloadTextFile("multisite-log.json", `${safeJson({ family: page.family, scope: page.scope, collected_at: visibleObservation.collected_at, provenance: visibleObservation.provenance, entries: filteredEntries })}\n`, "application/json")}>{text("Export JSON")}</ListActionButton>
                <ListActionButton onClick={() => downloadTextFile("multisite-log.csv", recordsToCsv(filteredEntries.map((entry) => ({ ...entry, _endpoint_id: visibleObservation.provenance.endpoint_id, _scope: page.scope, _collected_at: visibleObservation.collected_at }))), "text/csv;charset=utf-8")}>{text("Export CSV")}</ListActionButton>
              </>}
              countLabel={text("{filtered} of {loaded} loaded entries", { filtered: filteredEntries.length, loaded: page.entries.length })}
            >
              <DataTableShell columns={columns} rows={filteredEntries} rowKey={(row) => safeJson([
                lookupRecordValue(row, ["op_id", "log_id", "id", "key"]),
                lookupRecordValue(row, ["timestamp", "log_timestamp"]),
                lookupRecordValue(row, ["object", "name", "entry.key"]),
              ])} status={filteredEntries.length ? "ready" : "empty"} loadingMessage={text("Loading log entries…")} errorMessage={text("Unable to display log entries.")} emptyMessage={search ? text("No loaded entry matches the local search.") : text("No log entry was returned for this page.")} responsiveCards />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--ui-border-soft)] px-3 py-2">
                <div className="flex gap-2">
                  <ListActionButton disabled={history.previous.length === 0 || loading} onClick={previousPage}>{text("Previous")}</ListActionButton>
                  <ListActionButton disabled={!page.truncated || !page.next_cursor || loading} onClick={nextPage}>{text("Next")}</ListActionButton>
                </div>
                {canAdvanceToNextLog(page) && page.next_log ? <ListActionButton disabled={loading} onClick={nextLog}>{text("Next generation {generation}", { generation: page.next_log.generation })}</ListActionButton> : null}
              </div>
              {page.next_log && !canAdvanceToNextLog(page) ? <UiInlineMessage tone="info">{text("Complete the current generation pages before advancing to generation {generation}.", { generation: page.next_log.generation })}</UiInlineMessage> : null}
            </ListPageSection>
          </> : null}
        </> : null}
      </div>
      {selectedEntry && visibleObservation ? (
        <MultisiteDetailDrawer title={text("Log entry details")} subtitle={text("Loaded from {family} log", { family: form.family })} onClose={() => setSelectedEntry(null)} returnFocus={() => triggerRef.current} text={text}>
          <section className="space-y-2">
            <h3 className="ui-body font-semibold">{text("Provenance")}</h3>
            <ProvenanceSummary observation={visibleObservation} text={text} />
          </section>
          <JsonDetails value={selectedEntry} text={text} summary={text("Log entry JSON")} />
          <JsonDetails value={page?.scope ?? null} text={text} summary={text("Log scope JSON")} />
        </MultisiteDetailDrawer>
      ) : null}
    </MultisitePage>
  );
}
