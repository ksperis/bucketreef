/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  SettingsButton,
  SettingsInput,
  SettingsSelect,
} from "../../../components/settings/SettingsControls";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureEditorDialog from "./BucketFeatureEditorDialog";
import {
  BucketFeatureEditorEmpty,
  BucketFeatureEditorItem,
  BucketFeatureEditorList,
  BucketFeatureEditorToolbar,
  BucketFeatureJsonPane,
} from "./BucketFeatureEditorLayout";
import BucketFeatureSection from "./BucketFeatureSection";
import EndpointFeatureDisabledNotice from "./EndpointFeatureDisabledNotice";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import {
  isEncryptionRuleVisuallyEditable,
  readEncryptionVisualRule,
  type EncryptionRuleRecord,
  type EncryptionVisualRulePatch,
} from "./encryptionEditorModel";
import type { useBucketEncryptionController } from "./useBucketEncryptionController";

type BucketEncryptionController = ReturnType<typeof useBucketEncryptionController>;

type BucketEncryptionFeatureProps = {
  controller: BucketEncryptionController;
  enabled: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ruleAlgorithm(rule: EncryptionRuleRecord): string {
  const defaults = asRecord(rule.ApplyServerSideEncryptionByDefault);
  return typeof defaults?.SSEAlgorithm === "string" ? defaults.SSEAlgorithm : "—";
}

function ruleKmsKey(rule: EncryptionRuleRecord): string {
  const defaults = asRecord(rule.ApplyServerSideEncryptionByDefault);
  return typeof defaults?.KMSMasterKeyID === "string" && defaults.KMSMasterKeyID
    ? defaults.KMSMasterKeyID
    : "—";
}

function ruleBucketKey(rule: EncryptionRuleRecord): string {
  return rule.BucketKeyEnabled === true
    ? "Enabled"
    : rule.BucketKeyEnabled === false
      ? "Disabled"
      : "Provider default";
}

function EncryptionRuleEditor({
  index,
  rule,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  rule: EncryptionRuleRecord;
  disabled: boolean;
  onChange: (patch: EncryptionVisualRulePatch) => void;
  onRemove: () => void;
}) {
  const editable = isEncryptionRuleVisuallyEditable(rule);

  if (!editable) {
    return (
      <BucketFeatureEditorItem testId="encryption-advanced-rule">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="settings-label">Rule {index + 1}</p>
            <p className="settings-description mt-1">
              {ruleAlgorithm(rule)} · KMS key: {ruleKmsKey(rule)} · Bucket key: {ruleBucketKey(rule)}
            </p>
          </div>
          <UiBadge tone="warning">Advanced rule — edit in JSON</UiBadge>
        </div>
        <p className="settings-description">
          This rule contains fields or values that the visual editor cannot represent without loss.
        </p>
      </BucketFeatureEditorItem>
    );
  }

  const draft = readEncryptionVisualRule(rule);

  return (
    <BucketFeatureEditorItem testId="encryption-visual-rule">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="settings-label">Rule {index + 1}</p>
        </div>
        <SettingsButton type="button" variant="danger" onClick={onRemove} disabled={disabled}>
          Remove rule
        </SettingsButton>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsSelect
          label="Encryption algorithm"
          value={draft.algorithm}
          onChange={(event) =>
            onChange({ algorithm: event.target.value as "AES256" | "aws:kms" })
          }
          disabled={disabled}
        >
          <option value="AES256">AES256 (SSE-S3)</option>
          <option value="aws:kms">aws:kms (SSE-KMS)</option>
        </SettingsSelect>

        {draft.algorithm === "aws:kms" ? (
          <SettingsSelect
            label="S3 bucket key"
            value={draft.bucketKeyState}
            onChange={(event) =>
              onChange({
                bucketKeyState: event.target.value as "default" | "enabled" | "disabled",
              })
            }
            disabled={disabled}
          >
            <option value="default">Provider default</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </SettingsSelect>
        ) : null}
      </div>

      {draft.algorithm === "aws:kms" ? (
        <SettingsInput
          label="KMS key ID (optional)"
          value={draft.kmsKeyId}
          placeholder="Key ID, alias, or ARN supported by the endpoint"
          onChange={(event) => onChange({ kmsKeyId: event.target.value })}
          disabled={disabled}
          hint="Leave empty to use the provider default KMS key when supported."
        />
      ) : (
        <p className="settings-description">
          AES256 uses provider-managed S3 encryption and does not require a KMS key.
        </p>
      )}
    </BucketFeatureEditorItem>
  );
}

export default function BucketEncryptionFeature({
  controller,
  enabled,
}: BucketEncryptionFeatureProps) {
  const {
    addDraftRule,
    closeEditor,
    configured,
    draftRules,
    draftSignature,
    dirty,
    editorError,
    editorMode,
    editorOpen,
    error,
    jsonText,
    loading,
    openEditor,
    removeDraftRule,
    ruleCount,
    rules,
    saveDraft,
    saving,
    status,
    updateDraftRule,
    updateEditorMode,
    updateJsonText,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const disabled = !enabled || notImplemented;
  const visualState = resolveFeatureVisualState({
    disabled,
    configured,
    unsaved: false,
  });
  const primaryRule = rules[0];

  const visualEditor = (
    <div className="space-y-3">
      <BucketFeatureEditorToolbar
        action={
          <SettingsButton type="button" variant="secondary" onClick={addDraftRule} disabled={saving}>
            Add rule
          </SettingsButton>
        }
      >
        <p>
          Configure the default encryption rules applied by S3 to new objects. Advanced rules remain read-only here and are preserved for JSON editing.
        </p>
      </BucketFeatureEditorToolbar>
      {draftRules.length === 0 ? (
        <BucketFeatureEditorEmpty>
          Default bucket encryption is disabled. Add a rule to enable it.
        </BucketFeatureEditorEmpty>
      ) : (
        <BucketFeatureEditorList>
          {draftRules.map((rule, index) => (
            <EncryptionRuleEditor
              key={index}
              index={index}
              rule={rule}
              disabled={saving}
              onChange={(patch) => updateDraftRule(index, patch)}
              onRemove={() => removeDraftRule(index)}
            />
          ))}
        </BucketFeatureEditorList>
      )}
    </div>
  );

  const jsonEditor = (
    <BucketFeatureJsonPane
      description={
        <>
        Edit the complete S3 server-side encryption <code>Rules</code> array. Switching back to Visual validates the JSON structure first.
        </>
      }
      label="Encryption rules (JSON)"
      value={jsonText}
      onChange={updateJsonText}
      disabled={saving}
    />
  );

  return (
    <>
      <BucketFeatureSection
        title="Server-side encryption"
        description="Default S3 encryption applied to new objects in this bucket."
        mode="hybrid"
        visualState={visualState}
        stateLabel={disabled ? undefined : configured ? "Configured" : "Inactive"}
        successMessage={status}
        busy={loading}
        testId="bucket-feature-encryption"
      >
        {!enabled ? (
          <EndpointFeatureDisabledNotice featureLabel="Server-side encryption" />
        ) : error ? (
          <UiInlineMessage tone="error">{error}</UiInlineMessage>
        ) : loading ? (
          <UiInlineMessage>Loading encryption configuration...</UiInlineMessage>
        ) : (
          <div className="bucket-feature-summary-row">
            <div className={configured ? "bucket-feature-summary-value" : "bucket-feature-summary-muted"}>
              {primaryRule ? (
                <>
                  <strong>{ruleAlgorithm(primaryRule)}</strong>
                  {ruleKmsKey(primaryRule) !== "—"
                    ? ` · ${ruleKmsKey(primaryRule)}`
                    : " · S3 managed key"}
                  {ruleCount > 1 ? ` · ${ruleCount} rules` : ""}
                </>
              ) : (
                "No default encryption configuration."
              )}
            </div>
            <SettingsButton
              type="button"
              variant="secondary"
              onClick={openEditor}
              disabled={disabled || saving}
            >
              {configured ? "Edit" : "Configure"}
            </SettingsButton>
          </div>
        )}
      </BucketFeatureSection>

      {editorOpen ? (
        <BucketFeatureEditorDialog
          title="Edit server-side encryption"
          mode={editorMode}
          onModeChange={updateEditorMode}
          draftKey={draftSignature}
          dirty={dirty}
          busy={saving}
          error={editorError}
          visualContent={visualEditor}
          jsonContent={jsonEditor}
          onSave={saveDraft}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}
