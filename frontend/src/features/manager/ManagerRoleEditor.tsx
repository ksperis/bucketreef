/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useState, type FormEvent } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import { deleteRoleTag, getIamRole, putRoleTags, type IAMTag, updateIamRole } from "../../api/managerIamRoles";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { useSettingsRemoteDraft } from "../../components/settings/useSettingsRemoteDraft";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { extractApiError } from "../../utils/apiError";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import ManagerRoleFormFields from "./ManagerRoleFormFields";
import ManagerRoleTagsEditor, { roleTagError } from "./ManagerRoleTagsEditor";
import { DEFAULT_ASSUME_ROLE_DOCUMENT, DEFAULT_ROLE_PATH, parseIamRolePolicy } from "./iamRoleForm";
import { roleMaxSessionDurationError } from "./iamIdentityForm";
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

function tagsByKey(tags: IAMTag[]): Map<string, IAMTag[]> {
  const result = new Map<string, IAMTag[]>();
  for (const tag of tags) result.set(tag.key, [...(result.get(tag.key) ?? []), tag]);
  return result;
}

function sameTags(left: IAMTag[], right: IAMTag[]): boolean {
  const normalize = (tags: IAMTag[]) => tags.map(tag => `${tag.key}\u0000${tag.value}`).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

/** A mounted role/executor owns the request and draft until save or dismissal. */
export default function ManagerRoleEditor({ accountId, roleName, onClose, onSaved, mode = "all", embedded = false }: {
  accountId: S3AccountSelector;
  roleName: string;
  onClose: () => void;
  onSaved: () => void;
  mode?: "all" | "general" | "trust";
  embedded?: boolean;
}) {
  const { text } = useManagerI18n();
  const load = useCallback(async () => {
    const role = await getIamRole(accountId, roleName);
    return {
      arn: role.arn ?? "",
      path: role.path ?? DEFAULT_ROLE_PATH,
      policy: formatPolicy(role.assume_role_policy_document),
      maxSessionDuration: role.max_session_duration ?? 3600,
      tags: role.tags ?? [],
    };
  }, [accountId, roleName]);
  const { baseline, draft, setDraft, accept, dirty: draftDirty, loading, loadError, retry } = useSettingsRemoteDraft(
    () => ({ arn: "", path: DEFAULT_ROLE_PATH, policy: DEFAULT_ASSUME_ROLE_DOCUMENT, maxSessionDuration: 3600, tags: [] as IAMTag[] }), load, "Unable to load role details.",
  );
  const [saving, setSaving] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const parsed = parseIamRolePolicy(draft.policy);
  const maxDurationError = roleMaxSessionDurationError(draft.maxSessionDuration);
  const tagsError = draft.tags.find(roleTagError) ? "Fix invalid role tags before continuing." : undefined;
  const dirty = mode === "trust"
    ? draft.policy !== baseline.policy
    : mode === "general"
      ? draft.maxSessionDuration !== baseline.maxSessionDuration || !sameTags(draft.tags, baseline.tags)
      : draftDirty;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    if (loading || loadError || saving) return;
    setValidationAttempted(true);
    if ((mode !== "general" && parsed.error) || (mode !== "trust" && (maxDurationError || tagsError))) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const baselinePolicy = parseIamRolePolicy(baseline.policy);
      const roleChanges: Parameters<typeof updateIamRole>[2] = {};
      if (mode !== "general" && JSON.stringify(parsed.document) !== JSON.stringify(baselinePolicy.document)) {
        roleChanges.assume_role_policy_document = parsed.document;
      }
      if (mode !== "trust" && draft.maxSessionDuration !== baseline.maxSessionDuration) {
        roleChanges.max_session_duration = draft.maxSessionDuration;
      }
      if (Object.keys(roleChanges).length > 0) {
        await updateIamRole(accountId, roleName, roleChanges);
      }
      if (mode !== "trust") {
        const currentByKey = tagsByKey(baseline.tags);
        const desiredByKey = tagsByKey(draft.tags);
        for (const key of new Set([...currentByKey.keys(), ...desiredByKey.keys()])) {
          const currentTags = currentByKey.get(key) ?? [];
          const desiredTags = desiredByKey.get(key) ?? [];
          if (sameTags(currentTags, desiredTags)) continue;
          if (currentTags.length > 0) await deleteRoleTag(accountId, roleName, key);
          if (desiredTags.length > 0) await putRoleTags(accountId, roleName, desiredTags);
        }
      }
      const role = await getIamRole(accountId, roleName);
      accept({
        arn: role.arn ?? "",
        path: role.path ?? DEFAULT_ROLE_PATH,
        policy: formatPolicy(role.assume_role_policy_document),
        maxSessionDuration: role.max_session_duration ?? 3600,
        tags: role.tags ?? [],
      });
      setSaved(true);
      onSaved();
    } catch (error) {
      setError(extractApiError(error, text("Unable to update role.")));
      try { accept(await load()); } catch { /* keep the visible provider error */ }
    } finally { setSaving(false); }
  };
  return <SettingsWorkflowForm title={text("Edit IAM role: {role}", { role: roleName })} formLabel={text("Edit IAM role")}
    description={mode === "trust" ? text("Edit the trust policy used by STS AssumeRole.") : text("Review the role identity, session duration, and tags.")}
    breadcrumbs={managerPageBreadcrumbs(text, "roles", { label: text("Edit") })} backLabel={text("Back to roles")}
    embedded={embedded}
    contentVariant="plain" dirty={dirty && !loading && !loadError} busy={saving} loading={loading}
    disabled={Boolean(loadError)} error={loadError || error} onSubmit={save} onClose={onClose}
    persistentEdit submitLabel={text("Save changes")} busyLabel={text("Saving...")}>
    {loading && <p role="status" className="settings-description">{text("Loading role details...")}</p>}
    {saved && <UiInlineMessage tone="success" role="status">{text("Role updated")}</UiInlineMessage>}
    {loadError && <div><SettingsButton variant="secondary" onClick={retry}>{text("Retry loading")}</SettingsButton></div>}
    <fieldset disabled={Boolean(loadError)} className="min-w-0">
      <ManagerRoleFormFields editing sections={mode === "all" ? "all" : mode} name={roleName} path={draft.path} arn={draft.arn} policy={draft.policy}
        maxSessionDuration={draft.maxSessionDuration}
        onPolicyChange={policy => { setDraft(value => ({ ...value, policy })); setError(null); }}
        onMaxSessionDurationChange={maxSessionDuration => { setDraft(value => ({ ...value, maxSessionDuration })); setError(null); }}
        policyError={validationAttempted ? parsed.error : undefined}
        maxSessionDurationError={validationAttempted ? maxDurationError : undefined} />
      {mode !== "trust" && <ManagerRoleTagsEditor tags={draft.tags} onChange={tags => { setDraft(value => ({ ...value, tags })); setError(null); }} />}
      {mode !== "trust" && validationAttempted && tagsError && <UiInlineMessage tone="error">{text(tagsError)}</UiInlineMessage>}
    </fieldset>
  </SettingsWorkflowForm>;
}
