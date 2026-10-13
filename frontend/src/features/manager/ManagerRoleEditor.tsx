/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useState, type FormEvent } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import { getIamRole, updateIamRole } from "../../api/managerIamRoles";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { useSettingsRemoteDraft } from "../../components/settings/useSettingsRemoteDraft";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { extractApiError } from "../../utils/apiError";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import ManagerRoleFormFields from "./ManagerRoleFormFields";
import { DEFAULT_ASSUME_ROLE_DOCUMENT, DEFAULT_ROLE_PATH, parseIamRolePolicy } from "./iamRoleForm";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";

function formatPolicy(document: unknown): string {
  if (!document) return DEFAULT_ASSUME_ROLE_DOCUMENT;
  if (typeof document === "string") {
    try { return JSON.stringify(JSON.parse(document), null, 2); }
    catch { return document; }
  }
  try { return JSON.stringify(document, null, 2); }
  catch { return DEFAULT_ASSUME_ROLE_DOCUMENT; }
}

/** A mounted role/executor owns the request and draft until save or dismissal. */
export default function ManagerRoleEditor({ accountId, roleName, onClose, onSaved }: {
  accountId: S3AccountSelector;
  roleName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { text } = useManagerI18n();
  const load = useCallback(async () => {
    const role = await getIamRole(accountId, roleName);
    return { path: role.path ?? DEFAULT_ROLE_PATH, policy: formatPolicy(role.assume_role_policy_document) };
  }, [accountId, roleName]);
  const { draft, setDraft, accept, dirty, loading, loadError, retry } = useSettingsRemoteDraft(
    () => ({ path: DEFAULT_ROLE_PATH, policy: DEFAULT_ASSUME_ROLE_DOCUMENT }), load, "Unable to load role details.",
  );
  const [saving, setSaving] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const parsed = parseIamRolePolicy(draft.policy);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    if (loading || loadError || saving) return;
    setValidationAttempted(true);
    if (parsed.error) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const role = await updateIamRole(accountId, roleName, { assume_role_policy_document: parsed.document });
      accept({ path: role.path ?? DEFAULT_ROLE_PATH, policy: formatPolicy(role.assume_role_policy_document) });
      setSaved(true);
      onSaved();
    } catch (error) {
      setError(extractApiError(error, text("Unable to update role.")));
    } finally { setSaving(false); }
  };
  return <SettingsWorkflowForm title={text("Edit IAM role: {role}", { role: roleName })} formLabel={text("Edit IAM role")}
    description={text("Review the role identity and update its trust policy.")}
    breadcrumbs={managerPageBreadcrumbs(text, "roles", { label: text("Edit") })} backLabel={text("Back to roles")}
    contentVariant="plain" dirty={dirty && !loading && !loadError} busy={saving} loading={loading}
    disabled={Boolean(loadError)} error={loadError || error} onSubmit={save} onClose={onClose}
    persistentEdit submitLabel={text("Save changes")} busyLabel={text("Saving...")}>
    {loading && <p role="status" className="settings-description">{text("Loading role details...")}</p>}
    {saved && <UiInlineMessage tone="success" role="status">{text("Role updated")}</UiInlineMessage>}
    {loadError && <div><SettingsButton variant="secondary" onClick={retry}>{text("Retry loading")}</SettingsButton></div>}
    <fieldset disabled={Boolean(loadError)} className="min-w-0">
      <ManagerRoleFormFields editing name={roleName} path={draft.path} policy={draft.policy}
        onPolicyChange={policy => { setDraft(value => ({ ...value, policy })); setError(null); }}
        policyError={validationAttempted ? parsed.error : undefined} />
    </fieldset>
  </SettingsWorkflowForm>;
}
