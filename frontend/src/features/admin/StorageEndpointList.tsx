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
import "./storageEndpointList.css";

const providers: Record<StorageProvider, string> = { ceph: "Ceph", aws: "AWS", other: "Other" };
const services: Array<{ key: FeatureKey; label: string }> = [
  { key: "admin", label: "Admin" }, { key: "account", label: "Account API" },
  { key: "usage", label: "Usage Log" }, { key: "metrics", label: "Metrics" },
  { key: "sns", label: "SNS" }, { key: "sts", label: "STS" },
  { key: "static_website", label: "Static website" }, { key: "iam", label: "IAM" },
  { key: "sse", label: "SSE" }, { key: "replication", label: "Replication" },
  { key: "healthcheck", label: "Healthcheck" },
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
  const query = filters.query.trim();
  const rows = useMemo(() => endpoints.filter((endpoint) => {
    if (filters.provider !== "all" && endpoint.provider !== filters.provider) return false;
    const candidates = [endpoint.name, endpoint.endpoint_url, providers[endpoint.provider], endpoint.region,
      ...endpoint.tags.map((tag) => tag.label)];
    return filters.mode === "exact"
      ? matchesExactTextCandidate(candidates, query)
      : candidates.some((value) => (value ?? "").toLowerCase().includes(query.toLowerCase()));
  }), [endpoints, filters.provider, filters.mode, query]);
  const pending = loading || deleteBusy || defaultBusyId !== null;
  const mutable = canEdit && metadataReady && !envManaged;
  const activeFilters = [
    ...(query ? [{ id: "search", label: `Search ${filters.mode}: ${query}` }] : []),
    ...(filters.provider !== "all" ? [{ id: "provider", label: `Provider: ${providers[filters.provider]}` }] : []),
  ];
  const columns: DataTableColumn<StorageEndpoint>[] = [
    {
      id: "endpoint", label: "Endpoint", primary: true,
      render: (endpoint) => (
        <div className="endpoint-identity">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="endpoint-name" title={endpoint.name}>{endpoint.name}</span>
            {endpoint.is_default && <UiBadge className="endpoint-status-badge" tone="primary">Default</UiBadge>}
            {envManaged ? <UiBadge className="endpoint-status-badge">Env managed</UiBadge> : !endpoint.is_editable && <UiBadge className="endpoint-status-badge">Protected</UiBadge>}
          </div>
          <span className="endpoint-url" title={endpoint.endpoint_url}>{endpoint.endpoint_url}</span>
          {endpoint.tags.length > 0 && <div data-table-row-click-ignore="true">
            <UiTagBadgeList items={buildUiTagItems(endpoint.tags)} variant="listing-compact" layout="inline-compact" maxVisible={2} />
          </div>}
        </div>
      ),
    },
    {
      id: "provider", label: "Provider", headerClassName: "endpoint-provider-cell",
      render: (endpoint) => <div className="endpoint-summary">
        <span>{providers[endpoint.provider]}</span>
        <span className="text-[var(--ui-text-muted)]">{endpoint.region || "Not specified"}</span>
      </div>,
    },
    {
      id: "connection", label: "Connection", headerClassName: "endpoint-connection-cell",
      render: (endpoint) => <div className="endpoint-summary">
        {endpoint.verify_tls !== false ? <span>TLS verification on</span> : <UiBadge tone="warning">TLS verification off</UiBadge>}
        <span className="text-[var(--ui-text-muted)]">{endpoint.force_path_style ? "Path style" : "Virtual-host style"}</span>
      </div>,
    },
    {
      id: "services", label: "Enabled services", headerClassName: "endpoint-services-cell",
      render: (endpoint) => {
        const features = resolveFeatureState(endpoint, endpoint.provider);
        const enabled = services.filter((service) => features[service.key].enabled);
        return <div className="endpoint-services" role="group" aria-label={`Enabled services: ${enabled.map((service) => service.label).join(", ") || "None"}`}>
          {enabled.slice(0, 3).map((service) => <UiBadge key={service.key}>{service.label}</UiBadge>)}
          {enabled.length > 3 && <UiBadge title={enabled.slice(3).map((service) => service.label).join(", ")}>+{enabled.length - 3}</UiBadge>}
          {!enabled.length && <span className="text-[var(--ui-text-muted)]">None enabled</span>}
        </div>;
      },
    },
    {
      id: "actions", label: "Actions", align: "right", mobileRole: "actions",
      headerClassName: "endpoint-actions-cell", cellClassName: "endpoint-actions-cell",
      render: (endpoint) => <ListActions className="endpoint-actions">
        {!endpoint.is_default && <ListActionButton variant="secondary" disabled={!mutable || pending} onClick={() => onSetDefault(endpoint)}>
          {defaultBusyId === endpoint.id ? "Setting..." : "Set as default"}
        </ListActionButton>}
        <ListActionButton variant="secondary" onClick={() => onOpen(endpoint)} {...dataTableDefaultActionProps}>
          {mutable && endpoint.is_editable ? "Edit" : "View"}
        </ListActionButton>
        {mutable && endpoint.is_editable && <ListActionButton variant="danger" disabled={pending} onClick={() => onDelete(endpoint)}>Delete</ListActionButton>}
      </ListActions>,
    },
  ];
  const count = new Intl.NumberFormat("en");
  const status = resolveListTableStatus({ loading, error, rowCount: endpoints.length });

  return <div className="storage-endpoint-list">
    {error && <PageBanner tone="error"><ListActions className="justify-between" role="alert">
      <span>{error}</span><ListActionButton variant="secondary" disabled={loading} onClick={onRetry}>Retry</ListActionButton>
    </ListActions></PageBanner>}
    <ListPageSection variant="page" title="S3 Endpoints"
      countLabel={loading && !endpoints.length ? "Loading endpoints..." : error && !endpoints.length ? "Endpoints unavailable" : `${count.format(rows.length)}${activeFilters.length ? ` of ${count.format(endpoints.length)}` : ""} endpoint${(activeFilters.length ? endpoints.length : rows.length) === 1 ? "" : "s"}`}
      search={<ToolbarSearchInput value={filters.query} onChange={(value) => onFiltersChange({ ...filters, query: value })}
        placeholder="Search name, URL, provider, region or tag" className="endpoint-search w-full sm:w-80" active={Boolean(query)} matchMode={filters.mode}
        onToggleMatchMode={() => onFiltersChange({ ...filters, mode: filters.mode === "contains" ? "exact" : "contains" })} />}
      filters={<UiSelect label="Provider" size="compact" value={filters.provider}
        onChange={(event) => onFiltersChange({ ...filters, provider: event.target.value as EndpointListFilters["provider"] })}>
        <option value="all">All</option>{Object.entries(providers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </UiSelect>}
      secondaryContent={activeFilters.length > 0 && <ActiveFiltersBar items={activeFilters}
        onClearAll={() => onFiltersChange({ query: "", mode: "contains", provider: "all" })} />}>
      <DataTableShell columns={columns} rows={rows} rowKey={(endpoint) => endpoint.id}
        status={status === "ready" && !rows.length ? "empty" : status}
        loadingMessage="Loading endpoints..." errorMessage="Unable to load endpoints. Use Retry to try again."
        emptyMessage={endpoints.length ? "No endpoints match these filters." : "No endpoints configured yet."}
        primaryColumnId="endpoint" responsiveCards stickyActions={false} tableLayout="fixed"
        tableClassName="ui-data-table endpoint-table" containerClassName="rounded-t-none border-x-0 border-b-0" />
    </ListPageSection>
  </div>;
}
