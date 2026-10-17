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
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
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
import { useAdminI18n } from "./adminI18n";

type RotationTypeOption = {
  value: KeyRotationType;
  label: string;
  description: string;
  manuallyProvisioned?: boolean;
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
    manuallyProvisioned: true,
  },
  {
    value: "endpoint_runtime",
    label: "Runtime Read Ops",
    description: "Rotate managed credentials used for live read enrichment.",
  },
  {
    value: "endpoint_supervision",
    label: "Endpoint supervision keys",
    description:
      "Rotate supervision credentials used for usage and metrics collection.",
  },
  {
    value: "ceph_admin",
    label: "Ceph Admin keys",
    description:
      "Rotate the dedicated Ceph Admin credentials configured on each selected endpoint.",
    manuallyProvisioned: true,
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
];

const KEY_TYPE_LABEL: Record<KeyRotationType, string> = {
  endpoint_admin: "Endpoint admin",
  endpoint_runtime: "Runtime Read Ops",
  endpoint_supervision: "Endpoint supervision",
  account: "Account",
  s3_user: "S3 user",
  ceph_admin: "Ceph-admin",
};

const ENV_MANAGED_ENDPOINT_KEY_TYPES: KeyRotationType[] = ["endpoint_admin", "ceph_admin"];
const TECHNICAL_TYPES: KeyRotationType[] = ["endpoint_runtime", "endpoint_supervision"];

function isEndpointEligible(endpoint: StorageEndpoint, types: KeyRotationType[]): boolean {
  if (endpoint.provider !== "ceph") return false;
  return types.some(type => {
    if (TECHNICAL_TYPES.includes(type)) {
      const kind = type === "endpoint_runtime" ? "runtime" : type === "endpoint_supervision" ? "supervision" : "ceph_admin";
      return endpoint.service_identities?.some(identity => identity.kind === kind && identity.mode === "managed" && (identity.status === "ready" || identity.rotation_pending)) ?? false;
    }
    if (type === "ceph_admin") {
      const identity = endpoint.service_identities?.find(candidate => candidate.kind === "ceph_admin");
      return Boolean(
        endpoint.is_editable !== false &&
        identity?.mode === "external" &&
        (identity.status === "ready" || identity.rotation_pending)
      );
    }
    return Boolean(endpoint.capabilities?.admin ?? endpoint.features?.admin?.enabled);
  });
}

function resultTableColumns(adminText: ReturnType<typeof useAdminI18n>["text"]): Array<DataTableColumn<KeyRotationResultRow>> {
  return [
  {
    id: "endpoint",
    label: adminText("Endpoint"),
    primary: true,
    render: (item) => item.endpoint_name,
  },
  {
    id: "type",
    label: adminText("Type"),
    render: (item) => KEY_TYPE_LABEL[item.key_type],
  },
  {
    id: "target",
    label: adminText("Target"),
    render: (item) => item.target_label || item.target_type,
  },
  {
    id: "status",
    label: adminText("Status"),
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
    label: adminText("Details"),
    render: (item) => (
      <>
        {item.message}
        {item.rotation_pending && (
          <p>
            {adminText("Rotation pending · {phase}. Retry the same category to resume.", {
              phase: item.rotation_phase ?? "-",
            })}
          </p>
        )}
        {item.old_access_key && item.new_access_key ? (
          <details className="text-[var(--ui-text-muted)]">
            <summary className="cursor-pointer">{adminText("Key identifiers")}</summary>
            <span className="break-all font-mono text-xs">
              {item.old_access_key} → {item.new_access_key}
            </span>
          </details>
        ) : null}
      </>
    ),
  },
  ];
}

export default function KeyRotationPage() {
  const { text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [result, setResult] = useState<KeyRotationResponse | null>(null);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<KeyRotationType[]>([
    "endpoint_admin",
    "endpoint_runtime",
    "endpoint_supervision",
    "ceph_admin",
    "account",
    "s3_user",
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
          .filter((endpoint) => isEndpointEligible(endpoint, ROTATION_TYPE_OPTIONS.map(option => option.value)))
          .map((endpoint) => endpoint.id);
        setSelectedEndpointIds(eligibleIds);
      } catch (err) {
        if (!mounted) return;
        setError(extractApiError(err, adminText("Unable to run key rotation.")));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [adminText]);

  const eligibleEndpoints = useMemo(
    () => endpoints.filter((endpoint) => isEndpointEligible(endpoint, selectedTypes)),
    [endpoints, selectedTypes],
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

  const technicalSelected = selectedTypes.some(type => TECHNICAL_TYPES.includes(type));
  useEffect(() => { if (technicalSelected) setDeactivateOnly(false); }, [technicalSelected]);

  const runDisabled =
    running || !eligibleEndpoints.some(endpoint => selectedEndpointIds.includes(endpoint.id)) || selectedTypes.length === 0;

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
        endpoint_ids: selectedEndpointIds.filter(id => eligibleEndpoints.some(endpoint => endpoint.id === id)),
        key_types: selectedTypes,
        deactivate_only: deactivateOnly,
      });
      if (!active.current) return;
      setResult(response);
      setPreviousResult(false);
      if (response.summary.failed > 0) {
        setActionMessage(
          adminText("Rotation completed with errors. Review details below."),
        );
      } else if (response.summary.skipped > 0) {
        setActionMessage(
          adminText("Rotation completed with skipped items. Review details below."),
        );
      } else {
        setActionMessage(adminText("Rotation completed successfully."));
      }
    } catch (err) {
      if (active.current)
        setError(
          adminText("{error} The outcome may be incomplete. Retry the same categories to resume their persisted rotations.", {
            error: extractApiError(err, adminText("Unable to run key rotation.")),
          }),
        );
    } finally {
      pending.current = false;
      if (active.current) setRunning(false);
    }
  };

  return (
    <PageShell actionPresentation="listing"
      title={adminText("S3 key rotation")}
      description={adminText("Replace RGW keys managed by BucketReef on selected Ceph endpoints.")}
      breadcrumbs={adminBreadcrumbs("key-rotation")}
    >
      <div className="settings-compact">
        {loading && <PageBanner tone="info">{adminText("Loading endpoints...")}</PageBanner>}
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
            title={adminText("Endpoints")}
            description={adminText("Select endpoints eligible for at least one selected category. Ready managed service identities do not require the Admin feature.")}
          >
            <div className="flex flex-wrap justify-end gap-2">
              <SettingsButton variant="ghost" onClick={selectAllEndpoints}>
                {adminText("Select all endpoints")}</SettingsButton>
              <SettingsButton variant="ghost" onClick={clearAllEndpoints}>
                {adminText("Clear endpoints")}</SettingsButton>
            </div>
            {endpoints.map((endpoint) => (
              <SettingsChoiceRow
                key={endpoint.id}
                title={endpoint.name}
                description={`${endpoint.endpoint_url} · ${endpoint.provider}`}
                checked={selectedEndpointIds.includes(endpoint.id)}
                disabled={!isEndpointEligible(endpoint, selectedTypes)}
                onChange={() => toggleEndpoint(endpoint.id)}
              >
                {!isEndpointEligible(endpoint, selectedTypes) ? (
                  <span className="block text-amber-700 dark:text-amber-300">
                    {adminText("Unavailable for the selected categories.")}</span>
                ) : endpoint.is_editable === false ? (
                  <span className="block text-[var(--ui-text-muted)]">
                    {adminText("Admin Ops credentials are managed by ENV_STORAGE_ENDPOINTS. Managed service keys remain stored in the database.")}</span>
                ) : null}
              </SettingsChoiceRow>
            ))}
            {!loading && !endpoints.length && (
              <p className="settings-readonly">{adminText("No storage endpoints found.")}</p>
            )}
            {!loading && !selectedEndpointIds.length && (
              <p className="text-sm text-[var(--ui-text-muted)]">
                {adminText("Select at least one eligible endpoint.")}</p>
            )}
          </SettingsSection>
          <SettingsSection
            presentation="compact"
            title={adminText("Key categories")}
            description={adminText("Only the selected categories will be processed.")}
          >
            <div className="flex flex-wrap justify-end gap-2">
              <SettingsButton variant="ghost" onClick={selectAllTypes}>
                {adminText("Select all categories")}</SettingsButton>
              <SettingsButton variant="ghost" onClick={clearAllTypes}>
                {adminText("Clear categories")}</SettingsButton>
            </div>
            {ROTATION_TYPE_OPTIONS.map((option) => (
              <SettingsChoiceRow
                key={option.value}
                title={option.label}
                description={option.description}
                checked={selectedTypes.includes(option.value)}
                onChange={() => toggleType(option.value)}
              >
                {option.manuallyProvisioned && (
                  <span className="block text-[var(--ui-text-muted)]">
                    {adminText("Manually provisioned keys may also be used outside BucketReef.")}</span>
                )}
              </SettingsChoiceRow>
            ))}
            {!selectedTypes.length && (
              <p className="settings-readonly">
                {adminText("Select at least one key category.")}</p>
            )}
          </SettingsSection>
          <SettingsSection presentation="compact" title={adminText("Previous keys")}>
            <SettingsItem
              compact
              title={adminText("Disable old keys only")}
              description={
                technicalSelected
                  ? "Managed technical identities require deletion of previous keys. Deselect these categories to use disable mode."
                  : deactivateOnly
                  ? "Keep old keys in an inactive state after replacement."
                  : "Delete old keys after replacement. This cannot be undone."
              }
              action={
                <SettingsSwitch
                  ariaLabel={adminText("Disable old keys only")}
                  disabled={technicalSelected}
                  checked={deactivateOnly}
                  onChange={value => { if (!technicalSelected) setDeactivateOnly(value); }}
                />
              }
            />
          </SettingsSection>
        </fieldset>
        <SettingsSection
          presentation="compact"
          title={adminText("Execution")}
          description={adminText("Review the scope before starting. Rotation can return partial results.")}
        >
          {hasSelectedEnvManagedEndpointKeys && (
            <PageBanner tone="warning">
              {adminText("Admin Ops and Ceph Admin keys supplied by ENV_STORAGE_ENDPOINTS will be skipped. Rotate them externally and update the environment values. Managed service identities, account keys and S3 user keys remain eligible. Other external service identities are rotated by their operator.")}</PageBanner>
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
            aria-label={adminText("Rotation results")}
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
              <UiBadge>{adminText("Total: {count}", { count: result.summary.total })}</UiBadge>
              <UiBadge tone="success">
                {adminText("Rotated: {count}", { count: result.summary.rotated })}
              </UiBadge>
              <UiBadge tone="danger">
                {adminText("Failed: {count}", { count: result.summary.failed })}
              </UiBadge>
              <UiBadge>{adminText("Skipped: {count}", { count: result.summary.skipped })}</UiBadge>
              <UiBadge>
                {adminText("Old keys deleted: {count}", {
                  count: result.summary.deleted_old_keys,
                })}
              </UiBadge>
              <UiBadge>
                {adminText("Old keys disabled: {count}", {
                  count: result.summary.disabled_old_keys,
                })}
              </UiBadge>
            </div>
            <DataTableShell
              columns={resultTableColumns(adminText)}
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
          title={adminText("Run key rotation?")}
          description={adminText("New keys will replace the selected managed credentials. Applications using old keys may lose access.")}
          confirmLabel={adminText("Confirm rotation")}
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
              ? "ENV Admin Ops and external service identities will be skipped. Managed service identities, account and S3 user keys remain eligible."
              : undefined
          }
        />
      )}
      <SettingsNavigationGuard
        dirty={running}
        title={adminText("Leave this rotation?")}
        description={adminText("The server operation will continue. You may lose access to its detailed results on this page.")}
        confirmLabel={adminText("Leave page")}
        cancelLabel="Wait for results"
      />
    </PageShell>
  );
}
