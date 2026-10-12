/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { UiRole, UpdateUserPayload } from "../../api/users";
import type { ReactNode } from "react";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { adminUserMessage, useAdminUserI18n, type AdminUserText } from "./adminUserMessage";

type IdentityValues = Pick<UpdateUserPayload, "email" | "full_name" | "role"> & { password?: string };
export type UserIdentityErrors = Partial<Record<"email" | "password", string>>;

// Keep the native email constraint effective when General is not mounted.
export function userIdentityErrors(
  values: IdentityValues,
  creating: boolean,
  text: AdminUserText = (key) => adminUserMessage[key].en,
): UserIdentityErrors {
  const errors: UserIdentityErrors = {};
  const email = document.createElement("input");
  email.type = "email";
  email.value = values.email ?? "";
  if (creating && !values.email) errors.email = text("emailRequired");
  else if (!email.checkValidity()) errors.email = text("invalidEmail");
  if (creating && !values.password) errors.password = text("passwordRequired");
  return errors;
}

export default function AdminUserIdentityFields({
  values, creating = false, onChange, onRoleChange, canAssignAdmin, errors,
  helpOpen, onToggleHelp, idPrefix, children,
}: {
  values: IdentityValues;
  creating?: boolean;
  onChange: (patch: Partial<IdentityValues>) => void;
  onRoleChange: (role: UiRole) => void;
  canAssignAdmin: boolean;
  errors: UserIdentityErrors;
  helpOpen: boolean;
  onToggleHelp: () => void;
  idPrefix: string;
  children?: ReactNode;
}) {
  const { text } = useAdminUserI18n();
  const helpId = `${idPrefix}-role-access-help`;
  return (
    <SettingsSection title={text("identity")} presentation="compact">
      <div className="settings-fields">
        <UiInput id={`${idPrefix}-email`} label={text("email")} type="email" required={creating}
          value={values.email ?? ""} onChange={(event) => onChange({ email: event.target.value })}
          autoComplete="off" placeholder={creating ? text("emailPlaceholder") : undefined} error={errors.email} />
        {creating && <UiInput id={`${idPrefix}-password`} label={text("password")} type="password" required
          value={values.password ?? ""} onChange={(event) => onChange({ password: event.target.value })}
          autoComplete="new-password" error={errors.password} />}
        <UiInput label={text("fullName")} value={values.full_name ?? ""}
          onChange={(event) => onChange({ full_name: event.target.value })} placeholder={text("namePlaceholder")} />
        <UiSelect label={text("role")} value={values.role ?? "ui_user"} onChange={(event) => onRoleChange(event.target.value as UiRole)}>
          <option value="ui_none">{text("noAccess")}</option>
          <option value="ui_user">{text("user")}</option>
          <option value="ui_admin" disabled={!canAssignAdmin}>{text("admin")}{canAssignAdmin ? "" : text("restricted")}</option>
          <option value="ui_superadmin" disabled={!canAssignAdmin}>{text("superadmin")}{canAssignAdmin ? "" : text("restricted")}</option>
        </UiSelect>
        <div>
          <SettingsButton variant="secondary" aria-label={text("explainRoles")}
            aria-expanded={helpOpen} aria-controls={helpId} onClick={onToggleHelp}>
            {text("aboutRoles")}
          </SettingsButton>
          {helpOpen && <div id={helpId} className="mt-2 settings-stack">
            <p className="settings-label">{text("roleSummary")}</p>
            <dl className="settings-stack">
              {[
                [text("noAccessSummary"), text("profileOnly")],
                [text("user"), text("nonAdminWorkspaces")],
                [text("admin"), text("adminAccess")],
                [text("superadmin"), text("superadminAccess")],
              ].map(([role, access]) => <div key={role} className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <dt className="settings-label">{role}</dt><dd className="settings-readonly">{access}</dd>
              </div>)}
            </dl>
            <p className="settings-description">{text("dedicatedFlags")}</p>
          </div>}
        </div>
      </div>
      {children}
    </SettingsSection>
  );
}
