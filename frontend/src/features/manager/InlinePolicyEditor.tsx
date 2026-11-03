/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { inlinePolicyNameFormatError, type IAMEntity, type NamingValidationProfile } from "../../utils/resourceNames";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { InlinePolicy } from "../../api/managerIamPolicies";
import { extractApiError } from "../../utils/apiError";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import InlinePolicyChoice from "./InlinePolicyChoice";
import SettingsJsonEditor from "../../components/settings/SettingsJsonEditor";
import UiInput from "../../components/ui/UiInput";
import { SettingsButton, SettingsDialog, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { useManagerI18n } from "./managerI18n";

type InlinePolicyEditorProps = {
  entityLabel: string;
  entityType?: IAMEntity;
  namingValidationProfile?: NamingValidationProfile | null;
  entityName: string;
  loadPolicies: () => Promise<InlinePolicy[]>;
  savePolicy: (name: string, document: Record<string, unknown>) => Promise<void>;
  deletePolicy: (name: string) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
};

type EditorMode = "idle" | "create" | "edit";

export default function InlinePolicyEditor({
  entityLabel,
  entityType = "user",
  namingValidationProfile = "standard",
  entityName,
  loadPolicies,
  savePolicy,
  deletePolicy,
  disabled = false,
  disabledReason,
}: InlinePolicyEditorProps) {
  const { text } = useManagerI18n();
  const [policies, setPolicies] = useState<InlinePolicy[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [activePolicyName, setActivePolicyName] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("idle");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const deleteConfirmation = useConfirmActionDialog();
  const [validationAttempted, setValidationAttempted] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const controlsDisabled = disabled || namingValidationProfile === null || loading || saving || deleting;
  let parsedDocument: Record<string, unknown> | undefined;
  let documentError: string | undefined;
  try {
    parsedDocument = policyText.trim() ? JSON.parse(policyText) : {};
  } catch {
    documentError = "Inline policy must be valid JSON.";
  }

  const trimmedName = selectedName.trim();
  const nameFormatError = editorMode === "create"
    ? inlinePolicyNameFormatError(trimmedName, entityType, namingValidationProfile ?? "standard")
    : undefined;
  const hasPolicies = policies.length > 0;
  const selectedPolicy = activePolicyName ? policies.find((policy) => policy.name === activePolicyName) ?? null : null;
  const canDelete = editorMode === "edit" && Boolean(selectedPolicy);

  const extractError = useCallback(
    (err: unknown): string => extractApiError(err, text("Unexpected error")),
    [text],
  );

  const formatPolicyText = (policy?: InlinePolicy) => {
    if (!policy) return "";
    try {
      return JSON.stringify(policy.document ?? {}, null, 2);
    } catch {
      return "";
    }
  };

  const refresh = useCallback(async () => {
    if (disabled || !entityName) {
      setPolicies([]);
      return;
    }
    setLoading(true);
    setListError(null);
    try {
      const data = await loadPolicies();
      setPolicies(data);
    } catch (err) {
      setListError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [disabled, entityName, extractError, loadPolicies]);

  useEffect(() => {
    setSelectedName("");
    setPolicyText("");
    setActivePolicyName(null);
    setEditorMode("idle");
    setMessage(null);
    setListError(null);
    setEditorError(null);
    setValidationAttempted(false);
    void refresh();
  }, [entityName, disabled, refresh]);

  const handleSelectExisting = (name: string) => {
    const existing = policies.find((policy) => policy.name === name);
    if (!existing) return;
    setActivePolicyName(existing.name);
    setSelectedName(existing.name);
    setPolicyText(formatPolicyText(existing));
    setEditorMode("edit");
    setMessage(null);
    setEditorError(null);
    setValidationAttempted(false);
  };

  const handleStartCreate = () => {
    setActivePolicyName(null);
    setSelectedName("");
    setPolicyText("");
    setEditorMode("create");
    setMessage(null);
    setEditorError(null);
    setValidationAttempted(false);
  };

  const closeEditor = useCallback(() => {
    setActivePolicyName(null);
    setSelectedName("");
    setPolicyText("");
    setEditorMode("idle");
    setEditorError(null);
    setValidationAttempted(false);
  }, []);

  const handleInsertTemplate = () => {
    setPolicyText(DEFAULT_INLINE_POLICY_TEXT);
    setEditorError(null);
  };

  const dirty = editorMode === "create"
    ? selectedName !== "" || policyText !== ""
    : editorMode === "edit" && selectedPolicy
      ? policyText !== formatPolicyText(selectedPolicy)
      : false;
  const closeGuard = useSettingsCloseGuard({
    hasUnsavedChanges: dirty,
    disabled: saving || deleting,
    description: text("You have unsaved inline policy changes. Continuing will discard them."),
    onClose: closeEditor,
  });

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (controlsDisabled) return;
    setValidationAttempted(true);
    const targetName = editorMode === "edit" ? selectedPolicy?.name ?? "" : trimmedName;
    if (!targetName || (editorMode === "create" && nameFormatError) || documentError) {
      focusFirstInvalidField(event.currentTarget as HTMLFormElement);
      return;
    }

    setSaving(true);
    setEditorError(null);
    try {
      await savePolicy(targetName, parsedDocument!);
      await refresh();
      closeEditor();
      setMessage(text(editorMode === "edit" ? "Inline policy updated." : "Inline policy saved."));
    } catch (err) {
      setEditorError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedPolicy = async () => {
    if (controlsDisabled || !selectedPolicy) return;
    setDeleting(true);
    setEditorError(null);
    try {
      await deletePolicy(selectedPolicy.name);
      await refresh();
      closeEditor();
      setMessage(text("Inline policy deleted."));
    } catch (err) {
      setEditorError(extractError(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = () => {
    if (controlsDisabled || !selectedPolicy) return;
    const policyName = selectedPolicy.name;
    deleteConfirmation.requestConfirmation({
      title: text("Delete inline policy?"),
      description: text("Permanently remove this policy embedded in {entity}.", { entity: entityLabel }),
      confirmLabel: text("Delete inline policy"),
      details: [
        { label: entityLabel, value: entityName },
        { label: text("Policy"), value: policyName },
      ],
      impacts: [text("Permissions granted only by this inline policy will no longer apply to {entity}.", { entity: entityLabel })],
      onConfirm: deleteSelectedPolicy,
    });
  };

  return (
    <>
      <SettingsSection title={text("Inline policies")} presentation="compact"
        description={hasPolicies ? text("Select an existing inline policy to review or edit.") : text("No inline policies created yet.")}>
        <div className="settings-stack">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="settings-description">{text("{count} {policyLabel}", { count: policies.length, policyLabel: text(policies.length === 1 ? "policy" : "policies") })}</span>
            <SettingsButton variant="secondary" onClick={handleStartCreate} disabled={controlsDisabled}>
              {text("Create inline policy")}
            </SettingsButton>
            <SettingsButton variant="secondary" onClick={() => void refresh()} disabled={controlsDisabled}>
              {text(loading ? "Refreshing..." : "Refresh")}
            </SettingsButton>
          </div>
          {disabled && <UiInlineMessage tone="warning">{disabledReason ?? text("Select a context before editing inline policies.")}</UiInlineMessage>}
          {listError && <UiInlineMessage tone="error">{text(listError)}</UiInlineMessage>}
          {message && <UiInlineMessage tone="success" className="[overflow-wrap:anywhere]">{message}</UiInlineMessage>}
          <div className="settings-stack">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="settings-label">{text("Existing inline policies")}</h3>
              {loading && <span className="settings-description">{text("Loading inline policies...")}</span>}
            </div>
            {!loading && !hasPolicies && <p className="settings-description">{text("No inline policy exists yet.")}</p>}
            <div className="grid gap-2">
              {policies.map((policy) => (
                <InlinePolicyChoice key={policy.name} policy={policy}
                  disabled={controlsDisabled} onSelect={() => handleSelectExisting(policy.name)} />
              ))}
            </div>
          </div>
        </div>
      </SettingsSection>

      {editorMode !== "idle" && (
        <SettingsDialog
          title={editorMode === "edit" && selectedPolicy
            ? `${text("Edit inline policy")} — ${selectedPolicy.name}`
            : text("Create inline policy")}
          onClose={closeGuard.requestClose}
          closeDisabled={saving || deleting}
          initialFocusRef={nameInputRef}
          maxWidthClass="max-w-4xl"
          maxBodyHeightClass="max-h-[80vh]"
        >
          <form aria-label={text(editorMode === "edit" ? "Edit inline policy" : "Create inline policy")} noValidate onSubmit={handleSave}>
            <fieldset disabled={saving || deleting} className="settings-fields">
              {editorError && <UiInlineMessage tone="error">{text(editorError)}</UiInlineMessage>}
              {editorMode === "edit" && selectedPolicy ? (
                <UiInput ref={nameInputRef} label={text("Inline policy name")} value={selectedPolicy.name} readOnly />
              ) : (
                <UiInput ref={nameInputRef} label={text("Inline policy name")} required value={selectedName}
                  onChange={(event) => setSelectedName(event.target.value)} placeholder={text("inline-policy")}
                  error={nameFormatError ? text(nameFormatError) : validationAttempted && !trimmedName ? text("Inline policy name is required.") : undefined} />
              )}
              <SettingsJsonEditor label={text("Inline policy document (JSON)")} value={policyText} onChange={setPolicyText}
                rows={16} error={validationAttempted ? documentError : undefined}
                hint={text("Blank JSON will save as an empty document.")} placeholder={text("{\n  \"Version\": \"2012-10-17\",\n  \"Statement\": []\n}")} />
              <div className="flex justify-end">
                <SettingsButton type="button" variant="secondary" onClick={handleInsertTemplate}>{text("Insert template")}</SettingsButton>
              </div>
            </fieldset>
            <div className="settings-actions">
              {canDelete && <SettingsButton type="button" variant="danger" className="mr-auto" onClick={handleDelete} disabled={saving || deleting}>
                {text(deleting ? "Deleting..." : "Delete inline policy")}
              </SettingsButton>}
              <SettingsButton type="button" variant="secondary" onClick={closeGuard.requestClose} disabled={saving || deleting}>{text("Cancel")}</SettingsButton>
              <SettingsButton type="submit" disabled={saving || deleting}>
                {text(saving ? "Saving..." : editorMode === "edit" ? "Save changes" : "Create inline policy")}
              </SettingsButton>
            </div>
          </form>
        </SettingsDialog>
      )}

      {deleteConfirmation.confirmationDialog}
      {closeGuard.confirmationDialog}
    </>
  );
}
