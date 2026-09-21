/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isApiError } from "../../api/client";
import {
  applyOnboardingJourney, attestOnboardingJourney, fetchOnboardingStatus, previewOnboardingDraft,
  resumeOnboarding, saveOnboardingJourney, verifyOnboardingJourney,
  type OnboardingDraft, type OnboardingJourney, type OnboardingPreview, type OnboardingStatus, type OnboardingWorkspace,
} from "../../api/onboarding";
import { useSession } from "../../auth/SessionProvider";
import { isRecentWebAuthnVerificationCancelled, useRecentWebAuthnStepUp } from "../../auth/useRecentWebAuthnStepUp";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { settingsLabels } from "../../components/settings/settingsLabels";
import WorkflowPage, { WorkflowActions, WorkflowMetadata, WorkflowSection } from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import UiButton from "../../components/ui/UiButton";
import { uiCardMutedClass, uiCheckboxClass, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { isCancelledError, isRecentWebAuthnRequired } from "../../utils/apiError";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import OnboardingSetupFields from "./OnboardingSetupFields";
import OnboardingValidation from "./OnboardingValidation";
import { onboardingActions, onboardingCopy as copy, onboardingErrors } from "./onboardingCopy";

type Step = "goal" | "setup" | "validation";
const initialDraft = (name: string): OnboardingDraft => ({
  name, intent: "evaluate", workspace: "browser", resource_kind: "connection", beneficiary_user_id: null,
  endpoint_id: null, connection_id: null, account_id: null, endpoint_url: "", region: "", force_path_style: true,
  grant_access: false, bucket: "", prefix: "", space_id: "", space_name: "", space_visibility: "private",
});
const workspaces: { value: OnboardingWorkspace; label: "browser" | "manager" | "portal" | "ceph" }[] = [
  { value: "browser", label: "browser" }, { value: "manager", label: "manager" },
  { value: "portal", label: "portal" }, { value: "ceph-admin", label: "ceph" },
];

export default function OnboardingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialId = useRef(params.get("journey"));
  const initialized = useRef(false);
  const id = useRef<string>(crypto.randomUUID());
  const { refresh: refreshSettings } = useGeneralSettings();
  const { refresh: refreshSession } = useSession();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp({
    title: t({ en: "Verify with passkey", fr: "Vérifier avec une passkey", de: "Mit Passkey bestätigen", zh: "使用通行密钥验证" }),
    description: t({ en: "Confirm your identity to apply the reviewed configuration.", fr: "Confirmez votre identité pour appliquer la configuration vérifiée.", de: "Bestätigen Sie Ihre Identität, um die geprüfte Konfiguration anzuwenden.", zh: "请确认身份以应用已审核的配置。" }),
    cancel: t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" }),
  });
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [journey, setJourney] = useState<OnboardingJourney | null>(null);
  const [draft, setDraft] = useState(() => initialDraft(t(copy.defaultName)));
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialDraft(t(copy.defaultName))));
  const [internalNavigation, setInternalNavigation] = useState(false);
  const [step, setStep] = useState<Step>("goal");
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const labels = settingsLabels(t);
  const dirtyDraft = JSON.stringify(draft) !== baseline;
  const dirty = dirtyDraft || Boolean(accessKey || secretKey);
  const updateJourneyUrl = useCallback((journeyId: string | null) => {
    // This only changes the URL of an accepted local selection/checkpoint.
    // External navigation and reloads still use the shared draft guard.
    flushSync(() => setInternalNavigation(true));
    setParams(journeyId ? { journey: journeyId } : {}, { replace: true });
    setInternalNavigation(false);
  }, [setParams]);

  const message = useCallback((code: string) => {
    const [key, source] = code.split(":");
    return `${t(onboardingErrors[key] ?? onboardingErrors.generic)}${source ? ` (${source})` : ""}`;
  }, [t]);
  const failure = useCallback((cause: unknown) => {
    if (isRecentWebAuthnRequired(cause)) return t(copy.signIn);
    if (isApiError(cause)) {
      const detail = cause.response?.data?.detail as { code?: string } | undefined;
      return message(detail?.code ?? (cause.response?.status === 422 ? "invalid_configuration" : "generic"));
    }
    return message(cause instanceof Error && cause.message === "review_changed" ? "review_changed" : "generic");
  }, [message, t]);
  const selectJourney = useCallback((value: OnboardingJourney) => {
    id.current = value.id;
    setJourney(value); setDraft(value.draft); setPreview(value.preview);
    setBaseline(JSON.stringify(value.draft)); setPreviewPending(false); setPreviewError("");
    setStep(value.configured ? "validation" : "setup");
    setAccessKey(""); setSecretKey(""); setError("");
    updateJourneyUrl(value.id);
  }, [updateJourneyUrl]);

  useEffect(() => {
    if (initialized.current) return;
    let active = true;
    fetchOnboardingStatus().then(async (loaded) => {
      if (!active) return;
      const value = loaded.dismissed ? await resumeOnboarding() : loaded;
      if (!active) return;
      initialized.current = true;
      setStatus(value);
      const selected = value.journeys?.find((item) => item.id === initialId.current) ?? value.journeys?.[0];
      if (selected) selectJourney(selected);
    }).catch((cause) => { if (active) setError(failure(cause)); });
    return () => { active = false; };
  }, [failure, selectJourney]);

  useEffect(() => {
    if (step !== "setup" || busy) return;
    const controller = new AbortController();
    setPreviewPending(true); setPreviewError("");
    const timer = window.setTimeout(() => {
      previewOnboardingDraft(draft, controller.signal, journey?.id).then((value) => {
        if (!controller.signal.aborted) { setPreview(value); setPreviewPending(false); }
      }).catch((cause) => {
        if (!controller.signal.aborted && !isCancelledError(cause)) { setPreviewError(failure(cause)); setPreviewPending(false); }
      });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft, step, busy, previewNonce, failure, journey?.id]);

  const store = (value: OnboardingJourney) => {
    setJourney(value); setDraft(value.draft); setPreview(value.preview);
    setBaseline(JSON.stringify(value.draft)); setPreviewPending(false); setPreviewError("");
    setStatus((current) => current && ({ ...current, journeys: [value, ...(current.journeys ?? []).filter((item) => item.id !== value.id)] }));
    updateJourneyUrl(value.id);
  };
  const persist = async () => {
    const value = await saveOnboardingJourney(id.current, draft, journey?.revision);
    store(value);
    return value;
  };
  const run = async (action: (reconcile: () => void) => Promise<void>) => {
    if (busy) return;
    let reconcileCheckpoints = false;
    setBusy(true); setError("");
    try { await action(() => { reconcileCheckpoints = true; }); }
    catch (cause) {
      if (isRecentWebAuthnVerificationCancelled(cause)) return;
      setError(failure(cause));
      // Reconcile only after a remote operation was attempted. A failed draft
      // save must retain edits; a failed check must remove any stale success.
      try {
        const value = await fetchOnboardingStatus(); setStatus(value);
        const saved = value.journeys?.find((item) => item.id === id.current);
        if (saved && reconcileCheckpoints) store(saved);
      } catch { /* Keep the original operation error and allow an explicit retry. */ }
      setPreviewNonce((value) => value + 1);
    } finally { setBusy(false); }
  };
  const configure = () => {
    if (!preview || previewPending || previewError || preview.blockers.length > 0 || pendingSpace || (needsCredentials && (!accessKey || !secretKey))) return;
    return run(async (reconcile) => {
    const reviewed = preview?.review_token;
    const saved = await persist();
    if (reviewed !== saved.preview.review_token) throw new Error("review_changed");
    reconcile();
    const result = await runWithStepUp(() => applyOnboardingJourney(saved, { access_key: accessKey || undefined, secret_key: secretKey || undefined }));
    store(result); setAccessKey(""); setSecretKey("");
    await Promise.all([refreshSettings(), refreshSession()]);
    notifyExecutionContextsRefresh();
    setStatus(await fetchOnboardingStatus());
    setStep("validation");
    });
  };
  const change = (patch: Partial<OnboardingDraft>) => {
    const changedIdentity = ["resource_kind", "connection_id", "account_id", "endpoint_id", "endpoint_url", "beneficiary_user_id"].some((key) => key in patch);
    if (changedIdentity) {
      setAccessKey(""); setSecretKey("");
      setPreview(null);
    }
    setPreviewPending(true);
    setDraft((current) => ({ ...current, ...(changedIdentity ? { grant_access: false } : {}), ...patch }));
  };
  const changeWorkspace = (workspace: OnboardingWorkspace) => {
    if (workspace === draft.workspace) return;
    const kind = workspace === "portal" || (workspace === "manager" && draft.resource_kind === "account")
      ? "account" : workspace === "ceph-admin" ? "endpoint" : "connection";
    const existingConnection = status?.connections?.find((item) => item.id === draft.connection_id);
    const connectionId = kind === "connection" && existingConnection && (workspace === "manager" || !existingConnection.is_shared)
      ? existingConnection.id : null;
    const accountId = kind === "account" ? draft.account_id : null;
    const existingEndpoint = status?.endpoints?.find((item) => item.id === draft.endpoint_id);
    const endpointId = existingEndpoint && (kind === "connection" || existingEndpoint.provider === "ceph") ? existingEndpoint.id : null;
    const beneficiaryId = workspace === "browser" || workspace === "ceph-admin" ? null : draft.beneficiary_user_id;
    change({ workspace, resource_kind: kind, account_id: accountId, connection_id: connectionId, endpoint_id: endpointId,
      beneficiary_user_id: beneficiaryId, bucket: workspace === "browser" || workspace === "manager" ? draft.bucket : "",
      prefix: workspace === "browser" ? draft.prefix : "", space_id: "",
      space_name: workspace === "portal" && (!beneficiaryId || beneficiaryId === status?.actor_id) ? t(copy.defaultSpace) : "", grant_access: false });
  };
  const reset = () => {
    id.current = crypto.randomUUID();
    const value = initialDraft(t(copy.defaultName));
    setJourney(null); setDraft(value); setBaseline(JSON.stringify(value)); setStep("goal");
    setPreview(null); setPreviewPending(false); setPreviewError(""); setError("");
    setAccessKey(""); setSecretKey(""); updateJourneyUrl(null);
  };
  const beneficiary = status?.users?.find((user) => user.id === (draft.beneficiary_user_id ?? status.actor_id))?.name ?? t(copy.myself);
  const endpoint = status?.endpoints?.find((item) => item.id === draft.endpoint_id)?.name ?? draft.endpoint_url;
  const resourceName = (draft.resource_kind === "connection" ? status?.connections?.find((item) => item.id === draft.connection_id) : status?.accounts?.find((item) => item.id === draft.account_id))?.name ?? draft.name;
  const needsCredentials = Boolean((draft.resource_kind === "connection" && !draft.connection_id)
    || (!draft.endpoint_id && !draft.account_id && !draft.connection_id)
    || preview?.changes.some((item) => ["create_ceph_endpoint", "configure_endpoint_credentials"].includes(item)));
  const needsAccessConfirmation = preview?.changes.some((item) => ["allow_private_connections", "enable_connection_workspace", "grant_manager_access", "grant_portal_access", "grant_ceph_admin_access", "enable_ui_user"].includes(item));
  const pendingSpace = journey?.pending_step === "space" && !draft.space_id;

  return <WorkflowPage title={t(copy.title)} description={t(copy.description)} width="standard" breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: t(copy.title) }]}>
    <div className="space-y-4" aria-busy={busy}>
      <p className={uiMutedTextClass}>{t(copy.optional)}</p>
      {status && (dirty || journey) && <p role="status" className="ui-caption text-[var(--ui-text-muted)]">{t(dirty ? copy.unsaved : copy.saved)}</p>}
      {error && <div role="alert" className="ui-body text-[var(--ui-danger-text)]">{error} <UiButton variant="ghost" onClick={() => void run(async () => {
        const value = await fetchOnboardingStatus(); setStatus(value);
        const saved = value.journeys?.find((item) => item.id === id.current); if (saved) selectJourney(saved);
      })}>{t(copy.loadSaved)}</UiButton></div>}
      {!status ? <p role="status">{t(copy.loading)}</p> : <>
        {!status.can_configure && <p role="alert">{message("superadmin_required")}</p>}
        {(status.journeys?.length ?? 0) > 0 && <details>
          <summary className="cursor-pointer ui-body">{t(copy.journeys)}</summary>
          <div className="mt-2 flex flex-wrap gap-2">{status.journeys?.map((item) => <UiButton key={item.id} variant="secondary" disabled={busy} onClick={() => void run(async () => {
            if (dirtyDraft) await persist();
            if (item.id !== id.current) selectJourney(item);
          })}>{item.draft.name} · {item.draft.workspace}</UiButton>)}</div>
        </details>}
        <WorkflowTabs activeTab={step} onTabChange={setStep} ariaLabel={t(copy.title)} tabs={[
          { id: "goal", label: t(copy.goal), disabled: busy }, { id: "setup", label: t(copy.setup), disabled: busy },
          { id: "validation", label: t(copy.validation), disabled: busy || !journey?.configured || JSON.stringify(draft) !== JSON.stringify(journey.draft) },
        ]}>
          {step === "goal" && <fieldset disabled={busy || !status.can_configure} className="space-y-4">
            <WorkflowSection title={t(copy.context)}>
              {(["evaluate", "personal", "organization"] as const).map((intent) => <label key={intent} className="flex min-h-11 cursor-pointer items-center gap-3 ui-body">
                <input type="radio" name="onboarding-intent" value={intent} checked={draft.intent === intent} onChange={() => change({ intent })} />{t(copy[intent])}
                {intent === "evaluate" && status.source === "quickstart" && <span className="ui-caption">{t(copy.quickstart)}</span>}
              </label>)}
            </WorkflowSection>
            <WorkflowSection title={t(copy.need)}>
              {workspaces.map((workspace) => <label key={workspace.value} className="flex min-h-11 cursor-pointer items-center gap-3 py-2 ui-body">
                <input type="radio" name="onboarding-workspace" value={workspace.value} checked={draft.workspace === workspace.value} onChange={() => changeWorkspace(workspace.value)} />{t(copy[workspace.label])}
              </label>)}
            </WorkflowSection>
            <WorkflowActions><UiButton onClick={() => void run(async () => { await persist(); setStep("setup"); })}>{t(copy.continue)}</UiButton></WorkflowActions>
          </fieldset>}
          {step === "setup" && <form onSubmit={(event) => { event.preventDefault(); void configure(); }}>
            <fieldset disabled={busy || !status.can_configure} className="space-y-4">
              <OnboardingSetupFields key={`${id.current}:${draft.workspace}:${draft.account_id}:${draft.beneficiary_user_id}`} draft={draft} status={status} needsCredentials={needsCredentials} onChange={change} accessKey={accessKey} secretKey={secretKey} onCredentials={(access, secret) => { setAccessKey(access); setSecretKey(secret); }} />
              <section className={`${uiCardMutedClass} space-y-3 p-4`} aria-label={t(copy.summary)} aria-busy={previewPending}>
                <h2 className="ui-subtitle">{t(copy.summary)}</h2>
                <WorkflowMetadata items={[{ label: t(copy.beneficiary), value: beneficiary }, { label: t(copy.resource), value: resourceName }, { label: t(copy.endpoint), value: endpoint || "—" }]} />
                <p className={uiMutedTextClass}>{t(copy.automatic)}</p>
                {previewError && <p role="alert">{previewError} <UiButton variant="ghost" onClick={() => setPreviewNonce((value) => value + 1)}>{t(copy.retry)}</UiButton></p>}
                {pendingSpace && <p role="alert">{message("space_reconciliation_required")}</p>}
                {(previewPending || !preview) && !previewError && <p role="status">{t(copy.saving)}</p>}
                {preview && !previewError && <>
                  {preview.features.length + preview.changes.length === 0 && <p>{t(copy.noChanges)}</p>}
                  {(preview.features.length + preview.changes.length > 0) && <ul className="list-disc space-y-1 pl-5 ui-body">{[...preview.features, ...preview.changes].map((item) => <li key={item}>{t(onboardingActions[item] ?? copy.review)}</li>)}</ul>}
                  {!previewPending && preview.blockers.length > 0 && <div role="alert">{preview.blockers.map((item) => <p key={item}>{message(item)}</p>)}</div>}
                </>}
                {needsAccessConfirmation && <label className="flex min-h-11 cursor-pointer items-center gap-3 ui-body">
                  <input type="checkbox" className={uiCheckboxClass} checked={draft.grant_access} disabled={previewPending || Boolean(previewError)} onChange={(event) => change({ grant_access: event.target.checked })} />
                  {t(copy.allowAccess)}
                </label>}
              </section>
              <WorkflowActions><UiButton variant="secondary" onClick={() => setStep("goal")}>{t(copy.back)}</UiButton>
                <UiButton type="submit" loading={busy} disabled={!preview || previewPending || Boolean(previewError) || pendingSpace || preview.blockers.length > 0 || Boolean(needsCredentials && (!accessKey || !secretKey))}>{t(busy ? copy.working : copy.configure)}</UiButton>
              </WorkflowActions>
            </fieldset>
          </form>}
          {step === "validation" && journey && <OnboardingValidation key={journey.id} journey={journey} actorId={status.actor_id ?? 0} busy={busy} onConfigureSpace={() => setStep("setup")} onVerify={() => void run(async (reconcile) => { reconcile(); store(await verifyOnboardingJourney(journey)); })} onAttest={(check, checked, note) => void run(async (reconcile) => { reconcile(); store(await attestOnboardingJourney(journey, check, checked, note)); })} />}
        </WorkflowTabs>
        <WorkflowActions>
          <Link to="/admin" className="text-primary underline">Admin</Link>
          <UiButton variant="secondary" disabled={busy || !status.can_configure} onClick={() => void run(async () => {
            await persist();
            flushSync(() => { setAccessKey(""); setSecretKey(""); setInternalNavigation(true); });
            navigate("/admin");
          })}>{t(copy.pause)}</UiButton>
          <UiButton variant="ghost" disabled={busy || !status.can_configure} onClick={() => void run(async () => { if (journey || dirtyDraft) await persist(); reset(); })}>{t(copy.newGoal)}</UiButton>
        </WorkflowActions>
      </>}
      {verificationDialog}
      <SettingsNavigationGuard dirty={Boolean(status) && !internalNavigation && (dirty || busy)} discardDisabled={busy}
        title={busy ? t(copy.working) : labels.discardTitle}
        description={busy ? t(copy.waitBeforeLeaving) : t(copy.unsavedHelp)}
        confirmLabel={labels.discard} cancelLabel={labels.keepEditing} closeLabel={labels.close} />
    </div>
  </WorkflowPage>;
}
