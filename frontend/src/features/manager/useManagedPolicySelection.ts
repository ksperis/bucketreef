/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { listIamPoliciesPage, type IamPolicy } from "../../api/managerIamPolicies";
import { useManagerIamCursorCollection } from "./useManagerIamCursorCollection";

export type ManagedPolicySelectionViewModel = {
  policies: IamPolicy[];
  selectedPolicyArns: string[];
  search: string;
  expanded: boolean;
  loading: boolean;
  page: number;
  pageSize: number;
  canPrevious: boolean;
  canNext: boolean;
  onSearchChange: (value: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
  onExpandedChange: (expanded: boolean) => void;
  onSelectionChange: (policyArns: string[]) => void;
};

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

  const panel: ManagedPolicySelectionViewModel = {
    policies: collection.items,
    selectedPolicyArns: selectedPolicies,
    search: collection.search,
    expanded: showPolicyOptions,
    loading: collection.loading,
    page: collection.page,
    pageSize: collection.pageSize,
    canPrevious: collection.canPrevious,
    canNext: collection.canNext,
    onSearchChange: setCollectionSearch,
    onPreviousPage: collection.previousPage,
    onNextPage: collection.nextPage,
    onPageSizeChange: collection.setPageSize,
    onExpandedChange: setShowPolicyOptions,
    onSelectionChange: setSelectedPolicies,
  };

  return {
    loadPolicies,
    panel,
    resetPolicySelection,
    selectedPolicies,
    setPolicies: collection.setItems,
  };
}
