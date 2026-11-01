/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { listIamPolicies, type IamPolicy } from "../../api/managerIamPolicies";

type RelatedLoader = <RelatedItem>(
  contextId: S3ExecutionContextSelector,
  listRelatedItems: (contextId: S3ExecutionContextSelector) => Promise<RelatedItem[]>,
  setRelatedItems: (items: RelatedItem[]) => void,
) => Promise<void>;

export function useManagedPolicySelection(loadRelated: RelatedLoader) {
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [policySearch, setPolicySearch] = useState("");
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);

  const loadPolicies = useCallback((contextId: S3ExecutionContextSelector) => {
    setPolicies([]);
    return loadRelated(contextId, listIamPolicies, setPolicies);
  }, [loadRelated]);

  const resetPolicySelection = useCallback(() => {
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
  }, []);

  useEffect(() => {
    setSelectedPolicies((current) =>
      current.filter((arn) => policies.some((policy) => policy.arn === arn)),
    );
  }, [policies]);

  useEffect(() => {
    if (selectedPolicies.length > 0) {
      setShowPolicyOptions(true);
    }
  }, [selectedPolicies.length]);

  return {
    loadPolicies,
    policies,
    policySearch,
    resetPolicySelection,
    selectedPolicies,
    setPolicies,
    setPolicySearch,
    setSelectedPolicies,
    setShowPolicyOptions,
    showPolicyOptions,
  };
}
