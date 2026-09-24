/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import DataTableShell, { type DataTableColumn } from "../../../components/list/DataTableShell";
import { ListActionButton, ListActions } from "../../../components/list/ListControls";
import { SettingsButton, SettingsInput } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiTextarea from "../../../components/ui/UiTextarea";
import { cx, uiCardMutedClass } from "../../../components/ui/styles";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import {
  describeLifecycleActions,
  lifecycleFilterLabel,
  lifecycleRuleId,
  lifecycleRulePrefix,
  lifecycleRuleStatus,
  type LifecycleRuleRecord,
} from "../bucketLifecycle";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureModeToggle from "./BucketFeatureModeToggle";
import BucketFeatureSection from "./BucketFeatureSection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketLifecycleController } from "./useBucketLifecycleController";

type BucketLifecycleController = ReturnType<typeof useBucketLifecycleController>;

type BucketLifecycleFeatureProps = {
  controller: BucketLifecycleController;
};

type LifecycleTableRow = {
  key: string;
  index: number;
  rule: LifecycleRuleRecord;
};

const lifecycleJsonExample = `[
  {
    "ID": "expire-logs",
    "Status": "Enabled",
    "Filter": { "Prefix": "logs/" },
    "Expiration": { "Days": 30 }
  }
]`;

export default function BucketLifecycleFeature({ controller }: BucketLifecycleFeatureProps) {
  const [showJsonExample, setShowJsonExample] = useState(false);
  const {
    addCleanupExample,
    addExpirationExample,
    addTransitionExample,
    deleteRule,
    dirty,
    editorVisible,
    error,
    expirationDraft,
    hasRules,
    loading,
    mode,
    ruleCount,
    rules,
    save,
    saving,
    status,
    text,
    toggleEditor,
    toggleRuleStatus,
    transitionDraft,
    updateExpirationDraft,
    updateMode,
    updateText,
    updateTransitionDraft,
    warning,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured: hasRules,
    unsaved: dirty,
  });
  const operationDisabled = notImplemented || saving || loading;
  const rows = useMemo<LifecycleTableRow[]>(
    () =>
      rules.map((rule, index) => {
        const ruleId = lifecycleRuleId(rule);
        return {
          key: `${ruleId ?? lifecycleRulePrefix(rule) ?? "rule"}-${index}`,
          index,
          rule,
        };
      }),
    [rules],
  );
  const columns: Array<DataTableColumn<LifecycleTableRow>> = [
    {
      id: "id",
      label: "ID",
      primary: true,
      headerClassName: "min-w-48",
      cellClassName: "min-w-48",
      render: ({ rule }) => lifecycleRuleId(rule) ?? "(no ID)",
    },
    {
      id: "status",
      label: "Status",
      headerClassName: "w-px whitespace-nowrap",
      cellClassName: "w-px whitespace-nowrap",
      render: ({ index, rule }) => {
        const ruleStatus = lifecycleRuleStatus(rule);
        return (
          <ListActionButton
            type="button"
            onClick={() => toggleRuleStatus(index)}
            variant={ruleStatus === "Disabled" ? "secondary" : "success"}
            disabled={operationDisabled}
          >
            {ruleStatus}
          </ListActionButton>
        );
      },
    },
    {
      id: "filter",
      label: "Filter",
      headerClassName: "min-w-32 whitespace-nowrap",
      cellClassName: "min-w-32",
      render: ({ rule }) => lifecycleFilterLabel(rule.Filter),
    },
    {
      id: "actions",
      label: "Rule actions",
      mobileLabel: "Rule actions",
      headerClassName: "min-w-72",
      cellClassName: "min-w-72",
      render: ({ rule }) => describeLifecycleActions(rule),
    },
    {
      id: "manage",
      label: "Manage",
      mobileRole: "actions",
      render: ({ index }) => (
        <ListActions>
          <ListActionButton
            variant="danger"
            type="button"
            onClick={() => deleteRule(index)}
            disabled={operationDisabled}
          >
            Delete
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <BucketFeatureSection
      title="Lifecycle rules"
      description="S3-side expiration/clean-up."
      mode="hybrid"
      visualState={visualState}
      presentation="workbench"
      successMessage={status}
      busy={saving || loading}
      testId="bucket-feature-lifecycle"
      actions={
        <div className="flex flex-wrap gap-2">
          <span className="settings-description">
            {ruleCount === 1 ? "1 rule" : `${ruleCount} rules`}
          </span>
          <SettingsButton type="button" onClick={toggleEditor} variant="secondary" disabled={notImplemented}>
            {editorVisible ? "Hide editor" : "Show editor"}
          </SettingsButton>
          <SettingsButton
            type="button"
            onClick={save}
            disabled={operationDisabled || !dirty || mode !== "json"}
            title={mode === "simple" ? "Quick add actions save immediately." : undefined}
            variant="primary"
          >
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        </div>
      }
    >
      {error && <UiInlineMessage tone="error" className="mt-2">{error}</UiInlineMessage>}
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        status={loading && rows.length === 0 ? "loading" : rows.length === 0 ? "empty" : "ready"}
        loadingMessage="Loading lifecycle rules..."
        errorMessage="Unable to load lifecycle rules."
        emptyMessage="No rules configured on this bucket."
        primaryColumnId="id"
        responsiveCards
      />

      {editorVisible && (
        <>
          <div className="mt-3">
            <BucketFeatureModeToggle
              value={mode}
              options={[
                { value: "json", label: "JSON mode" },
                { value: "simple", label: "Quick add" },
              ]}
              onChange={updateMode}
              disabled={notImplemented}
            />
          </div>
          {mode === "simple" ? (
            <div className="mt-3 space-y-3">
              {warning && <UiInlineMessage tone="warning">{warning}</UiInlineMessage>}
              <p className="settings-description">
                Quickly add one of the preconfigured rules below (appended to the existing configuration).
              </p>
              <div className="space-y-3">
                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                  <p className="settings-label">
                    Rule 1: noncurrent 90d + multipart 30d + delete markers (explicit)
                  </p>
                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                    Cleans noncurrent versions after 90d, removes incomplete multipart uploads after 30d, and deletes expired delete markers.
                  </p>
                  <div className="mt-2 flex justify-end">
                    <SettingsButton
                      type="button"
                      onClick={() => void addCleanupExample()}
                      variant="secondary"
                      disabled={operationDisabled}
                    >
                      Add
                    </SettingsButton>
                  </div>
                </div>

                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                  <p className="settings-label">Rule 2: current/noncurrent transitions</p>
                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                    <SettingsInput
                      label="Current versions expiration (days)"
                      type="number"
                      min={0}
                      value={transitionDraft.currentDays}
                      onChange={(event) => updateTransitionDraft({ currentDays: event.target.value })}
                      className="w-28"
                      disabled={notImplemented}
                    />
                    <SettingsInput
                      label="Noncurrent versions expiration (days)"
                      type="number"
                      min={0}
                      value={transitionDraft.noncurrentDays}
                      onChange={(event) => updateTransitionDraft({ noncurrentDays: event.target.value })}
                      className="w-28"
                      disabled={notImplemented}
                    />
                    <SettingsInput
                      label="Storage class"
                      type="text"
                      value={transitionDraft.storageClass}
                      onChange={(event) => updateTransitionDraft({ storageClass: event.target.value })}
                      className="w-32"
                      placeholder="GLACIER"
                      disabled={notImplemented}
                    />
                    <SettingsInput
                      label="Prefix (optional)"
                      type="text"
                      value={transitionDraft.prefix}
                      onChange={(event) => updateTransitionDraft({ prefix: event.target.value })}
                      className="w-32"
                      placeholder="logs/"
                      disabled={notImplemented}
                    />
                  </div>
                  <div className="mt-2 flex justify-end">
                    <SettingsButton
                      type="button"
                      onClick={() => void addTransitionExample()}
                      variant="secondary"
                      disabled={operationDisabled}
                    >
                      Add
                    </SettingsButton>
                  </div>
                </div>

                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                  <p className="settings-label">Rule 3: current/noncurrent expiration</p>
                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                    <SettingsInput
                      label="Current versions expiration (days)"
                      type="number"
                      min={0}
                      value={expirationDraft.currentDays}
                      onChange={(event) => updateExpirationDraft({ currentDays: event.target.value })}
                      className="w-32"
                      disabled={notImplemented}
                    />
                    <SettingsInput
                      label="Noncurrent versions expiration (days)"
                      type="number"
                      min={0}
                      value={expirationDraft.noncurrentDays}
                      onChange={(event) => updateExpirationDraft({ noncurrentDays: event.target.value })}
                      className="w-32"
                      disabled={notImplemented}
                    />
                    <SettingsInput
                      label="Prefix (optional)"
                      type="text"
                      value={expirationDraft.prefix}
                      onChange={(event) => updateExpirationDraft({ prefix: event.target.value })}
                      className="w-32"
                      placeholder="archive/"
                      disabled={notImplemented}
                    />
                  </div>
                  <div className="mt-2 flex justify-end">
                    <SettingsButton
                      type="button"
                      onClick={() => void addExpirationExample()}
                      variant="secondary"
                      disabled={operationDisabled}
                    >
                      Add
                    </SettingsButton>
                  </div>
                </div>
              </div>
              <p className="settings-description">Use JSON mode to customize or edit rules.</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="settings-description">
                Paste a JSON array that matches the S3 API (<code>Rules</code>). Existing rules are listed above.
              </p>
              <UiTextarea
                label="Lifecycle rules (JSON)"
                value={text}
                onChange={(event) => updateText(event.target.value)}
                rows={10}
                className="settings-control font-mono"
                disabled={notImplemented}
              />
              <BucketFeatureJsonExample
                show={showJsonExample}
                onToggle={() => setShowJsonExample((current) => !current)}
                example={lifecycleJsonExample}
                onUseExample={() => updateText(lifecycleJsonExample)}
                disabled={notImplemented}
              />
            </div>
          )}
        </>
      )}
    </BucketFeatureSection>
  );
}
