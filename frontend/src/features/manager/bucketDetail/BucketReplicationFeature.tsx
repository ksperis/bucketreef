/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton, SettingsInput, SettingsSelect } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiTextarea from "../../../components/ui/UiTextarea";
import { cx, uiCardMutedClass } from "../../../components/ui/styles";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureModeToggle from "./BucketFeatureModeToggle";
import BucketFeatureSection from "./BucketFeatureSection";
import EndpointFeatureDisabledNotice from "./EndpointFeatureDisabledNotice";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketReplicationController } from "./useBucketReplicationController";

type BucketReplicationController = ReturnType<typeof useBucketReplicationController>;

type BucketReplicationFeatureProps = {
  blocked: boolean;
  controller: BucketReplicationController;
  onRequestClear: () => void;
};

const stackClass = "space-y-3";
const compactStackClass = "space-y-2";
const twoColumnGridClass = "grid gap-3 md:grid-cols-2";
const replicationJsonExample = `{
  "Role": "arn:aws:iam::123456789012:role/replication-role",
  "Rules": [
    {
      "ID": "rule-1",
      "Status": "Enabled",
      "Priority": 1,
      "Filter": { "Prefix": "logs/" },
      "Destination": { "Bucket": "arn:aws:s3:::target-bucket" },
      "DeleteMarkerReplication": { "Status": "Disabled" }
    }
  ]
}`;

export default function BucketReplicationFeature({
  blocked,
  controller,
  onRequestClear,
}: BucketReplicationFeatureProps) {
  const [showJsonExample, setShowJsonExample] = useState(false);
  const {
    addRule,
    busy,
    clearing,
    configured,
    dirty,
    error,
    hasUnsupportedZone,
    loading,
    mode,
    removeRule,
    role,
    rules,
    save,
    saving,
    status,
    text,
    updateMode,
    updateRole,
    updateRule,
    updateText,
    warning,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const disabled = blocked || notImplemented || busy;
  const visualState = resolveFeatureVisualState({
    disabled: blocked || notImplemented,
    configured,
    unsaved: dirty,
  });

  return (
    <BucketFeatureSection
      title="Replication / multisite"
      description="Configure Ceph RGW multisite bucket replication across zones within this bucket's zonegroup."
      mode="hybrid"
      visualState={visualState}
      presentation="workbench"
      successMessage={status}
      busy={busy}
      testId="bucket-feature-replication"
      actions={
        <div className="flex flex-wrap gap-2">
          <SettingsButton type="button" onClick={onRequestClear} disabled={disabled || !configured} variant="danger">
            {clearing ? "Clearing..." : "Clear"}
          </SettingsButton>
          <SettingsButton type="button" onClick={save} disabled={disabled || !dirty} variant="primary">
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        </div>
      }
    >
      <BucketFeatureModeToggle
        value={mode}
        options={[
          { value: "graphical", label: "Graphical mode" },
          { value: "json", label: "JSON mode" },
        ]}
        onChange={updateMode}
        disabled={disabled}
      />
      {blocked && <EndpointFeatureDisabledNotice featureLabel="Bucket replication" />}
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      {warning && <UiInlineMessage tone="warning">{warning}</UiInlineMessage>}
      {loading ? (
        <UiInlineMessage>Loading replication configuration...</UiInlineMessage>
      ) : mode === "graphical" ? (
        <div className={stackClass}>
          <SettingsInput
            label="Role ARN"
            type="text"
            value={role}
            onChange={(event) => updateRole(event.target.value)}
            placeholder="arn:aws:iam::123456789012:role/replication-role"
            disabled={disabled}
          />
          <div className={stackClass}>
            {rules.map((rule, index) => (
              <div key={rule.uiId} className={cx(uiCardMutedClass, "space-y-3 p-3")}>
                <div className="flex items-center justify-between">
                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Rule {index + 1}</p>
                  <SettingsButton
                    type="button"
                    onClick={() => removeRule(rule.uiId)}
                    disabled={disabled || rules.length <= 1}
                    variant="danger"
                  >
                    Remove
                  </SettingsButton>
                </div>
                <div className={twoColumnGridClass}>
                  <SettingsInput
                    label="ID"
                    type="text"
                    value={rule.id}
                    onChange={(event) => updateRule(rule.uiId, { id: event.target.value })}
                    placeholder={`rule-${index + 1}`}
                    disabled={disabled}
                  />
                  <SettingsSelect
                    label="Status"
                    value={rule.status}
                    onChange={(event) => updateRule(rule.uiId, { status: event.target.value as "Enabled" | "Disabled" })}
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
                    value={rule.priority}
                    onChange={(event) => updateRule(rule.uiId, { priority: event.target.value })}
                    placeholder="1"
                    disabled={disabled}
                  />
                  <SettingsInput
                    label="Prefix (optional)"
                    type="text"
                    value={rule.prefix}
                    onChange={(event) => updateRule(rule.uiId, { prefix: event.target.value })}
                    placeholder="logs/"
                    disabled={disabled}
                  />
                  <SettingsInput
                    label="Destination bucket ARN"
                    type="text"
                    value={rule.destinationBucket}
                    onChange={(event) => updateRule(rule.uiId, { destinationBucket: event.target.value })}
                    placeholder="arn:aws:s3:::target-bucket"
                    disabled={disabled}
                  />
                  <SettingsSelect
                    label="Delete marker replication"
                    value={rule.deleteMarkerStatus}
                    onChange={(event) => updateRule(rule.uiId, { deleteMarkerStatus: event.target.value as "Enabled" | "Disabled" })}
                    disabled={disabled}
                  >
                    <option value="Disabled">Disabled</option>
                    <option value="Enabled">Enabled</option>
                  </SettingsSelect>
                </div>
              </div>
            ))}
          </div>
          <div>
            <SettingsButton type="button" onClick={addRule} disabled={disabled} variant="secondary">
              Add rule
            </SettingsButton>
          </div>
        </div>
      ) : (
        <div className={compactStackClass}>
          <UiTextarea
            label="Replication configuration (JSON)"
            value={text}
            onChange={(event) => updateText(event.target.value)}
            rows={14}
            className="settings-control font-mono"
            spellCheck={false}
            disabled={disabled}
          />
          {hasUnsupportedZone && (
            <p className="ui-caption text-rose-700 dark:text-rose-200">
              Destination.Zone is not supported in V1 and must be removed before saving.
            </p>
          )}
          <BucketFeatureJsonExample
            show={showJsonExample}
            onToggle={() => setShowJsonExample((current) => !current)}
            example={replicationJsonExample}
            onUseExample={() => updateText(replicationJsonExample)}
            disabled={blocked || notImplemented}
          />
        </div>
      )}
    </BucketFeatureSection>
  );
}
