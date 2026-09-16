/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, ReactNode, SetStateAction } from "react";
import InlineSummary from "../../components/InlineSummary";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiTextarea from "../../components/ui/UiTextarea";
import { stableSignature } from "../../utils/stableSignature";
import { aclOptions, storageClassOptions } from "./browserConstants";
import type { BrowserBulkAttributesDraft } from "./useBrowserBulkAttributes";

const metadataFields = [
  ["contentType", "Content-Type"],
  ["cacheControl", "Cache-Control"],
  ["contentDisposition", "Content-Disposition"],
  ["contentEncoding", "Content-Encoding"],
  ["contentLanguage", "Content-Language"],
  ["expires", "Expires"],
] as const;

function AttributeOption({ label, checked, onChange, children }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return <div className="settings-stack border-b border-[var(--ui-border)] pb-3 last:border-b-0 last:pb-0">
    <UiCheckboxField className="settings-choice font-semibold" checked={checked}
      onChange={(event) => onChange(event.target.checked)}>{label}</UiCheckboxField>
    {checked && children}
  </div>;
}

type BrowserBulkAttributesModalProps = {
  draft: BrowserBulkAttributesDraft;
  error: string | null;
  fileCount: number;
  folderCount: number;
  loading: boolean;
  onApply: () => void | Promise<void>;
  onClose: () => void;
  setDraft: Dispatch<SetStateAction<BrowserBulkAttributesDraft>>;
  summary: string | null;
};

export default function BrowserBulkAttributesModal({
  draft,
  error,
  fileCount,
  folderCount,
  loading,
  onApply,
  onClose,
  setDraft,
  summary,
}: BrowserBulkAttributesModalProps) {
  const updateDraft = <Key extends keyof BrowserBulkAttributesDraft>(
    key: Key,
    value: BrowserBulkAttributesDraft[Key],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  const updateMetadata = (
    key: keyof BrowserBulkAttributesDraft["metadata"],
    value: string,
  ) =>
    setDraft((previous) => ({
      ...previous,
      metadata: { ...previous.metadata, [key]: value },
    }));

  return (
    <SettingsFormDialog title="Bulk attributes" draftKey={stableSignature(draft)}
      busy={loading} error={error} onSubmit={onApply} onClose={onClose}
      submitLabel={loading ? "Updating..." : "Apply changes"} maxWidthClass="max-w-3xl">
      <InlineSummary label="Targets" items={[
        { label: "Files", value: fileCount },
        { label: "Folders", value: folderCount, hint: folderCount > 0 ? "Folders expanded to files." : undefined },
      ]} />
      {summary && <UiInlineMessage tone="success" role="status">{summary}</UiInlineMessage>}
      <div className="settings-stack">
        <AttributeOption label="Metadata headers" checked={draft.applyMetadata} onChange={(value) => updateDraft("applyMetadata", value)}>
          <div className="grid gap-3 sm:grid-cols-2">
            {metadataFields.map(([key, label]) => <UiInput key={key} label={label} placeholder={label}
              type={key === "expires" ? "datetime-local" : "text"}
              value={draft.metadata[key]} onChange={(event) => updateMetadata(key, event.target.value)} />)}
          </div>
          <UiTextarea label="Custom metadata" hint="One key=value pair per line." rows={3}
            value={draft.metadataEntries} onChange={(event) => updateDraft("metadataEntries", event.target.value)} />
        </AttributeOption>
        <AttributeOption label="Tags (key=value per line)" checked={draft.applyTags} onChange={(value) => updateDraft("applyTags", value)}>
          <UiTextarea label="Tags" rows={3} value={draft.tags} onChange={(event) => updateDraft("tags", event.target.value)} />
        </AttributeOption>
        <AttributeOption label="Storage class" checked={draft.applyStorageClass} onChange={(value) => updateDraft("applyStorageClass", value)}>
          <UiSelect label="Storage class" value={draft.storageClass} onChange={(event) => updateDraft("storageClass", event.target.value)}>
            <option value="">Select storage class</option>
            {storageClassOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </UiSelect>
        </AttributeOption>
        <AttributeOption label="ACL" checked={draft.applyAcl} onChange={(value) => updateDraft("applyAcl", value)}>
          <UiSelect label="ACL" value={draft.aclValue} onChange={(event) => updateDraft("aclValue", event.target.value)}>
            {aclOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </UiSelect>
        </AttributeOption>
        <AttributeOption label="Legal hold" checked={draft.applyLegalHold} onChange={(value) => updateDraft("applyLegalHold", value)}>
          <UiSelect label="Legal hold status" value={draft.legalHoldStatus}
            onChange={(event) => updateDraft("legalHoldStatus", event.target.value as "ON" | "OFF")}>
            <option value="OFF">OFF</option><option value="ON">ON</option>
          </UiSelect>
        </AttributeOption>
        <AttributeOption label="Retention" checked={draft.applyRetention} onChange={(value) => updateDraft("applyRetention", value)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <UiSelect label="Retention mode" value={draft.retentionMode}
              onChange={(event) => updateDraft("retentionMode", event.target.value as "" | "GOVERNANCE" | "COMPLIANCE")}>
              <option value="">Select mode</option><option value="GOVERNANCE">GOVERNANCE</option><option value="COMPLIANCE">COMPLIANCE</option>
            </UiSelect>
            <UiInput label="Retain until" type="datetime-local" value={draft.retentionDate}
              onChange={(event) => updateDraft("retentionDate", event.target.value)} />
          </div>
          <UiCheckboxField className="settings-choice" checked={draft.retentionBypass}
            onChange={(event) => updateDraft("retentionBypass", event.target.checked)}>Bypass governance</UiCheckboxField>
        </AttributeOption>
      </div>
    </SettingsFormDialog>
  );
}
