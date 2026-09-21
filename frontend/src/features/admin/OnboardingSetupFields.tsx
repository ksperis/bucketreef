/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useState } from "react";
import type { OnboardingDraft, OnboardingStatus } from "../../api/onboarding";
import { WorkflowSection } from "../../components/WorkflowPage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { onboardingCopy as copy } from "./onboardingCopy";

export default function OnboardingSetupFields({ draft, status, needsCredentials, onChange, accessKey, secretKey, onCredentials }: {
  draft: OnboardingDraft;
  status: OnboardingStatus;
  needsCredentials: boolean;
  onChange: (patch: Partial<OnboardingDraft>) => void;
  accessKey: string;
  secretKey: string;
  onCredentials: (access: string, secret: string) => void;
}) {
  const { t } = useI18n();
  const [creatingSpace, setCreatingSpace] = useState(Boolean(draft.space_name));
  const connection = draft.resource_kind === "connection";
  const account = draft.resource_kind === "account";
  const existingResource = connection ? draft.connection_id : account ? draft.account_id : null;
  const self = !draft.beneficiary_user_id || draft.beneficiary_user_id === status.actor_id;
  const endpoints = (status.endpoints ?? []).filter((endpoint) => connection || endpoint.provider === "ceph");
  const spaces = (status.spaces ?? []).filter((space) => space.account_id === draft.account_id);
  const connections = (status.connections ?? []).filter((item) => draft.workspace !== "browser" || !item.is_shared);
  const resourceOptions = connection ? connections : status.accounts ?? [];
  const numberOrNull = (value: string) => value ? Number(value) : null;

  return <>
    <WorkflowSection title={t(copy.resource)} description={t(draft.workspace === "manager" ? copy.managerPrerequisites : draft.workspace === "portal" ? copy.portalPrerequisites : draft.workspace === "ceph-admin" ? copy.cephPrerequisites : copy.browserPrerequisites)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <UiInput label={t(copy.name)} hint={t(copy.nameHelp)} value={draft.name} required maxLength={120} onChange={(event) => onChange({ name: event.target.value })} />
        {draft.workspace === "manager" && <UiSelect label={t(copy.resource)} hint={t(copy.managerAccessHelp)} value={draft.resource_kind} onChange={(event) => onChange({ resource_kind: event.target.value as "connection" | "account", connection_id: null, account_id: null, endpoint_id: null, beneficiary_user_id: null })}>
          <option value="connection">{t(copy.connection)}</option><option value="account">{t(copy.account)}</option>
        </UiSelect>}
        {(connection || account) && (resourceOptions.length > 0 || existingResource) && <UiSelect label={t(connection ? copy.connection : copy.account)} value={existingResource ?? ""} onChange={(event) => {
          const id = numberOrNull(event.target.value);
          const option = (connection ? status.connections : status.accounts)?.find((item) => item.id === id);
          onChange({ [connection ? "connection_id" : "account_id"]: id, endpoint_id: option?.endpoint_id ?? null, space_id: "", space_name: "" });
        }}>
          <option value="">{t(copy.createNew)}</option>
          {resourceOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </UiSelect>}
        {!existingResource && (endpoints.length > 0 || draft.endpoint_id) && <UiSelect label={t(copy.endpoint)} value={draft.endpoint_id ?? ""} onChange={(event) => onChange({ endpoint_id: numberOrNull(event.target.value), endpoint_url: "" })}>
          <option value="">{t(copy.newEndpoint)}</option>
          {endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}
        </UiSelect>}
        {!existingResource && !draft.endpoint_id && <UiInput label={t(copy.endpointUrl)} type="url" required value={draft.endpoint_url} placeholder="https://s3.example.com" maxLength={2048} onChange={(event) => onChange({ endpoint_url: event.target.value })} />}
        {!connection && <UiSelect label={t(copy.beneficiary)} value={draft.beneficiary_user_id ?? ""} onChange={(event) => onChange({ beneficiary_user_id: numberOrNull(event.target.value), space_id: "", space_name: "" })}>
          <option value="">{t(copy.myself)}</option>
          {status.users?.filter((user) => user.id !== status.actor_id).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </UiSelect>}
      </div>
      {!existingResource && !draft.endpoint_id && <details>
        <summary className="cursor-pointer ui-body">{t(copy.options)}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <UiInput label={t(copy.region)} value={draft.region} maxLength={100} onChange={(event) => onChange({ region: event.target.value })} />
          <UiSelect label={t(copy.pathAddress)} value={draft.force_path_style ? "path" : "host"} onChange={(event) => onChange({ force_path_style: event.target.value === "path" })}>
            <option value="path">{t(copy.path)}</option><option value="host">{t(copy.virtualHost)}</option>
          </UiSelect>
        </div>
      </details>}
      {needsCredentials && <div className="space-y-3">
        <p className={uiMutedTextClass}>{t(connection ? copy.privateKeys : draft.workspace === "ceph-admin" ? copy.cephKeys : copy.accountKeys)}</p>
        <p className={uiMutedTextClass}>{t(copy.keysNotSaved)}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <UiInput label={t(copy.accessKey)} type="password" autoComplete="off" required value={accessKey} onChange={(event) => onCredentials(event.target.value, secretKey)} />
          <UiInput label={t(copy.secretKey)} type="password" autoComplete="new-password" required value={secretKey} onChange={(event) => onCredentials(accessKey, event.target.value)} />
        </div>
      </div>}
    </WorkflowSection>
    {(draft.workspace === "browser" || draft.workspace === "manager") && <WorkflowSection title={t(copy.scope)} description={t(copy.scopedHelp)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <UiInput label={t(copy.bucket)} value={draft.bucket} maxLength={255} onChange={(event) => onChange({ bucket: event.target.value })} />
        {draft.workspace === "browser" && <UiInput label={t(copy.prefix)} hint={t(copy.prefixHelp)} value={draft.prefix} maxLength={1024} onChange={(event) => onChange({ prefix: event.target.value })} />}
      </div>
    </WorkflowSection>}
    {draft.workspace === "portal" && <WorkflowSection title={t(copy.space)}>
      {self ? <div className="grid gap-3 sm:grid-cols-2">
        <UiSelect label={t(copy.space)} value={draft.space_id ? `existing:${draft.space_id}` : creatingSpace ? "new" : "later"} onChange={(event) => {
          const value = event.target.value;
          setCreatingSpace(value === "new");
          onChange({ space_id: value.startsWith("existing:") ? value.slice(9) : "", space_name: value === "new" ? t(copy.defaultSpace) : "" });
        }}>
          <option value="later">{t(copy.noSpace)}</option><option value="new">{t(copy.createNew)}</option>
          {spaces.map((space) => <option key={space.id} value={`existing:${space.id}`}>{space.name}</option>)}
          {draft.space_id && !spaces.some((space) => space.id === draft.space_id) && <option value={`existing:${draft.space_id}`}>{draft.space_id}</option>}
        </UiSelect>
        {creatingSpace && !draft.space_id && <>
          <UiInput label={t(copy.spaceName)} value={draft.space_name} required maxLength={120} onChange={(event) => onChange({ space_name: event.target.value })} />
          <UiSelect label={t(copy.spaceVisibility)} value={draft.space_visibility} onChange={(event) => onChange({ space_visibility: event.target.value as "private" | "shared" })}>
            <option value="private">{t(copy.privateSpace)}</option><option value="shared">{t(copy.teamSpace)}</option>
          </UiSelect>
        </>}
      </div> : <p className={uiMutedTextClass}>{t(copy.laterSpace)}</p>}
    </WorkflowSection>}
  </>;
}
