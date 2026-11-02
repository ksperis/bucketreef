/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import IamCursorPaginationControls from "./IamCursorPaginationControls";
import { useManagerI18n } from "./managerI18n";

export type ManagerIamAssociationPickerItem = {
  id: string;
  label: string;
  secondary?: string;
};

export type ManagerIamAssociationFailure = {
  id: string;
  label: string;
  message: string;
};

type ManagerIamAssociationPickerProps = {
  title: string;
  searchLabel: string;
  searchPlaceholder: string;
  emptyMessage: string;
  items: ManagerIamAssociationPickerItem[];
  selectedIds: string[];
  search: string;
  loading: boolean;
  error?: string | null;
  failures?: ManagerIamAssociationFailure[];
  page: number;
  pageSize: number;
  canPrevious: boolean;
  canNext: boolean;
  submitting: boolean;
  submitLabel: string;
  onSearchChange: (value: string) => void;
  onToggle: (item: ManagerIamAssociationPickerItem, checked: boolean) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export default function ManagerIamAssociationPicker({
  title,
  searchLabel,
  searchPlaceholder,
  emptyMessage,
  items,
  selectedIds,
  search,
  loading,
  error,
  failures = [],
  page,
  pageSize,
  canPrevious,
  canNext,
  submitting,
  submitLabel,
  onSearchChange,
  onToggle,
  onPreviousPage,
  onNextPage,
  onCancel,
  onSubmit,
}: ManagerIamAssociationPickerProps) {
  const { text } = useManagerI18n();

  return (
    <div className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-700" role="region" aria-label={title}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="ui-body font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        <span className={cx("ui-caption", uiMutedTextClass)}>
          {selectedIds.length} {text("selected")}
        </span>
      </div>

      <UiInput
        label={searchLabel}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={searchPlaceholder}
        disabled={submitting}
      />

      {error ? <p className="ui-caption text-red-600 dark:text-red-300" role="alert">{error}</p> : null}

      <div className="max-h-64 min-h-10 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
        {loading ? (
          <p className={cx("ui-caption px-3 py-2", uiMutedTextClass)}>{text("Loading...")}</p>
        ) : items.length === 0 ? (
          <p className={cx("ui-caption px-3 py-2", uiMutedTextClass)}>{emptyMessage}</p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {items.map((item) => (
              <UiCheckboxField
                key={item.id}
                checked={selectedIds.includes(item.id)}
                onChange={(event) => onToggle(item, event.target.checked)}
                disabled={submitting}
                className="w-full min-w-0 px-3 py-2 ui-body text-slate-700 dark:text-slate-200"
                labelProps={{ title: item.secondary }}
              >
                <span className="min-w-0">
                  <span className="block break-words font-medium [overflow-wrap:anywhere]">{item.label}</span>
                  {item.secondary ? (
                    <span className={cx("mt-0.5 block break-all font-mono text-[11px]", uiMutedTextClass)}>
                      {item.secondary}
                    </span>
                  ) : null}
                </span>
              </UiCheckboxField>
            ))}
          </div>
        )}
      </div>

      <IamCursorPaginationControls
        page={page}
        pageSize={pageSize}
        canPrevious={canPrevious}
        canNext={canNext}
        disabled={loading || submitting}
        onPrevious={onPreviousPage}
        onNext={onNextPage}
        showPageSize={false}
      />

      {failures.length > 0 ? (
        <div className="space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200" role="alert">
          <p className="ui-caption font-semibold">{text("Some associations could not be updated.")}</p>
          <ul className="space-y-0.5 ui-caption">
            {failures.map((failure) => (
              <li key={failure.id}>
                <span className="font-medium">{failure.label}</span>: {failure.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <UiButton type="button" size="xs" variant="secondary" onClick={onCancel} disabled={submitting}>
          {text("Cancel")}
        </UiButton>
        <UiButton type="button" size="xs" onClick={onSubmit} disabled={selectedIds.length === 0 || submitting} loading={submitting}>
          {submitLabel}
        </UiButton>
      </div>
    </div>
  );
}
