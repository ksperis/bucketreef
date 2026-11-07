/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { BucketDetailControllerOptions } from "./bucketDetailControllerOptions";
import { useBucketDetailsApi } from "../../shared/useBucketDetailsApi";
import {
  deleteCephAdminBucketCors,
  getCephAdminBucketCors,
  putCephAdminBucketCors,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError, isApiFeatureUnsupportedError } from "../../../utils/apiError";
import {
  bucketEditorDraftSignature,
  cloneBucketJsonValue,
  stableBucketJsonSignature,
} from "./bucketFeatureState";
import { useBucketFeatureEditorSession } from "./useBucketFeatureEditorSession";
import { useEditorRowIds } from "../../../hooks/useEditorRowIds";
import {
  createVisualCorsRule,
  parseCorsRulesJson,
  updateCorsVisualRule,
  validateVisualCorsRules,
  type CorsRuleRecord,
  type CorsVisualRulePatch,
} from "./corsEditorModel";

function normalizeRules(value: unknown): CorsRuleRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rule): rule is CorsRuleRecord =>
      rule !== null && typeof rule === "object" && !Array.isArray(rule),
  );
}

function parseCorsEditorJson(text: string) {
  const parsed = parseCorsRulesJson(text);
  return { draft: parsed.rules, error: parsed.error };
}

export function useBucketCorsController({
  contextId,
  bucketName,
  cephAdmin,
  cephAdminTenant,
  enabled,
  endpointId,
}: BucketDetailControllerOptions) {
  const bucketDetailsApi = useBucketDetailsApi();
  const [rules, setRules] = useState<CorsRuleRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [featureUnsupported, setFeatureUnsupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const {
    appendRowId: appendDraftRuleId,
    removeRowId: removeDraftRuleId,
    resetRowIds: resetDraftRuleIds,
    rowIds: draftRuleIds,
  } = useEditorRowIds("cors-rule");
  const {
    closeEditor,
    draft: draftRules,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    jsonText,
    openEditorDraft: openEditorSessionDraft,
    replaceDraft,
    setDraft: setDraftRules,
    setEditorError,
    setEditorTargetIndex,
    setStatus,
    status,
    updateEditorMode: updateEditorSessionMode,
    updateJsonText,
  } = useBucketFeatureEditorSession<CorsRuleRecord[]>({
    initialDraft: [],
    initialJsonText: "[]",
    parseJson: parseCorsEditorJson,
  });

  const applyBaseline = useCallback((next: unknown) => {
    setRules(normalizeRules(next));
  }, []);

  const openEditorDraft = useCallback((
    nextDraft: CorsRuleRecord[],
    mode: "visual" | "json",
    targetIndex: number | null,
  ) => {
    resetDraftRuleIds(nextDraft.length);
    openEditorSessionDraft(nextDraft, mode, targetIndex);
  }, [openEditorSessionDraft, resetDraftRuleIds]);

  const updateEditorMode = useCallback((nextMode: "visual" | "json") => {
    const parsedDraft = updateEditorSessionMode(nextMode);
    if (nextMode === "visual" && parsedDraft) {
      resetDraftRuleIds(parsedDraft.length);
    }
  }, [resetDraftRuleIds, updateEditorSessionMode]);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      applyBaseline([]);
      setLoadError(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setFeatureUnsupported(false);
    setLoadError(null);
    setStatus(null);
    try {
      let data;
      if (cephAdmin) {
        if (!endpointId) {
          applyBaseline([]);
          return;
        }
        data = await getCephAdminBucketCors(endpointId, bucketName, cephAdminTenant);
      } else {
        data = await bucketDetailsApi.getBucketCors(contextId, bucketName);
      }
      applyBaseline(data.rules);
    } catch (loadFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(loadFailure));
      applyBaseline([]);
      setLoadError(
        extractApiError(loadFailure, "Unable to load the CORS configuration."),
      );
    } finally {
      setLoading(false);
    }
  }, [bucketDetailsApi, contextId, applyBaseline, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId, setStatus]);

  const openEditor = useCallback(() => {
    openEditorDraft(cloneBucketJsonValue(rules), "visual", null);
  }, [openEditorDraft, rules]);

  const openEditorFor = useCallback((index: number) => {
    openEditorDraft(cloneBucketJsonValue(rules), "visual", index);
  }, [openEditorDraft, rules]);

  const openJsonEditor = useCallback(() => {
    openEditorDraft(cloneBucketJsonValue(rules), "json", null);
  }, [openEditorDraft, rules]);

  const openEditorWithNew = useCallback(() => {
    const nextDraft = [...cloneBucketJsonValue(rules), createVisualCorsRule()];
    openEditorDraft(nextDraft, "visual", nextDraft.length - 1);
  }, [openEditorDraft, rules]);

  const addDraftRule = useCallback(() => {
    setDraftRules((current) => [...current, createVisualCorsRule()]);
    appendDraftRuleId();
    setEditorTargetIndex(null);
    setEditorError(null);
  }, [appendDraftRuleId, setDraftRules, setEditorError, setEditorTargetIndex]);

  const removeDraftRule = useCallback((index: number) => {
    setDraftRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
    removeDraftRuleId(index);
    setEditorError(null);
  }, [removeDraftRuleId, setDraftRules, setEditorError]);

  const updateDraftRule = useCallback((index: number, patch: CorsVisualRulePatch) => {
    setDraftRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? updateCorsVisualRule(rule, patch) : rule,
      ),
    );
    setEditorError(null);
  }, [setDraftRules, setEditorError]);

  const persistRules = useCallback(async (nextRules: CorsRuleRecord[]) => {
    if (!bucketName || !enabled || (cephAdmin && !endpointId)) return null;
    if (nextRules.length === 0) {
      if (cephAdmin) {
        await deleteCephAdminBucketCors(endpointId as number, bucketName, cephAdminTenant);
      } else {
        await bucketDetailsApi.deleteBucketCors(contextId, bucketName);
      }
      return [];
    }
    const saved = cephAdmin
      ? await putCephAdminBucketCors(endpointId as number, bucketName, nextRules, cephAdminTenant)
      : await bucketDetailsApi.putBucketCors(contextId, bucketName, nextRules);
    return normalizeRules(saved.rules ?? nextRules);
  }, [bucketDetailsApi, contextId, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const removeRuleDirect = useCallback(async (index: number) => {
    if (saving) return;
    setSaving(true);
    setLoadError(null);
    setStatus(null);
    try {
      const savedRules = await persistRules(
        rules.filter((_, ruleIndex) => ruleIndex !== index),
      );
      if (savedRules === null) return;
      applyBaseline(savedRules);
      setStatus(savedRules.length === 0 ? "CORS configuration deleted" : "CORS rule removed");
    } catch (removeFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(removeFailure));
      setLoadError(extractApiError(removeFailure, "Unable to update the CORS configuration."));
    } finally {
      setSaving(false);
    }
  }, [applyBaseline, persistRules, rules, saving, setStatus]);

  const saveDraft = useCallback(async () => {
    if (!bucketName || !enabled || saving) return;

    let nextRules = draftRules;
    if (editorMode === "json") {
      const parsed = parseCorsRulesJson(jsonText);
      if (!parsed.rules) {
        setEditorError(parsed.error);
        return;
      }
      nextRules = parsed.rules;
      setDraftRules(parsed.rules);
      resetDraftRuleIds(parsed.rules.length);
    } else {
      const validationError = validateVisualCorsRules(nextRules);
      if (validationError) {
        setEditorError(validationError);
        return;
      }
    }

    setSaving(true);
    setEditorError(null);
    setStatus(null);
    try {
      const savedRules = await persistRules(nextRules);
      if (savedRules === null) return;
      applyBaseline(savedRules);
      replaceDraft(cloneBucketJsonValue(savedRules));
      resetDraftRuleIds(savedRules.length);
      setStatus(savedRules.length === 0 ? "CORS configuration deleted" : "CORS configuration updated");
      closeEditor();
    } catch (saveFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(saveFailure));
      setEditorError(
        extractApiError(saveFailure, "Unable to update the CORS configuration."),
      );
    } finally {
      setSaving(false);
    }
  }, [
    applyBaseline,
    bucketName,
    draftRules,
    editorMode,
    enabled,
    jsonText,
    persistRules,
    replaceDraft,
    resetDraftRuleIds,
    saving,
    closeEditor,
    setDraftRules,
    setEditorError,
    setStatus,
  ]);

  const baselineSignature = stableBucketJsonSignature(rules);
  const draftSignature = useMemo(
    () => bucketEditorDraftSignature(editorMode, jsonText, draftRules),
    [draftRules, editorMode, jsonText],
  );
  const dirty = editorOpen && draftSignature !== baselineSignature;

  return {
    featureUnsupported,
    addDraftRule,
    closeEditor,
    configured: rules.length > 0,
    dirty,
    draftRuleIds,
    draftRules,
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
    removeDraftRule,
    removeRuleDirect,
    ruleCount: rules.length,
    rules,
    saveDraft,
    saving,
    status,
    updateDraftRule,
    updateEditorMode,
    updateJsonText,
  };
}
