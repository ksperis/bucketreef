/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps } from "react";
import type { UiRole, UpdateUserPayload, User } from "../../api/users";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UserAvatarEditor from "../shared/UserAvatarEditor";
import { UserLanguageField, UserNotificationFields } from "../shared/UserProfilePreferenceFields";
import type { ProfileText } from "../shared/profileMessages";
import AdminUserIdentityFields, { type UserIdentityErrors } from "./AdminUserIdentityFields";

type Props = {
  user: User;
  values: UpdateUserPayload;
  role: UiRole;
  errors: UserIdentityErrors;
  canAssignAdmin: boolean;
  roleHelpOpen: boolean;
  busy: boolean;
  text: ProfileText;
  onChange: (patch: Partial<UpdateUserPayload>) => void;
  onRoleChange: (role: UiRole) => void;
  onToggleRoleHelp: () => void;
  onAvatarDirtyChange: (dirty: boolean) => void;
  onAvatarBusyChange: (busy: boolean) => void;
  onAvatarSave: ComponentProps<typeof UserAvatarEditor>["onSave"];
};

export default function AdminUserProfilePanel({
  user,
  values,
  role,
  errors,
  canAssignAdmin,
  roleHelpOpen,
  busy,
  text,
  onChange,
  onRoleChange,
  onToggleRoleHelp,
  onAvatarDirtyChange,
  onAvatarBusyChange,
  onAvatarSave,
}: Props) {
  return (
    <>
      <AdminUserIdentityFields
        idPrefix="edit-user"
        values={{ ...values, role }}
        errors={errors}
        onChange={onChange}
        canAssignAdmin={canAssignAdmin}
        helpOpen={roleHelpOpen}
        onToggleHelp={onToggleRoleHelp}
        onRoleChange={onRoleChange}
      >
        <UserAvatarEditor
          avatar={user.avatar}
          name={user.full_name}
          email={user.email}
          text={text}
          disabled={busy}
          onDirtyChange={onAvatarDirtyChange}
          onBusyChange={onAvatarBusyChange}
          onSave={onAvatarSave}
        />
      </AdminUserIdentityFields>
      <SettingsSection title={text("display")} presentation="compact">
        <UserLanguageField
          value={values.ui_language ?? "auto"}
          text={text}
          onChange={(value) => onChange({ ui_language: value === "auto" ? null : value })}
        />
      </SettingsSection>
      <UserNotificationFields
        quotaAlerts={values.quota_alerts_enabled !== false}
        quotaWatch={Boolean(values.quota_alerts_global_watch)}
        canWatch={role === "ui_admin" || role === "ui_superadmin"}
        text={text}
        onQuotaAlertsChange={(value) => onChange({ quota_alerts_enabled: value })}
        onQuotaWatchChange={(value) => onChange({ quota_alerts_global_watch: value })}
      />
    </>
  );
}
