/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { inlinePolicyNameFormatError, type IAMEntity, type NamingValidationProfile } from "../../utils/resourceNames";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { InlinePolicy } from "../../api/managerIamPolicies";
import { extractApiError } from "../../utils/apiError";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import InlinePolicyChoice from "./InlinePolicyChoice";
import SettingsJsonEditor from "../../components/settings/SettingsJsonEditor";
import UiInput from "../../components/ui/UiInput";
import { SettingsButton, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const deleteConfirmation = useConfirmActionDialog();
  const [validationAttempted, setValidationAttempted] = useState(false);
  const replacementMessageId = useId();
  const pendingTransition = useRef<() => void>(() => {});
  const controlsDisabled = disabled || namingValidationProfile === null || loading || saving || deleting;
  let parsedDocument: Record<string, unknown> | undefined;
  let documentError: string | undefined;
  try {
    parsedDocument = policyText.trim() ? JSON.parse(policyText) : {};
  } catch {
    documentError = "Inline policy must be valid JSON.";
  }

  const trimmedName = selectedName.trim();
  const nameFormatError = inlinePolicyNameFormatError(trimmedName, entityType, namingValidationProfile ?? "standard");
  const hasPolicies = policies.length > 0;
  const selectedPolicy = activePolicyName ? policies.find((policy) => policy.name === activePolicyName) ?? null : null;
  const replacementTarget = trimmedName
    ? policies.find((policy) => policy.name === trimmedName && policy.name !== activePolicyName) ?? null
    : null;
  const createsNewFromExisting = Boolean(activePolicyName && trimmedName && trimmedName !== activePolicyName && !replacementTarget);
  const canDelete = editorMode === "edit" && Boolean(selectedPolicy);
  const showPromptState = editorMode === "idle";
  const actionLabel = useMemo(() => {
    if (activePolicyName && trimmedName === activePolicyName) {
      return "Update existing inline policy";
    }
    if (replacementTarget) {
      return "Replace existing inline policy";
    }
    return "Save new inline policy";
  }, [activePolicyName, replacementTarget, trimmedName]);

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

  const refresh = useCallback(async (nextActiveName: string | null) => {
    if (disabled || !entityName) {
      setPolicies([]);
      setActivePolicyName(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await loadPolicies();
      setPolicies(data);

      if (!nextActiveName) {
        return;
      }

      const current = data.find((policy) => policy.name === nextActiveName);
      if (current) {
        setActivePolicyName(current.name);
        setSelectedName(current.name);
        setPolicyText(formatPolicyText(current));
        setEditorMode("edit");
        setValidationAttempted(false);
        return;
      }

      setActivePolicyName(null);
      setSelectedName("");
      setPolicyText("");
      setEditorMode("idle");
    } catch (err) {
      setError(extractError(err));
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
    setError(null);
    setValidationAttempted(false);
    void refresh(null);
  }, [entityName, disabled, refresh]);

  const handleSelectExisting = (name: string) => {
    const existing = policies.find((policy) => policy.name === name);
    if (!existing) return;
    setActivePolicyName(existing.name);
    setSelectedName(existing.name);
    setPolicyText(formatPolicyText(existing));
    setEditorMode("edit");
    setMessage(null);
    setError(null);
    setValidationAttempted(false);
  };

  const handleStartCreate = () => {
    setActivePolicyName(null);
    setSelectedName("");
    setPolicyText("");
    setEditorMode("create");
    setMessage(null);
    setError(null);
    setValidationAttempted(false);
  };

  const handleCancel = () => {
    setActivePolicyName(null);
    setSelectedName("");
    setPolicyText("");
    setEditorMode("idle");
    setMessage(null);
    setError(null);
    setValidationAttempted(false);
  };

  const handleInsertTemplate = () => {
    setPolicyText(DEFAULT_INLINE_POLICY_TEXT);
    setMessage(null);
    setError(null);
  };

  const dirty = editorMode !== "idle" && (
    selectedName !== (selectedPolicy?.name ?? "") || policyText !== formatPolicyText(selectedPolicy ?? undefined)
  );
  const transitionGuard = useSettingsCloseGuard({
    hasUnsavedChanges: dirty,
    disabled: controlsDisabled,
    description: text("You have unsaved inline policy changes. Continuing will discard them."),
    onClose: () => pendingTransition.current(),
  });
  const requestTransition = (action: () => void) => {
    if (controlsDisabled) return;
    pendingTransition.current = action;
    transitionGuard.requestClose();
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (controlsDisabled) return;
    setValidationAttempted(true);
    if (!trimmedName || nameFormatError || documentError) {
      focusFirstInvalidField(event.currentTarget as HTMLFormElement);
      return;
    }

    const isUpdatingSelected = Boolean(activePolicyName && trimmedName === activePolicyName);
    const isReplacingExisting = Boolean(replacementTarget);
    const isCreatingFromExisting = Boolean(activePolicyName && trimmedName !== activePolicyName && !replacementTarget);

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await savePolicy(trimmedName, parsedDocument!);
      await refresh(trimmedName);
      if (isUpdatingSelected) {
        setMessage(text("Inline policy updated."));
      } else if (isReplacingExisting) {
        setMessage(`Inline policy "${trimmedName}" replaced.`);
      } else if (isCreatingFromExisting) {
        setMessage(`New inline policy "${trimmedName}" created. "${activePolicyName}" remains unchanged.`);
      } else {
        setMessage(text("Inline policy saved."));
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedPolicy = async () => {
    if (controlsDisabled || !selectedPolicy) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      await deletePolicy(selectedPolicy.name);
      await refresh(null);
      setActivePolicyName(null);
      setSelectedName("");
      setPolicyText("");
      setEditorMode("idle");
      setMessage(text("Inline policy deleted."));
    } catch (err) {
      setError(extractError(err));
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
    <SettingsSection title={text("Inline policies")} presentation="compact"
      description={selectedPolicy ? text("Update the selected inline policy or create a separate one.") : hasPolicies
        ? text("Select an existing inline policy to review or edit.") : text("No inline policies created yet.")}>
      <div className="settings-stack">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="settings-description">{text("{count} {policyLabel}", { count: policies.length, policyLabel: text(policies.length === 1 ? "policy" : "policies") })}</span>
          <SettingsButton variant="secondary" onClick={() => requestTransition(handleStartCreate)} disabled={controlsDisabled}>
            {text(hasPolicies ? "Create new inline policy" : "Create inline policy")}
          </SettingsButton>
          <SettingsButton variant="secondary" onClick={() => requestTransition(() => {
            if (!activePolicyName) handleCancel();
            void refresh(activePolicyName);
          })} disabled={controlsDisabled}>
            {text(loading ? "Refreshing..." : "Refresh")}
          </SettingsButton>
        </div>
        {disabled && <UiInlineMessage tone="warning">{disabledReason ?? text("Select a context before editing inline policies.")}</UiInlineMessage>}
        {error && <UiInlineMessage tone="error">{text(error)}</UiInlineMessage>}
        {message && <UiInlineMessage tone="success" className="[overflow-wrap:anywhere]">{message}</UiInlineMessage>}
        <div className="settings-stack">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="settings-label">{text("Existing inline policies")}</h3>
            {loading && <span className="settings-description">{text("Loading inline policies...")}</span>}
          </div>
          {!loading && !hasPolicies && <p className="settings-description">{text("No inline policy exists yet.")}</p>}
          <div className="grid gap-2">
            {policies.map((policy) => (
              <InlinePolicyChoice key={policy.name} policy={policy} selected={policy.name === selectedPolicy?.name}
                disabled={controlsDisabled} onSelect={() => requestTransition(() => handleSelectExisting(policy.name))} />
            ))}
          </div>
        </div>
        {showPromptState ? (
          <div className="settings-body">
            <p>{text(hasPolicies ? "Select an existing inline policy to review or edit" : "Create the first inline policy")}</p>
            <p className="settings-description mt-1">
              {hasPolicies ? text("Existing inline policies stay visible above so you can avoid creating a second policy by mistake.")
                : text("Add an inline JSON policy that will live directly on {entity}.", { entity: entityLabel })}
            </p>
          </div>
        ) : (
          <form aria-label={text("Edit inline policy")} noValidate onSubmit={handleSave}>
            <fieldset disabled={controlsDisabled} className="settings-fields">
              <div>
                <h3 className="settings-label [overflow-wrap:anywhere]">{selectedPolicy ? text("Edit \"{name}\"", { name: selectedPolicy.name }) : text("Create a new inline policy")}</h3>
                <p className="settings-description mt-1">
                  {selectedPolicy ? text("Update the selected inline policy or change its name to save a different one.")
                    : text("Provide a name and valid JSON to create a new inline policy on {entity}.", { entity: entityLabel })}
                </p>
              </div>
              {(replacementTarget || createsNewFromExisting) && (
                <div id={replacementMessageId}>
                  <UiInlineMessage tone={replacementTarget ? "warning" : "info"} className="[overflow-wrap:anywhere]">
                    {replacementTarget
                      ? text("Saving with the name \"{name}\" will replace that existing inline policy. The currently selected policy will remain unchanged.", { name: replacementTarget.name })
                      : text("Changing the name from \"{name}\" will create a new inline policy instead of editing the selected one.", { name: activePolicyName ?? "" })}
                  </UiInlineMessage>
                </div>
              )}
              <UiInput label={text("Inline policy name")} required value={selectedName} onChange={(event) => setSelectedName(event.target.value)}
                placeholder={text("inline-policy")} aria-describedby={replacementTarget || createsNewFromExisting ? replacementMessageId : undefined}
                error={nameFormatError ? text(nameFormatError) : validationAttempted && !trimmedName ? text("Inline policy name is required.") : undefined} />
              <SettingsJsonEditor label={text("Inline policy document (JSON)")} value={policyText} onChange={setPolicyText}
                rows={10} error={validationAttempted ? documentError : undefined}
                hint={text("Blank JSON will save as an empty document.")} placeholder={text("{\n  \"Version\": \"2012-10-17\",\n  \"Statement\": []\n}")} />
              <div className="flex justify-end">
                <SettingsButton variant="secondary" onClick={handleInsertTemplate}>{text("Insert template")}</SettingsButton>
              </div>
            </fieldset>
            <div className="settings-actions">
              {canDelete && <SettingsButton variant="danger" className="mr-auto" onClick={handleDelete} disabled={controlsDisabled}>
              {text(deleting ? "Deleting..." : "Delete inline policy")}
              </SettingsButton>}
              <SettingsButton variant="secondary" onClick={() => requestTransition(handleCancel)} disabled={controlsDisabled}>{text("Cancel")}</SettingsButton>
              <SettingsButton type="submit" disabled={controlsDisabled}>{text(saving ? "Saving..." : actionLabel)}</SettingsButton>
            </div>
          </form>
        )}
      </div>
      {deleteConfirmation.confirmationDialog}
      {transitionGuard.confirmationDialog}
    </SettingsSection>
  );
}
