/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketPolicy,
  getBucketPolicy,
  putBucketPolicy,
} from "../../../api/bucketDetails";
import {
  deleteCephAdminBucketPolicy,
  getCephAdminBucketPolicy,
  putCephAdminBucketPolicy,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import type { BucketFeatureEditorMode } from "./BucketFeatureEditorDialog";
import {
  jsonTextSignature,
  stableBucketJsonSignature,
} from "./bucketFeatureState";
import {
  createVisualPolicyStatement,
  isPolicyConfigurationEmpty,
  parsePolicyJson,
  policyStatements,
  removePolicyCondition,
  setPolicyConditionValue,
  updatePolicyVisualStatement,
  validateVisualPolicy,
  withPolicyStatements,
  type PolicyDocumentRecord,
  type PolicyVisualStatementPatch,
} from "./policyEditorModel";

type UseBucketPolicyControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

function clonePolicy(policy: PolicyDocumentRecord): PolicyDocumentRecord {
  return JSON.parse(JSON.stringify(policy)) as PolicyDocumentRecord;
}

function normalizePolicy(value: unknown): PolicyDocumentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as PolicyDocumentRecord;
}

function policyText(policy: PolicyDocumentRecord): string {
  return JSON.stringify(policy, null, 2);
}

function nextStatementSid(policy: PolicyDocumentRecord): string {
  const statements = policyStatements(policy);
  const existing = new Set(
    statements
      .map((statement) => statement.Sid)
      .filter((sid): sid is string => typeof sid === "string"),
  );
  let index = statements.length + 1;
  while (existing.has(`Statement${index}`)) index += 1;
  return `Statement${index}`;
}

export function useBucketPolicyController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketPolicyControllerOptions) {
  const [policy, setPolicy] = useState<PolicyDocumentRecord>({});
  const [draftPolicy, setDraftPolicy] = useState<PolicyDocumentRecord>({});
  const [jsonText, setJsonText] = useState("{}");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<BucketFeatureEditorMode>("visual");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const applyBaseline = useCallback((next: unknown) => {
    setPolicy(clonePolicy(normalizePolicy(next)));
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      applyBaseline({});
      setLoadError(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setStatus(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketPolicy(endpointId, bucketName)
          : { policy: null }
        : await getBucketPolicy(accountId, bucketName);
      applyBaseline(data.policy);
    } catch (loadFailure) {
      applyBaseline({});
      setLoadError(extractApiError(loadFailure, "Unable to load the bucket policy."));
    } finally {
      setLoading(false);
    }
  }, [accountId, applyBaseline, bucketName, cephAdmin, enabled, endpointId]);

  const openEditor = useCallback(() => {
    const nextDraft = clonePolicy(policy);
    setDraftPolicy(nextDraft);
    setJsonText(policyText(nextDraft));
    setEditorMode("visual");
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, [policy]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorError(null);
  }, []);

  const updateJsonText = useCallback((value: string) => {
    setJsonText(value);
    setEditorError(null);
  }, []);

  const updateEditorMode = useCallback((nextMode: BucketFeatureEditorMode) => {
    if (nextMode === editorMode) return;
    setEditorError(null);
    if (nextMode === "json") {
      setJsonText(policyText(draftPolicy));
      setEditorMode("json");
      return;
    }
    const parsed = parsePolicyJson(jsonText);
    if (!parsed.policy) {
      setEditorError(parsed.error);
      return;
    }
    setDraftPolicy(clonePolicy(parsed.policy));
    setEditorMode("visual");
  }, [draftPolicy, editorMode, jsonText]);

  const addDraftStatement = useCallback(() => {
    setDraftPolicy((current) => withPolicyStatements(
      current,
      [...policyStatements(current), createVisualPolicyStatement(nextStatementSid(current))],
    ));
    setEditorError(null);
  }, []);

  const removeDraftStatement = useCallback((index: number) => {
    setDraftPolicy((current) => withPolicyStatements(
      current,
      policyStatements(current).filter((_, statementIndex) => statementIndex !== index),
    ));
    setEditorError(null);
  }, []);

  const updateDraftStatement = useCallback((
    index: number,
    patch: PolicyVisualStatementPatch,
  ) => {
    setDraftPolicy((current) => withPolicyStatements(
      current,
      policyStatements(current).map((statement, statementIndex) =>
        statementIndex === index
          ? updatePolicyVisualStatement(statement, patch)
          : statement,
      ),
    ));
    setEditorError(null);
  }, []);

  const updateDraftCondition = useCallback((
    statementIndex: number,
    operator: string,
    key: string,
    values: string[],
  ) => {
    setDraftPolicy((current) => withPolicyStatements(
      current,
      policyStatements(current).map((statement, index) =>
        index === statementIndex
          ? setPolicyConditionValue(statement, operator, key, values)
          : statement,
      ),
    ));
    setEditorError(null);
  }, []);

  const removeDraftCondition = useCallback((
    statementIndex: number,
    operator: string,
    key: string,
  ) => {
    setDraftPolicy((current) => withPolicyStatements(
      current,
      policyStatements(current).map((statement, index) =>
        index === statementIndex
          ? removePolicyCondition(statement, operator, key)
          : statement,
      ),
    ));
    setEditorError(null);
  }, []);

  const persistPolicy = useCallback(async (nextPolicy: PolicyDocumentRecord) => {
    if (!bucketName || !enabled) return null;
    if (isPolicyConfigurationEmpty(nextPolicy)) {
      if (cephAdmin) {
        if (!endpointId) return null;
        await deleteCephAdminBucketPolicy(endpointId, bucketName);
      } else {
        await deleteBucketPolicy(accountId, bucketName);
      }
      return {};
    }
    const saved = cephAdmin
      ? endpointId
        ? await putCephAdminBucketPolicy(endpointId, bucketName, nextPolicy)
        : { policy: nextPolicy }
      : await putBucketPolicy(accountId, bucketName, nextPolicy);
    return normalizePolicy(saved.policy ?? nextPolicy);
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

  const saveDraft = useCallback(async () => {
    if (!bucketName || !enabled || saving) return;
    let nextPolicy = draftPolicy;
    if (editorMode === "json") {
      const parsed = parsePolicyJson(jsonText);
      if (!parsed.policy) {
        setEditorError(parsed.error);
        return;
      }
      nextPolicy = parsed.policy;
      setDraftPolicy(clonePolicy(parsed.policy));
    } else {
      const validationError = validateVisualPolicy(nextPolicy);
      if (validationError) {
        setEditorError(validationError);
        return;
      }
    }

    setSaving(true);
    setEditorError(null);
    setStatus(null);
    try {
      const savedPolicy = await persistPolicy(nextPolicy);
      if (savedPolicy === null) return;
      applyBaseline(savedPolicy);
      setDraftPolicy(clonePolicy(savedPolicy));
      setJsonText(policyText(savedPolicy));
      setStatus(isPolicyConfigurationEmpty(savedPolicy) ? "Bucket policy deleted" : "Bucket policy updated");
      setEditorOpen(false);
    } catch (saveFailure) {
      setEditorError(extractApiError(saveFailure, "Unable to update the bucket policy."));
    } finally {
      setSaving(false);
    }
  }, [
    applyBaseline,
    bucketName,
    draftPolicy,
    editorMode,
    enabled,
    jsonText,
    persistPolicy,
    saving,
  ]);

  // Kept for the current page-level destructive-action contract. The Policy
  // summary no longer exposes this action; modal Save is the editing boundary.
  const remove = useCallback(async () => {
    if (!bucketName || !enabled) return;
    setDeleting(true);
    setLoadError(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketPolicy(endpointId, bucketName);
      } else {
        await deleteBucketPolicy(accountId, bucketName);
      }
      applyBaseline({});
      setStatus("Bucket policy deleted");
    } catch (removeFailure) {
      setLoadError(extractApiError(removeFailure, "Unable to delete the bucket policy."));
    } finally {
      setDeleting(false);
    }
  }, [accountId, applyBaseline, bucketName, cephAdmin, enabled, endpointId]);

  const statements = useMemo(() => policyStatements(policy), [policy]);
  const baselineSignature = stableBucketJsonSignature(policy);
  const draftSignature = useMemo(
    () => editorMode === "json"
      ? jsonTextSignature(jsonText, draftPolicy).signature
      : stableBucketJsonSignature(draftPolicy),
    [draftPolicy, editorMode, jsonText],
  );
  const dirty = editorOpen && draftSignature !== baselineSignature;

  return {
    addDraftStatement,
    allowCount: statements.filter((statement) => statement.Effect === "Allow").length,
    closeEditor,
    configured: !isPolicyConfigurationEmpty(policy),
    deleting,
    denyCount: statements.filter((statement) => statement.Effect === "Deny").length,
    dirty,
    draftPolicy,
    draftSignature,
    editorError,
    editorMode,
    editorOpen,
    error: loadError,
    jsonText,
    load,
    loading,
    openEditor,
    policy,
    remove,
    removeDraftCondition,
    removeDraftStatement,
    saveDraft,
    saving,
    statementCount: statements.length,
    statements,
    status,
    updateDraftCondition,
    updateDraftStatement,
    updateEditorMode,
    updateJsonText,
  };
}
