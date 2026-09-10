/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { InlinePolicy } from "../../api/managerIamPolicies";
import { extractApiError } from "../../utils/apiError";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import InlinePolicyChoice from "./InlinePolicyChoice";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import { SettingsButton, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";

type InlinePolicyEditorProps = {
  entityLabel: string;
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
  entityName,
  loadPolicies,
  savePolicy,
  deletePolicy,
  disabled = false,
  disabledReason,
}: InlinePolicyEditorProps) {
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
  const controlsDisabled = disabled || loading || saving || deleting;
  let parsedDocument: Record<string, unknown> | undefined;
  let documentError: string | undefined;
  try {
    parsedDocument = policyText.trim() ? JSON.parse(policyText) : {};
  } catch {
    documentError = "Inline policy must be valid JSON.";
  }

  const trimmedName = selectedName.trim();
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

  const extractError = (err: unknown): string => {
    return extractApiError(err, "Unexpected error");
  };

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
  }, [disabled, entityName, loadPolicies]);

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
    description: "You have unsaved inline policy changes. Continuing will discard them.",
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
    if (!trimmedName || documentError) {
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
        setMessage("Inline policy updated.");
      } else if (isReplacingExisting) {
        setMessage(`Inline policy "${trimmedName}" replaced.`);
      } else if (isCreatingFromExisting) {
        setMessage(`New inline policy "${trimmedName}" created. "${activePolicyName}" remains unchanged.`);
      } else {
        setMessage("Inline policy saved.");
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
      setMessage("Inline policy deleted.");
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
      title: "Delete inline policy?",
      description: `Permanently remove this policy embedded in the ${entityLabel}.`,
      confirmLabel: "Delete inline policy",
      details: [
        { label: entityLabel, value: entityName },
        { label: "Policy", value: policyName },
      ],
      impacts: [`Permissions granted only by this inline policy will no longer apply to the ${entityLabel}.`],
      onConfirm: deleteSelectedPolicy,
    });
  };

  return (
    <SettingsSection title="Inline policies" presentation="compact"
      description={selectedPolicy ? "Update the selected inline policy or create a separate one." : hasPolicies
        ? "Select an existing inline policy to review or edit." : "No inline policies created yet."}>
      <div className="settings-stack">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="settings-description">{policies.length} {policies.length === 1 ? "policy" : "policies"}</span>
          <SettingsButton variant="secondary" onClick={() => requestTransition(handleStartCreate)} disabled={controlsDisabled}>
            {hasPolicies ? "Create new inline policy" : "Create inline policy"}
          </SettingsButton>
          <SettingsButton variant="secondary" onClick={() => requestTransition(() => {
            if (!activePolicyName) handleCancel();
            void refresh(activePolicyName);
          })} disabled={controlsDisabled}>
            {loading ? "Refreshing..." : "Refresh"}
          </SettingsButton>
        </div>
        {disabled && <UiInlineMessage tone="warning">{disabledReason ?? "Select an account before editing inline policies."}</UiInlineMessage>}
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        {message && <UiInlineMessage tone="success" className="[overflow-wrap:anywhere]">{message}</UiInlineMessage>}
        <div className="settings-stack">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="settings-label">Existing inline policies</h3>
            {loading && <span className="settings-description">Loading inline policies...</span>}
          </div>
          {!loading && !hasPolicies && <p className="settings-description">No inline policy exists yet.</p>}
          <div className="grid gap-2">
            {policies.map((policy) => (
              <InlinePolicyChoice key={policy.name} policy={policy} selected={policy.name === selectedPolicy?.name}
                disabled={controlsDisabled} onSelect={() => requestTransition(() => handleSelectExisting(policy.name))} />
            ))}
          </div>
        </div>
        {showPromptState ? (
          <div className="settings-body">
            <p>{hasPolicies ? "Select an existing inline policy to review or edit" : "Create the first inline policy"}</p>
            <p className="settings-description mt-1">
              {hasPolicies ? "Existing inline policies stay visible above so you can avoid creating a second policy by mistake."
                : `Add an inline JSON policy that will live directly on this ${entityLabel}.`}
            </p>
          </div>
        ) : (
          <form aria-label="Edit inline policy" noValidate onSubmit={handleSave}>
            <fieldset disabled={controlsDisabled} className="settings-fields">
              <div>
                <h3 className="settings-label [overflow-wrap:anywhere]">{selectedPolicy ? `Edit "${selectedPolicy.name}"` : "Create a new inline policy"}</h3>
                <p className="settings-description mt-1">
                  {selectedPolicy ? "Update the selected inline policy or change its name to save a different one."
                    : `Provide a name and valid JSON to create a new inline policy on this ${entityLabel}.`}
                </p>
              </div>
              {(replacementTarget || createsNewFromExisting) && (
                <div id={replacementMessageId}>
                  <UiInlineMessage tone={replacementTarget ? "warning" : "info"} className="[overflow-wrap:anywhere]">
                    {replacementTarget
                      ? `Saving with the name "${replacementTarget.name}" will replace that existing inline policy. The currently selected policy will remain unchanged.`
                      : `Changing the name from "${activePolicyName}" will create a new inline policy instead of editing the selected one.`}
                  </UiInlineMessage>
                </div>
              )}
              <UiInput label="Inline policy name" required value={selectedName} onChange={(event) => setSelectedName(event.target.value)}
                placeholder="inline-policy" aria-describedby={replacementTarget || createsNewFromExisting ? replacementMessageId : undefined}
                error={validationAttempted && !trimmedName ? "Inline policy name is required." : undefined} />
              <UiTextarea label="Inline policy document (JSON)" value={policyText} onChange={(event) => setPolicyText(event.target.value)}
                className="font-mono" rows={10} spellCheck={false} error={validationAttempted ? documentError : undefined}
                hint="Blank JSON will save as an empty document." placeholder={'{\n  "Version": "2012-10-17",\n  "Statement": []\n}'} />
              <div className="flex justify-end">
                <SettingsButton variant="secondary" onClick={handleInsertTemplate}>Insert template</SettingsButton>
              </div>
            </fieldset>
            <div className="settings-actions">
              {canDelete && <SettingsButton variant="danger" className="mr-auto" onClick={handleDelete} disabled={controlsDisabled}>
                {deleting ? "Deleting..." : "Delete inline policy"}
              </SettingsButton>}
              <SettingsButton variant="secondary" onClick={() => requestTransition(handleCancel)} disabled={controlsDisabled}>Cancel</SettingsButton>
              <SettingsButton type="submit" disabled={controlsDisabled}>{saving ? "Saving..." : actionLabel}</SettingsButton>
            </div>
          </form>
        )}
      </div>
      {deleteConfirmation.confirmationDialog}
      {transitionGuard.confirmationDialog}
    </SettingsSection>
  );
}
