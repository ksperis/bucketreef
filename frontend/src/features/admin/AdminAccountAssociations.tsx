/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useId, useState } from "react";
import type { AccountUserLink, AccountGroupLink } from "../../api/accounts";
import { defaultAccountAccessGrant, hasAccountAccessRole, type AccountAccessGrant } from "../../api/accountAccess";
import { listUserOptions } from "../../api/users";
import { listGroupOptions } from "../../api/groups";
import { SettingsButton } from "../../components/settings/SettingsControls";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { ListActionButton, ListActions } from "../../components/list/ListControls";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { AdminAssociationAccessPickerTable, AdminAssociationSectionHeader, AdminAssociationPickerPanel, adminAssociationTableContainerClass } from "./AdminAssociationPicker";
import { AccountAccessRoleValidationMessage, ManagerAccountRoleSelect, PortalAccountRoleSelect } from "./AccountAccessRoleSelectors";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import { useAdminI18n } from "./adminI18n";
import usePaginatedOptions, { type PaginatedOptionsQuery } from "../../hooks/usePaginatedOptions";
import type { PaginatedResponse } from "../../api/types";

type Principal = { id: number; label: string };
type Adapter<T extends AccountAccessGrant> = {
  kind: "users" | "groups";
  singular: "User" | "Group";
  load: (query: PaginatedOptionsQuery) => Promise<PaginatedResponse<Principal>>;
  id: (link: T) => number;
  label: (link: T) => string | null | undefined;
  create: (principal: Principal, access: AccountAccessGrant) => T;
};

export const accountUserAssociations: Adapter<AccountUserLink> = {
  kind: "users", singular: "User",
  load: async (query) => {
    const response = await listUserOptions(query);
    return { ...response, items: response.items.map(user => ({ id: user.id, label: user.email })) };
  },
  id: link => link.user_id, label: link => link.user_email,
  create: (principal, access) => ({
    user_id: principal.id,
    user_email: principal.label,
    user_full_name: null,
    user_avatar: null,
    ...access,
    allow_manager_browser_data_access: false,
  }),
};
export const accountGroupAssociations: Adapter<AccountGroupLink> = {
  kind: "groups", singular: "Group",
  load: async (query) => {
    const response = await listGroupOptions(query);
    return { ...response, items: response.items.map(group => ({ id: group.id, label: group.name })) };
  },
  id: link => link.group_id, label: link => link.group_name,
  create: (principal, access) => ({
    group_id: principal.id,
    group_name: principal.label,
    group_avatar: null,
    ...access,
    allow_manager_browser_data_access: false,
  }),
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
  const { text: adminText } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [selectedPrincipals, setSelectedPrincipals] = useState<Record<number, Principal>>({});
  const [choices, setChoices] = useState<Record<number, AccountAccessGrant>>({});
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const prefix = useId();
  const catalogue = usePaginatedOptions(adapter.load, { enabled: open });
  useEffect(() => {
    onPendingChange(selected.length > 0 || advancedDirty);
    return () => onPendingChange(false);
  }, [selected.length, advancedDirty, onPendingChange]);
  const access = (id: number) => choices[id] ?? defaultAccountAccessGrant(portalEnabled);
  const linkedIds = new Set(links.map(adapter.id));
  const available = catalogue.items.filter(principal => !linkedIds.has(principal.id));
  const cancel = () => { setOpen(false); setSelected([]); setSelectedPrincipals({}); setChoices({}); catalogue.setSearch(""); };
  const add = () => {
    if (disabled || catalogue.loading || catalogue.error || selected.some(id => !hasAccountAccessRole(access(id)))) return;
    const added = selected.map(id => selectedPrincipals[id]).filter((principal): principal is Principal => Boolean(principal) && !linkedIds.has(principal.id));
    onChange([...links, ...added.map(principal => adapter.create(principal, access(principal.id)))]);
    cancel();
  };
  const label = (link: T) => adapter.label(link) ?? selectedPrincipals[adapter.id(link)]?.label ?? `${adapter.singular} #${adapter.id(link)}`;
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
        allowManagerBrowserDataAccess={link.allow_manager_browser_data_access} disabled={disabled} onDirtyChange={setAdvancedDirty}
        onApply={allowed => changeAccess(link, { ...link, allow_manager_browser_data_access: allowed })} />}
      <ListActionButton variant="danger" onClick={() => onChange(links.filter(item => adapter.id(item) !== adapter.id(link)))}>{adminText("Remove")}</ListActionButton>
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
      {catalogue.error && <UiInlineMessage tone="error" role="alert">{catalogue.error} <SettingsButton variant="secondary" onClick={catalogue.refresh}>{adminText("Retry")}</SettingsButton></UiInlineMessage>}
      <AdminAssociationPickerPanel title={`Add UI ${adapter.kind}`} search={catalogue.search} onSearchChange={catalogue.setSearch}
        searchAriaLabel={`Search UI ${adapter.kind}`} loading={catalogue.loading || Boolean(catalogue.error)}
        loadingLabel={catalogue.error ? "The catalogue is unavailable." : `Loading UI ${adapter.kind}...`}
        availableCount={available.length} maxVisibleOptions={catalogue.pageSize} selectedCount={selected.length}
        pagination={{ page: catalogue.page, pageSize: catalogue.pageSize, total: catalogue.total, onPageChange: catalogue.setPage, onPageSizeChange: catalogue.setPageSize }}
        onCancel={cancel} onAdd={add} addDisabled={disabled || catalogue.loading || Boolean(catalogue.error) || selected.length === 0 || selected.some(id => !hasAccountAccessRole(access(id)))}>
        {!catalogue.loading && !catalogue.error ? (
          <AdminAssociationAccessPickerTable
            title={"Available UI " + adapter.kind}
            principalLabel={adapter.singular}
            options={available.map((principal) => ({
              id: principal.id,
              label: principal.label,
              selected: selected.includes(principal.id),
              access: access(principal.id),
            }))}
            portalEnabled={portalEnabled}
            onToggle={(id) => {
              const principal = available.find((item) => item.id === id);
              const wasSelected = selected.includes(id);
              setSelected((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]);
              setSelectedPrincipals((current) => {
                const next = { ...current };
                if (wasSelected) delete next[id]; else if (principal) next[id] = principal;
                return next;
              });
            }}
            onAccessChange={(id, grant) =>
              setChoices((current) => ({ ...current, [id]: grant }))
            }
          />
        ) : null}
      </AdminAssociationPickerPanel>
    </> : undefined}
  </fieldset>;
}
