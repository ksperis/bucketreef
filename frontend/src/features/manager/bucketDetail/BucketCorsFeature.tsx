/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import DataTableShell, { type DataTableColumn } from "../../../components/list/DataTableShell";
import {
  SettingsButton,
  SettingsInput,
} from "../../../components/settings/SettingsControls";
import UiCheckboxField from "../../../components/ui/UiCheckboxField";
import UiBadge from "../../../components/ui/UiBadge";
import UiTextarea from "../../../components/ui/UiTextarea";
import { cx, uiCardMutedClass } from "../../../components/ui/styles";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureEditorDialog from "./BucketFeatureEditorDialog";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureSummarySection from "./BucketFeatureSummarySection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import {
  corsMethods,
  isCorsRuleVisuallyEditable,
  readCorsVisualRule,
  type CorsMethod,
  type CorsRuleRecord,
  type CorsVisualRuleDraft,
} from "./corsEditorModel";
import type { useBucketCorsController } from "./useBucketCorsController";

type BucketCorsController = ReturnType<typeof useBucketCorsController>;

type BucketCorsFeatureProps = {
  controller: BucketCorsController;
};

type CorsTableRow = {
  index: number;
  rule: CorsRuleRecord;
};

const defaultCorsExample = `[
  {
    "ID": "browser-uploads",
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]`;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : [];
}

function summarizeList(values: string[], empty = "—"): string {
  if (values.length === 0) return empty;
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2} more`;
}

function ruleLabel(rule: CorsRuleRecord, index: number): string {
  return typeof rule.ID === "string" && rule.ID.trim() ? rule.ID : `Rule ${index + 1}`;
}

function summarizeRuleOptions(rule: CorsRuleRecord): string {
  const parts: string[] = [];
  const allowedHeaders = stringArray(rule.AllowedHeaders);
  const exposeHeaders = stringArray(rule.ExposeHeaders);
  if (allowedHeaders.length > 0) parts.push(`${allowedHeaders.length} allowed header${allowedHeaders.length === 1 ? "" : "s"}`);
  if (exposeHeaders.length > 0) parts.push(`${exposeHeaders.length} exposed header${exposeHeaders.length === 1 ? "" : "s"}`);
  if (typeof rule.MaxAgeSeconds === "number") parts.push(`max age ${rule.MaxAgeSeconds}s`);
  return parts.length > 0 ? parts.join(" · ") : "Default response headers";
}

function StringListEditor({
  title,
  itemLabel,
  description,
  values,
  placeholder,
  addLabel,
  disabled,
  onChange,
}: {
  title: string;
  itemLabel: string;
  description: string;
  values: string[];
  placeholder: string;
  addLabel: string;
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-[color:var(--ui-border-soft)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="settings-label">{title}</p>
          <p className="settings-description">{description}</p>
        </div>
        <SettingsButton
          type="button"
          variant="secondary"
          onClick={() => onChange([...values, ""])}
          disabled={disabled}
        >
          {addLabel}
        </SettingsButton>
      </div>
      {values.length === 0 ? (
        <p className="settings-description">None configured.</p>
      ) : (
        <div className="space-y-2">
          {values.map((value, index) => (
            <div key={index} className="flex min-w-0 items-end gap-2">
              <div className="min-w-0 flex-1">
                <SettingsInput
                  label={`${itemLabel} ${index + 1}`}
                  value={value}
                  placeholder={placeholder}
                  onChange={(event) =>
                    onChange(values.map((entry, entryIndex) =>
                      entryIndex === index ? event.target.value : entry,
                    ))
                  }
                  disabled={disabled}
                />
              </div>
              <SettingsButton
                type="button"
                variant="secondary"
                aria-label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`}
                onClick={() => onChange(values.filter((_, entryIndex) => entryIndex !== index))}
                disabled={disabled}
              >
                Remove
              </SettingsButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CorsRuleEditor({
  index,
  rule,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  rule: CorsRuleRecord;
  disabled: boolean;
  onChange: (patch: Partial<CorsVisualRuleDraft>) => void;
  onRemove: () => void;
}) {
  const editable = isCorsRuleVisuallyEditable(rule);
  const label = ruleLabel(rule, index);

  if (!editable) {
    return (
      <div className={cx(uiCardMutedClass, "space-y-2 px-3 py-3")} data-testid="cors-advanced-rule">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="settings-label break-all">{label}</p>
            <p className="settings-description mt-1">
              {summarizeList(stringArray(rule.AllowedOrigins), "No readable origins")} · {summarizeList(stringArray(rule.AllowedMethods), "No readable methods")}
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

  const draft = readCorsVisualRule(rule);
  const updateMethod = (method: CorsMethod, checked: boolean) => {
    const selected = new Set(draft.allowedMethods);
    if (checked) selected.add(method);
    else selected.delete(method);
    onChange({ allowedMethods: corsMethods.filter((candidate) => selected.has(candidate)) });
  };

  return (
    <div className={cx(uiCardMutedClass, "space-y-4 px-3 py-3")} data-testid="cors-visual-rule">
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
        <SettingsInput
          label="Rule ID (optional)"
          value={draft.id}
          placeholder="browser-uploads"
          onChange={(event) => onChange({ id: event.target.value })}
          disabled={disabled}
        />
        <SettingsInput
          label="Max age (seconds)"
          type="number"
          min={0}
          step={1}
          value={draft.maxAgeSeconds}
          placeholder="3600"
          onChange={(event) => onChange({ maxAgeSeconds: event.target.value })}
          disabled={disabled}
        />
      </div>

      <StringListEditor
        title="Allowed origins"
        itemLabel="Origin"
        description="Origins that may issue cross-origin requests. Use * only when intentionally allowing any origin."
        values={draft.allowedOrigins}
        placeholder="https://app.example.com"
        addLabel="Add origin"
        disabled={disabled}
        onChange={(allowedOrigins) => onChange({ allowedOrigins })}
      />

      <div className="space-y-2 rounded-md border border-[color:var(--ui-border-soft)] p-3">
        <div>
          <p className="settings-label">Allowed methods</p>
          <p className="settings-description">Select the S3 operations browsers may call from the configured origins.</p>
        </div>
        <div role="group" aria-label={`Allowed methods for ${label}`} className="flex flex-wrap gap-x-4 gap-y-2">
          {corsMethods.map((method) => (
            <UiCheckboxField
              key={method}
              checked={draft.allowedMethods.includes(method)}
              onChange={(event) => updateMethod(method, event.target.checked)}
              disabled={disabled}
              className="settings-body"
            >
              {method}
            </UiCheckboxField>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <StringListEditor
          title="Allowed request headers"
          itemLabel="Allowed header"
          description="Headers accepted in browser preflight requests."
          values={draft.allowedHeaders}
          placeholder="Content-Type"
          addLabel="Add header"
          disabled={disabled}
          onChange={(allowedHeaders) => onChange({ allowedHeaders })}
        />
        <StringListEditor
          title="Exposed response headers"
          itemLabel="Exposed header"
          description="Response headers browser JavaScript is allowed to read."
          values={draft.exposeHeaders}
          placeholder="ETag"
          addLabel="Add exposed header"
          disabled={disabled}
          onChange={(exposeHeaders) => onChange({ exposeHeaders })}
        />
      </div>
    </div>
  );
}

export default function BucketCorsFeature({ controller }: BucketCorsFeatureProps) {
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
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: false,
  });
  const rows = useMemo<CorsTableRow[]>(
    () => rules.map((rule, index) => ({ index, rule })),
    [rules],
  );
  const columns: Array<DataTableColumn<CorsTableRow>> = [
    {
      id: "rule",
      label: "Rule",
      primary: true,
      headerClassName: "min-w-40",
      cellClassName: "min-w-40",
      render: ({ rule, index }) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all">{ruleLabel(rule, index)}</span>
          {!isCorsRuleVisuallyEditable(rule) ? <UiBadge tone="warning">Advanced</UiBadge> : null}
        </div>
      ),
    },
    {
      id: "origins",
      label: "Allowed origins",
      headerClassName: "min-w-56",
      cellClassName: "min-w-56",
      render: ({ rule }) => summarizeList(stringArray(rule.AllowedOrigins)),
    },
    {
      id: "methods",
      label: "Methods",
      headerClassName: "min-w-32",
      cellClassName: "min-w-32",
      render: ({ rule }) => summarizeList(stringArray(rule.AllowedMethods)),
    },
    {
      id: "options",
      label: "Headers / cache",
      mobileLabel: "Headers / cache",
      headerClassName: "min-w-56",
      cellClassName: "min-w-56",
      render: ({ rule }) => summarizeRuleOptions(rule),
    },
  ];

  const visualEditor = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="settings-description">
          Edit standard S3 CORS rules visually. Advanced rules stay read-only here and are preserved for JSON editing.
        </p>
        <SettingsButton type="button" variant="secondary" onClick={addDraftRule} disabled={saving}>
          Add rule
        </SettingsButton>
      </div>
      {draftRules.length === 0 ? (
        <div className={cx(uiCardMutedClass, "px-3 py-4 text-center settings-description")}>
          No CORS rules. Add a rule or switch to JSON.
        </div>
      ) : (
        draftRules.map((rule, index) => (
          <CorsRuleEditor
            key={`${typeof rule.ID === "string" ? rule.ID : "rule"}-${index}`}
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
        Edit the complete S3 CORS <code>CORSRules</code> array. Switching back to Visual validates the JSON structure first.
      </p>
      <UiTextarea
        label="CORS rules (JSON)"
        value={jsonText}
        onChange={(event) => updateJsonText(event.target.value)}
        rows={20}
        className="settings-control font-mono"
        disabled={saving}
        spellCheck={false}
      />
      <BucketFeatureJsonExample
        show={showJsonExample}
        onToggle={() => setShowJsonExample((current) => !current)}
        example={defaultCorsExample}
        onUseExample={() => updateJsonText(defaultCorsExample)}
        disabled={saving}
      />
    </div>
  );

  return (
    <>
      <BucketFeatureSummarySection
        title="CORS"
        description="Cross-origin rules applied by the S3 endpoint."
        visualState={visualState}
        metadata={ruleCount === 1 ? "1 rule" : `${ruleCount} rules`}
        loading={loading}
        error={error}
        successMessage={status}
        editDisabled={notImplemented || saving}
        onEdit={openEditor}
        testId="bucket-feature-cors"
      >
        <DataTableShell
          columns={columns}
          rows={rows}
          rowKey={(row) => `${ruleLabel(row.rule, row.index)}-${row.index}`}
          status={rows.length === 0 ? "empty" : "ready"}
          loadingMessage="Loading CORS rules..."
          errorMessage="Unable to load CORS rules."
          emptyMessage="No CORS rules configured on this bucket."
          primaryColumnId="rule"
          responsiveCards
        />
      </BucketFeatureSummarySection>

      {editorOpen ? (
        <BucketFeatureEditorDialog
          title="Edit CORS rules"
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
