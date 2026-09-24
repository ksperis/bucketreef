import { ListActionButton } from "../../components/list/ListControls";
import type { RefObject } from "react";

import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiIconButton from "../../components/ui/UiIconButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiMenuClass,
} from "../../components/ui/styles";

import { ChevronDownIcon, SearchIcon, SlidersIcon } from "./browserIcons";

const optionCardClasses =
  "inline-flex items-center gap-2 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-1.5 ui-caption font-medium text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]";
const menuClasses = cx(uiMenuClass, "overflow-hidden p-1.5");

type BrowserSearchScope = "prefix" | "bucket";
type BrowserObjectTypeFilter = "all" | "file" | "folder";

type BrowserObjectSearchHeaderProps = {
  rootRef: RefObject<HTMLDivElement>;
  optionsButtonRef: RefObject<HTMLButtonElement>;
  optionsMenuRef: RefObject<HTMLDivElement>;
  advancedOptionsEnabled: boolean;
  optionsOpen: boolean;
  filter: string;
  objectNounPlural: string;
  nameSortActive: boolean;
  sortDirection: "asc" | "desc";
  advancedOptionsActive: boolean;
  hasSearchQuery: boolean;
  searchScope: BrowserSearchScope;
  recursive: boolean;
  exactMatch: boolean;
  caseSensitive: boolean;
  typeFilter: BrowserObjectTypeFilter;
  storageFilter: string;
  storageClasses: readonly string[];
  canReset: boolean;
  onSortName: () => void;
  onFilterChange: (value: string) => void;
  onToggleOptions: () => void;
  onScopeChange: (scope: BrowserSearchScope) => void;
  onRecursiveChange: (enabled: boolean) => void;
  onExactMatchChange: (enabled: boolean) => void;
  onCaseSensitiveChange: (enabled: boolean) => void;
  onTypeFilterChange: (filter: BrowserObjectTypeFilter) => void;
  onStorageFilterChange: (filter: string) => void;
  onClear: () => void;
  onClose: () => void;
};

export default function BrowserObjectSearchHeader({
  rootRef,
  optionsButtonRef,
  optionsMenuRef,
  advancedOptionsEnabled,
  optionsOpen,
  filter,
  objectNounPlural,
  nameSortActive,
  sortDirection,
  advancedOptionsActive,
  hasSearchQuery,
  searchScope,
  recursive,
  exactMatch,
  caseSensitive,
  typeFilter,
  storageFilter,
  storageClasses,
  canReset,
  onSortName,
  onFilterChange,
  onToggleOptions,
  onScopeChange,
  onRecursiveChange,
  onExactMatchChange,
  onCaseSensitiveChange,
  onTypeFilterChange,
  onStorageFilterChange,
  onClear,
  onClose,
}: BrowserObjectSearchHeaderProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 pr-3">
      <button
        type="button"
        onClick={onSortName}
        className="group inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
      >
        <span>Name</span>
        <ChevronDownIcon
          className={`h-3 w-3 transition ${
            nameSortActive ? "opacity-100" : "opacity-30"
          } ${nameSortActive && sortDirection === "asc" ? "-rotate-180" : ""}`}
        />
      </button>
      <div
        ref={rootRef}
        className="relative w-48 min-w-0 flex-1 sm:w-56 md:w-64 normal-case"
      >
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <SearchIcon className="h-3 w-3" />
        </span>
        <UiInput
          type="text"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={`Search ${objectNounPlural}`}
          aria-label={`Search ${objectNounPlural}`}
          size="compact"
          fieldClassName="w-full"
          className={cx(
            "ui-list-control ui-list-control-with-icon h-8 w-full text-sm font-normal normal-case placeholder:text-slate-400 dark:placeholder:text-slate-500",
            advancedOptionsEnabled ? "pr-9" : "pr-3",
          )}
        />
        {advancedOptionsEnabled && (
          <UiIconButton
            ref={optionsButtonRef}
            size="compact"
            variant="ghost"
            onClick={onToggleOptions}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg focus-visible:outline-offset-1 ${
              advancedOptionsActive
                ? "text-primary-700 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-500/20"
                : ""
            }`}
            aria-haspopup="menu"
            aria-expanded={optionsOpen}
            label="Search options"
            icon={<SlidersIcon className="h-3 w-3" />}
          />
        )}
        <AnchoredPortalMenu
          open={advancedOptionsEnabled && optionsOpen}
          anchorRef={optionsButtonRef}
          placement="bottom-end"
          offset={8}
          minWidth={288}
          className={`w-72 ${menuClasses}`}
        >
          <div ref={optionsMenuRef} className="space-y-3">
            <UiSelect
              label="Scope"
              size="compact"
              value={searchScope}
              onChange={(event) =>
                onScopeChange(event.target.value as BrowserSearchScope)
              }
              className="ui-list-control h-9 w-full"
              aria-label="Search scope"
              disabled={!hasSearchQuery}
            >
              <option value="prefix">Current path</option>
              <option value="bucket">Whole bucket</option>
            </UiSelect>
            <UiCheckboxField
              checked={recursive}
              onChange={(event) => onRecursiveChange(event.target.checked)}
              disabled={!hasSearchQuery || searchScope === "bucket"}
              className={optionCardClasses}
              aria-label="Search recursively in subfolders"
            >
              Recursive
            </UiCheckboxField>
            <UiCheckboxField
              checked={exactMatch}
              onChange={(event) => onExactMatchChange(event.target.checked)}
              disabled={!hasSearchQuery}
              className={optionCardClasses}
              aria-label="Use exact match"
            >
              Exact match
            </UiCheckboxField>
            <UiCheckboxField
              checked={caseSensitive}
              onChange={(event) => onCaseSensitiveChange(event.target.checked)}
              disabled={!hasSearchQuery}
              className={optionCardClasses}
              aria-label="Case-sensitive search"
            >
              Case-sensitive
            </UiCheckboxField>
            <UiSelect
              label="Type"
              size="compact"
              value={typeFilter}
              onChange={(event) =>
                onTypeFilterChange(
                  event.target.value as BrowserObjectTypeFilter,
                )
              }
              className="ui-list-control h-9 w-full"
              aria-label="Object type filter"
            >
              <option value="all">All</option>
              <option value="file">Files</option>
              <option value="folder">Folders</option>
            </UiSelect>
            <UiSelect
              label="Storage class"
              size="compact"
              value={storageFilter}
              onChange={(event) =>
                onStorageFilterChange(event.target.value)
              }
              className="ui-list-control h-9 w-full"
              aria-label="Storage class filter"
            >
              <option value="all">All classes</option>
              {storageClasses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </UiSelect>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <ListActionButton
                type="button"
                onClick={onClear}
                disabled={!canReset}
              >
                Clear
              </ListActionButton>
              <ListActionButton
                type="button"
                onClick={onClose}

              >
                Close
              </ListActionButton>
            </div>
          </div>
        </AnchoredPortalMenu>
      </div>
    </div>
  );
}
