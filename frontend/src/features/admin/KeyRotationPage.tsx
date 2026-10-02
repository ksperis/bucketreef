/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyRotationResponse,
  KeyRotationResultItem,
  KeyRotationType,
  rotateS3Keys,
} from "../../api/keyRotation";
import {
  StorageEndpoint,
  listStorageEndpoints,
} from "../../api/storageEndpoints";
import DataTableShell, {
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import UiBadge from "../../components/ui/UiBadge";
import {
  SettingsButton,
} from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import {
  SettingsChoiceRow,
  SettingsSection,
  SettingsItem,
  SettingsSwitch,
} from "../../components/settings/SettingsLayout";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";

type RotationTypeOption = {
  value: KeyRotationType;
  label: string;
  description: string;
};

type KeyRotationResultRow = KeyRotationResultItem & {
  rowKey: string;
};

const ROTATION_TYPE_OPTIONS: RotationTypeOption[] = [
  {
    value: "endpoint_admin",
    label: "Endpoint admin keys",
    description:
      "Rotate admin credentials configured on each selected endpoint.",
  },
  {
    value: "endpoint_supervision",
    label: "Endpoint supervision keys",
    description:
      "Rotate supervision credentials used for usage and metrics collection.",
  },
  {
    value: "account",
    label: "Account keys",
    description: "Rotate interface keys for managed RGW accounts.",
  },
  {
    value: "s3_user",
    label: "S3 user keys",
    description: "Rotate interface keys for managed standalone S3 users.",
  },
  {
    value: "ceph_admin",
    label: "Ceph-admin keys",
    description:
      "Rotate dedicated Ceph Admin credentials configured on endpoints.",
  },
];

const KEY_TYPE_LABEL: Record<KeyRotationType, string> = {
  endpoint_admin: "Endpoint admin",
  endpoint_supervision: "Endpoint supervision",
  account: "Account",
  s3_user: "S3 user",
  ceph_admin: "Ceph-admin",
};

const ENV_MANAGED_ENDPOINT_KEY_TYPES: KeyRotationType[] = [
  "endpoint_admin",
  "endpoint_supervision",
  "ceph_admin",
];

function isEndpointEligible(endpoint: StorageEndpoint): boolean {
  if (endpoint.provider !== "ceph") return false;
  const adminEnabled =
    endpoint.capabilities?.admin ?? endpoint.features?.admin?.enabled ?? false;
  return Boolean(adminEnabled);
}

function extractError(err: unknown): string {
  return extractApiError(err, "Unable to run key rotation.");
}

const resultTableColumns: Array<DataTableColumn<KeyRotationResultRow>> = [
  {
    id: "endpoint",
    label: "Endpoint",
    primary: true,
    render: (item) => item.endpoint_name,
  },
  {
    id: "type",
    label: "Type",
    render: (item) => KEY_TYPE_LABEL[item.key_type],
  },
  {
    id: "target",
    label: "Target",
    render: (item) => item.target_label || item.target_type,
  },
  {
    id: "status",
    label: "Status",
    render: (item) => (
      <UiBadge
        tone={
          item.status === "rotated"
            ? "success"
            : item.status === "failed"
              ? "danger"
              : "neutral"
        }
      >
        {item.status}
      </UiBadge>
    ),
  },
  {
    id: "details",
    label: "Details",
    render: (item) => (
      <>
        {item.message}
        {item.old_access_key && item.new_access_key ? (
          <details className="text-[var(--ui-text-muted)]">
            <summary className="cursor-pointer">Key identifiers</summary>
            <span className="break-all font-mono text-xs">
              {item.old_access_key} → {item.new_access_key}
            </span>
          </details>
        ) : null}
      </>
    ),
  },
];

export default function KeyRotationPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [result, setResult] = useState<KeyRotationResponse | null>(null);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<KeyRotationType[]>([
    "endpoint_admin",
    "endpoint_supervision",
    "account",
    "s3_user",
    "ceph_admin",
  ]);
  const [previousResult, setPreviousResult] = useState(false);
  const [deactivateOnly, setDeactivateOnly] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const loadedEndpoints = await listStorageEndpoints();
        if (!mounted) return;
        setEndpoints(loadedEndpoints);
        const eligibleIds = loadedEndpoints
          .filter((endpoint) => isEndpointEligible(endpoint))
          .map((endpoint) => endpoint.id);
        setSelectedEndpointIds(eligibleIds);
      } catch (err) {
        if (!mounted) return;
        setError(extractError(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const eligibleEndpoints = useMemo(
    () => endpoints.filter((endpoint) => isEndpointEligible(endpoint)),
    [endpoints],
  );
  const selectedEnvManagedEndpoints = useMemo(
    () =>
      eligibleEndpoints.filter(
        (endpoint) =>
          selectedEndpointIds.includes(endpoint.id) &&
          endpoint.is_editable === false,
      ),
    [eligibleEndpoints, selectedEndpointIds],
  );
  const hasSelectedEnvManagedEndpointKeys =
    selectedEnvManagedEndpoints.length > 0 &&
    selectedTypes.some((type) => ENV_MANAGED_ENDPOINT_KEY_TYPES.includes(type));
  const resultRows = useMemo<KeyRotationResultRow[]>(
    () =>
      (result?.results ?? []).map((item, index) => ({
        ...item,
        rowKey: `${item.endpoint_id}-${item.key_type}-${item.target_id ?? "none"}-${index}`,
      })),
    [result?.results],
  );
  const resultTableStatus = resolveListTableStatus({
    loading: false,
    error: null,
    rowCount: resultRows.length,
  });

  const runDisabled =
    running || selectedEndpointIds.length === 0 || selectedTypes.length === 0;

  const toggleEndpoint = (endpointId: number) => {
    setSelectedEndpointIds((prev) =>
      prev.includes(endpointId)
        ? prev.filter((id) => id !== endpointId)
        : [...prev, endpointId],
    );
  };

  const toggleType = (type: KeyRotationType) => {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((entry) => entry !== type)
        : [...prev, type],
    );
  };

  const selectAllEndpoints = () => {
    setSelectedEndpointIds(eligibleEndpoints.map((endpoint) => endpoint.id));
  };

  const clearAllEndpoints = () => {
    setSelectedEndpointIds([]);
  };

  const selectAllTypes = () => {
    setSelectedTypes(ROTATION_TYPE_OPTIONS.map((option) => option.value));
  };

  const clearAllTypes = () => {
    setSelectedTypes([]);
  };

  const runRotation = async () => {
    if (runDisabled || pending.current) return;
    pending.current = true;
    setConfirmOpen(false);
    setPreviousResult(Boolean(result));
    setRunning(true);
    setError(null);
    setActionMessage(null);
    try {
      const response = await rotateS3Keys({
        endpoint_ids: selectedEndpointIds,
        key_types: selectedTypes,
        deactivate_only: deactivateOnly,
      });
      if (!active.current) return;
      setResult(response);
      setPreviousResult(false);
      if (response.summary.failed > 0) {
        setActionMessage(
          "Rotation completed with errors. Review details below.",
        );
      } else if (response.summary.skipped > 0) {
        setActionMessage(
          "Rotation completed with skipped items. Review details below.",
        );
      } else {
        setActionMessage("Rotation completed successfully.");
      }
    } catch (err) {
      if (active.current)
        setError(
          `${extractError(err)} The outcome may be incomplete. Review the existing keys before starting another rotation.`,
        );
    } finally {
      pending.current = false;
      if (active.current) setRunning(false);
    }
  };

  return (
    <PageShell actionPresentation="listing"
      title="S3 key rotation"
      description="Replace managed RGW keys on selected Ceph endpoints."
      breadcrumbs={adminPageBreadcrumbs("key-rotation")}
    >
      <div className="settings-compact">
        {loading && <PageBanner tone="info">Loading endpoints...</PageBanner>}
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {actionMessage && (
          <PageBanner
            tone={
              result?.summary.failed || result?.summary.skipped
                ? "warning"
                : "success"
            }
          >
            {actionMessage}
          </PageBanner>
        )}
        <fieldset disabled={running || loading} className="min-w-0">
          <SettingsSection
            presentation="compact"
            title="Endpoints"
            description="Select Ceph endpoints with the admin API enabled."
          >
            <div className="flex flex-wrap justify-end gap-2">
              <SettingsButton variant="ghost" onClick={selectAllEndpoints}>
                Select all endpoints
              </SettingsButton>
              <SettingsButton variant="ghost" onClick={clearAllEndpoints}>
                Clear endpoints
              </SettingsButton>
            </div>
            {endpoints.map((endpoint) => (
              <SettingsChoiceRow
                key={endpoint.id}
                title={endpoint.name}
                description={`${endpoint.endpoint_url} · ${endpoint.provider}`}
                checked={selectedEndpointIds.includes(endpoint.id)}
                disabled={!isEndpointEligible(endpoint)}
                onChange={() => toggleEndpoint(endpoint.id)}
              >
                {!isEndpointEligible(endpoint) ? (
                  <span className="block text-amber-700 dark:text-amber-300">
                    Unavailable: requires Ceph with the admin API enabled.
                  </span>
                ) : endpoint.is_editable === false ? (
                  <span className="block text-[var(--ui-text-muted)]">
                    Endpoint credentials are managed by ENV_STORAGE_ENDPOINTS.
                  </span>
                ) : null}
              </SettingsChoiceRow>
            ))}
            {!loading && !endpoints.length && (
              <p className="settings-readonly">No storage endpoints found.</p>
            )}
            {!loading && !selectedEndpointIds.length && (
              <p className="text-sm text-[var(--ui-text-muted)]">
                Select at least one eligible endpoint.
              </p>
            )}
          </SettingsSection>
          <SettingsSection
            presentation="compact"
            title="Key categories"
            description="Only the selected categories will be processed."
          >
            <div className="flex flex-wrap justify-end gap-2">
              <SettingsButton variant="ghost" onClick={selectAllTypes}>
                Select all categories
              </SettingsButton>
              <SettingsButton variant="ghost" onClick={clearAllTypes}>
                Clear categories
              </SettingsButton>
            </div>
            {ROTATION_TYPE_OPTIONS.map((option) => (
              <SettingsChoiceRow
                key={option.value}
                title={option.label}
                description={option.description}
                checked={selectedTypes.includes(option.value)}
                onChange={() => toggleType(option.value)}
              />
            ))}
            {!selectedTypes.length && (
              <p className="settings-readonly">
                Select at least one key category.
              </p>
            )}
          </SettingsSection>
          <SettingsSection presentation="compact" title="Previous keys">
            <SettingsItem
              compact
              title="Disable old keys only"
              description={
                deactivateOnly
                  ? "Keep old keys in an inactive state after replacement."
                  : "Delete old keys after replacement. This cannot be undone."
              }
              action={
                <SettingsSwitch
                  ariaLabel="Disable old keys only"
                  checked={deactivateOnly}
                  onChange={setDeactivateOnly}
                />
              }
            />
          </SettingsSection>
        </fieldset>
        <SettingsSection
          presentation="compact"
          title="Execution"
          description="Review the scope before starting. Rotation can return partial results."
        >
          {hasSelectedEnvManagedEndpointKeys && (
            <PageBanner tone="warning">
              Endpoint admin, supervision, and Ceph-admin keys managed by
              ENV_STORAGE_ENDPOINTS will be skipped. Rotate them externally and
              redeploy with the updated environment values. Account and S3 user
              keys remain eligible.
            </PageBanner>
          )}
          <SettingsItem
            compact
            title={running ? "Rotation in progress" : selectedEndpointIds.length && selectedTypes.length ? "Ready to review" : "Choose rotation scope"}
            description={
              running
                ? "The operation continues on the server. Wait for its results before starting another rotation."
                : `${selectedEndpointIds.length} endpoint(s) · ${selectedTypes.length} key categories · ${deactivateOnly ? "disable" : "delete"} previous keys`
            }
            action={
              <SettingsButton
                disabled={runDisabled || loading}
                onClick={() => setConfirmOpen(true)}
              >
                {running ? "Rotating..." : "Run rotation"}
              </SettingsButton>
            }
          />
        </SettingsSection>
        {result && (
          <section
            aria-label="Rotation results"
            className="border-t border-[var(--ui-border-soft)] pt-5"
          >
            <ListToolbar variant="section"
              title={
                previousResult
                  ? "Previous execution summary"
                  : "Execution summary"
              }
              description={`Mode: ${result.mode === "deactivate_old_keys" ? "Deactivate old keys" : "Delete old keys"}`}
              countLabel={`${result.results.length} detailed result${result.results.length === 1 ? "" : "s"}`}
            />
            <div className="my-3 flex flex-wrap gap-2">
              <UiBadge>Total: {result.summary.total}</UiBadge>
              <UiBadge tone="success">
                Rotated: {result.summary.rotated}
              </UiBadge>
              <UiBadge tone="danger">Failed: {result.summary.failed}</UiBadge>
              <UiBadge>Skipped: {result.summary.skipped}</UiBadge>
              <UiBadge>
                Old keys deleted: {result.summary.deleted_old_keys}
              </UiBadge>
              <UiBadge>
                Old keys disabled: {result.summary.disabled_old_keys}
              </UiBadge>
            </div>
            <DataTableShell
              columns={resultTableColumns}
              rows={resultRows}
              rowKey={(item) => item.rowKey}
              status={resultTableStatus}
              loadingMessage="Loading rotation results..."
              errorMessage="Unable to load rotation results."
              emptyMessage="No details returned by the backend."
              primaryColumnId="endpoint"
              responsiveCards
              tableClassName="ui-data-table"
            />
          </section>
        )}
      </div>
      {confirmOpen && (
        <ConfirmActionDialog
          title="Run key rotation?"
          description="New keys will replace the selected managed credentials. Applications using old keys may lose access."
          confirmLabel="Confirm rotation"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void runRotation()}
          details={[
            {
              label: "Endpoints",
              value: eligibleEndpoints
                .filter((endpoint) => selectedEndpointIds.includes(endpoint.id))
                .map((endpoint) => endpoint.name)
                .join(", "),
            },
            {
              label: "Key categories",
              value: selectedTypes
                .map((type) => KEY_TYPE_LABEL[type])
                .join(", "),
            },
            {
              label: "Previous keys",
              value: deactivateOnly
                ? "Disable after replacement"
                : "Permanently delete after replacement",
            },
          ]}
          warning={
            hasSelectedEnvManagedEndpointKeys
              ? "Environment-managed endpoint credentials will be skipped. Account and S3 user keys remain eligible."
              : undefined
          }
        />
      )}
      <SettingsNavigationGuard
        dirty={running}
        title="Leave this rotation?"
        description="The server operation will continue. You may lose access to its detailed results on this page."
        confirmLabel="Leave page"
        cancelLabel="Wait for results"
      />
    </PageShell>
  );
}
