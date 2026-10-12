/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useMemo } from "react";
import type { StorageEndpoint, StorageProvider } from "../../api/storageEndpoints";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import PageBanner from "../../components/PageBanner";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import DataTableShell, { dataTableDefaultActionProps, type DataTableColumn } from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { ListActionButton, ListActions } from "../../components/list/ListControls";
import UiBadge from "../../components/ui/UiBadge";
import UiSelect from "../../components/ui/UiSelect";
import { matchesExactTextCandidate, type TextMatchMode } from "../../utils/textMatch";
import { buildUiTagItems } from "../../utils/uiTags";
import { resolveFeatureState, type FeatureKey } from "./storageEndpointFormModel";
import { useStorageEndpointI18n, type StorageEndpointMessageKey } from "./storageEndpointMessages";
import "./storageEndpointList.css";

const serviceMessageKeys: Array<{ key: FeatureKey; messageKey: StorageEndpointMessageKey }> = [
  { key: "admin", messageKey: "serviceAdmin" }, { key: "account", messageKey: "serviceAccount" },
  { key: "usage", messageKey: "serviceUsage" }, { key: "metrics", messageKey: "serviceMetrics" },
  { key: "sns", messageKey: "serviceSns" }, { key: "sts", messageKey: "serviceSts" },
  { key: "static_website", messageKey: "serviceStaticWebsite" }, { key: "iam", messageKey: "serviceIam" },
  { key: "sse", messageKey: "serviceSse" }, { key: "replication", messageKey: "serviceReplication" },
  { key: "healthcheck", messageKey: "serviceHealthcheck" },
];

export type EndpointListFilters = { query: string; mode: TextMatchMode; provider: StorageProvider | "all" };

type Props = {
  endpoints: StorageEndpoint[];
  loading: boolean;
  error: string | null;
  envManaged: boolean;
  metadataReady: boolean;
  canEdit: boolean;
  defaultBusyId: number | null;
  deleteBusy: boolean;
  filters: EndpointListFilters;
  onFiltersChange: (filters: EndpointListFilters) => void;
  onOpen: (endpoint: StorageEndpoint) => void;
  onSetDefault: (endpoint: StorageEndpoint) => void;
  onDelete: (endpoint: StorageEndpoint) => void;
  onRetry: () => void;
};

export default function StorageEndpointList({
  endpoints, loading, error, envManaged, metadataReady, canEdit, defaultBusyId,
  deleteBusy, filters, onFiltersChange, onOpen, onSetDefault, onDelete, onRetry,
}: Props) {
  const { locale, text } = useStorageEndpointI18n();
  const providers = useMemo<Record<StorageProvider, string>>(
    () => ({ ceph: text("providerCeph"), aws: text("providerAws"), other: text("providerOther") }),
    [text],
  );
  const services = useMemo(
    () => serviceMessageKeys.map((service) => ({ ...service, label: text(service.messageKey) })),
    [text],
  );
  const query = filters.query.trim();
  const rows = useMemo(() => endpoints.filter((endpoint) => {
    if (filters.provider !== "all" && endpoint.provider !== filters.provider) return false;
    const candidates = [endpoint.name, endpoint.endpoint_url, providers[endpoint.provider], endpoint.region,
      ...endpoint.tags.map((tag) => tag.label)];
    return filters.mode === "exact"
      ? matchesExactTextCandidate(candidates, query)
      : candidates.some((value) => (value ?? "").toLowerCase().includes(query.toLowerCase()));
  }), [endpoints, filters.provider, filters.mode, providers, query]);
  const pending = loading || deleteBusy || defaultBusyId !== null;
  const mutable = canEdit && metadataReady && !envManaged;
  const activeFilters = [
    ...(query ? [{ id: "search", label: text("search", { mode: text(filters.mode === "exact" ? "matchExact" : "matchContains"), query }) }] : []),
    ...(filters.provider !== "all" ? [{ id: "provider", label: text("providerFilter", { provider: providers[filters.provider] }) }] : []),
  ];
  const columns: DataTableColumn<StorageEndpoint>[] = [
    {
      id: "endpoint", label: text("endpoint"), primary: true,
      render: (endpoint) => (
        <div className="endpoint-identity">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="endpoint-name" title={endpoint.name}>{endpoint.name}</span>
            {endpoint.is_default && <UiBadge className="endpoint-status-badge" tone="primary">{text("default")}</UiBadge>}
            {envManaged ? <UiBadge className="endpoint-status-badge">{text("envManaged")}</UiBadge> : !endpoint.is_editable && <UiBadge className="endpoint-status-badge">{text("protected")}</UiBadge>}
          </div>
          <span className="endpoint-url" title={endpoint.endpoint_url}>{endpoint.endpoint_url}</span>
          {endpoint.tags.length > 0 && <div data-table-row-click-ignore="true">
            <UiTagBadgeList items={buildUiTagItems(endpoint.tags)} variant="listing-compact" layout="inline-compact" maxVisible={2} />
          </div>}
        </div>
      ),
    },
    {
      id: "provider", label: text("provider"), headerClassName: "endpoint-provider-cell",
      render: (endpoint) => <div className="endpoint-summary">
        <span>{providers[endpoint.provider]}</span>
        <span className="text-[var(--ui-text-muted)]">{endpoint.region || text("notSpecified")}</span>
      </div>,
    },
    {
      id: "connection", label: text("connection"), headerClassName: "endpoint-connection-cell",
      render: (endpoint) => <div className="endpoint-summary">
        {endpoint.verify_tls !== false ? <span>{text("tlsOn")}</span> : <UiBadge tone="warning">{text("tlsOff")}</UiBadge>}
        <span className="text-[var(--ui-text-muted)]">{endpoint.force_path_style ? text("pathStyle") : text("virtualHostStyle")}</span>
      </div>,
    },
    {
      id: "services", label: text("enabledServices"), headerClassName: "endpoint-services-cell",
      render: (endpoint) => {
        const features = resolveFeatureState(endpoint, endpoint.provider);
        const enabled = services.filter((service) => features[service.key].enabled);
        return <div className="endpoint-services" role="group" aria-label={`${text("enabledServices")}: ${enabled.map((service) => service.label).join(", ") || text("none")}`}>
          {enabled.slice(0, 3).map((service) => <UiBadge key={service.key}>{service.label}</UiBadge>)}
          {enabled.length > 3 && <UiBadge title={enabled.slice(3).map((service) => service.label).join(", ")}>+{enabled.length - 3}</UiBadge>}
          {!enabled.length && <span className="text-[var(--ui-text-muted)]">{text("noneEnabled")}</span>}
        </div>;
      },
    },
    {
      id: "actions", label: text("actions"), align: "right", mobileRole: "actions",
      headerClassName: "endpoint-actions-cell", cellClassName: "endpoint-actions-cell",
      render: (endpoint) => <ListActions className="endpoint-actions">
        {!endpoint.is_default && <ListActionButton variant="secondary" disabled={!mutable || pending} onClick={() => onSetDefault(endpoint)}>
          {defaultBusyId === endpoint.id ? text("setting") : text("setAsDefault")}
        </ListActionButton>}
        <ListActionButton variant="secondary" onClick={() => onOpen(endpoint)} {...dataTableDefaultActionProps}>
          {mutable && endpoint.is_editable ? text("edit") : text("view")}
        </ListActionButton>
        {mutable && endpoint.is_editable && <ListActionButton variant="danger" disabled={pending} onClick={() => onDelete(endpoint)}>{text("delete")}</ListActionButton>}
      </ListActions>,
    },
  ];
  const count = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const countLabel = activeFilters.length
    ? text(endpoints.length === 1 ? "filteredEndpointCount" : "filteredEndpointCountPlural", {
      visible: count.format(rows.length),
      total: count.format(endpoints.length),
    })
    : text(rows.length === 1 ? "endpointCount" : "endpointCountPlural", { count: count.format(rows.length) });
  const status = resolveListTableStatus({ loading, error, rowCount: endpoints.length });

  return <div className="storage-endpoint-list">
    {error && <PageBanner tone="error"><ListActions className="justify-between" role="alert">
      <span>{error}</span><ListActionButton variant="secondary" disabled={loading} onClick={onRetry}>{text("retry")}</ListActionButton>
    </ListActions></PageBanner>}
    <ListPageSection variant="page" title={text("s3Endpoints")}
      countLabel={loading && !endpoints.length ? text("loadingEndpoints") : error && !endpoints.length ? text("endpointsUnavailable") : countLabel}
      search={<ToolbarSearchInput value={filters.query} onChange={(value) => onFiltersChange({ ...filters, query: value })}
        placeholder={text("searchPlaceholder")} className="endpoint-search w-full sm:w-80" active={Boolean(query)} matchMode={filters.mode}
        matchModeAriaLabel={text("toggleFilterMatchMode")}
        onToggleMatchMode={() => onFiltersChange({ ...filters, mode: filters.mode === "contains" ? "exact" : "contains" })} />}
      filters={<UiSelect label={text("provider")} size="compact" value={filters.provider}
        onChange={(event) => onFiltersChange({ ...filters, provider: event.target.value as EndpointListFilters["provider"] })}>
        <option value="all">{text("all")}</option>{Object.entries(providers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </UiSelect>}
      secondaryContent={activeFilters.length > 0 && <ActiveFiltersBar items={activeFilters}
        label={text("activeFilters")} clearLabel={text("clearAll")}
        onClearAll={() => onFiltersChange({ query: "", mode: "contains", provider: "all" })} />}>
      <DataTableShell columns={columns} rows={rows} rowKey={(endpoint) => endpoint.id}
        status={status === "ready" && !rows.length ? "empty" : status}
        loadingMessage={text("loadingEndpoints")} errorMessage={text("loadingError")}
        emptyMessage={endpoints.length ? text("noMatches") : text("noConfigured")}
        primaryColumnId="endpoint" responsiveCards stickyActions={false} tableLayout="fixed"
        tableClassName="ui-data-table endpoint-table" containerClassName="rounded-t-none border-x-0 border-b-0" />
    </ListPageSection>
  </div>;
}
