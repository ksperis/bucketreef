/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import {
  createOidcAdminProvider,
  updateOidcAdminProvider,
  fetchOidcAdminProviders,
  createLdapAdminProvider,
  updateLdapAdminProvider,
  fetchLdapAdminProviders,
  type OidcProviderAdminItem,
  type LdapProviderAdminItem,
} from "../../../api/authSettings";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../../auth/useRecentWebAuthnStepUp";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import SettingsWorkflowForm from "../../../components/settings/SettingsWorkflowForm";
import { SettingsButton } from "../../../components/settings/SettingsControls";
import { useSettingsDraft } from "../../../components/settings/useSettingsDraft";
import { extractApiError } from "../../../utils/apiError";
import { focusFirstInvalidField } from "../../../utils/focusFirstInvalidField";
import { adminPageBreadcrumbs } from "../adminBreadcrumbs";
import {
  emptyOidcForm,
  emptyLdapForm,
  oidcProviderToForm,
  ldapProviderToForm,
  oidcPayloadFromForm,
  ldapPayloadFromForm,
  type OidcProviderFormState,
  type LdapProviderFormState,
} from "./authProviderForms";
import OidcProviderFields from "./OidcProviderFields";
import LdapProviderFields from "./LdapProviderFields";

const backPath = "/admin/authentication-settings";
type Metadata = {
  provider_id: string;
  editable: boolean;
  source: "environment" | "ui";
};
type Adapter<T extends { provider_id: string }, P extends Metadata> = {
  kind: "OIDC" | "LDAP";
  empty: () => T;
  load: () => Promise<P[]>;
  toForm: (provider: P) => T;
  save: (value: T, provider: P | null) => Promise<unknown>;
  validate: (value: T) => Partial<Record<keyof T, string>>;
  render: (props: {
    form: T;
    update: <K extends keyof T>(key: K, value: T[K]) => void;
    provider: P | null;
    readOnly: boolean;
    errors: Partial<Record<keyof T, string>>;
  }) => ReactNode;
};

function required<T>(
  form: T,
  keys: (keyof T)[],
): Partial<Record<keyof T, string>> {
  return Object.fromEntries(
    keys
      .filter((key) => !String(form[key] ?? "").trim())
      .map((key) => [key, "This field is required."]),
  ) as Partial<Record<keyof T, string>>;
}

const oidc: Adapter<OidcProviderFormState, OidcProviderAdminItem> = {
  kind: "OIDC",
  empty: emptyOidcForm,
  load: fetchOidcAdminProviders,
  toForm: oidcProviderToForm,
  save: (form, provider) =>
    provider
      ? updateOidcAdminProvider(provider.provider_id, oidcPayloadFromForm(form))
      : createOidcAdminProvider(oidcPayloadFromForm(form)),
  validate: (form) =>
    required(form, [
      "provider_id",
      "display_name",
      "discovery_url",
      "client_id",
      "redirect_uri",
    ]),
  render: (props) => <OidcProviderFields {...props} />,
};
const ldap: Adapter<LdapProviderFormState, LdapProviderAdminItem> = {
  kind: "LDAP",
  empty: emptyLdapForm,
  load: fetchLdapAdminProviders,
  toForm: ldapProviderToForm,
  save: (form, provider) =>
    provider
      ? updateLdapAdminProvider(provider.provider_id, ldapPayloadFromForm(form))
      : createLdapAdminProvider(ldapPayloadFromForm(form)),
  validate: (form) => ({
    ...required(form, [
      "provider_id",
      "display_name",
      "url",
      "user_base_dn",
      "user_filter",
      "email_attribute",
    ]),
    timeout_seconds:
      Number(form.timeout_seconds) > 0 &&
      Number(form.timeout_seconds) <= 60 &&
      Number.isFinite(Number(form.timeout_seconds))
        ? undefined
        : "Timeout must be greater than zero and no more than 60 seconds.",
  }),
  render: (props) => <LdapProviderFields {...props} />,
};

function ProviderEditor<T extends { provider_id: string }, P extends Metadata>({
  adapter,
}: {
  adapter: Adapter<T, P>;
}) {
  const { providerId } = useParams();
  const navigate = useNavigate();
  const form = useSettingsDraft(adapter.empty);
  const [provider, setProvider] = useState<P | null>(null);
  const [loading, setLoading] = useState(Boolean(providerId));
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [completed, setCompleted] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
  const accept = form.accept;
  useEffect(() => {
    if (!providerId) return;
    let active = true;
    setLoading(true);
    setError(null);
    adapter
      .load()
      .then((providers) => {
        if (!active) return;
        const selected = providers.find(
          (item) => item.provider_id === providerId,
        );
        if (!selected) {
          setError("Provider not found.");
          return;
        }
        setProvider(selected);
        accept(adapter.toForm(selected));
      })
      .catch((err) => {
        if (active) setError(extractApiError(err, "Unable to load provider."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [adapter, providerId, accept, loadAttempt]);
  const readOnly = Boolean(provider && !provider.editable);
  const title = `${providerId ? (readOnly ? "View" : "Edit") : "Add"} ${adapter.kind} provider`;
  const close = (reason?: "navigation") => {
    form.cancel();
    if (reason !== "navigation") navigate(backPath);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    if (loading || (providerId && !provider) || readOnly || !form.dirty) return;
    const nextErrors = adapter.validate(form.draft);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    setError(null);
    try {
      await runWithStepUp(() => adapter.save(form.draft, provider));
      if (!active.current) return;
      // Remove the saved form and its pending navigation guard before redirecting.
      flushSync(() => { form.accept(adapter.empty()); setCompleted(true); });
      navigate(backPath, {
        state: { providerSaved: `${adapter.kind} provider saved.` },
      });
    } catch (err) {
      if (active.current && !isRecentWebAuthnVerificationCancelled(err))
        setError(extractApiError(err, "Unable to save provider."));
    }
  };
  if (completed) return null;
  return (
    <>
      <SettingsWorkflowForm
      title={title}
      description="Configure the connection, identity mapping and security options."
      formLabel={`${adapter.kind} provider configuration`}
      contentVariant="plain" width="wide" backLabel="Back to authentication"
      dirty={form.dirty} loading={loading} readOnly={readOnly || Boolean(providerId && !provider && !loading)}
      disabled={!form.dirty || Boolean(providerId && !provider)} error={error}
      submitLabel={`Save ${adapter.kind} provider`} busyLabel="Saving..." onSubmit={save} onClose={close}
      breadcrumbs={[
        ...adminPageBreadcrumbs("authentication-settings").map(
          (crumb, index, items) =>
            index === items.length - 1 ? { ...crumb, to: backPath } : crumb,
        ),
        { label: title },
      ]}
    >
        {loading ? (
          <p role="status">Loading provider...</p>
        ) : (
          (!providerId || provider) && (
            <>
              {readOnly && (
                <UiInlineMessage tone="info">
                  This provider is managed by environment variables and cannot
                  be edited here.
                </UiInlineMessage>
              )}
              {adapter.render({
                form: form.draft,
                update: (key, value) => {
                  form.setDraft((current) => ({ ...current, [key]: value }));
                  setErrors((current) => ({ ...current, [key]: undefined }));
                },
                provider,
                readOnly,
                errors,
              })}
            </>
          )
        )}
        {!loading && providerId && !provider && error && <div>
          <SettingsButton variant="secondary" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry</SettingsButton>
        </div>}
      </SettingsWorkflowForm>
      {verificationDialog}
    </>
  );
}

export default function AuthProviderPage({ kind }: { kind: "oidc" | "ldap" }) {
  const { providerId } = useParams();
  return kind === "oidc" ? (
    <ProviderEditor key={`oidc-${providerId ?? "create"}`} adapter={oidc} />
  ) : (
    <ProviderEditor key={`ldap-${providerId ?? "create"}`} adapter={ldap} />
  );
}
