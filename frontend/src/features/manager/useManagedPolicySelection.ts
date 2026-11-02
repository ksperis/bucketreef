/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { listIamPoliciesPage } from "../../api/managerIamPolicies";
import { useManagerIamCursorCollection } from "./useManagerIamCursorCollection";

export function useManagedPolicySelection() {
  const collection = useManagerIamCursorCollection(listIamPoliciesPage);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const { load: loadCollection, setSearch: setCollectionSearch } = collection;

  const loadPolicies = useCallback((contextId: S3ExecutionContextSelector) => {
    loadCollection(contextId);
  }, [loadCollection]);

  const resetPolicySelection = useCallback(() => {
    setSelectedPolicies([]);
    setCollectionSearch("");
    setShowPolicyOptions(false);
  }, [setCollectionSearch]);

  useEffect(() => {
    if (selectedPolicies.length > 0) {
      setShowPolicyOptions(true);
    }
  }, [selectedPolicies.length]);

  return {
    loadPolicies,
    policies: collection.items,
    policiesLoading: collection.loading,
    policiesError: collection.error,
    policySearch: collection.search,
    setPolicySearch: setCollectionSearch,
    policyPage: collection.page,
    policyPageSize: collection.pageSize,
    setPolicyPageSize: collection.setPageSize,
    canPreviousPolicyPage: collection.canPrevious,
    canNextPolicyPage: collection.canNext,
    previousPolicyPage: collection.previousPage,
    nextPolicyPage: collection.nextPage,
    resetPolicySelection,
    selectedPolicies,
    setPolicies: collection.setItems,
    setSelectedPolicies,
    setShowPolicyOptions,
    showPolicyOptions,
  };
}
