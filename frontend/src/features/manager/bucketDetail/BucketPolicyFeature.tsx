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
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureEditorDialog from "./BucketFeatureEditorDialog";
import {
  BucketFeatureEditorEmpty,
  BucketFeatureEditorGroup,
  BucketFeatureEditorItem,
  BucketFeatureEditorList,
  BucketFeatureEditorToolbar,
  BucketFeatureJsonPane,
} from "./BucketFeatureEditorLayout";
import BucketFeatureSummarySection from "./BucketFeatureSummarySection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import {
  isPolicyStatementVisuallyEditable,
  policyListText,
  policyPrincipalSummary,
  policyStatementEffect,
  policyStatementSid,
  policyStatements,
  policyValueSummary,
  readPolicyVisualStatement,
  splitPolicyListText,
  type PolicyConditionEntry,
  type PolicyPrincipalMode,
  type PolicyStatementRecord,
  type PolicyVisualStatementPatch,
} from "./policyEditorModel";
import type { useBucketPolicyController } from "./useBucketPolicyController";

type BucketPolicyController = ReturnType<typeof useBucketPolicyController>;

type BucketPolicyFeatureProps = {
  bucketName?: string;
  controller: BucketPolicyController;
  onRequestDelete: () => void;
};

type PolicySummaryRow = {
  index: number;
  statement: PolicyStatementRecord;
};

function NewConditionEditor({
  disabled,
  existing,
  onAdd,
}: {
  disabled: boolean;
  existing: PolicyConditionEntry[];
  onAdd: (operator: string, key: string, values: string[]) => void;
}) {
  const [operator, setOperator] = useState("");
  const [key, setKey] = useState("");
  const [values, setValues] = useState("");
  const normalizedOperator = operator.trim();
  const normalizedKey = key.trim();
  const duplicate = existing.some(
    (entry) => entry.operator === normalizedOperator && entry.key === normalizedKey,
  );
  const valueList = splitPolicyListText(values);
  const canAdd = Boolean(normalizedOperator && normalizedKey && valueList.length && !duplicate);

  return (
    <BucketFeatureEditorGroup>
      <p className="settings-label">Add condition</p>
      <div className="grid gap-3 md:grid-cols-2">
        <SettingsInput
          label="Operator"
          value={operator}
          placeholder="StringEquals"
          onChange={(event) => setOperator(event.target.value)}
          disabled={disabled}
        />
        <SettingsInput
          label="Condition key"
          value={key}
          placeholder="aws:SourceIp"
          onChange={(event) => setKey(event.target.value)}
          disabled={disabled}
        />
      </div>
      <UiTextarea
        label="Values (one per line)"
        rows={3}
        value={values}
        onChange={(event) => setValues(event.target.value)}
        className="settings-control font-mono"
        disabled={disabled}
      />
      {duplicate ? (
        <p className="settings-description text-amber-700 dark:text-amber-300">
          This condition already exists. Edit its values above.
        </p>
      ) : null}
      <SettingsButton
        type="button"
        variant="secondary"
        disabled={disabled || !canAdd}
        onClick={() => {
          onAdd(normalizedOperator, normalizedKey, valueList);
          setOperator("");
          setKey("");
          setValues("");
        }}
      >
        Add condition
      </SettingsButton>
    </BucketFeatureEditorGroup>
  );
}

function PolicyStatementEditor({
  index,
  statement,
  disabled,
  onChange,
  onRemove,
  onConditionChange,
  onConditionRemove,
}: {
  index: number;
  statement: PolicyStatementRecord;
  disabled: boolean;
  onChange: (patch: PolicyVisualStatementPatch) => void;
  onRemove: () => void;
  onConditionChange: (operator: string, key: string, values: string[]) => void;
  onConditionRemove: (operator: string, key: string) => void;
}) {
  const editable = isPolicyStatementVisuallyEditable(statement);
  const label = policyStatementSid(statement, index);

  if (!editable) {
    return (
      <BucketFeatureEditorItem testId="policy-advanced-statement">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="settings-label break-all">{label}</p>
            <p className="settings-description mt-1 break-all">
              {policyStatementEffect(statement)} · {policyPrincipalSummary(statement.Principal)} · {policyValueSummary(statement.Action)}
            </p>
          </div>
          <UiBadge tone="warning">Advanced statement — edit in JSON</UiBadge>
        </div>
      </BucketFeatureEditorItem>
    );
  }

  const draft = readPolicyVisualStatement(statement);
  const principalNeedsValues = draft.principalMode !== "none" && draft.principalMode !== "any";
  const principalValues = policyListText(draft.principalValues);

  return (
    <BucketFeatureEditorItem testId="policy-visual-statement">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="settings-label">Statement {index + 1}</p>
        </div>
        <SettingsButton type="button" variant="danger" onClick={onRemove} disabled={disabled}>
          Remove statement
        </SettingsButton>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SettingsInput
          label="Sid"
          value={draft.sid}
          placeholder="ReadObjects"
          onChange={(event) => onChange({ sid: event.target.value })}
          disabled={disabled}
        />
        <SettingsSelect
          label="Effect"
          value={draft.effect}
          onChange={(event) => onChange({ effect: event.target.value as PolicyVisualStatementPatch["effect"] })}
          disabled={disabled}
        >
          <option value="">Select effect</option>
          <option value="Allow">Allow</option>
          <option value="Deny">Deny</option>
        </SettingsSelect>
        <SettingsSelect
          label="Principal type"
          value={draft.principalMode}
          onChange={(event) => {
            const principalMode = event.target.value as PolicyPrincipalMode;
            onChange({
              principalMode,
              principalValues: principalMode === "any" || principalMode === "none"
                ? []
                : draft.principalValues,
            });
          }}
          disabled={disabled}
        >
          <option value="any">Any principal (*)</option>
          <option value="AWS">AWS</option>
          <option value="Service">Service</option>
          <option value="Federated">Federated</option>
          <option value="CanonicalUser">Canonical user</option>
          <option value="direct">Direct string</option>
          <option value="none">No principal</option>
        </SettingsSelect>
      </div>

      {principalNeedsValues ? (
        <UiTextarea
          label={draft.principalMode === "direct" ? "Principal" : "Principal values (one per line)"}
          rows={draft.principalMode === "direct" ? 2 : 3}
          value={principalValues}
          onChange={(event) => onChange({
            principalValues: draft.principalMode === "direct"
              ? [event.target.value]
              : splitPolicyListText(event.target.value),
          })}
          className="settings-control font-mono"
          disabled={disabled}
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <UiTextarea
          label="Actions (one per line)"
          rows={5}
          value={policyListText(draft.actions)}
          placeholder="s3:GetObject"
          onChange={(event) => onChange({ actions: splitPolicyListText(event.target.value) })}
          className="settings-control font-mono"
          disabled={disabled}
        />
        <UiTextarea
          label="Resources (one per line)"
          rows={5}
          value={policyListText(draft.resources)}
          placeholder="arn:aws:s3:::bucket/*"
          onChange={(event) => onChange({ resources: splitPolicyListText(event.target.value) })}
          className="settings-control font-mono"
          disabled={disabled}
        />
      </div>

      <div className="space-y-3">
        <div>
          <p className="settings-label">Conditions</p>
          <p className="settings-description">
            String or string-list condition values are editable here. Other condition structures remain JSON-only.
          </p>
        </div>
        {draft.conditions.length === 0 ? (
          <p className="settings-description">No conditions on this statement.</p>
        ) : (
          draft.conditions.map((condition) => (
            <div
              key={`${condition.operator}:${condition.key}`}
              className="grid gap-3 border-t border-[color:var(--ui-border-soft)] pt-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <UiBadge tone="neutral">{condition.operator}</UiBadge>
                  <code className="settings-description break-all">{condition.key}</code>
                </div>
                <UiTextarea
                  label={`Values — ${condition.operator} / ${condition.key}`}
                  rows={3}
                  value={policyListText(condition.values)}
                  onChange={(event) => onConditionChange(
                    condition.operator,
                    condition.key,
                    splitPolicyListText(event.target.value),
                  )}
                  className="settings-control font-mono"
                  disabled={disabled}
                />
              </div>
              <SettingsButton
                type="button"
                variant="danger"
                className="self-start"
                onClick={() => onConditionRemove(condition.operator, condition.key)}
                disabled={disabled}
              >
                Remove
              </SettingsButton>
            </div>
          ))
        )}
        <NewConditionEditor
          disabled={disabled}
          existing={draft.conditions}
          onAdd={onConditionChange}
        />
      </div>
    </BucketFeatureEditorItem>
  );
}

export default function BucketPolicyFeature({
  controller,
}: BucketPolicyFeatureProps) {
  const {
    addDraftStatement,
    allowCount,
    closeEditor,
    configured,
    denyCount,
    draftPolicy,
    draftSignature,
    dirty,
    editorError,
    editorMode,
    editorOpen,
    error,
    jsonText,
    loading,
    openEditor,
    removeDraftCondition,
    removeDraftStatement,
    saveDraft,
    saving,
    statementCount,
    statements,
    status,
    updateDraftCondition,
    updateDraftStatement,
    updateEditorMode,
    updateJsonText,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: false,
  });
  const summaryRows = useMemo<PolicySummaryRow[]>(
    () => statements.map((statement, index) => ({ index, statement })),
    [statements],
  );
  const draftStatements = useMemo(() => policyStatements(draftPolicy), [draftPolicy]);
  const metadata = configured
    ? `${statementCount} ${statementCount === 1 ? "statement" : "statements"} · ${allowCount} Allow · ${denyCount} Deny`
    : "Not configured · 0 statements";
  const summaryColumns: Array<DataTableColumn<PolicySummaryRow>> = [
    {
      id: "sid",
      label: "Sid",
      primary: true,
      headerClassName: "min-w-40",
      cellClassName: "min-w-40",
      render: ({ statement, index }) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all">{policyStatementSid(statement, index)}</span>
          {!isPolicyStatementVisuallyEditable(statement) ? <UiBadge tone="warning">Advanced</UiBadge> : null}
        </div>
      ),
    },
    {
      id: "effect",
      label: "Effect",
      headerClassName: "w-px whitespace-nowrap",
      cellClassName: "w-px whitespace-nowrap",
      render: ({ statement }) => {
        const effect = policyStatementEffect(statement);
        return (
          <UiBadge tone={effect === "Allow" ? "success" : effect === "Deny" ? "danger" : "neutral"}>
            {effect}
          </UiBadge>
        );
      },
    },
    {
      id: "principal",
      label: "Principal",
      headerClassName: "min-w-48",
      cellClassName: "min-w-48 break-all",
      render: ({ statement }) => policyPrincipalSummary(statement.Principal),
    },
    {
      id: "action",
      label: "Action",
      headerClassName: "min-w-52",
      cellClassName: "min-w-52 break-all",
      render: ({ statement }) => policyValueSummary(statement.Action),
    },
    {
      id: "resource",
      label: "Resource",
      headerClassName: "min-w-64",
      cellClassName: "min-w-64 break-all",
      render: ({ statement }) => policyValueSummary(statement.Resource),
    },
  ];

  const visualEditor = (
    <div className="space-y-3">
      <BucketFeatureEditorToolbar
        action={
          <SettingsButton type="button" variant="secondary" onClick={addDraftStatement} disabled={saving}>
            Add statement
          </SettingsButton>
        }
      >
        <div className="max-w-3xl">
          <p>
            Edit standard bucket-policy statements visually. Document metadata and advanced IAM constructs are preserved and can be edited in JSON.
          </p>
        </div>
      </BucketFeatureEditorToolbar>
      {draftStatements.length === 0 ? (
        <BucketFeatureEditorEmpty>
          No statements. Add a statement or use JSON. Saving an empty policy removes it from the bucket.
        </BucketFeatureEditorEmpty>
      ) : (
        <BucketFeatureEditorList>
          {draftStatements.map((statement, index) => (
            <PolicyStatementEditor
              key={`${policyStatementSid(statement, index)}-${index}`}
              index={index}
              statement={statement}
              disabled={saving}
              onChange={(patch) => updateDraftStatement(index, patch)}
              onRemove={() => removeDraftStatement(index)}
              onConditionChange={(operator, key, values) => updateDraftCondition(index, operator, key, values)}
              onConditionRemove={(operator, key) => removeDraftCondition(index, operator, key)}
            />
          ))}
        </BucketFeatureEditorList>
      )}
    </div>
  );

  const jsonEditor = (
    <BucketFeatureJsonPane
      description="Edit the complete S3 bucket policy document. Switching back to Visual validates the document shape first."
      label="Bucket policy (JSON)"
      value={jsonText}
      onChange={updateJsonText}
      rows={18}
      disabled={saving}
    />
  );

  return (
    <>
      <BucketFeatureSummarySection
        title="Bucket policy"
        description="IAM-like resource policy applied directly on the bucket."
        visualState={visualState}
        metadata={metadata}
        loading={loading}
        error={error}
        successMessage={status}
        editDisabled={notImplemented || saving}
        onEdit={openEditor}
        testId="bucket-feature-policy"
      >
        <DataTableShell
          columns={summaryColumns}
          rows={summaryRows}
          rowKey={({ index, statement }) => `${policyStatementSid(statement, index)}-${index}`}
          status={summaryRows.length === 0 ? "empty" : "ready"}
          loadingMessage="Loading bucket policy..."
          errorMessage="Unable to load the bucket policy."
          emptyMessage="No bucket policy configured."
          primaryColumnId="sid"
          responsiveCards
        />
      </BucketFeatureSummarySection>

      {editorOpen ? (
        <BucketFeatureEditorDialog
          title="Edit bucket policy"
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
