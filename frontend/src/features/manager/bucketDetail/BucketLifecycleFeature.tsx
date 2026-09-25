/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState, type ReactNode } from "react";
import DataTableShell, { type DataTableColumn } from "../../../components/list/DataTableShell";
import {
  SettingsButton,
  SettingsInput,
  SettingsSelect,
} from "../../../components/settings/SettingsControls";
import { SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import {
  describeLifecycleActions,
  lifecycleFilterLabel,
  lifecycleRuleId,
  lifecycleRulePrefix,
  lifecycleRuleStatus,
  type LifecycleRuleRecord,
} from "../bucketLifecycle";
import BucketFeatureEditorDialog from "./BucketFeatureEditorDialog";
import {
  BucketFeatureEditorEmpty,
  BucketFeatureEditorItem,
  BucketFeatureEditorList,
  BucketFeatureEditorToolbar,
  BucketFeatureJsonPane,
} from "./BucketFeatureEditorLayout";
import BucketFeatureSummarySection from "./BucketFeatureSummarySection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import {
  isLifecycleRuleVisuallyEditable,
  lifecycleVisualRuleValidationError,
  readLifecycleVisualRule,
  validateLifecycleVisualRules,
  type LifecycleVisualRuleDraft,
} from "./lifecycleEditorModel";
import type { useBucketLifecycleController } from "./useBucketLifecycleController";

type BucketLifecycleController = ReturnType<typeof useBucketLifecycleController>;

type BucketLifecycleFeatureProps = {
  controller: BucketLifecycleController;
};

type LifecycleTableRow = {
  index: number;
  key: string;
  rule: LifecycleRuleRecord;
};

function LifecycleActionGroup({
  title,
  configured,
  children,
}: {
  title: string;
  configured: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(configured);
  return (
    <details
      className="border-t border-[color:var(--ui-border-soft)] pt-1"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 py-2 settings-label">
        <span>{title}</span>
        <span className="settings-description font-normal">
          {configured ? "Configured" : "Optional"}
        </span>
      </summary>
      <div className="pb-1 pt-2">{children}</div>
    </details>
  );
}

function LifecycleRuleEditor({
  index,
  rule,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  rule: LifecycleRuleRecord;
  disabled: boolean;
  onChange: (patch: Partial<LifecycleVisualRuleDraft>) => void;
  onRemove: () => void;
}) {
  const editable = isLifecycleRuleVisuallyEditable(rule);
  const draft = readLifecycleVisualRule(rule);
  const ruleLabel = lifecycleRuleId(rule) ?? `Rule ${index + 1}`;
  const validationError = lifecycleVisualRuleValidationError(rule);

  if (!editable) {
    return (
      <BucketFeatureEditorItem testId="lifecycle-advanced-rule">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="settings-label break-all">{ruleLabel}</p>
            <p className="settings-description mt-1">
              {lifecycleFilterLabel(rule.Filter)} · {describeLifecycleActions(rule)}
            </p>
          </div>
          <UiBadge tone="warning">Advanced rule — edit in JSON</UiBadge>
          <SettingsButton type="button" variant="danger" onClick={onRemove} disabled={disabled}>
            Remove rule
          </SettingsButton>
        </div>
      </BucketFeatureEditorItem>
    );
  }

  return (
    <BucketFeatureEditorItem testId="lifecycle-visual-rule">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="settings-label break-all">{ruleLabel}</p>
        </div>
        <SettingsButton type="button" variant="danger" onClick={onRemove} disabled={disabled}>
          Remove rule
        </SettingsButton>
      </div>

      {validationError ? <UiInlineMessage tone="warning">{validationError}</UiInlineMessage> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <SettingsInput
          label="ID"
          value={draft.id}
          onChange={(event) => onChange({ id: event.target.value })}
          disabled={disabled}
        />
        <SettingsSelect
          label="Status"
          value={draft.status}
          onChange={(event) => onChange({ status: event.target.value as LifecycleVisualRuleDraft["status"] })}
          disabled={disabled}
        >
          <option value="Enabled">Enabled</option>
          <option value="Disabled">Disabled</option>
        </SettingsSelect>
        <SettingsInput
          label="Prefix"
          value={draft.prefix}
          placeholder="logs/"
          onChange={(event) => onChange({ prefix: event.target.value })}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <LifecycleActionGroup
          title="Expiration and cleanup"
          configured={Boolean(
            draft.expirationDays ||
              draft.noncurrentExpirationDays ||
              draft.abortMultipartDays ||
              draft.expiredObjectDeleteMarker,
          )}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <SettingsInput
              label="Expire current objects after (days)"
              type="number"
              min={0}
              value={draft.expirationDays}
              onChange={(event) => onChange({ expirationDays: event.target.value })}
              disabled={disabled}
            />
            <SettingsInput
              label="Expire noncurrent versions after (days)"
              type="number"
              min={0}
              value={draft.noncurrentExpirationDays}
              onChange={(event) => onChange({ noncurrentExpirationDays: event.target.value })}
              disabled={disabled}
            />
            <SettingsInput
              label="Abort incomplete multipart after (days)"
              type="number"
              min={0}
              value={draft.abortMultipartDays}
              onChange={(event) => onChange({ abortMultipartDays: event.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--ui-border-soft)] pt-3">
            <div>
              <p className="settings-label">Expired object delete marker</p>
              <p className="settings-description">Remove expired delete markers when S3 considers them eligible.</p>
            </div>
            <SettingsSwitch
              checked={draft.expiredObjectDeleteMarker}
              ariaLabel={`Expired object delete marker for ${ruleLabel}`}
              onChange={(checked) => onChange({ expiredObjectDeleteMarker: checked })}
              disabled={disabled}
            />
          </div>
        </LifecycleActionGroup>

        <LifecycleActionGroup
          title="Current version transition"
          configured={Boolean(draft.transitionDays || draft.transitionStorageClass)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <SettingsInput
              label="Days"
              type="number"
              min={0}
              value={draft.transitionDays}
              onChange={(event) => onChange({ transitionDays: event.target.value })}
              disabled={disabled}
            />
            <SettingsInput
              label="Storage class"
              value={draft.transitionStorageClass}
              required={Boolean(draft.transitionDays)}
              onChange={(event) => onChange({ transitionStorageClass: event.target.value })}
              disabled={disabled}
            />
          </div>
        </LifecycleActionGroup>

        <LifecycleActionGroup
          title="Noncurrent version transition"
          configured={Boolean(
            draft.noncurrentTransitionDays || draft.noncurrentTransitionStorageClass,
          )}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <SettingsInput
              label="Noncurrent days"
              type="number"
              min={0}
              value={draft.noncurrentTransitionDays}
              onChange={(event) => onChange({ noncurrentTransitionDays: event.target.value })}
              disabled={disabled}
            />
            <SettingsInput
              label="Storage class"
              value={draft.noncurrentTransitionStorageClass}
              required={Boolean(draft.noncurrentTransitionDays)}
              onChange={(event) => onChange({ noncurrentTransitionStorageClass: event.target.value })}
              disabled={disabled}
            />
          </div>
        </LifecycleActionGroup>
      </div>
    </BucketFeatureEditorItem>
  );
}

export default function BucketLifecycleFeature({ controller }: BucketLifecycleFeatureProps) {
  const {
    addDraftRule,
    closeEditor,
    draftRules,
    draftSignature,
    dirty,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    error,
    hasRules,
    jsonText,
    lastRemovedRule,
    loading,
    openEditor,
    openEditorFor,
    openEditorWithNew,
    removeDraftRule,
    removeRuleDirect,
    restoreLastRemovedRule,
    ruleCount,
    rules,
    saveDraft,
    saving,
    setRuleEnabled,
    status,
    updateDraftRule,
    updateEditorMode,
    updateJsonText,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured: hasRules,
    unsaved: false,
  });
  const visualValidationError =
    editorMode === "visual" ? validateLifecycleVisualRules(draftRules) : null;
  const rows = useMemo<LifecycleTableRow[]>(
    () =>
      rules.map((rule, index) => {
        const ruleId = lifecycleRuleId(rule);
        return {
          index,
          key: `${ruleId ?? lifecycleRulePrefix(rule) ?? "rule"}-${index}`,
          rule,
        };
      }),
    [rules],
  );
  const columns: Array<DataTableColumn<LifecycleTableRow>> = [
    {
      id: "id",
      label: "Rule",
      primary: true,
      headerClassName: "min-w-32",
      cellClassName: "min-w-32 max-w-48 break-all",
      render: ({ rule }) => lifecycleRuleId(rule) ?? "(no ID)",
    },
    {
      id: "filter",
      label: "Scope",
      headerClassName: "min-w-32 whitespace-nowrap",
      cellClassName: "min-w-32",
      render: ({ rule }) => lifecycleFilterLabel(rule.Filter),
    },
    {
      id: "actions",
      label: "Actions",
      mobileLabel: "Actions",
      headerClassName: "min-w-48",
      cellClassName: "min-w-48 whitespace-normal break-words",
      render: ({ rule }) => describeLifecycleActions(rule),
    },
    {
      id: "status",
      label: "Status",
      headerClassName: "w-px whitespace-nowrap",
      cellClassName: "w-px whitespace-nowrap",
      render: ({ rule, index }) => {
        const ruleStatus = lifecycleRuleStatus(rule);
        return (
          <div className="flex items-center gap-2">
            <SettingsSwitch
              checked={ruleStatus === "Enabled"}
              ariaLabel={`${lifecycleRuleId(rule) ?? `Rule ${index + 1}`} enabled`}
              onChange={(checked) => setRuleEnabled(index, checked)}
              disabled={saving || notImplemented}
            />
            <span>{ruleStatus}</span>
          </div>
        );
      },
    },
    {
      id: "manage",
      label: "Manage",
      mobileRole: "actions",
      headerClassName: "w-px whitespace-nowrap text-right",
      cellClassName: "w-px whitespace-nowrap",
      render: ({ index }) => (
        <div className="bucket-feature-row-actions">
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={() => openEditorFor(index)}
            disabled={saving || notImplemented}
          >
            Edit
          </SettingsButton>
          <SettingsButton
            type="button"
            variant="danger"
            onClick={() => removeRuleDirect(index)}
            disabled={saving || notImplemented}
          >
            Remove
          </SettingsButton>
        </div>
      ),
    },
  ];

  const visibleDraftRules = draftRules
    .map((rule, index) => ({ rule, index }))
    .filter(({ index }) => editorTargetIndex === null || index === editorTargetIndex);

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
          Supported rules can be edited here. Advanced S3 constructs remain read-only in Visual mode.
        </p>
      </BucketFeatureEditorToolbar>
      {lastRemovedRule ? (
        <UiInlineMessage>
          <span className="flex flex-wrap items-center gap-2">
            <span>Rule removed from this draft.</span>
            <SettingsButton
              type="button"
              variant="secondary"
              onClick={restoreLastRemovedRule}
              disabled={saving}
            >
              Undo
            </SettingsButton>
          </span>
        </UiInlineMessage>
      ) : null}
      {draftRules.length === 0 ? (
        <div className="space-y-2">
          {hasRules ? (
            <UiInlineMessage tone="warning">
              Saving will remove the Lifecycle configuration from this bucket.
            </UiInlineMessage>
          ) : null}
          <BucketFeatureEditorEmpty>
            No lifecycle rules. Add a rule or switch to JSON.
          </BucketFeatureEditorEmpty>
        </div>
      ) : (
        <BucketFeatureEditorList>
          {visibleDraftRules.map(({ rule, index }) => (
            <LifecycleRuleEditor
              key={`lifecycle-rule-${index}`}
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
        Edit the complete S3 Lifecycle <code>Rules</code> array. Switching back to Visual validates this JSON first.
        </>
      }
      label="Lifecycle rules (JSON)"
      value={jsonText}
      onChange={updateJsonText}
      disabled={saving}
    />
  );

  return (
    <>
      <BucketFeatureSummarySection
        title="Lifecycle rules"
        description="S3-side expiration/clean-up."
        visualState={visualState}
        metadata={ruleCount === 1 ? "1 rule" : `${ruleCount} rules`}
        loading={loading}
        error={error}
        successMessage={status}
        editDisabled={notImplemented || saving}
        editLabel="Advanced editor"
        onEdit={openEditor}
        primaryAction={
          <SettingsButton
            type="button"
            variant="primary"
            onClick={openEditorWithNew}
            disabled={notImplemented || loading || saving}
          >
            Add rule
          </SettingsButton>
        }
        testId="bucket-feature-lifecycle"
      >
        <DataTableShell
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          status={rows.length === 0 ? "empty" : "ready"}
          loadingMessage="Loading lifecycle rules..."
          errorMessage="Unable to load lifecycle rules."
          emptyMessage="No rules configured on this bucket."
          primaryColumnId="id"
          responsiveCards
          containerClassName="bucket-feature-collection-table"
        />
        <div className="bucket-feature-add-row">
          <span>Add a rule here, then use the editor for its complete S3 configuration.</span>
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={openEditorWithNew}
            disabled={notImplemented || loading || saving}
          >
            + Add rule
          </SettingsButton>
        </div>
      </BucketFeatureSummarySection>

      {editorOpen ? (
        <BucketFeatureEditorDialog
          title="Edit lifecycle rules"
          mode={editorMode}
          onModeChange={updateEditorMode}
          draftKey={draftSignature}
          dirty={dirty}
          busy={saving}
          error={editorError}
          saveDisabled={Boolean(visualValidationError)}
          visualContent={visualEditor}
          jsonContent={jsonEditor}
          onSave={saveDraft}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}
