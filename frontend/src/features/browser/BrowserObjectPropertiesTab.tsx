/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsOperationSection from "../../components/settings/SettingsOperationSection";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { storageClassOptions } from "./browserConstants";
import type {
  BrowserObjectMetadataDraft,
  BrowserObjectDirtySections,
  BrowserObjectPropertyEntry,
  BrowserObjectPropertyEntryField,
} from "./useBrowserObjectProperties";

type AsyncAction = () => Promise<unknown> | void;

type EditablePairsProps = {
  addLabel: string;
  emptyLabel: string;
  entries: BrowserObjectPropertyEntry[];
  keyPlaceholder: string;
  onAdd: () => void;
  onChange: (id: string, field: BrowserObjectPropertyEntryField, value: string) => void;
  onRemove: (id: string) => void;
  title: string;
  hideLegend?: boolean;
  valuePlaceholder: string;
};

const standardMetadataFields: Array<{
  field: keyof BrowserObjectMetadataDraft;
  label: string;
  placeholder?: string;
  type?: "datetime-local";
}> = [
  { field: "contentType", label: "Content type", placeholder: "application/octet-stream" },
  { field: "cacheControl", label: "Cache control", placeholder: "max-age=3600" },
  { field: "contentDisposition", label: "Content disposition", placeholder: "inline" },
  { field: "contentEncoding", label: "Content encoding", placeholder: "gzip" },
  { field: "contentLanguage", label: "Content language", placeholder: "en" },
  { field: "expires", label: "Expires", type: "datetime-local" },
];

function EditablePairs({
  addLabel, emptyLabel, entries, keyPlaceholder, onAdd, onChange,
  onRemove, title, hideLegend = false, valuePlaceholder,
}: EditablePairsProps) {
  return (
    <fieldset className="settings-stack min-w-0">
      <legend className={hideLegend ? "sr-only" : "settings-label mb-2"}>{title}</legend>
      {entries.length === 0 ? (
        <p className="settings-description">{emptyLabel}</p>
      ) : entries.map((entry, index) => (
        <div key={entry.id} className="settings-fields sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <UiInput label={`${title} key ${index + 1}`} value={entry.key}
            onChange={(event) => onChange(entry.id, "key", event.target.value)} placeholder={keyPlaceholder} />
          <UiInput label={`${title} value ${index + 1}`} value={entry.value}
            onChange={(event) => onChange(entry.id, "value", event.target.value)} placeholder={valuePlaceholder} />
          <SettingsButton variant="secondary" aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
            onClick={() => onRemove(entry.id)}>Remove</SettingsButton>
        </div>
      ))}
      <div><SettingsButton variant="secondary" onClick={onAdd}>{addLabel}</SettingsButton></div>
    </fieldset>
  );
}

type BrowserObjectPropertiesTabProps = {
  error: string | null;
  dirtySections?: BrowserObjectDirtySections;
  loaded: boolean;
  loading: boolean;
  metadataDraft: BrowserObjectMetadataDraft;
  metadataItems: BrowserObjectPropertyEntry[];
  onAddMetadata: () => void;
  onAddTag: () => void;
  onMetadataDraftChange: (field: keyof BrowserObjectMetadataDraft, value: string) => void;
  onMetadataItemChange: EditablePairsProps["onChange"];
  onRefresh: AsyncAction;
  onRemoveMetadata: (id: string) => void;
  onRemoveTag: (id: string) => void;
  onSaveMetadata: AsyncAction;
  onSaveStorageClass: AsyncAction;
  onSaveTags: AsyncAction;
  onStorageClassChange: (value: string) => void;
  onTagChange: EditablePairsProps["onChange"];
  readOnly: boolean;
  savingMetadata: boolean;
  savingStorageClass: boolean;
  savingTags: boolean;
  storageClass: string;
  tags: BrowserObjectPropertyEntry[];
};

export default function BrowserObjectPropertiesTab({
  error, dirtySections, loaded, loading, metadataDraft, metadataItems, onAddMetadata, onAddTag,
  onMetadataDraftChange, onMetadataItemChange, onRefresh, onRemoveMetadata,
  onRemoveTag, onSaveMetadata, onSaveStorageClass, onSaveTags, onStorageClassChange,
  onTagChange, readOnly, savingMetadata, savingStorageClass, savingTags, storageClass, tags,
}: BrowserObjectPropertiesTabProps) {
  const saving = savingMetadata || savingStorageClass || savingTags;
  const disabled = readOnly || loading || !loaded || saving;

  return (
    <div className="settings-compact settings-form">
      {readOnly && <UiInlineMessage tone="info">Properties are read-only in the Standard Browser profile.</UiInlineMessage>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="settings-description" role="status">{loading ? "Loading object details..." : "Save each section independently. Refresh keeps unsaved edits."}</p>
        <SettingsButton variant="secondary" onClick={() => void onRefresh()} disabled={loading || saving}>
          {error ? "Retry" : "Refresh"}
        </SettingsButton>
      </div>
      {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
      <SettingsOperationSection title="Metadata" description="Standard headers and custom metadata are saved together."
        busy={savingMetadata} disabled={disabled} dirty={dirtySections?.metadata} submitLabel="Save metadata" onSubmit={onSaveMetadata}>
        <div className="settings-fields sm:grid-cols-2">
          {standardMetadataFields.map(({ field, label, placeholder, type }) => (
            <UiInput key={field} label={label} type={type} value={metadataDraft[field]}
              onChange={(event) => onMetadataDraftChange(field, event.target.value)} placeholder={placeholder} />
          ))}
        </div>
        <EditablePairs title="Custom metadata" addLabel="Add metadata" emptyLabel="No custom metadata defined."
          entries={metadataItems} keyPlaceholder="x-custom-key" valuePlaceholder="value"
          onAdd={onAddMetadata} onChange={onMetadataItemChange} onRemove={onRemoveMetadata} />
      </SettingsOperationSection>
      <SettingsOperationSection title="Tags" description="Key/value tags attached to this object."
        busy={savingTags} disabled={disabled} dirty={dirtySections?.tags} submitLabel="Save tags" onSubmit={onSaveTags}>
        <EditablePairs title="Tags" hideLegend addLabel="Add tag" emptyLabel="No tags defined." entries={tags}
          keyPlaceholder="Key" valuePlaceholder="Value" onAdd={onAddTag} onChange={onTagChange} onRemove={onRemoveTag} />
      </SettingsOperationSection>
      <SettingsOperationSection title="Storage class" description="Changing storage class copies the object to the selected storage tier."
        busy={savingStorageClass} disabled={disabled} dirty={dirtySections?.storageClass} submitDisabled={!storageClass}
        submitLabel="Save storage class" onSubmit={onSaveStorageClass}>
        <UiSelect label="Storage class" value={storageClass} onChange={(event) => onStorageClassChange(event.target.value)}>
          <option value="">Select storage class</option>
          {storageClassOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </UiSelect>
      </SettingsOperationSection>
    </div>
  );
}
