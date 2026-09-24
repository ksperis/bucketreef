/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import DataTableShell, { type DataTableColumn } from "../../../components/list/DataTableShell";
import {
  SettingsButton,
  SettingsInput,
  SettingsSelect,
} from "../../../components/settings/SettingsControls";
import UiBadge from "../../../components/ui/UiBadge";
import UiTextarea from "../../../components/ui/UiTextarea";
import { cx, uiCardMutedClass } from "../../../components/ui/styles";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureEditorDialog from "./BucketFeatureEditorDialog";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureSummarySection from "./BucketFeatureSummarySection";
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

type EncryptionTableRow = {
  index: number;
  rule: EncryptionRuleRecord;
};

const defaultEncryptionExample = `[
  {
    "ApplyServerSideEncryptionByDefault": {
      "SSEAlgorithm": "aws:kms",
      "KMSMasterKeyID": "example-kms-key"
    },
    "BucketKeyEnabled": true
  }
]`;

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
      <div
        className={cx(uiCardMutedClass, "space-y-2 px-3 py-3")}
        data-testid="encryption-advanced-rule"
      >
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
      </div>
    );
  }

  const draft = readEncryptionVisualRule(rule);

  return (
    <div
      className={cx(uiCardMutedClass, "space-y-4 px-3 py-3")}
      data-testid="encryption-visual-rule"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="settings-label">Rule {index + 1}</p>
          <p className="settings-description">Changes remain local until the editor is saved.</p>
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
    </div>
  );
}

export default function BucketEncryptionFeature({
  controller,
  enabled,
}: BucketEncryptionFeatureProps) {
  const [showJsonExample, setShowJsonExample] = useState(false);
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
  const rows = useMemo<EncryptionTableRow[]>(
    () => rules.map((rule, index) => ({ index, rule })),
    [rules],
  );
  const columns: Array<DataTableColumn<EncryptionTableRow>> = [
    {
      id: "rule",
      label: "Rule",
      primary: true,
      headerClassName: "min-w-28",
      cellClassName: "min-w-28",
      render: ({ rule, index }) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>Rule {index + 1}</span>
          {!isEncryptionRuleVisuallyEditable(rule) ? <UiBadge tone="warning">Advanced</UiBadge> : null}
        </div>
      ),
    },
    {
      id: "algorithm",
      label: "Algorithm",
      headerClassName: "min-w-28",
      cellClassName: "min-w-28 font-mono",
      render: ({ rule }) => ruleAlgorithm(rule),
    },
    {
      id: "kmsKey",
      label: "KMS key",
      headerClassName: "min-w-48",
      cellClassName: "min-w-48 break-all font-mono",
      render: ({ rule }) => ruleKmsKey(rule),
    },
    {
      id: "bucketKey",
      label: "Bucket key",
      headerClassName: "min-w-32",
      cellClassName: "min-w-32",
      render: ({ rule }) => ruleBucketKey(rule),
    },
  ];

  const visualEditor = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="settings-description">
          Configure the default encryption rules applied by S3 to new objects. Advanced rules remain read-only here and are preserved for JSON editing.
        </p>
        <SettingsButton type="button" variant="secondary" onClick={addDraftRule} disabled={saving}>
          Add rule
        </SettingsButton>
      </div>
      {draftRules.length === 0 ? (
        <div className={cx(uiCardMutedClass, "px-3 py-4 text-center settings-description")}>
          Default bucket encryption is disabled. Add a rule to enable it.
        </div>
      ) : (
        draftRules.map((rule, index) => (
          <EncryptionRuleEditor
            key={index}
            index={index}
            rule={rule}
            disabled={saving}
            onChange={(patch) => updateDraftRule(index, patch)}
            onRemove={() => removeDraftRule(index)}
          />
        ))
      )}
    </div>
  );

  const jsonEditor = (
    <div className="space-y-3">
      <p className="settings-description">
        Edit the complete S3 server-side encryption <code>Rules</code> array. Switching back to Visual validates the JSON structure first.
      </p>
      <UiTextarea
        label="Encryption rules (JSON)"
        rows={20}
        value={jsonText}
        onChange={(event) => updateJsonText(event.target.value)}
        className="settings-control font-mono"
        spellCheck={false}
        disabled={saving}
      />
      <BucketFeatureJsonExample
        show={showJsonExample}
        onToggle={() => setShowJsonExample((current) => !current)}
        example={defaultEncryptionExample}
        onUseExample={() => updateJsonText(defaultEncryptionExample)}
        disabled={saving}
      />
    </div>
  );

  return (
    <>
      <BucketFeatureSummarySection
        title="Server-side encryption"
        description="Default S3 encryption applied to new objects in this bucket."
        visualState={visualState}
        metadata={
          disabled
            ? undefined
            : configured
              ? `Enabled · ${ruleCount === 1 ? "1 rule" : `${ruleCount} rules`}`
              : "Disabled · 0 rules"
        }
        loading={loading}
        error={error}
        successMessage={status}
        editDisabled={disabled || saving}
        onEdit={openEditor}
        testId="bucket-feature-encryption"
      >
        {!enabled ? (
          <EndpointFeatureDisabledNotice featureLabel="Server-side encryption" />
        ) : (
          <DataTableShell
            columns={columns}
            rows={rows}
            rowKey={(row) => `encryption-rule-${row.index}`}
            status={rows.length === 0 ? "empty" : "ready"}
            loadingMessage="Loading encryption rules..."
            errorMessage="Unable to load encryption rules."
            emptyMessage="Default bucket encryption is disabled."
            primaryColumnId="rule"
            responsiveCards
          />
        )}
      </BucketFeatureSummarySection>

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
