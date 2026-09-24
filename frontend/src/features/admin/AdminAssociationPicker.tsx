/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ListToolbar from "../../components/ListToolbar";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { ListActionButton } from "../../components/list/ListControls";
import { useId, type ReactNode } from "react";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";

import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTableContainerClass } from "../../components/ui/styles";
import "./adminAssociations.css";

const adminAssociationAddPanelClass = cx(uiCardMutedClass, "space-y-2 px-3 py-2");
export const adminAssociationPanelClass = "mt-3 min-w-0 space-y-3";
export const adminAssociationTableContainerClass = uiTableContainerClass;

const adminAssociationOptionLabelClass = "flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200";
const adminAssociationAccountOptionLabelClass =
  "flex min-w-48 items-center gap-2 ui-body text-slate-700 dark:text-slate-200";
export const adminAssociationOptionRowClass = (selected: boolean) =>
  `flex items-center justify-between rounded-md px-2 py-1 ${
    selected ? "bg-[var(--ui-selected-bg)]" : "hover:bg-[var(--ui-hover)]"
  }`;

export const adminAssociationAccountOptionRowClass = (selected: boolean) =>
  `flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 ${
    selected ? "bg-[var(--ui-selected-bg)]" : "hover:bg-[var(--ui-hover)]"
  }`;

type AdminAssociationOptionCheckboxProps = Omit<
  React.ComponentProps<typeof UiCheckboxField>,
  "checkboxClassName"
> & {
  account?: boolean;
};

export function AdminAssociationOptionCheckbox({
  account = false,
  className,
  ...props
}: AdminAssociationOptionCheckboxProps) {
  return (
    <UiCheckboxField
      {...props}
      className={cx(
        account ? adminAssociationAccountOptionLabelClass : adminAssociationOptionLabelClass,
        className,
      )}
    />
  );
}

type AdminAssociationSectionHeaderProps = {
  title: string;
  countLabel: ReactNode;
  actionLabel: ReactNode;
  onAction: () => void;
};

export function AdminAssociationSectionHeader({
  title,
  countLabel,
  actionLabel,
  onAction,
}: AdminAssociationSectionHeaderProps) {
  return (
    <ListToolbar variant="page" title={title} countLabel={countLabel}
      className="admin-association-toolbar"
      actions={<ListActionButton onClick={onAction}>{actionLabel}</ListActionButton>} />
  );
}

type AdminAssociationTab<T extends string> = {
  id: T;
  label: string;
  count: number;
  actionLabel: string;
  onAction: () => void;
  hint?: string;
  content: ReactNode;
};

/** Association counts and actions belong to their subtab, above its unframed table. */
export function AdminAssociationTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: AdminAssociationTab<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
}) {
  const idPrefix = `admin-associations-${useId().replaceAll(":", "")}`;
  const active = tabs.find((tab) => tab.id === activeTab);
  return (
    <div className="admin-association-tabs min-w-0 space-y-3">
      <PageTabs
        variant="bar"
        ariaLabel="Association types"
        idPrefix={idPrefix}
        tabs={tabs.map(({ id, label, count }) => ({ id, label: `${label} (${count})` }))}
        activeTab={activeTab}
        onChange={(id) => onChange(id as T)}
        headerActions={active ? <>
          {active.hint ? <span className={cx("ui-caption", uiMutedTextClass)}>{active.hint}</span> : null}
          <ListActionButton onClick={active.onAction}>{active.actionLabel}</ListActionButton>
        </> : undefined}
      />
      <PageTabPanel idPrefix={idPrefix} tabId={activeTab} className="min-w-0">
        {active?.content}
      </PageTabPanel>
    </div>
  );
}

type AdminAssociationLinkedTableProps = {
  title: string;
  toolbar?: Omit<AdminAssociationSectionHeaderProps, "title">;
  headers: Array<{ label: ReactNode; align?: "left" | "right" }>;
  hasItems: boolean;
  emptyLabel: ReactNode;
  rows: ReactNode;
  picker?: ReactNode;
};

export function AdminAssociationLinkedTable({
  title,
  toolbar,
  headers,
  hasItems,
  emptyLabel,
  rows,
  picker,
}: AdminAssociationLinkedTableProps) {
  return (
    <div className="space-y-3">
      {toolbar ? <AdminAssociationSectionHeader title={title} {...toolbar} /> : null}
      <div className={adminAssociationTableContainerClass}>
        <table className="ui-data-table" aria-label={title}>
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th
                  key={index}
                  className={
                    header.align === "right"
                      ? "w-px whitespace-nowrap text-right"
                      : "text-left"
                  }
                >
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasItems ? (
              rows
            ) : (
              <tr>
                <td colSpan={headers.length} className="ui-table-secondary">
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {picker}
    </div>
  );
}

type AdminAssociationCheckboxOptionsProps<T extends { id: number }> = {
  options: readonly T[];
  selectedIds: readonly number[];
  onToggle: (id: number) => void;
  getLabel: (option: T) => ReactNode;
};

export function AdminAssociationCheckboxOptions<T extends { id: number }>({
  options,
  selectedIds,
  onToggle,
  getLabel,
}: AdminAssociationCheckboxOptionsProps<T>) {
  return (
    <>
      {options.map((option) => {
        const isSelected = selectedIds.includes(option.id);
        return (
          <div key={option.id} className={adminAssociationOptionRowClass(isSelected)}>
            <AdminAssociationOptionCheckbox
              checked={isSelected}
              onChange={() => onToggle(option.id)}
            >
              <span>{getLabel(option)}</span>
            </AdminAssociationOptionCheckbox>
          </div>
        );
      })}
    </>
  );
}

type AdminAssociationPickerPanelProps = {
  title: ReactNode;
  hint?: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  availableCount: number;
  maxVisibleOptions: number;
  selectedCount: number;
  onCancel: () => void;
  onAdd: () => void;
  addDisabled: boolean;
  loadingLabel: ReactNode;
  searchAriaLabel?: string;
  emptyLabel?: ReactNode;
  addLabel?: ReactNode;
  children: ReactNode;
};

export function AdminAssociationPickerPanel({
  title,
  hint,
  search,
  onSearchChange,
  loading,
  availableCount,
  maxVisibleOptions,
  selectedCount,
  onCancel,
  onAdd,
  addDisabled,
  loadingLabel,
  searchAriaLabel,
  emptyLabel = "No results.",
  addLabel = "Add selected",
  children,
}: AdminAssociationPickerPanelProps) {
  return (
    <div className={adminAssociationAddPanelClass}>
      <ListToolbar variant="section" title={title} description={hint}
        search={<ToolbarSearchInput label={searchAriaLabel ?? "Search"} value={search} onChange={onSearchChange} placeholder="Search..." />}
      />
      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {loading ? <p className={cx("ui-caption", uiMutedTextClass)}>{loadingLabel}</p> : null}
        {!loading && availableCount === 0 ? <p className={cx("ui-caption", uiMutedTextClass)}>{emptyLabel}</p> : null}
        {children}
        {availableCount > maxVisibleOptions ? (
          <p className={cx("ui-caption", uiMutedTextClass)}>
            Showing first {maxVisibleOptions} matches. Use the search box to narrow down the list.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx("ui-caption", uiMutedTextClass)}>{selectedCount} selected</span>
        <div className="flex items-center gap-2">
          <UiButton variant="secondary" size="xs" onClick={onCancel}>
            Cancel
          </UiButton>
          <UiButton size="xs" disabled={addDisabled} onClick={onAdd}>
            {addLabel}
          </UiButton>
        </div>
      </div>
    </div>
  );
}
