/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps } from "react";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiTagEditor from "../../components/UiTagEditor";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import type { UiTagDefinition } from "../../utils/uiTags";
import { useI18n } from "../../i18n";
import { rgwUserNameErrorText } from "../../utils/rgwUserNameMessages";
import { rgwUserUidFormatError, rgwTenantFormatError } from "../../utils/resourceNames";
import { rgwAccountNameFormatError } from "../../utils/rgwAccountName";
import AdminRgwEndpointField from "./AdminRgwEndpointField";
import AdminQuotaFields from "./AdminQuotaFields";
import { useAdminI18n } from "./adminI18n";

type Draft = {
  name: string; uid?: string; rgw_tenant?: string; email: string; storage_endpoint_id: string;
  quota_max_size_gb: string; quota_max_size_unit: string; quota_max_objects: string;
  tags: UiTagDefinition[];
};

export default function AdminRgwCreateFields({kind, value, onChange, errors, busy, endpoint, tags}: {
  kind: "account" | "user"; value: Draft; onChange: (patch: Partial<Draft>) => void;
  errors: Record<string, string | undefined>; busy: boolean;
  endpoint: Omit<ComponentProps<typeof AdminRgwEndpointField>, "value" | "onChange" | "error">;
  tags: { catalog: ComponentProps<typeof UiTagEditor>["catalog"]; loading: boolean; error: string | null };
}) {
  const { text: adminText } = useAdminI18n();
  const { locale } = useI18n();
  const liveNameError = kind === "account" ? rgwAccountNameFormatError(value.name) : undefined;
  return <>
    <SettingsSection presentation="compact" title={kind === "account" ? "Account details" : "User details"}>
      <div className="settings-fields">
        <div className="grid gap-3 md:grid-cols-2">
          <UiInput label={kind === "account" ? "Account name *" : "Display name *"} name="name" value={value.name}
            error={errors.name ?? liveNameError} required onChange={event => onChange({name: event.target.value})} />
          {kind === "user" && <UiInput label={adminText("UID (optional)")} name="uid" value={value.uid ?? ""} placeholder="user-123" error={rgwUserNameErrorText(errors.uid ?? rgwUserUidFormatError((value.uid ?? "").trim(), value.rgw_tenant?.trim()), locale)}
            onChange={event => onChange({uid: event.target.value})} />}
          {kind === "user" && <UiInput label={adminText("Ceph tenant (optional)")} name="rgw_tenant" value={value.rgw_tenant ?? ""}
            placeholder="customer01" error={errors.rgw_tenant ?? rgwTenantFormatError(value.rgw_tenant ?? "")}
            onChange={event => onChange({rgw_tenant: event.target.value})} />}
          <UiInput label={kind === "account" ? "Email contact" : "Email"} name="email" type="email" value={value.email}
            error={errors.email} placeholder="contact@example.com" onChange={event => onChange({email: event.target.value})} />
        </div>
        <AdminRgwEndpointField {...endpoint} value={value.storage_endpoint_id} error={errors.storage_endpoint_id}
          onChange={storage_endpoint_id => onChange({storage_endpoint_id})} />
        {tags.error && <UiInlineMessage tone="warning">{tags.error}</UiInlineMessage>}
        <UiTagEditor label={adminText("Tags")} tags={value.tags} catalog={tags.catalog} disabled={busy}
          onChange={next => onChange({tags: next})} placeholder={kind === "account" ? "Add a tag for this account" : "Add a tag for this RGW user"}
          hint={tags.loading ? "Loading existing tag catalog..." : undefined} />
      </div>
    </SettingsSection>
    <AdminQuotaFields compact errors={errors} storageValue={value.quota_max_size_gb} storageUnit={value.quota_max_size_unit}
      objectValue={value.quota_max_objects} disabled={busy}
      onStorageValueChange={quota_max_size_gb => onChange({quota_max_size_gb})}
      onStorageUnitChange={quota_max_size_unit => onChange({quota_max_size_unit})}
      onObjectValueChange={quota_max_objects => onChange({quota_max_objects})} />
  </>;
}
