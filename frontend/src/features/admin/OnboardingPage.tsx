/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { isApiError } from "../../api/client";
import {
  announceOnboardingStatus,
  applyOnboardingJourney,
  dismissOnboarding,
  previewOnboardingDraft,
  resumeOnboarding,
  saveOnboardingJourney,
  type OnboardingDraft,
  type OnboardingJourney,
  type OnboardingPreview,
} from "../../api/onboarding";
import {
  detectStorageEndpointFeatures,
  listStorageEndpoints,
  type StorageEndpoint,
  type StorageEndpointFeatureDetectionResult,
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
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCardMutedClass,
  uiCheckboxClass,
  uiMutedTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import {
  extractApiError,
  isCancelledError,
  isRecentWebAuthnRequired,
} from "../../utils/apiError";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import { onboardingActions, onboardingCopy as copy, onboardingErrors } from "./onboardingCopy";
import { useOnboardingStatus } from "./useOnboardingStatus";

type Step = "connect" | "prepare";

const initialDraft = (): OnboardingDraft => ({
  version: 2,
  endpoint_id: null,
  endpoint_url: "",
  region: "",
  force_path_style: true,
  manager: false,
  portal: false,
  private_connection: false,
  ceph_admin: false,
});

function validEndpointUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function SetupOption({
  title,
  description,
  checked,
  disabled,
  disabledReason,
  recommended,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  recommended?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cx(
        uiCardMutedClass,
        "block min-h-28 p-4",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
        checked && !disabled && "outline outline-2 outline-[var(--ui-primary)]",
      )}
    >
      <span className="flex items-start gap-3">
        <input
          type="checkbox"
          className={cx(uiCheckboxClass, "mt-0.5")}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="ui-body font-semibold text-[var(--ui-text)]">{title}</span>
            {recommended && <UiBadge tone="neutral">{recommended}</UiBadge>}
          </span>
          <span className={cx("mt-1 block ui-caption", uiMutedTextClass)}>{description}</span>
          {disabledReason && (
            <span className="mt-2 block ui-caption text-[var(--ui-warning-text)]">
              {disabledReason}
            </span>
          )}
        </span>
      </span>
    </label>
  );
}

function Capability({
  label,
  available,
  detail,
  availableLabel,
  unavailableLabel,
}: {
  label: string;
  available: boolean;
  detail?: string | null;
  availableLabel: string;
  unavailableLabel: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-1.5">
      <span className="ui-body">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {detail && <span className={cx("truncate ui-caption", uiMutedTextClass)}>{detail}</span>}
        <UiBadge tone={available ? "success" : "neutral"}>
          {available ? availableLabel : unavailableLabel}
        </UiBadge>
      </span>
    </div>
  );
}

export default function OnboardingPage() {
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
  const id = useRef<string>(crypto.randomUUID());
  const [step, setStep] = useState<Step>("connect");
  const [journey, setJourney] = useState<OnboardingJourney | null>(null);
  const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialDraft()));
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [endpointListError, setEndpointListError] = useState("");
  const [endpointAccessKey, setEndpointAccessKey] = useState("");
  const [endpointSecretKey, setEndpointSecretKey] = useState("");
  const [privateAccessKey, setPrivateAccessKey] = useState("");
  const [privateSecretKey, setPrivateSecretKey] = useState("");
  const [detection, setDetection] = useState<StorageEndpointFeatureDetectionResult | null>(null);
  const [detectionPending, setDetectionPending] = useState(false);
  const [detectionError, setDetectionError] = useState("");
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [internalNavigation, setInternalNavigation] = useState(false);

  const dirtyDraft = JSON.stringify(draft) !== baseline;
  const dirtySecrets = Boolean(
    endpointAccessKey || endpointSecretKey || privateAccessKey || privateSecretKey,
  );
  const dirty = dirtyDraft || dirtySecrets;
  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === draft.endpoint_id) ?? null,
    [draft.endpoint_id, endpoints],
  );
  const isCeph = draft.endpoint_id ? selectedEndpoint?.provider === "ceph" : true;
  const endpointConfigured = Boolean(
    draft.endpoint_id || (draft.endpoint_url && validEndpointUrl(draft.endpoint_url)),
  );
  const endpointCredentialsPartial = Boolean(endpointAccessKey) !== Boolean(endpointSecretKey);
  const canAccount = Boolean(isCeph && detection?.admin && detection?.account);
  const canCephAdmin = Boolean(
    isCeph && detection?.credential_checks.ceph_admin.status === "valid",
  );
  const hasSelection =
    draft.manager || draft.portal || draft.private_connection || draft.ceph_admin;

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
        const detail = cause.response?.data?.detail as { code?: string } | undefined;
        return message(
          detail?.code ??
            (cause.response?.status === 422 ? "invalid_configuration" : "generic"),
        );
      }
      return message(
        cause instanceof Error && cause.message === "review_changed"
          ? "review_changed"
          : "generic",
      );
    },
    [message, t],
  );

  const store = useCallback((value: OnboardingJourney) => {
    id.current = value.id;
    setJourney(value);
    setDraft(value.draft);
    setBaseline(JSON.stringify(value.draft));
    setPreview(value.preview);
    setPreviewPending(false);
    setPreviewError("");
  }, []);

  useEffect(() => {
    if (!status || status.dismissed || initialized.current) return;
    initialized.current = true;
    const current = status.journeys.find((item) => !item.configured);
    if (current) {
      store(current);
      setStep("prepare");
    }
  }, [status, store]);

  useEffect(() => {
    let active = true;
    listStorageEndpoints()
      .then((value) => {
        if (active) {
          setEndpoints(value);
          setEndpointListError("");
        }
      })
      .catch((cause) => {
        if (active) {
          setEndpointListError(
            extractApiError(cause, "Unable to load configured endpoints."),
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const endpoint = selectedEndpoint;
    if (endpoint && endpoint.provider !== "ceph") {
      setDetection(null);
      setDetectionPending(false);
      setDetectionError("");
      return;
    }
    const url = endpoint?.endpoint_url ?? draft.endpoint_url;
    if (!url || (!endpoint && !validEndpointUrl(url)) || endpointCredentialsPartial) {
      setDetection(null);
      setDetectionPending(false);
      setDetectionError("");
      return;
    }

    const controller = new AbortController();
    setDetectionPending(true);
    setDetectionError("");
    const timer = window.setTimeout(() => {
      detectStorageEndpointFeatures({
        endpoint_id: endpoint?.id ?? null,
        endpoint_url: url,
        region: (endpoint?.region ?? draft.region) || null,
        verify_tls: endpoint?.verify_tls ?? true,
        admin_access_key: endpoint ? null : endpointAccessKey || null,
        admin_secret_key: endpoint ? null : endpointSecretKey || null,
        ceph_admin_access_key: endpoint ? null : endpointAccessKey || null,
        ceph_admin_secret_key: endpoint ? null : endpointSecretKey || null,
      })
        .then((value) => {
          if (!controller.signal.aborted) {
            setDetection(value);
            setDetectionPending(false);
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted && !isCancelledError(cause)) {
            setDetection(null);
            setDetectionPending(false);
            setDetectionError(
              extractApiError(cause, "Endpoint capabilities could not be checked."),
            );
          }
        });
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    draft.endpoint_url,
    draft.region,
    endpointAccessKey,
    endpointCredentialsPartial,
    endpointSecretKey,
    selectedEndpoint,
  ]);

  useEffect(() => {
    if (step !== "prepare" || journey?.configured || busy) return;
    const controller = new AbortController();
    setPreviewPending(true);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      previewOnboardingDraft(draft, controller.signal, journey?.id)
        .then((value) => {
          if (!controller.signal.aborted) {
            setPreview(value);
            setPreviewPending(false);
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted && !isCancelledError(cause)) {
            setPreviewError(failure(cause));
            setPreviewPending(false);
          }
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [busy, draft, failure, journey?.configured, journey?.id, previewNonce, step]);

  const clearSecrets = () => {
    setEndpointAccessKey("");
    setEndpointSecretKey("");
    setPrivateAccessKey("");
    setPrivateSecretKey("");
  };

  const change = (patch: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(null);
    setPreviewPending(step === "prepare");
  };

  const selectEndpoint = (value: string) => {
    clearSecrets();
    setDetection(null);
    setDetectionError("");
    setPreview(null);
    if (value === "new") {
      change({
        endpoint_id: null,
        endpoint_url: "",
        region: "",
        force_path_style: true,
        manager: false,
        portal: false,
        private_connection: false,
        ceph_admin: false,
      });
      return;
    }
    const endpointId = Number(value);
    change({
      endpoint_id: endpointId,
      endpoint_url: "",
      region: "",
      force_path_style: true,
      manager: false,
      portal: false,
      private_connection: false,
      ceph_admin: false,
    });
  };

  const persist = async (value = draft) => {
    const saved = await saveOnboardingJourney(id.current, value, journey?.revision);
    store(saved);
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
      const latest = await refreshStatus();
      const saved = latest?.journeys.find((item) => item.id === id.current);
      if (saved) store(saved);
      setPreviewNonce((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const goPrepare = () =>
    run(async () => {
      let next = draft;
      if (!hasSelection) {
        next = canAccount
          ? { ...draft, manager: true, portal: true }
          : { ...draft, private_connection: true };
        setDraft(next);
      }
      await persist(next);
      setStep("prepare");
    });

  const accountUnavailableReason = !isCeph
    ? t(onboardingErrors.ceph_endpoint_required)
    : detectionError
      ? detectionError
      : !detection
        ? t(onboardingErrors.endpoint_admin_credentials_required)
        : !detection.admin
          ? t(onboardingErrors.endpoint_admin_credentials_required)
          : !detection.account
            ? t(onboardingErrors.account_api_unavailable)
            : undefined;
  const cephUnavailableReason = !isCeph
    ? t(onboardingErrors.ceph_endpoint_required)
    : detectionError
      ? detectionError
      : !canCephAdmin
        ? t(onboardingErrors.ceph_identity_denied)
        : undefined;

  const invalidSelection =
    (draft.manager && !canAccount) ||
    (draft.portal && !canAccount) ||
    (draft.ceph_admin && !canCephAdmin);
  const privateCredentialsMissing =
    draft.private_connection && (!privateAccessKey || !privateSecretKey);
  const canApply =
    Boolean(preview) &&
    !previewPending &&
    !previewError &&
    preview!.blockers.length === 0 &&
    hasSelection &&
    !invalidSelection &&
    !endpointCredentialsPartial &&
    !privateCredentialsMissing;

  const configure = () =>
    run(async () => {
      if (!canApply || !preview) return;
      const reviewed = preview.review_token;
      const saved = await persist();
      if (saved.preview.review_token !== reviewed) throw new Error("review_changed");
      const result = await runWithStepUp(() =>
        applyOnboardingJourney(saved, {
          endpoint_access_key: endpointAccessKey || undefined,
          endpoint_secret_key: endpointSecretKey || undefined,
          private_access_key: privateAccessKey || undefined,
          private_secret_key: privateSecretKey || undefined,
        }),
      );
      store(result);
      clearSecrets();
      await Promise.all([refreshSettings(), refreshSession()]);
      notifyExecutionContextsRefresh();
      const nextStatus = await refreshStatus();
      if (nextStatus) announceOnboardingStatus(nextStatus);
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
            <UiButton variant="ghost" onClick={() => setPreviewNonce((value) => value + 1)}>
              {t(copy.retry)}
            </UiButton>
          </UiInlineMessage>
        )}
        {!status.can_configure && (
          <UiInlineMessage tone="warning">{message("superadmin_required")}</UiInlineMessage>
        )}

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
                      <div className={cx(uiCardMutedClass, "space-y-3 p-4")}>
                        <div>
                          <h3 className="ui-body font-semibold">{t(copy.adminCredentials)}</h3>
                          <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>{t(copy.adminCredentialsHelp)}</p>
                          <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>{t(copy.keysNotSaved)}</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <UiInput
                            label={t(copy.accessKey)}
                            type="password"
                            autoComplete="off"
                            value={endpointAccessKey}
                            onChange={(event) => setEndpointAccessKey(event.target.value)}
                          />
                          <UiInput
                            label={t(copy.secretKey)}
                            type="password"
                            autoComplete="new-password"
                            value={endpointSecretKey}
                            onChange={(event) => setEndpointSecretKey(event.target.value)}
                          />
                        </div>
                      </div>
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
                </div>
              </WorkflowSection>

              <WorkflowSection title={t(copy.capabilityTitle)} description={t(copy.detectionHint)}>
                {detectionPending ? (
                  <p role="status" className={uiMutedTextClass}>{t(copy.detecting)}</p>
                ) : (
                  <div className="divide-y divide-[var(--ui-border)]">
                    <Capability
                      label={t(copy.adminOps)}
                      available={Boolean(detection?.admin)}
                      detail={detection?.credential_checks.admin.message}
                      availableLabel={t(copy.available)}
                      unavailableLabel={t(copy.unavailable)}
                    />
                    <Capability
                      label={t(copy.accountApi)}
                      available={Boolean(detection?.account)}
                      detail={detection?.account_error}
                      availableLabel={t(copy.available)}
                      unavailableLabel={t(copy.unavailable)}
                    />
                    <Capability
                      label={t(copy.cephIdentity)}
                      available={canCephAdmin}
                      detail={detection?.credential_checks.ceph_admin.message}
                      availableLabel={t(copy.available)}
                      unavailableLabel={t(copy.unavailable)}
                    />
                  </div>
                )}
                {selectedEndpoint?.provider !== "ceph" && (
                  <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                    S3 access is available through a private connection; Ceph-specific setup is not offered for this endpoint.
                  </p>
                )}
                {detectionError && <UiInlineMessage tone="warning">{detectionError}</UiInlineMessage>}
              </WorkflowSection>

              <WorkflowActions>
                <UiButton
                  onClick={() => void goPrepare()}
                  disabled={
                    !endpointConfigured ||
                    endpointCredentialsPartial ||
                    detectionPending ||
                    busy
                  }
                >
                  {t(copy.continue)}
                </UiButton>
                <UiButton variant="ghost" onClick={() => void hideSetup()}>{t(copy.dismiss)}</UiButton>
              </WorkflowActions>
            </fieldset>
          )}

          {step === "prepare" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void configure();
              }}
            >
              <fieldset disabled={busy || !status.can_configure} className="space-y-4">
                <WorkflowSection title={t(copy.prepareTitle)} description={t(copy.prepareHelp)}>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <SetupOption
                      title={t(copy.managerTitle)}
                      description={t(copy.managerDesc)}
                      checked={draft.manager}
                      disabled={!canAccount}
                      disabledReason={!canAccount ? accountUnavailableReason : undefined}
                      recommended={canAccount ? t(copy.recommended) : undefined}
                      onChange={(manager) => change({ manager })}
                    />
                    <SetupOption
                      title={t(copy.portalTitle)}
                      description={t(copy.portalDesc)}
                      checked={draft.portal}
                      disabled={!canAccount}
                      disabledReason={!canAccount ? accountUnavailableReason : undefined}
                      recommended={canAccount ? t(copy.recommended) : undefined}
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
                      title={t(copy.cephTitle)}
                      description={t(copy.cephDesc)}
                      checked={draft.ceph_admin}
                      disabled={!canCephAdmin}
                      disabledReason={!canCephAdmin ? cephUnavailableReason : undefined}
                      onChange={(ceph_admin) => change({ ceph_admin })}
                    />
                  </div>
                </WorkflowSection>

                {draft.private_connection && (
                  <WorkflowSection
                    title={t(copy.privateCredentials)}
                    description={t(copy.privateCredentialsHelp)}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <UiInput
                        label={t(copy.accessKey)}
                        type="password"
                        autoComplete="off"
                        required
                        value={privateAccessKey}
                        onChange={(event) => setPrivateAccessKey(event.target.value)}
                      />
                      <UiInput
                        label={t(copy.secretKey)}
                        type="password"
                        autoComplete="new-password"
                        required
                        value={privateSecretKey}
                        onChange={(event) => setPrivateSecretKey(event.target.value)}
                      />
                    </div>
                    <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>{t(copy.keysNotSaved)}</p>
                  </WorkflowSection>
                )}

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
                      <UiButton variant="ghost" onClick={() => setPreviewNonce((value) => value + 1)}>
                        {t(copy.retry)}
                      </UiButton>
                    </UiInlineMessage>
                  )}
                  {!hasSelection && (
                    <UiInlineMessage tone="warning">{message("selection_required")}</UiInlineMessage>
                  )}
                </section>

                <WorkflowActions>
                  <UiButton variant="secondary" onClick={() => setStep("connect")}>{t(copy.back)}</UiButton>
                  <UiButton type="submit" loading={busy} disabled={!canApply}>
                    {t(busy ? copy.working : copy.apply)}
                  </UiButton>
                  <UiButton variant="ghost" onClick={() => void hideSetup()}>{t(copy.dismiss)}</UiButton>
                </WorkflowActions>
              </fieldset>
            </form>
          )}
        </WorkflowTabs>

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
