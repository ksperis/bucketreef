/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { useLocation } from "react-router-dom";
import {
  SettingsItem,
  SettingsSection,
  SettingsSwitch,
} from "../../components/settings/SettingsLayout";
import { SettingsConfirmation } from "../../components/settings/SettingsControls";
import AdminSettingsFrame from "./settings/AdminSettingsFrame";
import AuthProviderList from "./settings/AuthProviderList";
import { AppSettingsToggle } from "./settings/AppSettingsFields";
import { useAppSettingsDraft } from "./settings/useAppSettingsDraft";
import type { SettingsPath } from "./settings/appSettingsDraft";

const paths = [
  "general.allow_login_access_keys",
  "general.allow_login_endpoint_list",
  "general.allow_login_custom_endpoint",
  "general.require_passkey_for_admins",
  "general.require_passkey_for_users",
  "general.allow_user_profile_name_edit",
  "general.allow_user_external_identity_unlink",
] as const satisfies readonly SettingsPath[];
export default function AuthenticationSettingsPage() {
  const form = useAppSettingsDraft(paths);
  const [disableProtection, setDisableProtection] = useState(false);
  const location = useLocation();
  const providerSaved =
    typeof location.state?.providerSaved === "string"
      ? location.state.providerSaved
      : null;
  return (
    <AdminSettingsFrame
      title="Authentication settings"
      description="Sign-in methods, identity policy and external providers."
      page="authentication-settings"
      resetTitle="Reset authentication settings draft?"
      form={form}
      dialogs={
        <>
          {disableProtection && (
            <SettingsConfirmation
              title="Disable required admin passkeys?"
              description="Administrator sessions will no longer require a recent passkey verification for sensitive actions."
              confirmLabel="Disable protection"
              tone="danger"
              warning="This weakens protection for every administrator account. The change is applied only after saving."
              impacts={[
                "Any active authorized Admin or Superadmin session will be sufficient for sensitive administration actions.",
              ]}
              onCancel={() => setDisableProtection(false)}
              onConfirm={() => {
                form.setValue("general.require_passkey_for_admins", false);
                setDisableProtection(false);
              }}
            />
          )}
        </>
      }
      additionalContent={
        <div className="settings-compact mt-5">
          {providerSaved && (
            <p role="status" className="mb-3">
              {providerSaved}
            </p>
          )}
          <AuthProviderList kind="oidc" />
          <AuthProviderList kind="ldap" />
        </div>
      }
    >
      <SettingsSection
        presentation="compact"
        title="Access-key sign-in"
        description="Options for users signing in with S3 credentials."
      >
        <AppSettingsToggle
          form={form}
          field="general.allow_login_access_keys"
          title="Access-key login"
        />
        <AppSettingsToggle
          form={form}
          field="general.allow_login_endpoint_list"
          title="Access-key endpoint list"
          description="Show configured endpoints on the access-key login screen."
          disabled={!form.draft["general.allow_login_access_keys"]}
        />
        <AppSettingsToggle
          form={form}
          field="general.allow_login_custom_endpoint"
          title="Custom login endpoint"
          description="Public HTTPS targets only. The backend rejects private/local hosts and insecure transport. Admin-managed HTTP endpoints remain available through administration."
          disabled={!form.draft["general.allow_login_access_keys"]}
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Identity security policy"
        description="Requirements at sign-in and changes users can make themselves."
      >
        <SettingsItem
          compact
          title="Require passkeys for administrators"
          description="Also requires recent WebAuthn verification for sensitive administration actions."
          action={
            <SettingsSwitch
              ariaLabel="Require passkeys for administrators"
              checked={Boolean(
                form.draft["general.require_passkey_for_admins"],
              )}
              onChange={(value) => {
                if (!value && form.settings?.general.require_passkey_for_admins)
                  setDisableProtection(true);
                else form.setValue("general.require_passkey_for_admins", value);
              }}
            />
          }
        />
        <AppSettingsToggle
          form={form}
          field="general.require_passkey_for_users"
          title="Require passkeys for standard users"
          description="Applies at their next sign-in."
        />
        <AppSettingsToggle
          form={form}
          field="general.allow_user_profile_name_edit"
          title="Allow users to edit their profile name"
        />
        <AppSettingsToggle
          form={form}
          field="general.allow_user_external_identity_unlink"
          title="Allow users to unlink external identities"
          description="Another primary sign-in method must remain."
        />
      </SettingsSection>
    </AdminSettingsFrame>
  );
}
