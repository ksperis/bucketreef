/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { flushSync } from "react-dom";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import {
  createStorageEndpoint,
  deleteStorageEndpoint,
  fetchStorageEndpointsMeta,
  getStorageEndpoint,
  listStorageEndpoints,
  setDefaultStorageEndpoint,
  updateStorageEndpoint,
  updateStorageEndpointTags,
  reconcileEndpointIdentities,
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
  serviceIdentityRequirements,
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
import { useStorageEndpointI18n } from "./storageEndpointMessages";
import {
  EndpointHttpStatusBadge,
  resolveCredentialCheckView,
} from "./StorageEndpointValidationStatus";
import { useStorageEndpointLiveValidation } from "./useStorageEndpointLiveValidation";

type EndpointEditorTab = "general" | "credentials" | "capabilities";

const createEmptyCredentialChecks = (): StorageEndpointCredentialChecks => ({
  ceph_admin: { status: "not_configured" },
  runtime: { status: "not_configured" },
  admin: { status: "not_configured" },
  supervision: { status: "not_configured" },
});
const configurationSignature = (form: FormState) => stableSignature({ ...form, tags: [] });
function isMethodNotAllowedError(message?: string | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("405") || normalized.includes("methodnotallowed") || normalized.includes("method not allowed");
}

export default function StorageEndpointsPage() {
  const navigate = useNavigate();
  const { text } = useStorageEndpointI18n();
  const extractLocalizedError = useCallback((err: unknown) => extractApiError(err, text("genericError")), [text]);
  const { endpointId: endpointIdParam } = useParams();
  const { generalSettings } = useGeneralSettings();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
  const currentUser = useMemo(() => readStoredUser(), []);
  const canEditEndpoints = isSuperAdminRole(currentUser?.role);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [envManaged, setEnvManaged] = useState(false);
  const [metadataReady, setMetadataReady] = useState(false);
  const mutationPending = useRef(false);
  const createdEndpointAwaitingTagRetry = useRef(false);
  const detectedFeatureDefaultsApplied = useRef({ account: false, usage: false, metrics: false });
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
  const [validationRetryKey, setValidationRetryKey] = useState(0);
  const [validationShown, setValidationShown] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [readOnlyEndpointDetail, setReadOnlyEndpointDetail] = useState<StorageEndpoint | null>(null);
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
    createdEndpointAwaitingTagRetry.current = false;
    detectedFeatureDefaultsApplied.current = { account: false, usage: false, metrics: false };
    setForm(createEmptyForm());
    setActiveTab("general");
    setFormBaseline(null);
    setFormError(null);
    setValidationShown(false);
    setEditingId(null);
    setReadOnlyEndpointDetail(null);
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
    if (data.status === "rejected") setError(extractLocalizedError(data.reason));
    else if (meta.status === "rejected") setError(text("managementModeUnavailable", { error: extractLocalizedError(meta.reason) }));
    setLoading(false);
  }, [extractLocalizedError, text]);

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
  useEffect(() => {
    if (!showForm || editingId == null || !configurationReadOnly) {
      setReadOnlyEndpointDetail(null);
      return;
    }
    let active = true;
    void getStorageEndpoint(editingId, { include_admin_ops_permissions: true })
      .then((endpoint) => {
        if (active) setReadOnlyEndpointDetail(endpoint);
      })
      .catch(() => {
        if (active) setReadOnlyEndpointDetail(null);
      });
    return () => {
      active = false;
    };
  }, [configurationReadOnly, editingId, showForm]);
  const endpointUrl = form.endpoint_url.trim();
  const adminAccessKey = form.admin_access_key.trim();
  const adminSecretKey = form.admin_secret_key.trim();
  const cephAdminAccessKey = form.ceph_admin_access_key.trim();
  const cephAdminSecretKey = form.ceph_admin_secret_key.trim();
  const runtimeAccessKey = form.runtime_access_key.trim();
  const runtimeSecretKey = form.runtime_secret_key.trim();
  const supervisionAccessKey = form.supervision_access_key.trim();
  const supervisionSecretKey = form.supervision_secret_key.trim();
  const hasAdminCredentials = Boolean(
    adminAccessKey &&
      (adminSecretKey ||
        (form.has_admin_secret && adminAccessKey === (editingEndpoint?.admin_access_key ?? "").trim()))
  );
  const hasSupervisionCredentials = Boolean(
    (supervisionAccessKey && supervisionSecretKey) ||
      (editingId != null &&
        form.has_supervision_secret &&
        !supervisionAccessKey &&
        !supervisionSecretKey)
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
            ceph_admin_access_key: cephAdminAccessKey || null,
            ceph_admin_secret_key: cephAdminSecretKey || null,
            runtime_access_key: form.service_identity_mode === "external" ? runtimeAccessKey || null : null,
            runtime_secret_key: form.service_identity_mode === "external" ? runtimeSecretKey || null : null,
            supervision_access_key: form.service_identity_mode === "external" ? supervisionAccessKey || null : null,
            supervision_secret_key: form.service_identity_mode === "external" ? supervisionSecretKey || null : null,
          }
        : null,
    [
      adminAccessKey,
      adminSecretKey,
      cephAdminAccessKey,
      cephAdminSecretKey,
      runtimeAccessKey,
      runtimeSecretKey,
      form.service_identity_mode,
      canEditEndpoints,
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
    retryKey: validationRetryKey,
  });
  const featureDetectBusy = endpointValidation.status === "loading";
  const detection = endpointValidation.result;
  const credentialChecks = { ...createEmptyCredentialChecks(), ...detection?.credential_checks };
  const adminUsersWrite = detection?.credential_checks.admin.status === "valid"
    ? detection.admin_ops_permissions?.users_write
    : configurationReadOnly && readOnlyEndpointDetail?.id === editingId
      ? readOnlyEndpointDetail.admin_ops_permissions?.users_write
      : undefined;
  const featureDetectWarnings = useMemo(() => {
    if (!detection) return [];
    const warnings = detection.warnings.filter((item) => typeof item === "string" && item.trim());
    if (
      hasAdminCredentials &&
      !detection.account &&
      isMethodNotAllowedError(detection.account_error)
    ) {
      warnings.push(text("accountApiUnavailable"));
    }
    return warnings;
  }, [detection, hasAdminCredentials, text]);
  const featureDetectError = useMemo(() => {
    if (endpointValidation.error) return endpointValidation.error;
    if (!detection) return null;
    const errors: string[] = [];
    if (detection.http_check?.status === "unavailable") {
      errors.push(detection.http_check.message ?? text("endpointUnavailable"));
    }
    if (hasAdminCredentials && !detection.admin && detection.admin_error) {
      errors.push(text("adminError", { error: detection.admin_error }));
    }
    if (
      hasAdminCredentials &&
      !detection.account &&
      detection.account_error &&
      !isMethodNotAllowedError(detection.account_error)
    ) {
      errors.push(text("accountApiError", { error: detection.account_error }));
    }
    if (hasSupervisionCredentials && !detection.metrics && detection.metrics_error) {
      errors.push(text("metricsError", { error: detection.metrics_error }));
    }
    if (
      hasSupervisionCredentials &&
      !detection.usage &&
      detection.usage_error &&
      !detection.metrics
    ) {
      errors.push(text("usageLogError", { error: detection.usage_error }));
    }
    return errors.length > 0 ? errors.join(" | ") : null;
  }, [
    detection,
    endpointValidation.error,
    hasAdminCredentials,
    hasSupervisionCredentials,
    text,
  ]);

  useEffect(() => {
    if (!detection || mutationPending.current) return;
    const defaultAccount = hasAdminCredentials && detection.account && !detectedFeatureDefaultsApplied.current.account;
    const defaultUsage = hasSupervisionCredentials && detection.usage && !detectedFeatureDefaultsApplied.current.usage;
    const defaultMetrics = hasSupervisionCredentials && detection.metrics && !detectedFeatureDefaultsApplied.current.metrics;
    if (defaultAccount) detectedFeatureDefaultsApplied.current.account = true;
    if (defaultUsage) detectedFeatureDefaultsApplied.current.usage = true;
    if (defaultMetrics) detectedFeatureDefaultsApplied.current.metrics = true;
    setForm((prev) => {
      if (prev.provider !== "ceph") return prev;
      const next = applyFeatureConstraints(
        {
          ...prev.features,
          admin: hasAdminCredentials
            ? { ...prev.features.admin, enabled: Boolean(detection.admin) }
            : prev.features.admin,
          account: defaultAccount ? { ...prev.features.account, enabled: true } : prev.features.account,
          usage: defaultUsage ? { ...prev.features.usage, enabled: true } : prev.features.usage,
          metrics: defaultMetrics ? { ...prev.features.metrics, enabled: true } : prev.features.metrics,
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
    detectedFeatureDefaultsApplied.current = { account: false, usage: false, metrics: false };
    const nextForm = createEmptyForm();
    setForm(nextForm);
    setActiveTab("general");
    setFormBaseline(nextForm);
    setFormError(null);
    setValidationShown(false);
    setEditingId(null);
    createdEndpointAwaitingTagRetry.current = false;
    setShowForm(true);
  };

  const openEndpointPage = useCallback((endpoint: StorageEndpoint) => {
    closingEndpointId.current = null;
    createdEndpointAwaitingTagRetry.current = false;
    detectedFeatureDefaultsApplied.current = { account: true, usage: true, metrics: true };
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
  const savedRuntimeIdentity = editingEndpoint?.service_identities?.find(identity => identity.kind === "runtime");
  const requiredServiceIdentities = serviceIdentityRequirements(form.features);
  const savedManagedProvisioningPending = Boolean(
    editingEndpoint?.service_identities?.some(identity =>
      (identity.kind === "runtime" || identity.kind === "supervision") &&
      requiredServiceIdentities[identity.kind] &&
      identity.mode === "managed" &&
      identity.status === "not_provisioned"
    )
  );
  const switchingToManaged = Boolean(
    editingId !== null &&
    form.service_identity_mode === "managed" &&
    savedRuntimeIdentity?.mode !== "managed"
  );
  const managedProvisioningIntent = Boolean(
    cephMode &&
    (requiredServiceIdentities.runtime || requiredServiceIdentities.supervision) &&
    form.service_identity_mode === "managed" &&
    !configurationReadOnly &&
    hasConfigurationChanges &&
    (editingId === null || switchingToManaged || savedManagedProvisioningPending)
  );
  const managedProvisioningOnSave = managedProvisioningIntent && hasAdminCredentials && adminUsersWrite === true;
  const endpointSubmitLabel = managedProvisioningOnSave
    ? editingId === null ? text("saveAndCreateIdentities") : text("saveCreateIdentities")
    : undefined;
  const fieldErrors = validationShown && !configurationReadOnly
    ? buildStorageEndpointSubmission(form, editingId !== null, editingEndpoint?.service_identities).errors ?? {} : {};

  const handleDelete = async () => {
    if (!metadataReady || envManaged || !canEditEndpoints || mutationPending.current) return;
    if (!deleteTarget?.is_editable) return;
    mutationPending.current = true;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteStorageEndpoint(deleteTarget.id);
      setDeleteTarget(null);
      setActionMessage(text("endpointDeleted"));
      await loadEndpoints();
    } catch (err) {
      setDeleteError(extractLocalizedError(err));
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
      setActionMessage(text("defaultEndpointUpdated"));
      await loadEndpoints();
    } catch (err) {
      setDefaultError(extractLocalizedError(err));
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
    const submission = saveConfiguration ? buildStorageEndpointSubmission(form, editingId !== null, editingEndpoint?.service_identities) : null;
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
    const creatingEndpoint = editingId === null;
    try {
      const normalizedTags = normalizeUiTags(form.tags);
      let targetId = editingId;
      if (submission?.payload) {
        if (targetId === null) {
          savedEndpoint = await runWithStepUp(() => createStorageEndpoint(submission.payload));
        } else {
          const existingEndpointId = targetId;
          savedEndpoint = await runWithStepUp(() => updateStorageEndpoint(existingEndpointId, submission.payload));
        }
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
      if (hasTagChanges) {
        await updateStorageEndpointTags(targetId, { tags: normalizedTags });
        setFormBaseline(previous => previous ? { ...previous, tags: normalizedTags } : previous);
      }
      if (savedEndpoint?.service_identities?.some(identity => identity.status === "error" || identity.status === "revocation_pending")) {
        setFormError(text("endpointSavedIdentityAttention"));
        await loadEndpoints();
        return;
      }
      const savedIdentityRequirements = savedEndpoint ? serviceIdentityRequirements(savedEndpoint.features) : null;
      const awaitingManagedProvisioning = Boolean(
        savedEndpoint?.provider === "ceph" &&
        savedEndpoint.service_identities?.some(identity =>
          (identity.kind === "runtime" || identity.kind === "supervision") &&
          savedIdentityRequirements?.[identity.kind] &&
          identity.mode === "managed" &&
          identity.status === "not_provisioned"
        )
      );
      if (awaitingManagedProvisioning && managedProvisioningOnSave) {
        setActiveTab("credentials");
        if (!hasEndpointRoute) navigate(`/admin/storage-endpoints/${targetId}`);
        try {
          const reconciled = await runWithStepUp(() => reconcileEndpointIdentities(targetId));
          const reconciledForm = createFormFromEndpoint(reconciled);
          setEndpoints(previous => [...previous.filter(endpoint => endpoint.id !== reconciled.id), reconciled]);
          setForm(reconciledForm);
          setFormBaseline(reconciledForm);
          setActionMessage(text(editingId === null ? "endpointAddedIdentitiesCreated" : "endpointUpdatedIdentitiesCreated"));
          await loadEndpoints();
          setValidationRetryKey(previous => previous + 1);
        } catch (cause) {
          if (isRecentWebAuthnVerificationCancelled(cause)) {
            setActionMessage(text("endpointSavedIdentitiesNotCreated"));
          } else {
            setFormError(text("endpointSavedIdentitiesFailed", { error: extractLocalizedError(cause) }));
          }
          await loadEndpoints();
        }
        return;
      }
      if (awaitingManagedProvisioning) {
        setActionMessage(text(editingId === null ? "endpointAddedProvisioningPending" : "endpointUpdatedProvisioningPending"));
        setActiveTab("credentials");
        await loadEndpoints();
        if (!hasEndpointRoute) navigate(`/admin/storage-endpoints/${targetId}`);
        return;
      }
      setActionMessage(text(editingId === null ? "endpointAdded" : saveConfiguration ? "endpointUpdated" : "endpointTagsUpdated"));
      if (editingId !== null && !createdEndpointAwaitingTagRetry.current) {
        await loadEndpoints();
        setValidationRetryKey(previous => previous + 1);
        return;
      }
      closingEndpointId.current = routeEndpointId;
      flushSync(() => { setShowForm(false); resetForm(); });
      await loadEndpoints();
      if (hasEndpointRoute) {
        navigate("/admin/storage-endpoints");
      }
    } catch (err) {
      if (savedEndpoint && creatingEndpoint) createdEndpointAwaitingTagRetry.current = true;
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        setFormError(savedEndpoint
          ? text("endpointTagsSaveFailed", { status: text(editingId === null ? "statusCreated" : "statusUpdated"), error: extractLocalizedError(err) })
          : extractLocalizedError(err));
      }
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
        incompleteMessage: text("enterAdminCredentials"),
      });
  const supervisionCredentialCheck = configurationReadOnly
    ? null
    : resolveCredentialCheckView({
        accessKey: form.supervision_access_key,
        secretKey: form.supervision_secret_key,
        hasStoredSecret: form.has_supervision_secret,
        reuseStoredCredentials: editingId != null,
        endpointReady: endpointReadyForCredentialCheck,
        checking: featureDetectBusy,
        check: credentialChecks.supervision,
        incompleteMessage: text("enterSupervisionCredentials"),
      });
  const cephAdminCredentialCheck = configurationReadOnly ? null : resolveCredentialCheckView({
    accessKey: form.ceph_admin_access_key, secretKey: form.ceph_admin_secret_key,
    hasStoredSecret: form.has_ceph_admin_secret, reuseStoredCredentials: editingId != null,
    endpointReady: endpointReadyForCredentialCheck, checking: featureDetectBusy,
    check: credentialChecks.ceph_admin ?? { status: "not_configured" },
    incompleteMessage: text("enterCephAdminCredentials"),
  });
  const runtimeCredentialCheck = configurationReadOnly
    ? null
    : resolveCredentialCheckView({
        accessKey: form.runtime_access_key,
        secretKey: form.runtime_secret_key,
        hasStoredSecret: form.has_runtime_secret,
        reuseStoredCredentials: editingId != null,
        endpointReady: endpointReadyForCredentialCheck,
        checking: featureDetectBusy,
        check: credentialChecks.runtime ?? { status: "not_configured" },
        incompleteMessage: text("enterRuntimeCredentials"),
      });
  const managedSupervisionReady = Boolean(
    editingEndpoint?.service_identities?.some(identity =>
      identity.kind === "supervision" && identity.mode === "managed" && identity.status === "ready"
    )
  );
  const hasSupervisionCredentialsForSignedProbe = form.service_identity_mode === "managed"
    ? managedSupervisionReady
    : Boolean(
        (form.supervision_access_key.trim() && form.supervision_secret_key.trim()) ||
          (editingId != null &&
            form.has_supervision_secret &&
            !form.supervision_access_key.trim() &&
            !form.supervision_secret_key.trim())
      );
  const externalSupervisionConfigured = form.service_identity_mode === "external"
    && Boolean(
      (form.supervision_access_key.trim() && form.supervision_secret_key.trim()) ||
        (editingId != null && form.has_supervision_secret &&
          !form.supervision_access_key.trim() && !form.supervision_secret_key.trim())
    );
  const editorTabs = [
    { id: "general", label: text("connectionTab") },
    { id: "credentials", label: text("credentialsTab") },
    { id: "capabilities", label: text("capabilitiesTab") },
  ];
  const signedProbeBlockedReason = !cephMode
    ? text("signedProbeCephOnly")
    : !hasSupervisionCredentialsForSignedProbe
    ? text("signedProbeCredentialsRequired")
    : null;
  const editorEndpointName = form.name.trim() || editingEndpoint?.name || text("endpointFallback");
  const editorTitle = editingId
    ? `${text(configurationReadOnly ? "storageEndpointTitle" : "editStorageEndpoint")} · ${editorEndpointName}`
    : text("newStorageEndpoint");
  useEffect(() => {
    if (saving || configurationReadOnly) return;
    if (externalSupervisionConfigured && (
      !form.features.healthcheck.enabled || form.features.healthcheck.mode !== "s3"
    )) {
      updateFeatures((current) => ({
        ...current,
        healthcheck: {
          ...current.healthcheck,
          enabled: true,
          mode: "s3",
        },
      }));
      return;
    }
    if (signedProbeBlockedReason && form.features.healthcheck.mode === "s3") {
      updateFeatures((current) => ({
        ...current,
        healthcheck: {
          ...current.healthcheck,
          mode: "http",
        },
      }));
    }
  }, [
    configurationReadOnly,
    externalSupervisionConfigured,
    form.features.healthcheck.enabled,
    form.features.healthcheck.mode,
    saving,
    signedProbeBlockedReason,
    updateFeatures,
  ]);

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      {routeEndpointLoading ? (
        <WorkflowPage
          title={text("loadingStorageEndpoint")}
          description={text("loadingDescription")}
          breadcrumbs={adminPageBreadcrumbs("storage-endpoints", { label: text("loadingStorageEndpoint") })}
          width="narrow"
        >
          <PageBanner tone="info">{text("loadingConfiguration")}</PageBanner>
        </WorkflowPage>
      ) : routeEndpointMissing ? (
        <WorkflowPage
          title={text("notFound")}
          description={text("notFoundDescription")}
          breadcrumbs={adminPageBreadcrumbs("storage-endpoints", { label: text("notFound") })}
          backLabel={text("backToEndpoints")}
          onBack={() => navigate("/admin/storage-endpoints")}
          width="narrow"
        >
          <PageBanner tone="warning">{text("selectCurrentEndpoint")}</PageBanner>
        </WorkflowPage>
      ) : !showForm ? (
        <>
      <PageHeader
        title={text("s3Endpoints")}
        description={text("pageDescription")}
        breadcrumbs={adminPageBreadcrumbs("storage-endpoints")}
        rightContent={metadataReady && !loading && !envManaged && canEditEndpoints ? <ListActionButton variant="primary" onClick={startCreate}>{text("newEndpoint")}</ListActionButton> : undefined}
      />

      {envManaged && (
        <PageBanner tone="info">
          {text("envManagedBanner")}
        </PageBanner>
      )}
      {!envManaged && !canEditEndpoints && (
        <PageBanner tone="info">
          {text("readOnlyBanner")}
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
        <StorageEndpointEditor key={editingId ?? "create"} title={editorTitle} name={editingEndpoint?.name ?? text("endpointFallback")}
          editing={editingId !== null} readOnly={configurationReadOnly} canEdit={canEditEndpoints}
          ready={metadataReady} dirty={hasFormChanges} busy={saving}
          submitLabel={endpointSubmitLabel} busyLabel={managedProvisioningOnSave ? text("savingAndCreatingIdentities") : undefined}
          onSubmit={handleSubmit} onClose={onCloseForm}>
          {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
          {formError && <PageBanner tone="error">{formError}</PageBanner>}
          {configurationReadOnly && <PageBanner tone="info">
            {text("endpointConfigurationReadOnly", { detail: !metadataReady
              ? text("managementModeUnavailableShort")
              : canEditEndpoints ? text("tagsCanStillUpdate")
                : text("settingsConsultationOnly") })}
          </PageBanner>}
          {endpointTagCatalogError && <PageBanner tone="warning">{endpointTagCatalogError}</PageBanner>}
          <PageTabs tabs={editorTabs.map(tab => ({ ...tab, disabled: saving }))} activeTab={activeTab}
            onChange={tab => setActiveTab(tab as EndpointEditorTab)} variant="line"
            ariaLabel={text("endpointConfigurationSections")} idPrefix="endpoint-editor" />
          <div id={`endpoint-editor-panel-${activeTab}`} role="tabpanel" aria-labelledby={`endpoint-editor-tab-${activeTab}`}>
            {activeTab === "general" && <StorageEndpointConnectionFields form={form} setForm={setForm}
              readOnly={configurationReadOnly} canEditTags={canEditEndpoints} busy={saving}
              catalog={endpointTagCatalog} catalogLoading={endpointTagCatalogLoading} errors={fieldErrors}
              onProviderChange={handleProviderChange} onRegionChange={handleRegionChange} invalidateChecks={invalidateCredentialChecks}
              validationStatus={!configurationReadOnly && cephMode && endpointUrl ? (
                <EndpointHttpStatusBadge checking={featureDetectBusy} check={detection?.http_check} />
              ) : undefined} />}
            {activeTab === "credentials" && <StorageEndpointCredentialsFields form={form} setForm={setForm}
              readOnly={configurationReadOnly} editing={editingId !== null} cephAdminEnabled={cephAdminConfigEnabled} cephAdminActive={editingEndpoint?.ceph_admin_active}
              usersWrite={adminUsersWrite}
              identities={editingEndpoint?.service_identities} reconciling={saving} configurationDirty={hasConfigurationChanges}
              storedAdminAccessKey={editingEndpoint?.admin_access_key}
              onReconcile={editingId !== null && canEditEndpoints ? () => {
                if (hasConfigurationChanges || mutationPending.current) return;
                mutationPending.current = true;
                setFormError(null);
                setSaving(true);
                void runWithStepUp(() => reconcileEndpointIdentities(editingId)).then(async reconciled => {
                  const reconciledForm = createFormFromEndpoint(reconciled);
                  setEndpoints(previous => [...previous.filter(endpoint => endpoint.id !== reconciled.id), reconciled]);
                  setForm(reconciledForm);
                  setFormBaseline(reconciledForm);
                  await loadEndpoints();
                  setValidationRetryKey(previous => previous + 1);
                })
                  .catch(cause => { if (!isRecentWebAuthnVerificationCancelled(cause)) setFormError(extractLocalizedError(cause)); })
                  .finally(() => { mutationPending.current = false; setSaving(false); });
              } : undefined}
              errors={fieldErrors} invalidateChecks={invalidateCredentialChecks} detection={detection} checks={{
                ceph_admin: cephAdminCredentialCheck,
                runtime: runtimeCredentialCheck,
                admin: adminCredentialCheck,
                supervision: supervisionCredentialCheck,
              }} />}
            {activeTab === "capabilities" && <StorageEndpointCapabilitiesFields features={form.features} provider={form.provider}
              region={form.region} readOnly={configurationReadOnly} updateFeatures={updateFeatures}
              invalidateChecks={invalidateCredentialChecks} detecting={featureDetectBusy} detectionError={featureDetectError}
              warnings={featureDetectWarnings} usageUnavailable={showUsageLogUnavailableWarning} signedProbeBlockedReason={signedProbeBlockedReason}
              detectedCapabilities={detection ? { account: detection.account, usage: detection.usage, metrics: detection.metrics } : null} />}
          </div>
        </StorageEndpointEditor>
      )}

      {deleteTarget && (
        <ConfirmActionDialog
          title={text("deleteEndpoint")}
          description={<>{text("deleteConfirm", { name: deleteTarget.name }).split(deleteTarget.name)[0]}<strong>{deleteTarget.name}</strong>{text("deleteConfirm", { name: deleteTarget.name }).split(deleteTarget.name)[1]}</>}
          confirmLabel={text("delete")}
          processingLabel={text("deleting")}
          loading={deleteBusy}
          error={deleteError}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
      {verificationDialog}
    </div>
  );
}
