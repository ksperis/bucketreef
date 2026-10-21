/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";
import { useBrowserI18n } from "./browserI18n";

type BrowserSearchScope = "prefix" | "bucket";
type BrowserSearchTypeFilter = "all" | "file" | "folder";

type UseBrowserSearchOptions = {
  isPortalProfile: boolean;
  scopeKey: string;
};

export function useBrowserSearch({
  isPortalProfile,
  scopeKey,
}: UseBrowserSearchOptions) {
  const { text } = useBrowserI18n();
  const [filter, setFilter] = useState("");
  const [showSearchOptionsMenu, setShowSearchOptionsMenu] = useState(false);
  const [searchScope, setSearchScope] =
    useState<BrowserSearchScope>("prefix");
  const [searchRecursive, setSearchRecursive] = useState(false);
  const [searchExactMatch, setSearchExactMatch] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [typeFilter, setTypeFilter] =
    useState<BrowserSearchTypeFilter>("all");
  const [storageFilter, setStorageFilter] = useState("all");
  const searchControlRef = useRef<HTMLDivElement | null>(null);
  const searchOptionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchOptionsMenuRef = useRef<HTMLDivElement | null>(null);

  const hasSearchQuery = filter.trim().length > 0;
  const isSearchingInWholeBucket =
    hasSearchQuery && searchScope === "bucket";
  const hasAdvancedSearchOptionsActive =
    !isPortalProfile &&
    (searchScope !== "prefix" ||
      searchRecursive ||
      searchExactMatch ||
      searchCaseSensitive ||
      typeFilter !== "all" ||
      storageFilter !== "all");
  const hasActiveSearchFilters =
    hasSearchQuery || hasAdvancedSearchOptionsActive;
  const searchResultScopeLabel = hasSearchQuery
    ? isSearchingInWholeBucket
      ? "Whole bucket"
      : searchRecursive
        ? "Current path + subfolders"
        : "Current path"
    : "Filters applied";
  const activeSearchStatusChips = [
    hasSearchQuery ? { label: text("Query"), value: filter } : null,
    hasSearchQuery
      ? { label: text("Scope"), value: searchResultScopeLabel }
      : null,
    searchRecursive && !isSearchingInWholeBucket
      ? { label: text("Mode"), value: "Recursive" }
      : null,
    searchExactMatch ? { label: text("Match"), value: "Exact" } : null,
    searchCaseSensitive ? { label: text("Case"), value: "Sensitive" } : null,
    typeFilter !== "all" ? { label: text("Type"), value: typeFilter } : null,
    storageFilter !== "all"
      ? { label: text("Storage"), value: storageFilter }
      : null,
  ].filter((entry): entry is { label: string; value: string } =>
    Boolean(entry),
  );

  const changeSearchScope = useCallback((scope: BrowserSearchScope) => {
    setSearchScope(scope);
    if (scope === "bucket") {
      setSearchRecursive(false);
    }
  }, []);

  const clearSearchFilters = useCallback(() => {
    setFilter("");
    setSearchScope("prefix");
    setSearchRecursive(false);
    setSearchExactMatch(false);
    setSearchCaseSensitive(false);
    setTypeFilter("all");
    setStorageFilter("all");
  }, []);

  const toggleSearchOptionsMenu = useCallback(() => {
    setShowSearchOptionsMenu((current) => !current);
  }, []);
  const closeSearchOptionsMenu = useCallback(() => {
    setShowSearchOptionsMenu(false);
  }, []);

  useDismissibleLayer({
    open: showSearchOptionsMenu,
    insideRefs: [searchControlRef, searchOptionsMenuRef],
    onDismiss: (reason) => {
      closeSearchOptionsMenu();
      if (reason === "escape") searchOptionsButtonRef.current?.focus();
    },
  });

  useEffect(() => {
    setShowSearchOptionsMenu(false);
  }, [scopeKey]);

  useEffect(() => {
    if (isPortalProfile) {
      setShowSearchOptionsMenu(false);
      if (searchScope !== "prefix") setSearchScope("prefix");
      if (searchRecursive) setSearchRecursive(false);
      if (searchExactMatch) setSearchExactMatch(false);
      if (searchCaseSensitive) setSearchCaseSensitive(false);
      if (typeFilter !== "all") setTypeFilter("all");
      if (storageFilter !== "all") setStorageFilter("all");
      return;
    }
    if (hasSearchQuery) return;
    if (searchScope !== "prefix") setSearchScope("prefix");
    if (searchRecursive) setSearchRecursive(false);
    if (searchExactMatch) setSearchExactMatch(false);
    if (searchCaseSensitive) setSearchCaseSensitive(false);
  }, [
    hasSearchQuery,
    isPortalProfile,
    searchCaseSensitive,
    searchExactMatch,
    searchRecursive,
    searchScope,
    storageFilter,
    typeFilter,
  ]);

  return {
    activeSearchStatusChips,
    changeSearchScope,
    clearSearchFilters,
    closeSearchOptionsMenu,
    filter,
    hasActiveSearchFilters,
    hasAdvancedSearchOptionsActive,
    hasSearchQuery,
    isSearchingInWholeBucket,
    searchCaseSensitive,
    searchControlRef,
    searchExactMatch,
    searchOptionsButtonRef,
    searchOptionsMenuRef,
    searchRecursive,
    searchScope,
    setFilter,
    setSearchCaseSensitive,
    setSearchExactMatch,
    setSearchRecursive,
    setStorageFilter,
    setTypeFilter,
    showSearchOptionsMenu,
    storageFilter,
    typeFilter,
    toggleSearchOptionsMenu,
  };
}
