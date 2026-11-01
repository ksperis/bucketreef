/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3ExecutionContextSelector } from "../../../api/accountParams";
import { useBucketDetailsApi } from "../../shared/useBucketDetailsApi";
import {
  deleteCephAdminBucketPolicy,
  getCephAdminBucketPolicy,
  putCephAdminBucketPolicy,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError, isApiFeatureUnsupportedError } from "../../../utils/apiError";
import {
  bucketEditorDraftSignature,
  cloneBucketJsonValue,
  stableBucketJsonSignature,
} from "./bucketFeatureState";
import { useBucketFeatureEditorSession } from "./useBucketFeatureEditorSession";
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
  contextId: S3ExecutionContextSelector;
  bucketName?: string;
  cephAdmin: boolean;
  cephAdminTenant?: string | null;
  enabled: boolean;
  endpointId?: number | null;
};

function normalizePolicy(value: unknown): PolicyDocumentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as PolicyDocumentRecord;
}

function parsePolicyEditorJson(text: string) {
  const parsed = parsePolicyJson(text);
  return { draft: parsed.policy, error: parsed.error };
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
  contextId,
  bucketName,
  cephAdmin,
  cephAdminTenant,
  enabled,
  endpointId,
}: UseBucketPolicyControllerOptions) {
  const bucketDetailsApi = useBucketDetailsApi();
  const [policy, setPolicy] = useState<PolicyDocumentRecord>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [featureUnsupported, setFeatureUnsupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const {
    closeEditor,
    draft: draftPolicy,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    jsonText,
    openEditorDraft,
    replaceDraft,
    setDraft: setDraftPolicy,
    setEditorError,
    setEditorTargetIndex,
    setStatus,
    status,
    updateEditorMode,
    updateJsonText,
  } = useBucketFeatureEditorSession<PolicyDocumentRecord>({
    initialDraft: {},
    initialJsonText: "{}",
    parseJson: parsePolicyEditorJson,
    clearTargetOnVisual: false,
  });

  const applyBaseline = useCallback((next: unknown) => {
    setPolicy(cloneBucketJsonValue(normalizePolicy(next)));
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      applyBaseline({});
      setLoadError(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setFeatureUnsupported(false);
    setLoadError(null);
    setStatus(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketPolicy(endpointId, bucketName, cephAdminTenant)
          : { policy: null }
        : await bucketDetailsApi.getBucketPolicy(contextId, bucketName);
      applyBaseline(data.policy);
    } catch (loadFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(loadFailure));
      applyBaseline({});
      setLoadError(extractApiError(loadFailure, "Unable to load the bucket policy."));
    } finally {
      setLoading(false);
    }
  }, [bucketDetailsApi, contextId, applyBaseline, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId, setStatus]);

  const openEditor = useCallback(() => {
    openEditorDraft(cloneBucketJsonValue(policy), "visual", null);
  }, [openEditorDraft, policy]);

  const openEditorFor = useCallback((index: number) => {
    openEditorDraft(cloneBucketJsonValue(policy), "visual", index);
  }, [openEditorDraft, policy]);

  const openJsonEditor = useCallback(() => {
    openEditorDraft(cloneBucketJsonValue(policy), "json", null);
  }, [openEditorDraft, policy]);

  const openEditorWithNew = useCallback(() => {
    const nextDraft = cloneBucketJsonValue(policy);
    const statements = policyStatements(nextDraft);
    const withNewStatement = withPolicyStatements(
      nextDraft,
      [...statements, createVisualPolicyStatement(nextStatementSid(nextDraft))],
    );
    openEditorDraft(withNewStatement, "visual", statements.length);
  }, [openEditorDraft, policy]);

  const addDraftStatement = useCallback(() => {
    setDraftPolicy((current) => withPolicyStatements(
      current,
      [...policyStatements(current), createVisualPolicyStatement(nextStatementSid(current))],
    ));
    setEditorTargetIndex(null);
    setEditorError(null);
  }, [setDraftPolicy, setEditorError, setEditorTargetIndex]);

  const removeDraftStatement = useCallback((index: number) => {
    setDraftPolicy((current) => withPolicyStatements(
      current,
      policyStatements(current).filter((_, statementIndex) => statementIndex !== index),
    ));
    setEditorError(null);
  }, [setDraftPolicy, setEditorError]);

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
  }, [setDraftPolicy, setEditorError]);

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
  }, [setDraftPolicy, setEditorError]);

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
  }, [setDraftPolicy, setEditorError]);

  const persistPolicy = useCallback(async (nextPolicy: PolicyDocumentRecord) => {
    if (!bucketName || !enabled) return null;
    if (isPolicyConfigurationEmpty(nextPolicy)) {
      if (cephAdmin) {
        if (!endpointId) return null;
        await deleteCephAdminBucketPolicy(endpointId, bucketName, cephAdminTenant);
      } else {
        await bucketDetailsApi.deleteBucketPolicy(contextId, bucketName);
      }
      return {};
    }
    const saved = cephAdmin
      ? endpointId
        ? await putCephAdminBucketPolicy(endpointId, bucketName, nextPolicy, cephAdminTenant)
        : { policy: nextPolicy }
      : await bucketDetailsApi.putBucketPolicy(contextId, bucketName, nextPolicy);
    return normalizePolicy(saved.policy ?? nextPolicy);
  }, [bucketDetailsApi, contextId, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const removeStatementDirect = useCallback(async (index: number) => {
    if (saving) return;
    setSaving(true);
    setLoadError(null);
    setStatus(null);
    try {
      const nextPolicy = withPolicyStatements(
        cloneBucketJsonValue(policy),
        policyStatements(policy).filter((_, statementIndex) => statementIndex !== index),
      );
      const savedPolicy = await persistPolicy(nextPolicy);
      if (savedPolicy === null) return;
      applyBaseline(savedPolicy);
      setStatus(isPolicyConfigurationEmpty(savedPolicy) ? "Bucket policy deleted" : "Policy statement removed");
    } catch (removeFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(removeFailure));
      setLoadError(extractApiError(removeFailure, "Unable to update the bucket policy."));
    } finally {
      setSaving(false);
    }
  }, [applyBaseline, persistPolicy, policy, saving, setStatus]);

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
      setDraftPolicy(cloneBucketJsonValue(parsed.policy));
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
      replaceDraft(cloneBucketJsonValue(savedPolicy));
      setStatus(isPolicyConfigurationEmpty(savedPolicy) ? "Bucket policy deleted" : "Bucket policy updated");
      closeEditor();
    } catch (saveFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(saveFailure));
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
    replaceDraft,
    saving,
    closeEditor,
    setDraftPolicy,
    setEditorError,
    setStatus,
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
        await deleteCephAdminBucketPolicy(endpointId, bucketName, cephAdminTenant);
      } else {
        await bucketDetailsApi.deleteBucketPolicy(contextId, bucketName);
      }
      applyBaseline({});
      setStatus("Bucket policy deleted");
    } catch (removeFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(removeFailure));
      setLoadError(extractApiError(removeFailure, "Unable to delete the bucket policy."));
    } finally {
      setDeleting(false);
    }
  }, [bucketDetailsApi, contextId, applyBaseline, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId, setStatus]);

  const statements = useMemo(() => policyStatements(policy), [policy]);
  const baselineSignature = stableBucketJsonSignature(policy);
  const draftSignature = useMemo(
    () => bucketEditorDraftSignature(editorMode, jsonText, draftPolicy),
    [draftPolicy, editorMode, jsonText],
  );
  const dirty = editorOpen && draftSignature !== baselineSignature;

  return {
    featureUnsupported,
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
    editorTargetIndex,
    error: loadError,
    jsonText,
    load,
    loading,
    openEditor,
    openEditorFor,
    openEditorWithNew,
    openJsonEditor,
    policy,
    remove,
    removeDraftCondition,
    removeDraftStatement,
    removeStatementDirect,
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
