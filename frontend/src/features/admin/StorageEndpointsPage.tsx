/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { flushSync } from "react-dom";
import {
  createStorageEndpoint,
  deleteStorageEndpoint,
  fetchStorageEndpointsMeta,
  listStorageEndpoints,
  setDefaultStorageEndpoint,
  updateStorageEndpoint,
  updateStorageEndpointTags,
  type StorageEndpoint,
  type StorageEndpointCredentialChecks,
  type StorageProvider,
} from "../../api/storageEndpoints";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import WorkflowPage from "../../components/WorkflowPage";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import { ListActionButton } from "../../components/list/ListControls";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { normalizeUiTags } from "../../utils/uiTags";
import { isSuperAdminRole, readStoredUser } from "../../utils/workspaces";
import {
  applyFeatureConstraints,
  awsCoordinatesForRegion,
  awsIamEndpointForRegion,
  awsS3EndpointForRegion,
  awsStsEndpointForRegion,
  AWS_DEFAULT_REGION,
  createEmptyForm,
  createFormFromEndpoint,
  defaultFeaturesForProvider,
  EMPTY_STORAGE_ENDPOINT_FORM,
  normalizeAwsRegion,
  type FeaturesState,
  type FormState,
} from "./storageEndpointFormModel";

import StorageEndpointEditor from "./StorageEndpointEditor";
import StorageEndpointConnectionFields from "./StorageEndpointConnectionFields";
import StorageEndpointCredentialsFields from "./StorageEndpointCredentialsFields";
import StorageEndpointCapabilitiesFields from "./StorageEndpointCapabilitiesFields";
import { buildStorageEndpointSubmission } from "./storageEndpointSubmission";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import StorageEndpointList, { type EndpointListFilters } from "./StorageEndpointList";
import {
  AdminOpsPermissionsBadges,
  CredentialStatusBadge,
  EndpointHttpStatusBadge,
  resolveCredentialCheckView,
  SupervisionValidationBadges,
} from "./StorageEndpointValidationStatus";
import { useStorageEndpointLiveValidation } from "./useStorageEndpointLiveValidation";

type EndpointEditorTab = "general" | "credentials" | "capabilities";

const createEmptyCredentialChecks = (): StorageEndpointCredentialChecks => ({
  admin: { status: "not_configured" },
  supervision: { status: "not_configured" },
  ceph_admin: { status: "not_configured" },
});
const configurationSignature = (form: FormState) => stableSignature({ ...form, tags: [] });
function extractError(err: unknown): string {
  return extractApiError(err, "An error occurred.");
}

function isMethodNotAllowedError(message?: string | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("405") || normalized.includes("methodnotallowed") || normalized.includes("method not allowed");
}

export default function StorageEndpointsPage() {
  const navigate = useNavigate();
  const { endpointId: endpointIdParam } = useParams();
  const { generalSettings } = useGeneralSettings();
  const currentUser = useMemo(() => readStoredUser(), []);
  const canEditEndpoints = isSuperAdminRole(currentUser?.role);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [envManaged, setEnvManaged] = useState(false);
  const [metadataReady, setMetadataReady] = useState(false);
  const mutationPending = useRef(false);
  const closingEndpointId = useRef<number | null>(null);
  const [listFilters, setListFilters] = useState<EndpointListFilters>({ query: "", mode: "contains", provider: "all" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<EndpointEditorTab>("general");
  const [form, setForm] = useState<FormState>(EMPTY_STORAGE_ENDPOINT_FORM);
  const [formBaseline, setFormBaseline] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationShown, setValidationShown] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [defaultBusyId, setDefaultBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StorageEndpoint | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const {
    catalog: endpointTagCatalog,
    loading: endpointTagCatalogLoading,
    error: endpointTagCatalogError,
  } = useTagCatalog({ kind: "admin", domain: "endpoint" }, Boolean(showForm && canEditEndpoints));

  const invalidateCredentialChecks = useCallback(() => undefined, []);

  const resetForm = useCallback(() => {
    setForm(createEmptyForm());
    setActiveTab("general");
    setFormBaseline(null);
    setFormError(null);
    setValidationShown(false);
    setEditingId(null);
  }, []);

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMetadataReady(false);
    const [data, meta] = await Promise.allSettled([listStorageEndpoints(), fetchStorageEndpointsMeta()]);
    if (data.status === "fulfilled") setEndpoints(data.value);
    if (meta.status === "fulfilled") {
      setEnvManaged(Boolean(meta.value.managed_by_env));
      setMetadataReady(true);
    }
    if (data.status === "rejected") setError(extractError(data.reason));
    else if (meta.status === "rejected") setError(`Unable to load endpoint management mode. Changes are disabled. ${extractError(meta.reason)}`);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEndpoints();
  }, [loadEndpoints]);

  const cephMode = useMemo(() => form.provider === "ceph", [form.provider]);
  const cephAdminConfigEnabled = Boolean(generalSettings.ceph_admin_enabled);
  const editingEndpoint = useMemo(
    () => (editingId == null ? null : endpoints.find((endpoint) => endpoint.id === editingId) ?? null),
    [editingId, endpoints]
  );
  const routeEndpointId = Number(endpointIdParam ?? "");
  const hasEndpointRoute = endpointIdParam !== undefined;
  const hasValidEndpointRoute = Number.isFinite(routeEndpointId) && routeEndpointId > 0;
  const routeEndpointMissing = Boolean(
    hasEndpointRoute && !loading && (!hasValidEndpointRoute || !endpoints.some((endpoint) => endpoint.id === routeEndpointId))
  );
  const routeEndpointLoading = hasEndpointRoute && !routeEndpointMissing && !showForm;
  const configurationReadOnly = Boolean(
    editingId != null && (!metadataReady || envManaged || editingEndpoint?.is_editable === false || !canEditEndpoints)
  );
  const endpointUrl = form.endpoint_url.trim();
  const adminAccessKey = form.admin_access_key.trim();
  const adminSecretKey = form.admin_secret_key.trim();
  const supervisionAccessKey = form.supervision_access_key.trim();
  const supervisionSecretKey = form.supervision_secret_key.trim();
  const cephAdminAccessKey = form.ceph_admin_access_key.trim();
  const cephAdminSecretKey = form.ceph_admin_secret_key.trim();
  const hasAdminCredentials = Boolean(
    adminAccessKey &&
      (adminSecretKey ||
        (form.has_admin_secret && adminAccessKey === (editingEndpoint?.admin_access_key ?? "").trim()))
  );
  const hasSupervisionCredentials = Boolean(
    supervisionAccessKey &&
      (supervisionSecretKey ||
        (form.has_supervision_secret &&
          supervisionAccessKey === (editingEndpoint?.supervision_access_key ?? "").trim()))
  );
  const endpointValidationPayload = useMemo(
    () =>
      showForm &&
      cephMode &&
      canEditEndpoints &&
      !configurationReadOnly &&
      !saving &&
      endpointUrl
        ? {
            endpoint_id: editingId,
            endpoint_url: endpointUrl,
            admin_endpoint: form.features.admin.endpoint.trim() || null,
            region: form.region.trim() || null,
            verify_tls: form.verify_tls,
            check_http: true,
            admin_access_key: adminAccessKey || null,
            admin_secret_key: adminSecretKey || null,
            supervision_access_key: supervisionAccessKey || null,
            supervision_secret_key: supervisionSecretKey || null,
            ceph_admin_access_key: cephAdminAccessKey || null,
            ceph_admin_secret_key: cephAdminSecretKey || null,
          }
        : null,
    [
      adminAccessKey,
      adminSecretKey,
      canEditEndpoints,
      cephAdminAccessKey,
      cephAdminSecretKey,
      cephMode,
      configurationReadOnly,
      editingId,
      endpointUrl,
      form.features.admin.endpoint,
      form.region,
      form.verify_tls,
      saving,
      showForm,
      supervisionAccessKey,
      supervisionSecretKey,
    ],
  );
  const endpointValidation = useStorageEndpointLiveValidation({
    enabled: Boolean(endpointValidationPayload),
    payload: endpointValidationPayload,
  });
  const featureDetectBusy = endpointValidation.status === "loading";
  const detection = endpointValidation.result;
  const credentialChecks = detection?.credential_checks ?? createEmptyCredentialChecks();
  const featureDetectWarnings = useMemo(() => {
    if (!detection) return [];
    const warnings = detection.warnings.filter((item) => typeof item === "string" && item.trim());
    if (
      hasAdminCredentials &&
      !detection.account &&
      isMethodNotAllowedError(detection.account_error)
    ) {
      warnings.push("Account API is not available on this endpoint (optional capability).");
    }
    return warnings;
  }, [detection, hasAdminCredentials]);
  const featureDetectError = useMemo(() => {
    if (endpointValidation.error) return endpointValidation.error;
    if (!detection) return null;
    const errors: string[] = [];
    if (detection.http_check?.status === "unavailable") {
      errors.push(detection.http_check.message ?? "Endpoint is unavailable.");
    }
    if (hasAdminCredentials && !detection.admin && detection.admin_error) {
      errors.push(`Admin: ${detection.admin_error}`);
    }
    if (
      hasAdminCredentials &&
      !detection.account &&
      detection.account_error &&
      !isMethodNotAllowedError(detection.account_error)
    ) {
      errors.push(`Account API: ${detection.account_error}`);
    }
    if (hasSupervisionCredentials && !detection.metrics && detection.metrics_error) {
      errors.push(`Metrics: ${detection.metrics_error}`);
    }
    if (
      hasSupervisionCredentials &&
      !detection.usage &&
      detection.usage_error &&
      !detection.metrics
    ) {
      errors.push(`Usage Log: ${detection.usage_error}`);
    }
    return errors.length > 0 ? errors.join(" | ") : null;
  }, [
    detection,
    endpointValidation.error,
    hasAdminCredentials,
    hasSupervisionCredentials,
  ]);

  useEffect(() => {
    if (!detection || mutationPending.current) return;
    setForm((prev) => {
      if (prev.provider !== "ceph") return prev;
      const next = applyFeatureConstraints(
        {
          ...prev.features,
          admin: hasAdminCredentials
            ? { ...prev.features.admin, enabled: Boolean(detection.admin) }
            : prev.features.admin,
          account: hasAdminCredentials
            ? { ...prev.features.account, enabled: Boolean(detection.account) }
            : prev.features.account,
          usage: hasSupervisionCredentials
            ? { ...prev.features.usage, enabled: Boolean(detection.usage) }
            : prev.features.usage,
          metrics: hasSupervisionCredentials
            ? { ...prev.features.metrics, enabled: Boolean(detection.metrics) }
            : prev.features.metrics,
        },
        prev.provider,
      );
      if (
        next.admin.enabled === prev.features.admin.enabled &&
        next.account.enabled === prev.features.account.enabled &&
        next.usage.enabled === prev.features.usage.enabled &&
        next.metrics.enabled === prev.features.metrics.enabled
      ) {
        return prev;
      }
      return { ...prev, features: next };
    });
  }, [detection, hasAdminCredentials, hasSupervisionCredentials]);

  const updateFeatures = useCallback(
    (updater: (current: FeaturesState) => FeaturesState, providerOverride?: StorageProvider) => {
      setForm((prev) => {
        const provider = providerOverride ?? prev.provider;
        const nextRaw = updater(prev.features);
        const constrained = applyFeatureConstraints(nextRaw, provider);
        return {
          ...prev,
          provider,
          features: constrained,
        };
      });
    },
    []
  );

  const handleProviderChange = (provider: StorageProvider) => {
    invalidateCredentialChecks();
    setForm((prev) => {
      const awsRegion = AWS_DEFAULT_REGION;
      const awsCoordinates = awsCoordinatesForRegion(awsRegion);
      const defaultFeatures = defaultFeaturesForProvider(provider, awsRegion);
      const constrained = applyFeatureConstraints(defaultFeatures, provider);
      return {
        ...prev,
        provider,
        endpoint_url: provider === "aws" ? awsS3EndpointForRegion(awsRegion) : prev.endpoint_url,
        region: provider === "aws" ? awsRegion : prev.region,
        latitude: provider === "aws" ? (awsCoordinates?.latitude ?? "") : prev.latitude,
        longitude: provider === "aws" ? (awsCoordinates?.longitude ?? "") : prev.longitude,
        verify_tls: provider === "aws" ? true : prev.verify_tls,
        admin_access_key: provider === "ceph" ? prev.admin_access_key : "",
        admin_secret_key: provider === "ceph" ? prev.admin_secret_key : "",
        supervision_access_key: provider === "ceph" ? prev.supervision_access_key : "",
        supervision_secret_key: provider === "ceph" ? prev.supervision_secret_key : "",
        ceph_admin_access_key: provider === "ceph" ? prev.ceph_admin_access_key : "",
        ceph_admin_secret_key: provider === "ceph" ? prev.ceph_admin_secret_key : "",
        features: constrained,
      };
    });
  };

  const handleRegionChange = (region: string) => {
    invalidateCredentialChecks();
    setForm((prev) => {
      if (prev.provider !== "aws") {
        return { ...prev, region };
      }
      const nextRegion = normalizeAwsRegion(region);
      const nextCoordinates = awsCoordinatesForRegion(region);
      const nextFeatures = applyFeatureConstraints(
        {
          ...prev.features,
          sts: { ...prev.features.sts, endpoint: awsStsEndpointForRegion(nextRegion) },
          iam: { ...prev.features.iam, endpoint: awsIamEndpointForRegion(nextRegion) },
        },
        prev.provider
      );
      return {
        ...prev,
        region,
        endpoint_url: awsS3EndpointForRegion(nextRegion),
        latitude: nextCoordinates?.latitude ?? "",
        longitude: nextCoordinates?.longitude ?? "",
        features: nextFeatures,
      };
    });
  };

  const startCreate = () => {
    if (!metadataReady || envManaged || !canEditEndpoints) return;
    const nextForm = createEmptyForm();
    setForm(nextForm);
    setActiveTab("general");
    setFormBaseline(nextForm);
    setFormError(null);
    setValidationShown(false);
    setEditingId(null);
    setShowForm(true);
  };

  const openEndpointPage = useCallback((endpoint: StorageEndpoint) => {
    closingEndpointId.current = null;
    const nextForm = createFormFromEndpoint(endpoint);
    setEditingId(endpoint.id);
    setActiveTab("general");
    setForm(nextForm);
    setFormBaseline(nextForm);
    setFormError(null);
    setValidationShown(false);
    setShowForm(true);
  }, []);

  const startEdit = (endpoint: StorageEndpoint) => {
    closingEndpointId.current = null;
    openEndpointPage(endpoint);
    navigate(`/admin/storage-endpoints/${endpoint.id}`);
  };

  useEffect(() => {
    if (!hasEndpointRoute) {
      closingEndpointId.current = null;
      return;
    }
    // Router transitions may commit after local state; do not reopen the closing form.
    if (closingEndpointId.current === routeEndpointId || loading || !hasValidEndpointRoute) return;
    if (editingId === routeEndpointId && showForm) return;
    const endpoint = endpoints.find((candidate) => candidate.id === routeEndpointId);
    if (endpoint) {
      openEndpointPage(endpoint);
    }
  }, [
    editingId,
    endpoints,
    hasEndpointRoute,
    hasValidEndpointRoute,
    loading,
    openEndpointPage,
    routeEndpointId,
    showForm,
  ]);

  const onCloseForm = (reason?: "navigation") => {
    closingEndpointId.current = routeEndpointId;
    setShowForm(false);
    resetForm();
    if (hasEndpointRoute && reason !== "navigation") {
      navigate("/admin/storage-endpoints");
    }
  };
  const hasConfigurationChanges = !configurationReadOnly && formBaseline !== null
    && configurationSignature(form) !== configurationSignature(formBaseline);
  const hasTagChanges = formBaseline !== null
    && stableSignature(normalizeUiTags(form.tags)) !== stableSignature(normalizeUiTags(formBaseline.tags));
  const hasFormChanges = hasConfigurationChanges || hasTagChanges;
  const fieldErrors = validationShown && !configurationReadOnly
    ? buildStorageEndpointSubmission(form, editingId !== null).errors ?? {} : {};

  const handleDelete = async () => {
    if (!metadataReady || envManaged || !canEditEndpoints || mutationPending.current) return;
    if (!deleteTarget?.is_editable) return;
    mutationPending.current = true;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteStorageEndpoint(deleteTarget.id);
      setDeleteTarget(null);
      setActionMessage("Endpoint deleted.");
      await loadEndpoints();
    } catch (err) {
      setDeleteError(extractError(err));
    } finally {
      mutationPending.current = false;
      setDeleteBusy(false);
    }
  };

  const handleSetDefault = async (endpoint: StorageEndpoint) => {
    if (!metadataReady || envManaged || !canEditEndpoints || mutationPending.current) return;
    if (endpoint.is_default) return;
    mutationPending.current = true;
    setDefaultError(null);
    setDefaultBusyId(endpoint.id);
    try {
      await setDefaultStorageEndpoint(endpoint.id);
      setActionMessage("Default endpoint updated.");
      await loadEndpoints();
    } catch (err) {
      setDefaultError(extractError(err));
    } finally {
      mutationPending.current = false;
      setDefaultBusyId(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!metadataReady || !canEditEndpoints || mutationPending.current) return;
    if (editingId === null && envManaged) return;
    setFormError(null);
    const saveConfiguration = !configurationReadOnly && (editingId === null || hasConfigurationChanges);
    const submission = saveConfiguration ? buildStorageEndpointSubmission(form, editingId !== null) : null;
    if (submission?.errors) {
      setValidationShown(true);
      const connectionFields = ["name", "endpoint_url", "latitude", "longitude"];
      setActiveTab(Object.keys(submission.errors).some(field => connectionFields.includes(field)) ? "general" : "credentials");
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    mutationPending.current = true;
    setSaving(true);
    let savedEndpoint: StorageEndpoint | null = null;
    try {
      const normalizedTags = normalizeUiTags(form.tags);
      let targetId = editingId;
      if (submission?.payload) {
        savedEndpoint = targetId === null
          ? await createStorageEndpoint(submission.payload)
          : await updateStorageEndpoint(targetId, submission.payload);
        targetId = savedEndpoint.id;
        const savedForm = createFormFromEndpoint(savedEndpoint);
        // Configuration and tags have separate API commits. Retain the saved identity
        // and rebase the configuration before attempting tags, including on create.
        const committedEndpoint = savedEndpoint;
        setEndpoints(previous => [...previous.filter(endpoint => endpoint.id !== committedEndpoint.id), committedEndpoint]);
        setEditingId(targetId);
        setFormBaseline(savedForm);
        setForm({ ...savedForm, tags: normalizedTags });
        setValidationShown(false);
      }
      if (targetId === null) return;
      if (hasTagChanges) await updateStorageEndpointTags(targetId, { tags: normalizedTags });
      setActionMessage(editingId === null ? "Endpoint added." : saveConfiguration ? "Endpoint updated." : "Endpoint tags updated.");
      closingEndpointId.current = routeEndpointId;
      flushSync(() => { setShowForm(false); resetForm(); });
      await loadEndpoints();
      if (hasEndpointRoute) {
        navigate("/admin/storage-endpoints");
      }
    } catch (err) {
      setFormError(savedEndpoint
        ? `Endpoint ${editingId === null ? "created" : "updated"}, but tags could not be saved. Your tag changes are kept; retry to save them. ${extractError(err)}`
        : extractError(err));
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  };

  const showUsageLogUnavailableWarning =
    cephMode &&
    !featureDetectBusy &&
    !featureDetectError &&
    Boolean(form.endpoint_url.trim()) &&
    Boolean(form.supervision_access_key.trim() || form.has_supervision_secret) &&
    !form.features.usage.enabled;
  const endpointReadyForCredentialCheck = Boolean(form.endpoint_url.trim());
  const adminCredentialCheck = configurationReadOnly
    ? null
    : resolveCredentialCheckView({
        accessKey: form.admin_access_key,
        secretKey: form.admin_secret_key,
        storedAccessKey: editingEndpoint?.admin_access_key,
        hasStoredSecret: form.has_admin_secret,
        endpointReady: endpointReadyForCredentialCheck,
        checking: featureDetectBusy,
        check: credentialChecks.admin,
        incompleteMessage: "Enter both the Admin Ops access key and secret key.",
      });
  const supervisionCredentialCheck = configurationReadOnly
    ? null
    : resolveCredentialCheckView({
        accessKey: form.supervision_access_key,
        secretKey: form.supervision_secret_key,
        storedAccessKey: editingEndpoint?.supervision_access_key,
        hasStoredSecret: form.has_supervision_secret,
        endpointReady: endpointReadyForCredentialCheck,
        checking: featureDetectBusy,
        check: credentialChecks.supervision,
        incompleteMessage: "Enter both the Supervision Ops access key and secret key.",
      });
  const cephAdminCredentialCheck = configurationReadOnly
    ? null
    : resolveCredentialCheckView({
        accessKey: form.ceph_admin_access_key,
        secretKey: form.ceph_admin_secret_key,
        storedAccessKey: editingEndpoint?.ceph_admin_access_key,
        hasStoredSecret: form.has_ceph_admin_secret,
        endpointReady: endpointReadyForCredentialCheck,
        checking: featureDetectBusy,
        check: credentialChecks.ceph_admin,
        incompleteMessage: "Enter both the Ceph Admin access key and secret key.",
      });
  const hasSupervisionCredentialsForSignedProbe = Boolean(
    form.supervision_access_key.trim() &&
      (form.supervision_secret_key.trim() ||
        (form.has_supervision_secret &&
          form.supervision_access_key.trim() === (editingEndpoint?.supervision_access_key ?? "").trim()))
  );
  const editorTabs = [
    { id: "general", label: "Connection" },
    { id: "credentials", label: "Credentials" },
    { id: "capabilities", label: "Capabilities & health" },
  ];
  const signedProbeBlockedReason = !cephMode
    ? "S3 signed probe is available only for Ceph endpoints."
    : !hasSupervisionCredentialsForSignedProbe
    ? "S3 signed probe requires Supervision credentials (access key + secret key)."
    : null;
  const editorEndpointName = form.name.trim() || editingEndpoint?.name || "Endpoint";
  const editorTitle = editingId
    ? `${configurationReadOnly ? "Storage endpoint" : "Edit storage endpoint"} · ${editorEndpointName}`
    : "New storage endpoint";
  useEffect(() => {
    if (!saving && !configurationReadOnly && signedProbeBlockedReason && form.features.healthcheck.mode === "s3") {
      updateFeatures((current) => ({
        ...current,
        healthcheck: {
          ...current.healthcheck,
          mode: "http",
        },
      }));
    }
  }, [form.features.healthcheck.mode, signedProbeBlockedReason, updateFeatures, saving, configurationReadOnly]);

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      {routeEndpointLoading ? (
        <WorkflowPage
          title="Loading storage endpoint"
          description="Retrieving endpoint configuration and access mode."
          breadcrumbs={adminPageBreadcrumbs("storage-endpoints", { label: "Loading" })}
          width="narrow"
        >
          <PageBanner tone="info">Loading endpoint configuration...</PageBanner>
        </WorkflowPage>
      ) : routeEndpointMissing ? (
        <WorkflowPage
          title="Storage endpoint not found"
          description="The requested endpoint does not exist or is no longer available."
          breadcrumbs={adminPageBreadcrumbs("storage-endpoints", { label: "Not found" })}
          backLabel="Back to endpoints"
          onBack={() => navigate("/admin/storage-endpoints")}
          width="narrow"
        >
          <PageBanner tone="warning">Select an endpoint from the current storage endpoint list.</PageBanner>
        </WorkflowPage>
      ) : !showForm ? (
        <>
      <PageHeader
        title="S3 Endpoints"
        description="Manage the S3/Ceph endpoints used by the console."
        breadcrumbs={adminPageBreadcrumbs("storage-endpoints")}
        rightContent={metadataReady && !loading && !envManaged && canEditEndpoints ? <ListActionButton variant="primary" onClick={startCreate}>New endpoint</ListActionButton> : undefined}
      />

      {envManaged && (
        <PageBanner tone="info">
          Storage endpoints are managed by environment variables (ENV_STORAGE_ENDPOINTS). Configuration changes are disabled.
        </PageBanner>
      )}
      {!envManaged && !canEditEndpoints && (
        <PageBanner tone="info">
          Endpoint editing is restricted to superadmin users. You currently have read-only access.
        </PageBanner>
      )}
      {defaultError && <PageBanner tone="error">{defaultError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      <StorageEndpointList endpoints={endpoints} loading={loading} error={error}
        envManaged={envManaged} metadataReady={metadataReady} canEdit={canEditEndpoints}
        defaultBusyId={defaultBusyId} deleteBusy={deleteBusy} filters={listFilters}
        onFiltersChange={setListFilters} onOpen={startEdit} onSetDefault={handleSetDefault}
        onDelete={(endpoint) => { setDeleteTarget(endpoint); setDeleteError(null); }}
        onRetry={() => void loadEndpoints()} />
        </>
      ) : null}

      {showForm && (
        <StorageEndpointEditor key={editingId ?? "create"} title={editorTitle} name={editingEndpoint?.name ?? "Endpoint"}
          editing={editingId !== null} readOnly={configurationReadOnly} canEdit={canEditEndpoints}
          ready={metadataReady} dirty={hasFormChanges} busy={saving} onSubmit={handleSubmit} onClose={onCloseForm}>
          {formError && <PageBanner tone="error">{formError}</PageBanner>}
          {configurationReadOnly && <PageBanner tone="info">
            Endpoint configuration is read-only. {!metadataReady
              ? "Management mode is unavailable. Return to endpoints and retry before making changes."
              : canEditEndpoints ? "You can still update the tags associated with this endpoint."
                : "All settings and tags are available for consultation only."}
          </PageBanner>}
          {endpointTagCatalogError && <PageBanner tone="warning">{endpointTagCatalogError}</PageBanner>}
          <PageTabs tabs={editorTabs.map(tab => ({ ...tab, disabled: saving }))} activeTab={activeTab}
            onChange={tab => setActiveTab(tab as EndpointEditorTab)} variant="line"
            ariaLabel="Endpoint configuration sections" idPrefix="endpoint-editor" />
          <div id={`endpoint-editor-panel-${activeTab}`} role="tabpanel" aria-labelledby={`endpoint-editor-tab-${activeTab}`}>
            {activeTab === "general" && <StorageEndpointConnectionFields form={form} setForm={setForm}
              readOnly={configurationReadOnly} canEditTags={canEditEndpoints} busy={saving}
              catalog={endpointTagCatalog} catalogLoading={endpointTagCatalogLoading} errors={fieldErrors}
              onProviderChange={handleProviderChange} onRegionChange={handleRegionChange} invalidateChecks={invalidateCredentialChecks}
              validationStatus={!configurationReadOnly && cephMode && endpointUrl ? (
                <EndpointHttpStatusBadge checking={featureDetectBusy} check={detection?.http_check} />
              ) : undefined} />}
            {activeTab === "credentials" && <StorageEndpointCredentialsFields form={form} setForm={setForm}
              readOnly={configurationReadOnly} editing={editingId !== null} cephAdminEnabled={cephAdminConfigEnabled}
              errors={fieldErrors} invalidateChecks={invalidateCredentialChecks} statuses={{
                admin: adminCredentialCheck && <>
                  <CredentialStatusBadge {...adminCredentialCheck} />
                  {adminCredentialCheck.status === "valid" && (
                    <AdminOpsPermissionsBadges permissions={detection?.admin_ops_permissions} />
                  )}
                </>,
                supervision: supervisionCredentialCheck && <>
                  <CredentialStatusBadge {...supervisionCredentialCheck} />
                  {supervisionCredentialCheck.status === "valid" && detection && (
                    <SupervisionValidationBadges
                      metrics={detection.metrics}
                      usage={detection.usage}
                      metricsError={detection.metrics_error}
                      usageError={detection.usage_error}
                    />
                  )}
                </>,
                ceph_admin: cephAdminCredentialCheck && <CredentialStatusBadge {...cephAdminCredentialCheck} />,
              }} />}
            {activeTab === "capabilities" && <StorageEndpointCapabilitiesFields features={form.features} provider={form.provider}
              region={form.region} readOnly={configurationReadOnly} updateFeatures={updateFeatures}
              invalidateChecks={invalidateCredentialChecks} detecting={featureDetectBusy} detectionError={featureDetectError}
              warnings={featureDetectWarnings} usageUnavailable={showUsageLogUnavailableWarning} signedProbeBlockedReason={signedProbeBlockedReason} />}
          </div>
        </StorageEndpointEditor>
      )}

      {deleteTarget && (
        <ConfirmActionDialog
          title="Delete endpoint"
          description={<>Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action cannot be undone.</>}
          confirmLabel="Delete"
          processingLabel="Deleting..."
          loading={deleteBusy}
          error={deleteError}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}
