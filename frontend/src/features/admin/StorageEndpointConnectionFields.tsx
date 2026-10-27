/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { Dispatch, ReactNode, SetStateAction } from "react";
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
import { useStorageEndpointI18n } from "./storageEndpointMessages";

export default function StorageEndpointConnectionFields({
  form, setForm, readOnly, canEditTags, busy, catalog, catalogLoading, errors,
  onProviderChange, onRegionChange, invalidateChecks,
  validationStatus,
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
  validationStatus?: ReactNode;
}) {
  const { text } = useStorageEndpointI18n();
  const aws = form.provider === "aws";
  return <>
    <SettingsSection title={text("identitySection")} description={text("identityDescription")} presentation="compact">
      <div className="settings-fields sm:grid-cols-2">
        <UiInput label={text("endpointName")} value={form.name} readOnly={readOnly} required error={errors.name}
          onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} />
        {canEditTags ? <UiTagEditor label={text("endpointTags")} tags={form.tags} catalog={catalog} disabled={busy}
          onChange={tags => setForm(previous => ({ ...previous, tags }))} placeholder={text("addEndpointTag")}
          hint={catalogLoading ? text("loadingEndpointTags") : undefined} compact />
          : <div className="settings-stack"><p className="settings-label">{text("endpointTags")}</p>
            <UiTagBadgeList items={buildUiTagItems(form.tags)} emptyLabel={text("noTags")} /></div>}
      </div>
    </SettingsSection>
    <SettingsSection title={text("connection")} description={text("connectionDescription")} presentation="compact">
      <div className="settings-fields">
        <fieldset aria-label={text("providerLabel")} className="min-w-0">
          <legend className="settings-label mb-1">{text("providerLabel")}</legend>
          {([['ceph', text("providerCeph")], ['aws', text("providerAws")], ['other', text("providerOther")]] as const).map(([value, title]) =>
            <SettingsChoiceRow key={value} title={title} type="radio" name="endpoint-provider" checked={form.provider === value}
              disabled={readOnly} onChange={() => onProviderChange(value)} />)}
        </fieldset>
        <div className="settings-fields sm:grid-cols-2">
          <UiInput label={text("s3EndpointUrl")} required value={aws ? awsS3EndpointForRegion(form.region) : form.endpoint_url}
            readOnly={readOnly || aws} placeholder={aws ? undefined : text("s3EndpointPlaceholder")} error={errors.endpoint_url}
            hint={aws ? text("derivedFromAwsRegion") : undefined}
            onChange={event => { if (!aws) { invalidateChecks(); setForm(previous => ({ ...previous, endpoint_url: event.target.value })); } }} />
          <UiInput label={text("optionalRegion")} value={form.region} readOnly={readOnly} placeholder="us-east-1"
            onChange={event => onRegionChange(event.target.value)} />
        </div>
        {validationStatus ? <div className="flex flex-wrap items-center gap-2">{validationStatus}</div> : null}
        <SettingsItem title={text("forcePathStyle")} compact action={<SettingsSwitch ariaLabel={text("forcePathStyle")}
          checked={form.force_path_style} disabled={readOnly}
          onChange={value => setForm(previous => ({ ...previous, force_path_style: value }))} />} />
        <SettingsItem title={text("insecureSsl")} compact action={<SettingsSwitch
          ariaLabel={text("insecureSsl")} checked={!form.verify_tls} disabled={readOnly}
          onChange={value => { invalidateChecks(); setForm(previous => ({ ...previous, verify_tls: !value })); }} />} />
        {!form.verify_tls && <UiInlineMessage tone="warning">
          {text("tlsValidationDisabled")}
        </UiInlineMessage>}
      </div>
    </SettingsSection>
    <SettingsSection title={text("locationSection")} description={text("locationDescription")} presentation="compact">
      <div className="settings-fields sm:grid-cols-2">
        <UiInput label={text("optionalLatitude")} type="number" value={form.latitude} readOnly={readOnly} min={-90} max={90} step="any"
          error={errors.latitude} onChange={event => setForm(previous => ({ ...previous, latitude: event.target.value }))} />
        <UiInput label={text("optionalLongitude")} type="number" value={form.longitude} readOnly={readOnly} min={-180} max={180} step="any"
          error={errors.longitude} onChange={event => setForm(previous => ({ ...previous, longitude: event.target.value }))} />
      </div>
    </SettingsSection>
  </>;
}
