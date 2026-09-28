import BrowserAdvancedSearch from "./BrowserAdvancedSearch";
import { EMPTY_BROWSER_FILE_FILTERS, type BrowserFileFilterDraft } from "./browserFileFilters";
import { useBrowserText } from "./browserMessages";
import type { RefObject } from "react";

import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import UiIconButton from "../../components/ui/UiIconButton";
import UiInput from "../../components/ui/UiInput";
import {
  cx,
  uiMenuClass,
} from "../../components/ui/styles";

import { ChevronDownIcon, SearchIcon, SlidersIcon } from "./browserIcons";

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
  hasFileFilters?: boolean;
  fileFilters?: BrowserFileFilterDraft;
  onFileFiltersChange?: (filters: BrowserFileFilterDraft) => void;
  portal?: boolean;
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
  exactMatch,
  caseSensitive,
  typeFilter,
  searchScope, recursive, onScopeChange, onRecursiveChange,
  fileFilters = EMPTY_BROWSER_FILE_FILTERS, onFileFiltersChange, portal = false,
  storageFilter,
  storageClasses,
  onSortName,
  onFilterChange,
  onToggleOptions,
  onExactMatchChange,
  onCaseSensitiveChange,
  onTypeFilterChange,
  onStorageFilterChange,
  onClose,
}: BrowserObjectSearchHeaderProps) {
  const tr = useBrowserText();
  const activeCount = Number(searchScope === "bucket" || recursive) + Number(exactMatch) + Number(caseSensitive) + Number(typeFilter !== "all") + Number(storageFilter !== "all") + Object.values(fileFilters).filter(Boolean).length;
  const close = () => { onClose(); optionsButtonRef.current?.focus(); };
  return (
    <div className="flex min-w-0 items-center gap-2 pr-3">
      <button
        type="button"
        onClick={onSortName}
        className="group inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
      >
        <span>{tr("Name")}</span>
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
            advancedOptionsEnabled ? "ui-list-search" : "pr-3",
          )}
        />
        {advancedOptionsEnabled && (
          <UiIconButton
            ref={optionsButtonRef}
            size="compact"
            variant="ghost"
            onClick={onToggleOptions}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg focus-visible:outline-offset-1 ${
              advancedOptionsActive || activeCount > 0
                ? "text-primary-700 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-500/20"
                : ""
            }`}
            aria-haspopup="dialog"
            aria-expanded={optionsOpen}
            label="Search options"
            icon={<SlidersIcon className="h-3 w-3" />}
          />
        )}
        {advancedOptionsEnabled && activeCount > 0 && <span aria-label={`${activeCount} active search options`} className="pointer-events-none absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] leading-4 text-white">{activeCount}</span>}
        <AnchoredPortalMenu
          open={advancedOptionsEnabled && optionsOpen}
          anchorRef={optionsButtonRef}
          placement="bottom-end"
          offset={8}
          minWidth={360}
          className={`w-[460px] max-h-[calc(100dvh-24px)] overflow-y-auto ${menuClasses}`}
        >
          <div ref={optionsMenuRef}>
            <BrowserAdvancedSearch portal={portal} storageClasses={storageClasses}
              value={{ scope: searchScope, recursive, exactMatch, caseSensitive, type: typeFilter, storageClass: storageFilter, files: fileFilters }}
              onClose={close} onApply={value => {
                onScopeChange(value.scope); onRecursiveChange(value.recursive); onExactMatchChange(value.exactMatch); onCaseSensitiveChange(value.caseSensitive);
                onTypeFilterChange(value.type); onStorageFilterChange(value.storageClass); onFileFiltersChange?.(value.files); close();
              }} />
          </div>
        </AnchoredPortalMenu>
      </div>
    </div>
  );
}
