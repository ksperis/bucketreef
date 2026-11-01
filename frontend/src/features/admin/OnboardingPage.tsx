/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { isApiError } from "../../api/client";
import {
  announceOnboardingStatus,
  applyOnboardingJourney,
  dismissOnboarding,
  resumeOnboarding,
  type OnboardingDraft,
  type OnboardingJourney,
} from "../../api/onboarding";
import { validateAdminS3ConnectionCredentials } from "../../api/s3ConnectionsAdmin";
import {
  type StorageEndpointCredentialCheck,
} from "../../api/storageEndpoints";
import { useSession } from "../../auth/SessionProvider";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { settingsLabels } from "../../components/settings/settingsLabels";
import WorkflowPage, {
  WorkflowActions,
  WorkflowSection,
} from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCardMutedClass,
  uiMutedTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import {
  extractApiErrorCode,
  isRecentWebAuthnRequired,
} from "../../utils/apiError";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import S3CredentialsValidationMessage from "../shared/S3CredentialsValidationMessage";
import { useLiveS3CredentialsValidation } from "../shared/useLiveS3CredentialsValidation";
import { onboardingActions, onboardingCopy as copy, onboardingErrors } from "./onboardingCopy";
import {
  AdminOpsPermissionsBadges,
  CredentialStatusBadge,
  EndpointHttpStatusBadge,
  SupervisionValidationBadges,
} from "./StorageEndpointValidationStatus";
import {
  ADMIN_OPS_FULL_COMMAND,
  CEPH_ADMIN_COMMAND,
  RUNTIME_READ_OPS_COMMAND,
  PRIVATE_S3_USER_COMMAND,
  SUPERVISION_OPS_COMMAND,
} from "./storageEndpointCredentialHelp";
import { useOnboardingStatus } from "./useOnboardingStatus";
import useOnboardingDraftPreview from "./useOnboardingDraftPreview";
import useOnboardingEndpointCatalogue from "./useOnboardingEndpointCatalogue";
import useOnboardingJourneyDraft from "./useOnboardingJourneyDraft";
import { useStorageEndpointLiveValidation } from "./useStorageEndpointLiveValidation";
import { useAdminI18n } from "./adminI18n";
import {
  buildOnboardingApplyCredentials,
  buildOnboardingEndpointValidationPayload,
  buildOnboardingPrivateValidationPayload,
  countOnboardingSelections,
  createOnboardingCredentialDraft,
  createOnboardingDraft,
  hasOnboardingCredentialValues,
  resolveOnboardingEndpointState,
  resolveOnboardingReadiness,
  serviceIdentity,
  type OnboardingCredentialDraft,
  type OnboardingIdentityMode,
} from "./onboardingFormModel";

type Step = "connect" | "prepare" | "credentials" | "review";

class OnboardingReviewChangedError extends Error {
  constructor() {
    super("Onboarding review changed while applying configuration");
    this.name = "OnboardingReviewChangedError";
  }
}

const EMPTY_CREDENTIAL_CHECK: StorageEndpointCredentialCheck = {
  status: "not_configured",
};

function SetupOption({
  title,
  description,
  checked,
  disabled,
  disabledReason,
  recommended,
  experimental,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  recommended?: string;
  experimental?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <UiCheckboxField
      className={cx(
        uiCardMutedClass,
        "min-h-28 w-full items-start gap-3 p-4",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
        checked && !disabled && "outline outline-2 outline-[var(--ui-primary)]",
      )}
      checkboxClassName="mt-0.5 shrink-0"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="ui-body font-semibold text-[var(--ui-text)]">{title}</span>
          {recommended && <UiBadge tone="neutral">{recommended}</UiBadge>}
          {experimental && <UiBadge tone="neutral">{experimental}</UiBadge>}
        </span>
        <span className={cx("mt-1 block ui-caption", uiMutedTextClass)}>{description}</span>
        {disabledReason && (
          <span className="mt-2 block ui-caption text-[var(--ui-warning-text)]">
            {disabledReason}
          </span>
        )}
      </span>
    </UiCheckboxField>
  );
}

function CredentialHelp({ command, note }: { command: string; note?: string }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer ui-caption font-medium">{note}</summary>
      <pre className="mt-2 whitespace-pre-wrap break-all rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3 ui-caption">
        <code>{command}</code>
      </pre>
    </details>
  );
}

function CredentialSection({
  title,
  description,
  accessLabel,
  secretLabel,
  accessKey,
  secretKey,
  required,
  stored,
  command,
  commandHelp,
  storedLabel,
  onAccessChange,
  onSecretChange,
  extraHelp,
  validation,
}: {
  title: string;
  description: string;
  accessLabel: string;
  secretLabel: string;
  accessKey: string;
  secretKey: string;
  required: boolean;
  stored: boolean;
  command?: string;
  commandHelp: string;
  storedLabel: string;
  onAccessChange: (value: string) => void;
  onSecretChange: (value: string) => void;
  extraHelp?: string;
  validation?: ReactNode;
}) {
  return (
    <WorkflowSection title={title} description={description}>
      {validation ? <div className="flex flex-wrap items-center gap-2">{validation}</div> : null}
      {stored ? (
        <UiInlineMessage tone="success">{storedLabel}</UiInlineMessage>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <UiInput
              label={accessLabel}
              type="password"
              autoComplete="off"
              required={required}
              value={accessKey}
              onChange={(event) => onAccessChange(event.target.value)}
            />
            <UiInput
              label={secretLabel}
              type="password"
              autoComplete="new-password"
              required={required}
              value={secretKey}
              onChange={(event) => onSecretChange(event.target.value)}
            />
          </div>
        </>
      )}
      {extraHelp && <p className={cx("mt-3 ui-caption", uiMutedTextClass)}>{extraHelp}</p>}
      {command && <CredentialHelp command={command} note={commandHelp} />}
    </WorkflowSection>
  );
}

function SelectionCount({ count, label }: { count: number; label: string }) {
  return (
    <div className="flex justify-end">
      <UiBadge tone={count > 0 ? "success" : "neutral"}>{label}</UiBadge>
    </div>
  );
}

export default function OnboardingPage() {
  const { text: adminText } = useAdminI18n();
  const { t } = useI18n();
  const navigate = useNavigate();
  const labels = settingsLabels(t);
  const { refresh: refreshSettings } = useGeneralSettings();
  const { refresh: refreshSession } = useSession();
  const {
    status,
    error: statusError,
    refresh: refreshStatus,
    setStatus,
  } = useOnboardingStatus();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp({
    title: t({ en: "Verify with passkey", fr: "Vérifier avec une passkey", de: "Mit Passkey bestätigen", zh: "使用通行密钥验证" }),
    description: t(copy.signIn),
    cancel: t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" }),
  });

  const initialized = useRef(false);
  const [step, setStep] = useState<Step>("connect");
  const workflowTopRef = useRef<HTMLDivElement>(null);
  const previousStepRef = useRef<Step>(step);
  const {
    journey,
    draft,
    dirtyDraft,
    storeJourney,
    persistJourney,
    changeDraft,
    replaceDraft,
    getJourneyId,
  } = useOnboardingJourneyDraft();
  const {
    endpoints,
    error: endpointListError,
    refresh: refreshEndpoints,
  } = useOnboardingEndpointCatalogue(adminText("Unable to load configured endpoints."));
  const [credentialDraft, setCredentialDraft] = useState<OnboardingCredentialDraft>(
    createOnboardingCredentialDraft,
  );
  const [identityMode, setIdentityMode] = useState<OnboardingIdentityMode>("managed");
  const [validationNonce, setValidationNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [internalNavigation, setInternalNavigation] = useState(false);

  const message = useCallback(
    (code: string) => {
      const [key, source] = code.split(":");
      return `${t(onboardingErrors[key] ?? onboardingErrors.generic)}${source ? ` (${source})` : ""}`;
    },
    [t],
  );
  const failure = useCallback(
    (cause: unknown) => {
      if (isRecentWebAuthnRequired(cause)) return t(copy.signIn);
      if (isApiError(cause)) {
        return message(
          extractApiErrorCode(cause) ??
            (cause.response?.status === 422 ? "invalid_configuration" : "generic"),
        );
      }
      return message(
        cause instanceof OnboardingReviewChangedError
          ? "review_changed"
          : "generic",
      );
    },
    [message, t],
  );
  const {
    preview,
    pending: previewPending,
    error: previewError,
    syncPreview,
    invalidatePreview,
    retryPreview,
  } = useOnboardingDraftPreview({
    draft,
    journeyId: journey?.id,
    enabled: step !== "connect" && !journey?.configured && !busy,
    formatError: failure,
  });

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const workflowTop = workflowTopRef.current;
    if (!workflowTop || typeof workflowTop.scrollIntoView !== "function") return;
    workflowTop.scrollIntoView({ block: "start" });
  }, [step]);

  const dirtySecrets = hasOnboardingCredentialValues(credentialDraft);
  const dirty = dirtyDraft || dirtySecrets;
  const {
    adminAccessKey,
    adminSecretKey,
    supervisionAccessKey,
    supervisionSecretKey,
    cephAdminAccessKey,
    cephAdminSecretKey,
    runtimeAccessKey,
    runtimeSecretKey,
    privateAccessKey,
    privateSecretKey,
  } = credentialDraft;
  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === draft.endpoint_id) ?? null,
    [draft.endpoint_id, endpoints],
  );
  useEffect(() => {
    if (selectedEndpoint) {
      setIdentityMode(serviceIdentity(selectedEndpoint, "runtime")?.mode ?? "external");
    }
  }, [selectedEndpoint]);
  const endpointState = useMemo(
    () =>
      resolveOnboardingEndpointState({
        draft,
        selectedEndpoint,
        identityMode,
      }),
    [draft, identityMode, selectedEndpoint],
  );
  const {
    isCeph,
    endpointConfigured,
    storedAdminCredentials,
    storedSupervisionCredentials,
    storedCephAdminCredentials,
    storedRuntimeCredentials,
    needsRuntime,
    needsSupervision,
    needsServiceIdentities,
    needsAdmin,
    managedServicesReady,
    adminCredentialsRequired,
    supervisionCredentialsRequired,
    runtimeCredentialsRequired,
  } = endpointState;
  const selectionCount = countOnboardingSelections(draft);
  const hasSelection = selectionCount > 0;
  const endpointValidationPayload = useMemo(
    () =>
      buildOnboardingEndpointValidationPayload({
        draft,
        selectedEndpoint,
        identityMode,
        state: endpointState,
        credentials: credentialDraft,
      }),
    [
      credentialDraft,
      draft,
      endpointState,
      identityMode,
      selectedEndpoint,
    ],
  );
  const endpointValidation = useStorageEndpointLiveValidation({
    enabled: Boolean(endpointValidationPayload),
    payload: endpointValidationPayload,
    retryKey: validationNonce,
  });
  const adminCredentialCheck =
    endpointValidation.result?.credential_checks?.admin ?? EMPTY_CREDENTIAL_CHECK;
  const supervisionCredentialCheck =
    endpointValidation.result?.credential_checks?.supervision ?? EMPTY_CREDENTIAL_CHECK;
  const cephAdminCredentialCheck = endpointValidation.result?.credential_checks?.ceph_admin ?? EMPTY_CREDENTIAL_CHECK;
  const runtimeCredentialCheck =
    endpointValidation.result?.credential_checks?.runtime ?? EMPTY_CREDENTIAL_CHECK;
  useEffect(() => {
    if (needsServiceIdentities && adminCredentialCheck.status === "valid" && !endpointValidation.result?.admin_ops_permissions.users_write && !managedServicesReady) setIdentityMode("external");
  }, [needsServiceIdentities, adminCredentialCheck.status, endpointValidation.result?.admin_ops_permissions.users_write, managedServicesReady]);
  const privateValidationPayload = useMemo(
    () =>
      buildOnboardingPrivateValidationPayload({
        draft,
        state: endpointState,
        credentials: credentialDraft,
      }),
    [credentialDraft, draft, endpointState],
  );
  const privateValidation = useLiveS3CredentialsValidation({
    enabled: Boolean(privateValidationPayload),
    payload: privateValidationPayload,
    validate: validateAdminS3ConnectionCredentials,
  });
  const {
    endpointReachable,
    invalidSelection,
    validationPending,
    canReview,
    canApply,
  } = resolveOnboardingReadiness({
    draft,
    identityMode,
    state: endpointState,
    credentials: credentialDraft,
    endpointValidation,
    privateValidation: {
      status: privateValidation.status,
      ok: privateValidation.result?.ok === true,
    },
    preview: {
      value: preview,
      pending: previewPending,
      error: previewError,
    },
  });

  const store = useCallback((value: OnboardingJourney) => {
    storeJourney(value);
    syncPreview(value.preview);
  }, [storeJourney, syncPreview]);

  useEffect(() => {
    if (!status || status.dismissed || initialized.current) return;
    initialized.current = true;
    const current = status.journeys.find((item) => !item.configured);
    if (current) {
      store(current);
      setStep("prepare");
    }
  }, [status, store]);

  const clearSecrets = () => setCredentialDraft(createOnboardingCredentialDraft());

  const changeCredential = (field: keyof OnboardingCredentialDraft, value: string) => {
    setCredentialDraft((current) => ({ ...current, [field]: value }));
  };

  const change = (patch: Partial<OnboardingDraft>) => {
    changeDraft(patch);
    invalidatePreview(step !== "connect");
  };

  const selectEndpoint = (value: string) => {
    clearSecrets();
    invalidatePreview(step !== "connect");
    if (value === "new") {
      replaceDraft(createOnboardingDraft());
      return;
    }
    const endpointId = Number(value);
    const endpoint = endpoints.find((candidate) => candidate.id === endpointId);
    if (endpoint) {
      replaceDraft(createOnboardingDraft(endpoint));
    }
  };

  const persist = async (value = draft) => {
    const saved = await persistJourney(value);
    syncPreview(saved.preview);
    if (status?.complete) {
      const nextStatus = await refreshStatus();
      if (nextStatus) announceOnboardingStatus(nextStatus);
    }
    return saved;
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (isRecentWebAuthnVerificationCancelled(cause)) return;
      setError(failure(cause));
      const [latest] = await Promise.all([refreshStatus(), refreshEndpoints()]);
      const saved = latest?.journeys.find((item) => item.id === getJourneyId());
      if (saved) store(saved);
      retryPreview();
    } finally {
      setBusy(false);
    }
  };

  const goPrepare = () =>
    run(async () => {
      if (!endpointReachable) return;
      await persist();
      setStep("prepare");
    });

  const goCredentials = () =>
    run(async () => {
      if (!hasSelection) return;
      await persist();
      setStep("credentials");
    });

  const goReview = () =>
    run(async () => {
      if (!canReview) return;
      await persist();
      setStep("review");
    });

  const configure = () =>
    run(async () => {
      if (!canApply || !preview) return;
      const reviewed = preview.review_token;
      const saved = await persist();
      if (saved.preview.review_token !== reviewed) throw new OnboardingReviewChangedError();
      const result = await runWithStepUp(() =>
        applyOnboardingJourney(
          saved,
          buildOnboardingApplyCredentials({
            draft,
            identityMode,
            state: endpointState,
            credentials: credentialDraft,
          }),
        ),
      );
      store(result);
      clearSecrets();
      await Promise.all([refreshSettings(), refreshSession()]);
      notifyExecutionContextsRefresh();
      const nextStatus = await refreshStatus();
      if (nextStatus) announceOnboardingStatus(nextStatus);
      flushSync(() => setInternalNavigation(true));
      navigate("/admin", { replace: true });
    });

  const hideSetup = () =>
    run(async () => {
      if (journey || dirtyDraft) await persist();
      const next = await dismissOnboarding();
      setStatus(next);
      flushSync(() => setInternalNavigation(true));
      navigate("/admin");
    });

  if (!status) {
    return (
      <WorkflowPage
        title={t(copy.title)}
        description={t(copy.description)}
        width="standard"
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: t(copy.title) }]}
      >
        <p role="status">{statusError ?? t({ en: "Loading…", fr: "Chargement…", de: "Laden…", zh: "加载中…" })}</p>
      </WorkflowPage>
    );
  }

  if (status.dismissed) {
    return (
      <WorkflowPage
        title={t(copy.title)}
        description={t(copy.description)}
        width="standard"
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: t(copy.title) }]}
      >
        <WorkflowSection title={t(copy.hiddenTitle)} description={t(copy.hiddenDescription)}>
          <WorkflowActions>
            <UiButton
              onClick={() =>
                void run(async () => {
                  initialized.current = false;
                  const next = await resumeOnboarding();
                  setStatus(next);
                })
              }
            >
              {t(copy.showSetup)}
            </UiButton>
            <Link to="/admin" className="text-primary underline">{t(copy.admin)}</Link>
          </WorkflowActions>
        </WorkflowSection>
        {verificationDialog}
      </WorkflowPage>
    );
  }

  if (journey?.configured) {
    return (
      <WorkflowPage
        title={t(copy.title)}
        description={t(copy.description)}
        width="standard"
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: t(copy.title) }]}
      >
        <WorkflowSection title={t(copy.successTitle)} description={t(copy.successDescription)}>
          <div className="mb-4"><UiBadge tone="success">{t(copy.available)}</UiBadge></div>
          <WorkflowActions>
            {journey.links.manager && <Link className="text-primary underline" to={journey.links.manager}>{t(copy.openManager)}</Link>}
            {journey.links.portal && <Link className="text-primary underline" to={journey.links.portal}>{t(copy.openPortal)}</Link>}
            {journey.links.browser && <Link className="text-primary underline" to={journey.links.browser}>{t(copy.openBrowser)}</Link>}
            {journey.links.private_manager && <Link className="text-primary underline" to={journey.links.private_manager}>{t(copy.openPrivateManager)}</Link>}
            {journey.links.ceph_admin && <Link className="text-primary underline" to={journey.links.ceph_admin}>{t(copy.openCephAdmin)}</Link>}
            <Link to="/admin" className="text-primary underline">{t(copy.admin)}</Link>
          </WorkflowActions>
        </WorkflowSection>
        {verificationDialog}
      </WorkflowPage>
    );
  }

  return (
    <WorkflowPage
      title={t(copy.title)}
      description={t(copy.description)}
      width="standard"
      breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: t(copy.title) }]}
    >
      <div className="space-y-4" aria-busy={busy}>
        <p className={uiMutedTextClass}>{t(copy.optional)}</p>
        {(statusError || endpointListError) && (
          <UiInlineMessage tone="error">{statusError || endpointListError}</UiInlineMessage>
        )}
        {error && (
          <UiInlineMessage tone="error">
            {error}{" "}
            <UiButton
              variant="ghost"
              onClick={() => {
                retryPreview();
                setValidationNonce((value) => value + 1);
              }}
            >
              {t(copy.retry)}
            </UiButton>
          </UiInlineMessage>
        )}
        {!status.can_configure && (
          <UiInlineMessage tone="warning">{message("superadmin_required")}</UiInlineMessage>
        )}

        <div ref={workflowTopRef}>
          <WorkflowTabs
            activeTab={step}
            onTabChange={setStep}
            ariaLabel={t(copy.title)}
            tabs={[
              { id: "connect", label: t(copy.connectStep), disabled: busy },
              {
                id: "prepare",
                label: t(copy.prepareStep),
                disabled: busy || !journey,
              },
              {
                id: "credentials",
                label: t(copy.credentialsStep),
                disabled: busy || !journey || !hasSelection,
              },
              {
                id: "review",
                label: t(copy.reviewStep),
                disabled: busy || !journey || !canReview,
              },
            ]}
          >
          {step === "connect" && (
            <fieldset disabled={busy || !status.can_configure} className="space-y-4">
              <WorkflowSection title={t(copy.endpointTitle)} description={t(copy.endpointHelp)}>
                <div className="space-y-4">
                  <UiSelect
                    label={t(copy.endpointChoice)}
                    value={draft.endpoint_id ? String(draft.endpoint_id) : "new"}
                    onChange={(event) => selectEndpoint(event.target.value)}
                  >
                    <option value="new">{t(copy.newEndpoint)}</option>
                    {endpoints.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.name} · {endpoint.provider.toUpperCase()}
                      </option>
                    ))}
                  </UiSelect>

                  {!draft.endpoint_id && (
                    <>
                      <UiInput
                        label={t(copy.endpointUrl)}
                        type="url"
                        required
                        placeholder="https://s3.example.com"
                        value={draft.endpoint_url}
                        onChange={(event) => change({ endpoint_url: event.target.value })}
                      />
                      <details>
                        <summary className="cursor-pointer ui-body">{t(copy.advanced)}</summary>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <UiInput
                            label={t(copy.region)}
                            value={draft.region}
                            onChange={(event) => change({ region: event.target.value })}
                          />
                          <UiSelect
                            label={t(copy.addressStyle)}
                            value={draft.force_path_style ? "path" : "host"}
                            onChange={(event) =>
                              change({ force_path_style: event.target.value === "path" })
                            }
                          >
                            <option value="path">{t(copy.pathStyle)}</option>
                            <option value="host">{t(copy.virtualHost)}</option>
                          </UiSelect>
                        </div>
                      </details>
                    </>
                  )}
                  {endpointConfigured && (
                    <div className="flex flex-wrap items-center gap-2">
                      <EndpointHttpStatusBadge
                        checking={endpointValidation.status === "loading"}
                        check={endpointValidation.result?.http_check}
                      />
                    </div>
                  )}
                  {endpointValidation.error && (
                    <UiInlineMessage tone="error">{endpointValidation.error}</UiInlineMessage>
                  )}
                </div>
              </WorkflowSection>

              <WorkflowActions>
                <UiButton
                  onClick={() => void goPrepare()}
                  disabled={!endpointReachable || endpointValidation.status === "loading" || busy}
                >
                  {t(copy.continue)}
                </UiButton>
                <UiButton variant="ghost" onClick={() => void hideSetup()}>{t(copy.dismiss)}</UiButton>
              </WorkflowActions>
            </fieldset>
          )}

          {step === "prepare" && (
            <fieldset disabled={busy || !status.can_configure} className="space-y-4">
              <WorkflowSection title={t(copy.prepareTitle)} description={t(copy.prepareHelp)}>
                <SelectionCount
                  count={selectionCount}
                  label={`${selectionCount} ${t(copy.optionsSelected)}`}
                />
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <SetupOption
                    title={t(copy.managerTitle)}
                    description={t(copy.managerDesc)}
                    checked={draft.manager}
                    disabled={!isCeph}
                    disabledReason={!isCeph ? t(onboardingErrors.ceph_endpoint_required) : undefined}
                    recommended={isCeph ? t(copy.recommended) : undefined}
                    onChange={(manager) => change({ manager })}
                  />
                  <SetupOption
                    title={t(copy.portalTitle)}
                    description={t(copy.portalDesc)}
                    checked={draft.portal}
                    disabled={!isCeph}
                    disabledReason={!isCeph ? t(onboardingErrors.ceph_endpoint_required) : undefined}
                    experimental={t(copy.experimental)}
                    onChange={(portal) => change({ portal })}
                  />
                  <SetupOption
                    title={t(copy.privateTitle)}
                    description={t(copy.privateDesc)}
                    checked={draft.private_connection}
                    disabled={false}
                    onChange={(private_connection) => change({ private_connection })}
                  />
                  <SetupOption
                    title={t(copy.supervisionTitle)}
                    description={t(copy.supervisionDesc)}
                    checked={draft.supervision}
                    disabled={!isCeph}
                    disabledReason={!isCeph ? t(onboardingErrors.ceph_endpoint_required) : undefined}
                    recommended={isCeph ? t(copy.recommended) : undefined}
                    onChange={(supervision) => change({ supervision })}
                  />
                  <SetupOption
                    title={t(copy.cephTitle)}
                    description={t(copy.cephDesc)}
                    checked={draft.ceph_admin}
                    disabled={!isCeph}
                    disabledReason={!isCeph ? t(onboardingErrors.ceph_endpoint_required) : undefined}
                    onChange={(ceph_admin) => change({ ceph_admin })}
                  />
                </div>
              </WorkflowSection>

              {!isCeph && (
                <UiInlineMessage tone="info">{t(copy.genericEndpointHelp)}</UiInlineMessage>
              )}
              {!hasSelection && (
                <UiInlineMessage tone="warning">{message("selection_required")}</UiInlineMessage>
              )}

              <WorkflowActions>
                <UiButton variant="secondary" onClick={() => setStep("connect")}>{t(copy.back)}</UiButton>
                <UiButton onClick={() => void goCredentials()} disabled={!hasSelection || invalidSelection}>
                  {t(copy.continue)}
                </UiButton>
                <UiButton variant="ghost" onClick={() => void hideSetup()}>{t(copy.dismiss)}</UiButton>
              </WorkflowActions>
            </fieldset>
          )}

          {step === "credentials" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void goReview();
              }}
            >
              <fieldset disabled={busy || !status.can_configure} className="space-y-4">
                <WorkflowSection title={t(copy.credentialsTitle)} description={t(copy.credentialsHelp)}>
                  <p className={uiMutedTextClass}>{t(copy.credentialsIntro)}</p>
                  <p className={cx("ui-caption", uiMutedTextClass)}>{t(copy.keysNotSaved)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <EndpointHttpStatusBadge
                      checking={endpointValidation.status === "loading"}
                      check={endpointValidation.result?.http_check}
                    />
                  </div>
                  {endpointValidation.error && (
                    <UiInlineMessage tone="error">{endpointValidation.error}</UiInlineMessage>
                  )}
                </WorkflowSection>

                {needsAdmin && (
                  <CredentialSection
                    title={t(copy.adminCredentials)}
                    description={t(copy.adminCredentialsHelp)}
                    accessLabel={t(copy.adminAccessKey)}
                    secretLabel={t(copy.adminSecretKey)}
                    accessKey={adminAccessKey}
                    secretKey={adminSecretKey}
                    required={adminCredentialsRequired}
                    stored={storedAdminCredentials}
                    command={ADMIN_OPS_FULL_COMMAND}
                    commandHelp={t(copy.rgwCommandHelp)}
                    storedLabel={t(copy.storedCredentials)}
                    onAccessChange={(value) => changeCredential("adminAccessKey", value)}
                    onSecretChange={(value) => changeCredential("adminSecretKey", value)}
                    validation={
                      <>
                        <CredentialStatusBadge
                          status={
                            endpointValidation.status === "loading"
                              ? "checking"
                              : adminCredentialCheck.status
                          }
                          message={adminCredentialCheck.message}
                        />
                        {endpointValidation.status === "done" &&
                          adminCredentialCheck.status === "misconfigured" &&
                          adminCredentialCheck.message && (
                            <UiInlineMessage tone="error">
                              {adminCredentialCheck.message}
                            </UiInlineMessage>
                          )}
                        {endpointValidation.status === "done" &&
                          adminCredentialCheck.status === "valid" && (
                            <>
                              <AdminOpsPermissionsBadges
                                permissions={endpointValidation.result?.admin_ops_permissions}
                              />
                              <UiBadge
                                tone={endpointValidation.result?.account ? "success" : "danger"}
                              >
                                {t(copy.accountApi)} ·{" "}
                                {t(
                                  endpointValidation.result?.account
                                    ? copy.available
                                    : copy.unavailable,
                                )}
                              </UiBadge>
                            </>
                          )}
                      </>
                    }
                  />
                )}

                {needsServiceIdentities && <WorkflowSection title={adminText("Service identities")} description={adminText("Runtime Read Ops supports Manager and Portal. Supervision Ops supports monitoring. Only selected workflows require these identities.")}>
                  <UiSelect label={adminText("Identity management")} value={identityMode} onChange={event => setIdentityMode(event.target.value as OnboardingIdentityMode)}>
                    <option value="managed" disabled={adminCredentialCheck.status === "valid" && !endpointValidation.result?.admin_ops_permissions.users_write && !managedServicesReady}>{adminText("Managed by BucketReef")}</option>
                    <option value="external">{adminText("Provided externally")}</option>
                  </UiSelect>
                  {identityMode === "managed" && <UiInlineMessage tone="info">{adminText("The identities required by selected workflows are created and functionally validated when you apply this setup. Generated secrets remain hidden. Usage is checked with Supervision when monitoring is selected.")}</UiInlineMessage>}
                </WorkflowSection>}
                {needsSupervision && identityMode === "external" && (
                  <CredentialSection
                    title={t(copy.supervisionCredentials)}
                    description={t(copy.supervisionCredentialsHelp)}
                    accessLabel={t(copy.supervisionAccessKey)}
                    secretLabel={t(copy.supervisionSecretKey)}
                    accessKey={supervisionAccessKey}
                    secretKey={supervisionSecretKey}
                    required={supervisionCredentialsRequired}
                    stored={storedSupervisionCredentials}
                    command={SUPERVISION_OPS_COMMAND}
                    commandHelp={t(copy.rgwCommandHelp)}
                    storedLabel={t(copy.storedCredentials)}
                    onAccessChange={(value) => changeCredential("supervisionAccessKey", value)}
                    onSecretChange={(value) => changeCredential("supervisionSecretKey", value)}
                    validation={
                      <>
                        <CredentialStatusBadge
                          status={
                            endpointValidation.status === "loading"
                              ? "checking"
                              : supervisionCredentialCheck.status
                          }
                          message={supervisionCredentialCheck.message}
                        />
                        {endpointValidation.status === "done" &&
                          supervisionCredentialCheck.status === "valid" && (
                            <SupervisionValidationBadges
                              metrics={Boolean(endpointValidation.result?.metrics)}
                              usage={Boolean(endpointValidation.result?.usage)}
                              metricsError={endpointValidation.result?.metrics_error}
                              usageError={endpointValidation.result?.usage_error}
                            />
                          )}
                      </>
                    }
                  />
                )}

                {needsRuntime && identityMode === "external" && (
                  <CredentialSection
                    title={adminText("Runtime Read Ops")}
                    description={adminText("accounts=read;user-info-without-keys=read;buckets=read, without admin/system flags.")}
                    accessLabel="Runtime access key"
                    secretLabel="Runtime secret key"
                    accessKey={runtimeAccessKey}
                    secretKey={runtimeSecretKey}
                    required={runtimeCredentialsRequired}
                    stored={storedRuntimeCredentials}
                    command={RUNTIME_READ_OPS_COMMAND}
                    commandHelp={t(copy.rgwCommandHelp)}
                    storedLabel={t(copy.storedCredentials)}
                    onAccessChange={(value) => changeCredential("runtimeAccessKey", value)}
                    onSecretChange={(value) => changeCredential("runtimeSecretKey", value)}
                    validation={
                      <CredentialStatusBadge
                        status={
                          endpointValidation.status === "loading"
                            ? "checking"
                            : runtimeCredentialCheck.status
                        }
                        message={runtimeCredentialCheck.message}
                      />
                    }
                  />
                )}

                {draft.ceph_admin && <CredentialSection
                  title="Ceph Admin" description={adminText("Keys from an externally configured RGW user with admin=true and system=false.")}
                  accessLabel="Ceph Admin access key" secretLabel="Ceph Admin secret key"
                  accessKey={cephAdminAccessKey} secretKey={cephAdminSecretKey}
                  required={!storedCephAdminCredentials} stored={storedCephAdminCredentials}
                  command={CEPH_ADMIN_COMMAND} commandHelp={t(copy.rgwCommandHelp)} storedLabel={t(copy.storedCredentials)}
                  onAccessChange={(value) => changeCredential("cephAdminAccessKey", value)}
                  onSecretChange={(value) => changeCredential("cephAdminSecretKey", value)}
                  validation={<CredentialStatusBadge status={endpointValidation.status === "loading" ? "checking" : cephAdminCredentialCheck.status} message={cephAdminCredentialCheck.message} />}
                />}
                {draft.private_connection && (
                  <CredentialSection
                    title={t(copy.privateCredentials)}
                    description={t(copy.privateCredentialsHelp)}
                    accessLabel={t(copy.privateAccessKey)}
                    secretLabel={t(copy.privateSecretKey)}
                    accessKey={privateAccessKey}
                    secretKey={privateSecretKey}
                    required
                    stored={false}
                    command={isCeph ? PRIVATE_S3_USER_COMMAND : undefined}
                    commandHelp={t(copy.rgwCommandHelp)}
                    storedLabel={t(copy.storedCredentials)}
                    extraHelp={isCeph ? t(copy.privatePermissionsHelp) : undefined}
                    onAccessChange={(value) => changeCredential("privateAccessKey", value)}
                    onSecretChange={(value) => changeCredential("privateSecretKey", value)}
                    validation={
                      privateValidation.status !== "idle" ? (
                        <S3CredentialsValidationMessage validation={privateValidation} />
                      ) : undefined
                    }
                  />
                )}

                <WorkflowActions>
                  <UiButton variant="secondary" onClick={() => setStep("prepare")}>{t(copy.back)}</UiButton>
                  <UiButton type="submit" disabled={!canReview || validationPending}>
                    {t(copy.continue)}
                  </UiButton>
                  <UiButton variant="ghost" onClick={() => void hideSetup()}>{t(copy.dismiss)}</UiButton>
                </WorkflowActions>
              </fieldset>
            </form>
          )}

          {step === "review" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void configure();
              }}
            >
              <fieldset disabled={busy || !status.can_configure} className="space-y-4">
                <WorkflowSection title={t(copy.reviewTitle)} description={t(copy.reviewHelp)}>
                  <div className="space-y-2">
                    <EndpointHttpStatusBadge
                      checking={endpointValidation.status === "loading"}
                      check={endpointValidation.result?.http_check}
                    />
                    {(draft.manager || draft.portal) && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="ui-caption font-semibold text-[var(--ui-text)]">
                          {t(copy.adminCredentials)}
                        </span>
                        <CredentialStatusBadge
                          status={adminCredentialCheck.status}
                          message={adminCredentialCheck.message}
                        />
                        <AdminOpsPermissionsBadges
                          permissions={endpointValidation.result?.admin_ops_permissions}
                        />
                        <UiBadge tone={endpointValidation.result?.account ? "success" : "danger"}>
                          {t(copy.accountApi)} ·{" "}
                          {t(endpointValidation.result?.account ? copy.available : copy.unavailable)}
                        </UiBadge>
                      </div>
                    )}
                    {draft.supervision && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="ui-caption font-semibold text-[var(--ui-text)]">
                          {t(copy.supervisionCredentials)}
                        </span>
                        <CredentialStatusBadge
                          status={supervisionCredentialCheck.status}
                          message={supervisionCredentialCheck.message}
                        />
                        <SupervisionValidationBadges
                          metrics={Boolean(endpointValidation.result?.metrics)}
                          usage={Boolean(endpointValidation.result?.usage)}
                          metricsError={endpointValidation.result?.metrics_error}
                          usageError={endpointValidation.result?.usage_error}
                        />
                      </div>
                    )}
                    {draft.ceph_admin && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="ui-caption font-semibold text-[var(--ui-text)]">
                          {adminText("Ceph Admin credentials")}</span>
                        <CredentialStatusBadge
                          status={cephAdminCredentialCheck.status}
                          message={cephAdminCredentialCheck.message}
                        />
                      </div>
                    )}
                  </div>
                  {draft.private_connection && (
                    <div className="space-y-1.5">
                      <span className="ui-caption font-semibold text-[var(--ui-text)]">
                        {t(copy.privateCredentials)}
                      </span>
                      <S3CredentialsValidationMessage validation={privateValidation} />
                    </div>
                  )}
                  {endpointValidation.result?.warnings.map((warning) => (
                    <UiInlineMessage tone="warning" key={warning}>
                      {warning}
                    </UiInlineMessage>
                  ))}
                </WorkflowSection>

                <section
                  className={cx(uiCardMutedClass, "space-y-3 p-4")}
                  aria-label={t(copy.summary)}
                  aria-busy={previewPending}
                >
                  <div>
                    <h2 className="ui-subtitle">{t(copy.summary)}</h2>
                    <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>{t(copy.summaryHelp)}</p>
                  </div>
                  {previewPending || !preview ? (
                    <p role="status" className={uiMutedTextClass}>{t(copy.previewing)}</p>
                  ) : (
                    <>
                      {preview.features.length + preview.changes.length === 0 && <p>{t(copy.noChanges)}</p>}
                      {preview.features.length + preview.changes.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 ui-body">
                          {[...preview.features, ...preview.changes].map((item) => (
                            <li key={item}>{t(onboardingActions[item] ?? copy.summaryHelp)}</li>
                          ))}
                        </ul>
                      )}
                      {preview.blockers.length > 0 && (
                        <UiInlineMessage tone="warning">
                          {preview.blockers.map((item) => (
                            <span className="block" key={item}>{message(item)}</span>
                          ))}
                        </UiInlineMessage>
                      )}
                    </>
                  )}
                  {previewError && (
                    <UiInlineMessage tone="error">
                      {previewError}{" "}
                      <UiButton variant="ghost" onClick={retryPreview}>
                        {t(copy.retry)}
                      </UiButton>
                    </UiInlineMessage>
                  )}
                </section>

                <WorkflowActions>
                  <UiButton variant="secondary" onClick={() => setStep("credentials")}>{t(copy.back)}</UiButton>
                  <UiButton type="submit" loading={busy} disabled={!canApply}>
                    {t(busy ? copy.working : copy.apply)}
                  </UiButton>
                  <UiButton variant="ghost" onClick={() => void hideSetup()}>{t(copy.dismiss)}</UiButton>
                </WorkflowActions>
              </fieldset>
            </form>
          )}
          </WorkflowTabs>
        </div>

        {verificationDialog}
        <SettingsNavigationGuard
          dirty={!internalNavigation && (dirty || busy)}
          discardDisabled={busy}
          title={busy ? t(copy.working) : labels.discardTitle}
          description={
            busy
              ? t({ en: "Wait for the current operation to finish before leaving.", fr: "Attendez la fin de l’opération avant de quitter la page.", de: "Warten Sie, bis der Vorgang abgeschlossen ist.", zh: "请等待当前操作完成后再离开。" })
              : t({ en: "Entered keys are not saved. Leave this setup?", fr: "Les clés saisies ne sont pas enregistrées. Quitter cette configuration ?", de: "Eingegebene Schlüssel werden nicht gespeichert. Einrichtung verlassen?", zh: "输入的密钥不会保存。要离开此设置吗？" })
          }
          confirmLabel={labels.discard}
          cancelLabel={labels.keepEditing}
          closeLabel={labels.close}
        />
      </div>
    </WorkflowPage>
  );
}
