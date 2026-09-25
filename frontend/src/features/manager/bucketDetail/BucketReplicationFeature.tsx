/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import DataTableShell, {
  type DataTableColumn,
} from "../../../components/list/DataTableShell";
import {
  SettingsButton,
  SettingsInput,
  SettingsSelect,
} from "../../../components/settings/SettingsControls";
import { SettingsAutocomplete } from "../../../components/settings/SettingsAutocomplete";
import { SettingsSwitch } from "../../../components/settings/SettingsLayout";
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
import BucketFeatureSummarySection from "./BucketFeatureSummarySection";
import { useBucketFeatureSuggestions } from "./BucketFeatureSuggestions";
import EndpointFeatureDisabledNotice from "./EndpointFeatureDisabledNotice";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import {
  isReplicationRuleVisuallyEditable,
  readReplicationVisualRule,
  replicationRuleSummary,
  type ReplicationVisualRulePatch,
} from "./replicationEditorModel";
import type { useBucketReplicationController } from "./useBucketReplicationController";

type BucketReplicationController = ReturnType<typeof useBucketReplicationController>;

type BucketReplicationFeatureProps = {
  blocked: boolean;
  controller: BucketReplicationController;
};

type ReplicationSummaryRow = {
  index: number;
  key: string;
  rule: unknown;
};

function ReplicationRuleEditor({
  index,
  uiId,
  rule,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  uiId: string;
  rule: unknown;
  disabled: boolean;
  onChange: (patch: ReplicationVisualRulePatch) => void;
  onRemove: () => void;
}) {
  const editable = isReplicationRuleVisuallyEditable(rule);
  const summary = replicationRuleSummary(rule);
  const draft = readReplicationVisualRule(rule);
  const { destinationBucketArns, prefixes } = useBucketFeatureSuggestions();

  if (!editable) {
    return (
      <BucketFeatureEditorItem testId="replication-advanced-rule">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="settings-label break-all">{summary.id}</p>
            <p className="settings-description break-all">
              {summary.status} · {summary.prefix} · {summary.destination}
            </p>
          </div>
          <UiBadge tone="warning">Advanced rule — edit in JSON</UiBadge>
        </div>
        <p className="settings-description">
          This rule contains S3 fields that the visual editor cannot represent without loss.
        </p>
      </BucketFeatureEditorItem>
    );
  }

  return (
    <BucketFeatureEditorItem
      testId="replication-visual-rule"
      ruleId={uiId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="settings-label">Rule {index + 1}</p>
        </div>
        <SettingsButton
          type="button"
          variant="danger"
          onClick={onRemove}
          disabled={disabled}
        >
          Remove rule
        </SettingsButton>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SettingsInput
          label="ID"
          value={draft.id}
          onChange={(event) => onChange({ id: event.target.value })}
          placeholder={`rule-${index + 1}`}
          disabled={disabled}
        />
        <SettingsSelect
          label="Status"
          value={draft.status}
          onChange={(event) =>
            onChange({ status: event.target.value as "Enabled" | "Disabled" })
          }
          disabled={disabled}
        >
          <option value="Enabled">Enabled</option>
          <option value="Disabled">Disabled</option>
        </SettingsSelect>
        <SettingsInput
          label="Priority"
          type="number"
          min={0}
          step={1}
          value={draft.priority}
          onChange={(event) => onChange({ priority: event.target.value })}
          placeholder="1"
          disabled={disabled}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsAutocomplete
          label="Prefix / filter"
          value={draft.prefix}
          onChange={(value) => onChange({ prefix: value })}
          placeholder="logs/"
          disabled={disabled}
          {...prefixes}
        />
        <SettingsAutocomplete
          label="Destination bucket ARN"
          value={draft.destinationBucket}
          onChange={(value) => onChange({ destinationBucket: value })}
          placeholder="arn:aws:s3:::target-bucket"
          disabled={disabled}
          {...destinationBucketArns}
        />
      </div>

      <div className="max-w-sm">
        <SettingsSelect
          label="Delete marker replication"
          value={draft.deleteMarkerStatus}
          onChange={(event) =>
            onChange({
              deleteMarkerStatus: event.target.value as "Enabled" | "Disabled",
            })
          }
          disabled={disabled}
        >
          <option value="Disabled">Disabled</option>
          <option value="Enabled">Enabled</option>
        </SettingsSelect>
      </div>
    </BucketFeatureEditorItem>
  );
}

export default function BucketReplicationFeature({
  blocked,
  controller,
}: BucketReplicationFeatureProps) {
  const {
    addRule,
    advancedRuleCount,
    busy,
    closeEditor,
    configured,
    draftSignature,
    dirty,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    error,
    hasAdvancedTopLevelFields,
    hasUnsupportedZone,
    jsonText,
    loading,
    openEditorFor,
    openEditorWithNew,
    openJsonEditor,
    removeRule,
    removeRuleDirect,
    role,
    ruleCount,
    rules,
    saveDraft,
    saving,
    setRuleEnabled,
    status,
    summaryRules,
    updateEditorMode,
    updateJsonText,
    updateRole,
    updateRule,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const featureDisabled = blocked || notImplemented;
  const visualState = resolveFeatureVisualState({
    disabled: featureDisabled,
    configured,
    unsaved: false,
  });

  const summaryRows = useMemo<ReplicationSummaryRow[]>(
    () =>
      summaryRules.map((rule, index) => ({
        index,
        key: `${replicationRuleSummary(rule).id}-${index}`,
        rule,
      })),
    [summaryRules],
  );

  const summaryColumns: Array<DataTableColumn<ReplicationSummaryRow>> = [
    {
      id: "id",
      label: "Rule",
      primary: true,
      headerClassName: "min-w-40",
      cellClassName: "min-w-40",
      render: ({ rule }) => replicationRuleSummary(rule).id,
    },
    {
      id: "status",
      label: "Status",
      headerClassName: "w-px whitespace-nowrap",
      cellClassName: "w-px whitespace-nowrap",
      render: ({ rule, index }) => {
        const value = replicationRuleSummary(rule).status;
        return (
          <div className="flex items-center gap-2">
            <SettingsSwitch
              checked={value === "Enabled"}
              ariaLabel={`${replicationRuleSummary(rule).id} enabled`}
              onChange={(checked) => setRuleEnabled(index, checked)}
              disabled={saving || featureDisabled || !isReplicationRuleVisuallyEditable(rule)}
            />
            <span>{value}</span>
          </div>
        );
      },
    },
    {
      id: "priority",
      label: "Priority",
      headerClassName: "w-px whitespace-nowrap",
      cellClassName: "w-px whitespace-nowrap",
      render: ({ rule }) => replicationRuleSummary(rule).priority,
    },
    {
      id: "prefix",
      label: "Prefix",
      headerClassName: "min-w-32",
      cellClassName: "min-w-32 break-all",
      render: ({ rule }) => replicationRuleSummary(rule).prefix,
    },
    {
      id: "destination",
      label: "Destination",
      headerClassName: "min-w-56",
      cellClassName: "min-w-56 break-all font-mono ui-caption",
      render: ({ rule }) => replicationRuleSummary(rule).destination,
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
            disabled={saving || featureDisabled}
          >
            Edit
          </SettingsButton>
          <SettingsButton
            type="button"
            variant="danger"
            onClick={() => removeRuleDirect(index)}
            disabled={saving || featureDisabled}
          >
            Remove
          </SettingsButton>
        </div>
      ),
    },
  ];
  const visibleRules = rules.filter((_, index) => editorTargetIndex === null || index === editorTargetIndex);

  const visualEditor = (
    <div className="space-y-4">
      <SettingsInput
        label="Role ARN"
        type="text"
        value={role}
        onChange={(event) => updateRole(event.target.value)}
        placeholder="arn:aws:iam::123456789012:role/replication-role"
        disabled={saving}
      />

      {(advancedRuleCount > 0 || hasAdvancedTopLevelFields) && (
        <UiInlineMessage tone="warning">
          Advanced replication fields are preserved in the draft. Advanced rules
          are read-only here and can be changed from the JSON tab.
        </UiInlineMessage>
      )}

      <BucketFeatureEditorToolbar
        action={
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={addRule}
            disabled={saving}
          >
            Add rule
          </SettingsButton>
        }
      >
        <p>
          Edit supported rules visually. Nothing is persisted until Save.
        </p>
      </BucketFeatureEditorToolbar>

      {rules.length === 0 ? (
        <BucketFeatureEditorEmpty>
          No replication rules. Saving this draft will clear the replication
          configuration.
        </BucketFeatureEditorEmpty>
      ) : (
        <BucketFeatureEditorList>
          {visibleRules.map(({ uiId, rule }) => {
            const index = rules.findIndex((entry) => entry.uiId === uiId);
            return (
            <ReplicationRuleEditor
              key={uiId}
              index={index}
              uiId={uiId}
              rule={rule}
              disabled={saving}
              onChange={(patch) => updateRule(uiId, patch)}
              onRemove={() => removeRule(uiId)}
            />
            );
          })}
        </BucketFeatureEditorList>
      )}
    </div>
  );

  const jsonEditor = (
    <BucketFeatureJsonPane
      description="Edit the complete S3 replication configuration. Switching back to Visual validates the JSON structure first."
      label="Replication configuration (JSON)"
      value={jsonText}
      onChange={updateJsonText}
      disabled={saving}
    >
      {hasUnsupportedZone && (
        <UiInlineMessage tone="warning">
          Destination.Zone is preserved in this draft, but the current BucketReef
          replication API rejects it on Save.
        </UiInlineMessage>
      )}
    </BucketFeatureJsonPane>
  );

  return (
    <>
      <BucketFeatureSummarySection
        title="Replication / multisite"
        description="Configure Ceph RGW multisite bucket replication across zones within this bucket's zonegroup."
        visualState={visualState}
        metadata={ruleCount === 1 ? "1 rule" : `${ruleCount} rules`}
        loading={loading}
        error={error}
        successMessage={status}
        editDisabled={featureDisabled || busy}
        editLabel="JSON"
        onEdit={openJsonEditor}
        primaryAction={
          <SettingsButton
            type="button"
            variant="primary"
            onClick={openEditorWithNew}
            disabled={featureDisabled || busy}
          >
            Add rule
          </SettingsButton>
        }
        testId="bucket-feature-replication"
      >
        {blocked ? (
          <EndpointFeatureDisabledNotice featureLabel="Bucket replication" />
        ) : (
          <div className="space-y-3">
            <DataTableShell
              columns={summaryColumns}
              rows={summaryRows}
              rowKey={(row) => row.key}
              status={summaryRows.length === 0 ? "empty" : "ready"}
              loadingMessage="Loading replication configuration..."
              errorMessage="Unable to load replication configuration."
              emptyMessage="No replication rules configured on this bucket."
              primaryColumnId="id"
              responsiveCards
              containerClassName="bucket-feature-collection-table"
            />
            <div className="bucket-feature-add-row">
              <span>Enable, disable, remove or create ordinary replication rules here; advanced fields stay in the editor.</span>
              <SettingsButton
                type="button"
                variant="secondary"
                onClick={openEditorWithNew}
                disabled={featureDisabled || busy}
              >
                + Add rule
              </SettingsButton>
            </div>
          </div>
        )}
      </BucketFeatureSummarySection>

      {editorOpen ? (
        <BucketFeatureEditorDialog
          title="Edit replication configuration"
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
