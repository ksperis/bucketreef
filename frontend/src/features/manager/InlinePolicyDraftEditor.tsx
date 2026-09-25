/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId } from "react";
import type { InlinePolicy } from "../../api/managerIamPolicies";
import InlinePolicyChoice from "./InlinePolicyChoice";
import SettingsJsonEditor from "../../components/settings/SettingsJsonEditor";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";

export type InlinePolicyDraftEditorMode = "idle" | "create" | "edit";

type InlinePolicyDraftEditorProps = {
  drafts: InlinePolicy[];
  selectedDraftName: string | null;
  draftName: string;
  draftText: string;
  entityLabel: string;
  mode: InlinePolicyDraftEditorMode;
  expanded?: boolean;
  onCreateDraft: () => void;
  onSelectDraft: (name: string | null) => void;
  onDraftNameChange: (value: string) => void;
  onDraftTextChange: (value: string) => void;
  onSaveDraft: () => void;
  onRemoveDraft: (name: string) => void;
  onClearDrafts: () => void;
  onInsertTemplate: () => void;
  onToggleExpanded?: () => void;
};

export default function InlinePolicyDraftEditor({
  drafts,
  selectedDraftName,
  draftName,
  draftText,
  entityLabel,
  mode,
  expanded = true,
  onCreateDraft,
  onSelectDraft,
  onDraftNameChange,
  onDraftTextChange,
  onSaveDraft,
  onRemoveDraft,
  onClearDrafts,
  onInsertTemplate,
  onToggleExpanded,
}: InlinePolicyDraftEditorProps) {
  const contentId = useId();
  const replacementMessageId = `${contentId}-replacement`;
  const hasDrafts = drafts.length > 0;
  const selectedDraft = selectedDraftName ? drafts.find((draft) => draft.name === selectedDraftName) ?? null : null;
  const trimmedName = draftName.trim();
  const replacementTarget = trimmedName
    ? drafts.find((draft) => draft.name === trimmedName && draft.name !== selectedDraftName) ?? null
    : null;
  const actionLabel = mode === "edit" ? "Update draft" : "Save draft";
  const showIdleState = mode === "idle" && hasDrafts;
  const showEditor = mode !== "idle" || !hasDrafts;

  return (
    <SettingsSection
      title="Inline policies (optional)"
      description={`Save inline JSON policies that embed directly on this ${entityLabel}.`}
      presentation="compact"
    >
      <div className="settings-stack">
        {(hasDrafts || onToggleExpanded) && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasDrafts && <span className="settings-description">{drafts.length} saved</span>}
            {onToggleExpanded && (
              <SettingsButton
                variant="secondary"
                onClick={onToggleExpanded}
                aria-label={expanded ? "Hide inline policies" : "Show inline policies"}
                aria-expanded={expanded}
                aria-controls={contentId}
              >
                {expanded ? "Hide" : "Show"}
              </SettingsButton>
            )}
            {hasDrafts && (
              <>
                <SettingsButton variant="secondary" onClick={onClearDrafts}>Clear all</SettingsButton>
                <SettingsButton variant="secondary" onClick={onCreateDraft}>Create new inline policy</SettingsButton>
              </>
            )}
          </div>
        )}
        <div id={contentId} hidden={!expanded} className={expanded ? "settings-stack" : undefined}>
          {hasDrafts && (
            <div className="settings-stack">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="settings-label">Saved inline policies</h3>
                {showIdleState && <span className="settings-description">Select one to edit or create a new one.</span>}
              </div>
              <div className="grid gap-2">
                {drafts.map((draft) => {
                  const isSelected = draft.name === selectedDraft?.name;
                  return (
                    <div key={draft.name} className="flex min-w-0 flex-wrap items-center gap-2">
                      <InlinePolicyChoice policy={draft} selected={isSelected} onSelect={() => onSelectDraft(draft.name)} />
                      <SettingsButton
                        variant="ghost"
                        onClick={() => onRemoveDraft(draft.name)}
                        aria-label={`Remove inline policy ${draft.name}`}
                      >
                        Remove
                      </SettingsButton>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {showIdleState && (
            <div className="settings-body">
              <p>Select a saved inline policy to edit, or create a new one.</p>
              <p className="settings-description mt-1">
                Existing inline policies stay listed above so you can review them before adding another draft.
              </p>
            </div>
          )}
          {showEditor && (
            <div className="settings-fields">
              <div>
                <h3 className="settings-label break-words [overflow-wrap:anywhere]">
                  {mode === "edit" ? `Editing "${selectedDraftName}"` : "Create a new inline policy"}
                </h3>
                <p className="settings-description mt-1">
                  {mode === "edit"
                    ? `Update the selected draft before creating the ${entityLabel}.`
                    : "Provide a name and valid JSON to keep this inline policy draft visible in the form."}
                </p>
              </div>
              {replacementTarget && (
                <div id={replacementMessageId}>
                  <UiInlineMessage tone="warning" className="[overflow-wrap:anywhere]">
                    Saving this draft will replace the existing draft "{replacementTarget.name}".
                  </UiInlineMessage>
                </div>
              )}
              <UiInput
                label="Inline policy name"
                aria-describedby={replacementTarget ? replacementMessageId : undefined}
                value={draftName}
                onChange={(event) => onDraftNameChange(event.target.value)}
                placeholder="inline-policy"
              />
              <SettingsJsonEditor
                label="Inline policy document"
                value={draftText}
                onChange={onDraftTextChange}
                rows={8}
                hint="Provide valid JSON. Blank defaults to an empty document."
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <SettingsButton variant="secondary" onClick={onInsertTemplate}>Insert template</SettingsButton>
                {hasDrafts && (
                  <SettingsButton variant="secondary" onClick={() => onSelectDraft(null)}>Cancel</SettingsButton>
                )}
                <SettingsButton onClick={onSaveDraft}>{actionLabel}</SettingsButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
