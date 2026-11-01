/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useRef, useState } from "react";

import { fetchLdapProviders, type LDAPProviderInfo } from "../../api/auth";
import { searchLdapUsers, type LdapImportSearchItem } from "../../api/users";
import { extractApiError } from "../../utils/apiError";
import { useUsersI18n } from "./usersMessage";

export default function useAdminUserLdapImport() {
  const { text } = useUsersI18n();
  const textRef = useRef(text);
  textRef.current = text;

  const [providers, setProviders] = useState<LDAPProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [query, setQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [items, setItems] = useState<LdapImportSearchItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LdapImportSearchItem | null>(null);

  const clearResults = useCallback(() => {
    setSearchError(null);
    setItems([]);
    setTruncated(false);
    setSearchPerformed(false);
    setSelectedEntry(null);
  }, []);

  const ensureProviders = useCallback(async () => {
    if (providersLoaded) {
      if (providers.length === 1) {
        setProviderId((current) => current || providers[0].id);
      }
      return;
    }
    if (providersLoading) return;
    setProvidersLoading(true);
    setSearchError(null);
    try {
      const loadedProviders = await fetchLdapProviders();
      setProviders(loadedProviders);
      setProvidersLoaded(true);
      if (loadedProviders.length === 1) {
        setProviderId((current) => current || loadedProviders[0].id);
      }
    } catch (err) {
      setSearchError(extractApiError(err, textRef.current("loadLdapProvidersError")));
    } finally {
      setProvidersLoading(false);
    }
  }, [providers, providersLoaded, providersLoading]);

  const changeProvider = useCallback((nextProviderId: string) => {
    setProviderId(nextProviderId);
    setQuery("");
    clearResults();
  }, [clearResults]);

  const changeQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    clearResults();
  }, [clearResults]);

  const search = useCallback(async () => {
    const normalizedQuery = query.trim();
    if (!providerId || normalizedQuery.length < 2 || searchLoading) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchPerformed(false);
    setSelectedEntry(null);
    try {
      const result = await searchLdapUsers(providerId, normalizedQuery);
      setItems(result.items);
      setTruncated(result.truncated);
      setSearchPerformed(true);
    } catch (err) {
      setItems([]);
      setTruncated(false);
      setSearchError(extractApiError(err, textRef.current("ldapSearchFailed")));
    } finally {
      setSearchLoading(false);
    }
  }, [providerId, query, searchLoading]);

  const reset = useCallback(() => {
    setProviderId("");
    setQuery("");
    clearResults();
  }, [clearResults]);

  return {
    providers,
    providersLoading,
    providerId,
    query,
    searchLoading,
    searchError,
    items,
    truncated,
    searchPerformed,
    selectedEntry,
    ensureProviders,
    changeProvider,
    changeQuery,
    clearResults,
    search,
    select: setSelectedEntry,
    reset,
  };
}
