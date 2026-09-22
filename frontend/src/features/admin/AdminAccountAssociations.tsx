/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useId, useState } from "react";
import type { AccountUserLink, AccountGroupLink } from "../../api/accounts";
import { defaultAccountAccessGrant, hasAccountAccessRole, type AccountAccessGrant } from "../../api/accountAccess";
import { listMinimalUsers } from "../../api/users";
import { listMinimalGroups } from "../../api/groups";
import { useSettingsRemoteDraft } from "../../components/settings/useSettingsRemoteDraft";
import { SettingsButton } from "../../components/settings/SettingsControls";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { ListActionButton, ListActions } from "../../components/list/ListControls";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { AdminAssociationSectionHeader, AdminAssociationPickerPanel, adminAssociationAccountOptionRowClass, adminAssociationTableContainerClass } from "./AdminAssociationPicker";
import AccountAccessRoleSelectors, { AccountAccessRoleValidationMessage, ManagerAccountRoleSelect, PortalAccountRoleSelect } from "./AccountAccessRoleSelectors";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";

type Principal = { id: number; label: string };
type Adapter<T extends AccountAccessGrant> = {
  kind: "users" | "groups";
  singular: "User" | "Group";
  load: () => Promise<Principal[]>;
  id: (link: T) => number;
  label: (link: T) => string | null | undefined;
  create: (principal: Principal, access: AccountAccessGrant) => T;
};

export const accountUserAssociations: Adapter<AccountUserLink> = {
  kind: "users", singular: "User",
  load: async () => (await listMinimalUsers()).map(user => ({ id: user.id, label: user.email })),
  id: link => link.user_id, label: link => link.user_email,
  create: (principal, access) => ({ user_id: principal.id, user_email: principal.label, ...access, allow_manager_browser_data_access: false }),
};
export const accountGroupAssociations: Adapter<AccountGroupLink> = {
  kind: "groups", singular: "Group",
  load: async () => (await listMinimalGroups()).map(group => ({ id: group.id, label: group.name })),
  id: link => link.group_id, label: link => link.group_name,
  create: (principal, access) => ({ group_id: principal.id, group_name: principal.label, ...access, allow_manager_browser_data_access: false }),
};

/** The two association types share presentation, selection and load-error recovery. */
export default function AdminAccountAssociations<T extends AccountAccessGrant>({ adapter, links, onChange, portalEnabled, disabled, onPendingChange }: {
  adapter: Adapter<T>;
  links: T[];
  onChange: (links: T[]) => void;
  portalEnabled: boolean;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const catalogue = useSettingsRemoteDraft<Principal[]>(() => [], adapter.load, `Unable to load UI ${adapter.kind}.`);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [choices, setChoices] = useState<Record<number, AccountAccessGrant>>({});
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const prefix = useId();
  useEffect(() => {
    onPendingChange(selected.length > 0 || advancedDirty);
    return () => onPendingChange(false);
  }, [selected.length, advancedDirty, onPendingChange]);
  const access = (id: number) => choices[id] ?? defaultAccountAccessGrant(portalEnabled);
  const linkedIds = new Set(links.map(adapter.id));
  const available = catalogue.draft.filter(principal => !linkedIds.has(principal.id)
    && principal.label.toLowerCase().includes(search.trim().toLowerCase()));
  const cancel = () => { setOpen(false); setSelected([]); setChoices({}); setSearch(""); };
  const add = () => {
    if (disabled || catalogue.loading || catalogue.loadError || selected.some(id => !hasAccountAccessRole(access(id)))) return;
    const added = catalogue.draft.filter(principal => selected.includes(principal.id) && !linkedIds.has(principal.id));
    onChange([...links, ...added.map(principal => adapter.create(principal, access(principal.id)))]);
    cancel();
  };
  const label = (link: T) => adapter.label(link) ?? catalogue.draft.find(principal => principal.id === adapter.id(link))?.label ?? `${adapter.singular} #${adapter.id(link)}`;
  const errorId = (link: T) => `${prefix}-${adapter.id(link)}-error`;
  const changeAccess = (link: T, grant: AccountAccessGrant) => onChange(links.map(item => adapter.id(item) === adapter.id(link) ? { ...item, ...grant } : item));
  const columns: DataTableColumn<T>[] = [
    { id: "principal", label: adapter.singular, primary: true, cellClassName: "min-w-[220px] max-w-[320px]",
      render: link => <><span className="break-words">{label(link)}</span>
        <AccountAccessRoleValidationMessage id={errorId(link)} value={link} portalEnabled={portalEnabled} /></> },
    { id: "manager", label: "Manager role", render: link => <ManagerAccountRoleSelect label={label(link)} value={link}
      onChange={grant => changeAccess(link, grant)} portalEnabled={portalEnabled} fieldClassName="w-full md:w-52"
      showLabel={false} invalid={!hasAccountAccessRole(link)} describedBy={!hasAccountAccessRole(link) ? errorId(link) : undefined} /> },
    ...(portalEnabled ? [{ id: "portal", label: "Portal role", render: (link: T) => <PortalAccountRoleSelect label={label(link)} value={link}
      onChange={grant => changeAccess(link, grant)} portalEnabled={portalEnabled} fieldClassName="w-full md:w-44"
      showLabel={false} invalid={!hasAccountAccessRole(link)} describedBy={!hasAccountAccessRole(link) ? errorId(link) : undefined} /> }] : []),
    { id: "actions", label: "Actions", mobileRole: "actions", align: "right", render: link => <ListActions>
      {link.manager_role && <AdminAssociationAdvancedSettings targetLabel={label(link)} associationKind="account"
        allowManagerBrowserDataAccess={Boolean(link.allow_manager_browser_data_access)} disabled={disabled} onDirtyChange={setAdvancedDirty}
        onApply={allowed => changeAccess(link, { ...link, allow_manager_browser_data_access: allowed })} />}
      <ListActionButton variant="danger" onClick={() => onChange(links.filter(item => adapter.id(item) !== adapter.id(link)))}>Remove</ListActionButton>
    </ListActions> },
  ];
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0">
    <legend className="sr-only">{`Linked UI ${adapter.kind} controls`}</legend>
    <AdminAssociationSectionHeader title={`Linked UI ${adapter.kind}`} countLabel={`${links.length} linked`}
      actionLabel={open ? "Close" : `Add UI ${adapter.kind}`}
      onAction={() => { if (!disabled) { if (open) cancel(); else setOpen(true); } }} />
    <DataTableShell columns={columns} rows={links} rowKey={adapter.id} responsiveCards
      containerClassName={adminAssociationTableContainerClass} status={links.length ? "ready" : "empty"}
      loadingMessage="Loading associations..." errorMessage="Unable to load associations." emptyMessage={`No linked ${adapter.kind} yet.`} />
    {open ? <>
      {catalogue.loadError && <UiInlineMessage tone="error" role="alert">{catalogue.loadError} <SettingsButton variant="secondary" onClick={catalogue.retry}>Retry</SettingsButton></UiInlineMessage>}
      <AdminAssociationPickerPanel title={`Add UI ${adapter.kind}`} search={search} onSearchChange={setSearch}
        searchAriaLabel={`Search UI ${adapter.kind}`} loading={catalogue.loading || Boolean(catalogue.loadError)}
        loadingLabel={catalogue.loadError ? "The catalogue is unavailable." : `Loading UI ${adapter.kind}...`}
        availableCount={available.length} maxVisibleOptions={10} selectedCount={selected.length}
        onCancel={cancel} onAdd={add} addDisabled={disabled || catalogue.loading || Boolean(catalogue.loadError) || selected.length === 0 || selected.some(id => !hasAccountAccessRole(access(id)))}>
        {!catalogue.loading && !catalogue.loadError && available.slice(0, 10).map(principal => <div key={principal.id} className={adminAssociationAccountOptionRowClass(selected.includes(principal.id))}>
          <UiCheckboxField checked={selected.includes(principal.id)} onChange={() => setSelected(current => current.includes(principal.id) ? current.filter(id => id !== principal.id) : [...current, principal.id])}>{principal.label}</UiCheckboxField>
          <AccountAccessRoleSelectors label={principal.label} value={access(principal.id)} portalEnabled={portalEnabled}
            onChange={grant => setChoices(current => ({ ...current, [principal.id]: grant }))} />
        </div>)}
      </AdminAssociationPickerPanel>
    </> : undefined}
  </fieldset>;
}
