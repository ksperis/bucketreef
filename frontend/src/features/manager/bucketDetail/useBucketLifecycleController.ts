/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3ExecutionContextSelector } from "../../../api/accountParams";
import { useBucketDetailsApi } from "../../shared/useBucketDetailsApi";
import {
  deleteCephAdminBucketLifecycle,
  getCephAdminBucketLifecycle,
  putCephAdminBucketLifecycle,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError, isApiFeatureUnsupportedError } from "../../../utils/apiError";
import type { LifecycleRuleRecord } from "../bucketLifecycle";
import {
  bucketEditorDraftSignature,
  cloneBucketJsonValue,
  stableBucketJsonSignature,
} from "./bucketFeatureState";
import { useBucketFeatureEditorSession } from "./useBucketFeatureEditorSession";
import { useEditorRowIds } from "../../../hooks/useEditorRowIds";
import {
  createVisualLifecycleRule,
  parseLifecycleRulesJson,
  validateLifecycleVisualRules,
  updateLifecycleVisualRule,
  type LifecycleVisualRulePatch,
} from "./lifecycleEditorModel";

type UseBucketLifecycleControllerOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName?: string;
  cephAdmin: boolean;
  cephAdminTenant?: string | null;
  enabled: boolean;
  endpointId?: number | null;
};

function normalizeRules(value: unknown): LifecycleRuleRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rule): rule is LifecycleRuleRecord =>
      rule !== null && typeof rule === "object" && !Array.isArray(rule),
  );
}

function parseLifecycleEditorJson(text: string) {
  const parsed = parseLifecycleRulesJson(text);
  return { draft: parsed.rules, error: parsed.error };
}

export function useBucketLifecycleController({
  contextId,
  bucketName,
  cephAdmin,
  cephAdminTenant,
  enabled,
  endpointId,
}: UseBucketLifecycleControllerOptions) {
  const bucketDetailsApi = useBucketDetailsApi();
  const [rules, setRules] = useState<LifecycleRuleRecord[]>([]);
  const {
    appendRowId: appendDraftRuleId,
    insertRowId: insertDraftRuleId,
    removeRowId: removeDraftRuleId,
    resetRowIds: resetDraftRuleIds,
    rowIds: draftRuleIds,
  } = useEditorRowIds("lifecycle-rule");
  const [lastRemovedRule, setLastRemovedRule] = useState<{
    index: number;
    rule: LifecycleRuleRecord;
    uiId?: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [featureUnsupported, setFeatureUnsupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const {
    closeEditor: closeEditorSession,
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
    updateJsonText: updateSessionJsonText,
  } = useBucketFeatureEditorSession<LifecycleRuleRecord[]>({
    initialDraft: [],
    initialJsonText: "[]",
    parseJson: parseLifecycleEditorJson,
  });

  const applyBaseline = useCallback((next: unknown) => {
    setRules(normalizeRules(next));
  }, []);

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
        data = await getCephAdminBucketLifecycle(endpointId, bucketName, cephAdminTenant);
      } else {
        data = await bucketDetailsApi.getBucketLifecycle(contextId, bucketName);
      }
      applyBaseline(data.rules);
    } catch (loadFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(loadFailure));
      applyBaseline([]);
      setLoadError(extractApiError(loadFailure, "Unable to load lifecycle rules."));
    } finally {
      setLoading(false);
    }
  }, [bucketDetailsApi, contextId, applyBaseline, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId, setStatus]);

  const openEditorDraft = useCallback((
    nextDraft: LifecycleRuleRecord[],
    mode: "visual" | "json",
    targetIndex: number | null,
  ) => {
    setLastRemovedRule(null);
    resetDraftRuleIds(nextDraft.length);
    openEditorSessionDraft(nextDraft, mode, targetIndex);
  }, [openEditorSessionDraft, resetDraftRuleIds]);

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
    const nextDraft = [
      ...cloneBucketJsonValue(rules),
      createVisualLifecycleRule(),
    ];
    openEditorDraft(nextDraft, "visual", nextDraft.length - 1);
  }, [openEditorDraft, rules]);

  const closeEditor = useCallback(() => {
    closeEditorSession();
    setLastRemovedRule(null);
  }, [closeEditorSession]);

  const updateJsonText = useCallback((value: string) => {
    updateSessionJsonText(value);
    setLastRemovedRule(null);
  }, [updateSessionJsonText]);

  const updateEditorMode = useCallback(
    (nextMode: "visual" | "json") => {
      const parsedDraft = updateEditorSessionMode(nextMode);
      if (nextMode === "visual" && parsedDraft) {
        setLastRemovedRule(null);
        resetDraftRuleIds(parsedDraft.length);
      }
    },
    [resetDraftRuleIds, updateEditorSessionMode],
  );

  const addDraftRule = useCallback(() => {
    setDraftRules((current) => [
      ...current,
      createVisualLifecycleRule(),
    ]);
    appendDraftRuleId();
    setEditorTargetIndex(null);
    setEditorError(null);
  }, [appendDraftRuleId, setDraftRules, setEditorError, setEditorTargetIndex]);

  const removeDraftRule = useCallback((index: number) => {
    const removedRule = draftRules[index];
    if (!removedRule) return;
    const uiId = draftRuleIds[index];
    setLastRemovedRule({ index, rule: cloneBucketJsonValue([removedRule])[0], uiId });
    setDraftRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
    removeDraftRuleId(index);
    setEditorError(null);
  }, [draftRuleIds, draftRules, removeDraftRuleId, setDraftRules, setEditorError]);

  const restoreLastRemovedRule = useCallback(() => {
    if (!lastRemovedRule) return;
    setDraftRules((current) => {
      const restored = [...current];
      restored.splice(Math.min(lastRemovedRule.index, restored.length), 0, lastRemovedRule.rule);
      return restored;
    });
    insertDraftRuleId(lastRemovedRule.index, lastRemovedRule.uiId);
    setLastRemovedRule(null);
    setEditorError(null);
  }, [insertDraftRuleId, lastRemovedRule, setDraftRules, setEditorError]);

  const updateDraftRule = useCallback((index: number, patch: LifecycleVisualRulePatch) => {
    setDraftRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? updateLifecycleVisualRule(rule, patch) : rule,
      ),
    );
    setEditorError(null);
  }, [setDraftRules, setEditorError]);

  const persistRules = useCallback(async (nextRules: LifecycleRuleRecord[]) => {
    if (!bucketName || !enabled || (cephAdmin && !endpointId)) return null;
    if (nextRules.length === 0) {
      if (cephAdmin) {
        await deleteCephAdminBucketLifecycle(endpointId as number, bucketName, cephAdminTenant);
      } else {
        await bucketDetailsApi.deleteBucketLifecycle(contextId, bucketName);
      }
      return [];
    }
    const saved = cephAdmin
      ? await putCephAdminBucketLifecycle(endpointId as number, bucketName, nextRules, cephAdminTenant)
      : await bucketDetailsApi.putBucketLifecycle(contextId, bucketName, nextRules);
    return normalizeRules(saved.rules ?? nextRules);
  }, [bucketDetailsApi, contextId, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const persistDirectRules = useCallback(async (
    nextRules: LifecycleRuleRecord[],
    successMessage: string,
  ) => {
    if (saving) return;
    setSaving(true);
    setLoadError(null);
    setStatus(null);
    try {
      const savedRules = await persistRules(nextRules);
      if (savedRules === null) return;
      applyBaseline(savedRules);
      setStatus(successMessage);
    } catch (mutationFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(mutationFailure));
      setLoadError(extractApiError(mutationFailure, "Unable to update lifecycle rules."));
    } finally {
      setSaving(false);
    }
  }, [applyBaseline, persistRules, saving, setStatus]);

  const removeRuleDirect = useCallback((index: number) => {
    void persistDirectRules(
      rules.filter((_, ruleIndex) => ruleIndex !== index),
      "Lifecycle rule removed",
    );
  }, [persistDirectRules, rules]);

  const setRuleEnabled = useCallback((index: number, checked: boolean) => {
    void persistDirectRules(
      rules.map((rule, ruleIndex) =>
        ruleIndex === index
          ? { ...rule, Status: checked ? "Enabled" : "Disabled" }
          : rule,
      ),
      `Lifecycle rule ${checked ? "enabled" : "disabled"}`,
    );
  }, [persistDirectRules, rules]);

  const saveDraft = useCallback(async () => {
    if (!bucketName || !enabled || saving) return;
    let nextRules = draftRules;
    if (editorMode === "json") {
      const parsed = parseLifecycleRulesJson(jsonText);
      if (!parsed.rules) {
        setEditorError(parsed.error);
        return;
      }
      nextRules = parsed.rules;
      setDraftRules(parsed.rules);
      resetDraftRuleIds(parsed.rules.length);
    }

    const validationError = validateLifecycleVisualRules(nextRules);
    if (validationError) {
      setEditorError(validationError);
      return;
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
      setStatus(savedRules.length === 0 ? "Lifecycle deleted" : "Lifecycle updated");
      closeEditor();
    } catch (saveFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(saveFailure));
      setEditorError(extractApiError(saveFailure, "Invalid or unsaved lifecycle."));
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
    dirty,
    draftRuleIds,
    draftRules,
    draftSignature,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    error: loadError,
    hasRules: rules.length > 0,
    jsonText,
    lastRemovedRule,
    load,
    loading,
    openEditor,
    openEditorFor,
    openEditorWithNew,
    openJsonEditor,
    removeDraftRule,
    removeRuleDirect,
    restoreLastRemovedRule,
    ruleCount: rules.length,
    rules,
    saveDraft,
    saving,
    status,
    setRuleEnabled,
    updateDraftRule,
    updateEditorMode,
    updateJsonText,
  };
}
