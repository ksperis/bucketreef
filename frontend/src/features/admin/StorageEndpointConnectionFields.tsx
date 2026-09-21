/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { Dispatch, SetStateAction } from "react";
import type { StorageProvider } from "../../api/storageEndpoints";
import type { TagDefinitionSummary } from "../../api/tags";
import { SettingsSection, SettingsChoiceRow, SettingsItem, SettingsSwitch } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiTagEditor from "../../components/UiTagEditor";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import { buildUiTagItems } from "../../utils/uiTags";
import { awsS3EndpointForRegion, type FormState } from "./storageEndpointFormModel";
import type { EndpointFieldErrors } from "./storageEndpointSubmission";

export default function StorageEndpointConnectionFields({
  form, setForm, readOnly, canEditTags, busy, catalog, catalogLoading, errors,
  onProviderChange, onRegionChange, invalidateChecks,
}: {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  readOnly: boolean;
  canEditTags: boolean;
  busy: boolean;
  catalog: TagDefinitionSummary[];
  catalogLoading: boolean;
  errors: EndpointFieldErrors;
  onProviderChange: (value: StorageProvider) => void;
  onRegionChange: (value: string) => void;
  invalidateChecks: () => void;
}) {
  const aws = form.provider === "aws";
  return <>
    <SettingsSection title="Identity" description="Name and classify this endpoint." presentation="compact">
      <div className="settings-fields sm:grid-cols-2">
        <UiInput label="Endpoint name" value={form.name} readOnly={readOnly} required error={errors.name}
          onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} />
        {canEditTags ? <UiTagEditor label="Endpoint tags" tags={form.tags} catalog={catalog} disabled={busy}
          onChange={tags => setForm(previous => ({ ...previous, tags }))} placeholder="Add a tag for this endpoint"
          hint={catalogLoading ? "Loading existing endpoint tags..." : undefined} compact />
          : <div className="settings-stack"><p className="settings-label">Endpoint tags</p>
            <UiTagBadgeList items={buildUiTagItems(form.tags)} emptyLabel="No tags" /></div>}
      </div>
    </SettingsSection>
    <SettingsSection title="Connection" description="Choose the provider and how BucketReef reaches it." presentation="compact">
      <div className="settings-fields">
        <fieldset aria-label="Provider" className="min-w-0">
          <legend className="settings-label mb-1">Provider</legend>
          {([['ceph', 'Ceph'], ['aws', 'AWS'], ['other', 'Other']] as const).map(([value, title]) =>
            <SettingsChoiceRow key={value} title={title} type="radio" name="endpoint-provider" checked={form.provider === value}
              disabled={readOnly} onChange={() => onProviderChange(value)} />)}
        </fieldset>
        <div className="settings-fields sm:grid-cols-2">
          <UiInput label="S3 endpoint URL" required value={aws ? awsS3EndpointForRegion(form.region) : form.endpoint_url}
            readOnly={readOnly || aws} placeholder={aws ? undefined : "https://s3.example.com"} error={errors.endpoint_url}
            hint={aws ? "Derived from the AWS region." : undefined}
            onChange={event => { if (!aws) { invalidateChecks(); setForm(previous => ({ ...previous, endpoint_url: event.target.value })); } }} />
          <UiInput label="Region (optional)" value={form.region} readOnly={readOnly} placeholder="us-east-1"
            onChange={event => onRegionChange(event.target.value)} />
        </div>
        <SettingsItem title="Force path style" compact action={<SettingsSwitch ariaLabel="Force path style"
          checked={form.force_path_style} disabled={readOnly}
          onChange={value => setForm(previous => ({ ...previous, force_path_style: value }))} />} />
        <SettingsItem title="Insecure SSL (skip certificate validation)" compact action={<SettingsSwitch
          ariaLabel="Insecure SSL (skip certificate validation)" checked={!form.verify_tls} disabled={readOnly}
          onChange={value => { invalidateChecks(); setForm(previous => ({ ...previous, verify_tls: !value })); }} />} />
        {!form.verify_tls && <UiInlineMessage tone="warning">
          TLS certificate validation is disabled for this endpoint. Use only in trusted environments.
        </UiInlineMessage>}
      </div>
    </SettingsSection>
    <SettingsSection title="Location" description="Optional geographic coordinates for the endpoint map." presentation="compact">
      <div className="settings-fields sm:grid-cols-2">
        <UiInput label="Latitude (optional)" type="number" value={form.latitude} readOnly={readOnly} min={-90} max={90} step="any"
          error={errors.latitude} onChange={event => setForm(previous => ({ ...previous, latitude: event.target.value }))} />
        <UiInput label="Longitude (optional)" type="number" value={form.longitude} readOnly={readOnly} min={-180} max={180} step="any"
          error={errors.longitude} onChange={event => setForm(previous => ({ ...previous, longitude: event.target.value }))} />
      </div>
    </SettingsSection>
  </>;
}
