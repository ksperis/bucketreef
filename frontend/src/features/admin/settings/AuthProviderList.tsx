/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ConfirmActionDialog from "../../../components/ConfirmActionDialog";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchOidcAdminProviders,
  fetchLdapAdminProviders,
  deleteOidcAdminProvider,
  deleteLdapAdminProvider,
  type OidcProviderAdminItem,
  type LdapProviderAdminItem,
} from "../../../api/authSettings";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../../auth/useRecentWebAuthnStepUp";
import {
  SettingsItem,
  SettingsSection,
} from "../../../components/settings/SettingsLayout";
import {
  SettingsButton,
} from "../../../components/settings/SettingsControls";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { extractApiError } from "../../../utils/apiError";
import { useAdminI18n } from "../adminI18n";
import useAdminListController from "../useAdminListController";

const isDemo = import.meta.env.MODE === "demo";

type Provider = OidcProviderAdminItem | LdapProviderAdminItem;
export default function AuthProviderList({ kind }: { kind: "oidc" | "ldap" }) {
  const { text: adminText } = useAdminI18n();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
  const name = kind.toUpperCase();
  const path = `/admin/authentication-settings/${kind}`;
  const fetchProviders = useCallback(
    () =>
      kind === "oidc" ? fetchOidcAdminProviders() : fetchLdapAdminProviders(),
    [kind],
  );
  const formatLoadError = useCallback(
    (error: unknown) =>
      extractApiError(error, adminText("Unable to load {kind} providers.", { kind: name })),
    [adminText, name],
  );
  const {
    items: providers,
    setItems: setProviders,
    loading,
    error,
    setError,
  } = useAdminListController<Provider>({
    loadItems: fetchProviders,
    formatError: formatLoadError,
  });
  const remove = async () => {
    if (!selected?.editable || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await runWithStepUp(() =>
        kind === "oidc"
          ? deleteOidcAdminProvider(selected.provider_id)
          : deleteLdapAdminProvider(selected.provider_id),
      );
      setProviders((current) =>
        current.filter(
          (provider) => provider.provider_id !== selected.provider_id,
        ),
      );
      setSelected(null);
      setMessage(adminText("{kind} provider deleted.", { kind: name }));
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err))
        setError(extractApiError(err, adminText("Unable to delete {kind} provider.", { kind: name })));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      presentation="compact"
      title={adminText("{kind} providers", { kind: name })}
      description={adminText("Login providers. Environment-managed settings remain locked.")}
    >
      <div className="mb-2 flex justify-end">
        <SettingsButton
          variant="secondary"
          disabled={isDemo || busy}
          onClick={() => navigate(`${path}/new`)}
        >
          {adminText("Add {kind} provider", { kind: name })}</SettingsButton>
      </div>
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      {message && <p role="status">{message}</p>}
      {loading ? (
        <p role="status">{adminText("Loading {kind} providers...", { kind: name })}</p>
      ) : (
        providers.length === 0 && (
          <p className="py-3 settings-readonly">
            {adminText("No {kind} providers configured.", { kind: name })}</p>
        )
      )}
      {providers.map((provider) => (
        <SettingsItem
          compact
          key={provider.provider_id}
          title={provider.display_name}
          description={provider.provider_id}
          status={
            <>
              <UiBadge tone={provider.enabled ? "success" : "neutral"}>
                {adminText(provider.enabled ? "Enabled" : "Disabled")}
              </UiBadge>
              <UiBadge tone="neutral">
                {provider.source === "environment" ? adminText("Environment") : "UI"}
              </UiBadge>
            </>
          }
          action={
            <div className="flex flex-wrap gap-2">
              <SettingsButton
                variant="secondary"
                disabled={isDemo || busy}
                aria-label={adminText("{action} {kind} provider {id}", { action: adminText(provider.editable ? "Edit" : "View"), kind: name, id: provider.provider_id })}
                onClick={() =>
                  navigate(
                    `${path}/providers/${encodeURIComponent(provider.provider_id)}`,
                  )
                }
              >
                {adminText(provider.editable ? "Edit" : "View")}
              </SettingsButton>
              {provider.editable && (
                <SettingsButton
                  variant="ghost"
                  disabled={isDemo || busy}
                  aria-label={adminText("{action} {kind} provider {id}", { action: adminText("Delete"), kind: name, id: provider.provider_id })}
                  onClick={() => setSelected(provider)}
                >
                  {adminText("Delete")}</SettingsButton>
              )}
            </div>
          }
        />
      ))}
      {selected && (
        <ConfirmActionDialog
          title={adminText("Delete {kind} provider?", { kind: name })}
          description={adminText("Remove {name} ({id}) from sign-in options.", { name: selected.display_name, id: selected.provider_id })}
          confirmLabel={adminText("Delete provider")}
          loading={busy}
          warning={error ? <span role="alert">{error}</span> : undefined}
          impacts={[
            adminText("Users will no longer be able to sign in through this provider."),
          ]}
          onCancel={() => {
            if (!busy) setSelected(null);
          }}
          onConfirm={remove}
        />
      )}
      {verificationDialog}
    </SettingsSection>
  );
}
