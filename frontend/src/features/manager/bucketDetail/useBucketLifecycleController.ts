/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketLifecycle,
  getBucketLifecycle,
  putBucketLifecycle,
} from "../../../api/bucketDetails";
import {
  deleteCephAdminBucketLifecycle,
  getCephAdminBucketLifecycle,
  putCephAdminBucketLifecycle,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import type { LifecycleRuleRecord } from "../bucketLifecycle";
import { jsonTextSignature, stableBucketJsonSignature } from "./bucketFeatureState";
import type { BucketFeatureEditorMode } from "./BucketFeatureEditorDialog";
import {
  createVisualLifecycleRule,
  parseLifecycleRulesJson,
  validateLifecycleVisualRules,
  updateLifecycleVisualRule,
  type LifecycleVisualRulePatch,
} from "./lifecycleEditorModel";

type UseBucketLifecycleControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

function createRuleId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return `rule-${crypto.randomUUID()}`;
    } catch {
      // Fall back to a local random identifier when randomUUID is unavailable.
    }
  }
  return `rule-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRules(value: unknown): LifecycleRuleRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rule): rule is LifecycleRuleRecord =>
      rule !== null && typeof rule === "object" && !Array.isArray(rule),
  );
}

function cloneRules(rules: LifecycleRuleRecord[]): LifecycleRuleRecord[] {
  return JSON.parse(JSON.stringify(rules)) as LifecycleRuleRecord[];
}

function rulesText(rules: LifecycleRuleRecord[]): string {
  return JSON.stringify(rules, null, 2);
}

export function useBucketLifecycleController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketLifecycleControllerOptions) {
  const [rules, setRules] = useState<LifecycleRuleRecord[]>([]);
  const [draftRules, setDraftRules] = useState<LifecycleRuleRecord[]>([]);
  const [jsonText, setJsonText] = useState("[]");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<BucketFeatureEditorMode>("visual");
  const [editorTargetIndex, setEditorTargetIndex] = useState<number | null>(null);
  const [lastRemovedRule, setLastRemovedRule] = useState<{
    index: number;
    rule: LifecycleRuleRecord;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setLoadError(null);
    setStatus(null);
    try {
      let data;
      if (cephAdmin) {
        if (!endpointId) {
          applyBaseline([]);
          return;
        }
        data = await getCephAdminBucketLifecycle(endpointId, bucketName);
      } else {
        data = await getBucketLifecycle(accountId, bucketName);
      }
      applyBaseline(data.rules);
    } catch (loadFailure) {
      applyBaseline([]);
      setLoadError(extractApiError(loadFailure, "Unable to load lifecycle rules."));
    } finally {
      setLoading(false);
    }
  }, [accountId, applyBaseline, bucketName, cephAdmin, enabled, endpointId]);

  const openEditorDraft = useCallback((
    nextDraft: LifecycleRuleRecord[],
    mode: BucketFeatureEditorMode,
    targetIndex: number | null,
  ) => {
    setDraftRules(nextDraft);
    setJsonText(rulesText(nextDraft));
    setEditorMode(mode);
    setEditorTargetIndex(targetIndex);
    setLastRemovedRule(null);
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, []);

  const openEditor = useCallback(() => {
    openEditorDraft(cloneRules(rules), "visual", null);
  }, [openEditorDraft, rules]);

  const openEditorFor = useCallback((index: number) => {
    openEditorDraft(cloneRules(rules), "visual", index);
  }, [openEditorDraft, rules]);

  const openJsonEditor = useCallback(() => {
    openEditorDraft(cloneRules(rules), "json", null);
  }, [openEditorDraft, rules]);

  const openEditorWithNew = useCallback(() => {
    const nextDraft = [
      ...cloneRules(rules),
      createVisualLifecycleRule(createRuleId()),
    ];
    openEditorDraft(nextDraft, "visual", nextDraft.length - 1);
  }, [openEditorDraft, rules]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorTargetIndex(null);
    setEditorError(null);
    setLastRemovedRule(null);
  }, []);

  const updateJsonText = useCallback((value: string) => {
    setJsonText(value);
    setEditorError(null);
    setLastRemovedRule(null);
  }, []);

  const updateEditorMode = useCallback(
    (nextMode: BucketFeatureEditorMode) => {
      if (nextMode === editorMode) return;
      setEditorError(null);
      if (nextMode === "json") {
        setJsonText(rulesText(draftRules));
        setEditorMode("json");
        return;
      }
      const parsed = parseLifecycleRulesJson(jsonText);
      if (!parsed.rules) {
        setEditorError(parsed.error);
        return;
      }
      setDraftRules(parsed.rules);
      setEditorTargetIndex(null);
      setLastRemovedRule(null);
      setEditorMode("visual");
    },
    [draftRules, editorMode, jsonText],
  );

  const addDraftRule = useCallback(() => {
    setDraftRules((current) => [...current, createVisualLifecycleRule(createRuleId())]);
    setEditorTargetIndex(null);
    setEditorError(null);
  }, []);

  const removeDraftRule = useCallback((index: number) => {
    const removedRule = draftRules[index];
    if (!removedRule) return;
    setLastRemovedRule({ index, rule: cloneRules([removedRule])[0] });
    setDraftRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
    setEditorError(null);
  }, [draftRules]);

  const restoreLastRemovedRule = useCallback(() => {
    if (!lastRemovedRule) return;
    setDraftRules((current) => {
      const restored = [...current];
      restored.splice(Math.min(lastRemovedRule.index, restored.length), 0, lastRemovedRule.rule);
      return restored;
    });
    setLastRemovedRule(null);
    setEditorError(null);
  }, [lastRemovedRule]);

  const updateDraftRule = useCallback((index: number, patch: LifecycleVisualRulePatch) => {
    setDraftRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? updateLifecycleVisualRule(rule, patch) : rule,
      ),
    );
    setEditorError(null);
  }, []);

  const persistRules = useCallback(async (nextRules: LifecycleRuleRecord[]) => {
    if (!bucketName || !enabled || (cephAdmin && !endpointId)) return null;
    if (nextRules.length === 0) {
      if (cephAdmin) {
        await deleteCephAdminBucketLifecycle(endpointId as number, bucketName);
      } else {
        await deleteBucketLifecycle(accountId, bucketName);
      }
      return [];
    }
    const saved = cephAdmin
      ? await putCephAdminBucketLifecycle(endpointId as number, bucketName, nextRules)
      : await putBucketLifecycle(accountId, bucketName, nextRules);
    return normalizeRules(saved.rules ?? nextRules);
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

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
      setLoadError(extractApiError(mutationFailure, "Unable to update lifecycle rules."));
    } finally {
      setSaving(false);
    }
  }, [applyBaseline, persistRules, saving]);

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
      setDraftRules(cloneRules(savedRules));
      setJsonText(rulesText(savedRules));
      setStatus(savedRules.length === 0 ? "Lifecycle deleted" : "Lifecycle updated");
      setLastRemovedRule(null);
      setEditorTargetIndex(null);
      setEditorOpen(false);
    } catch (saveFailure) {
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
    saving,
  ]);

  const baselineSignature = stableBucketJsonSignature(rules);
  const draftSignature = useMemo(
    () =>
      editorMode === "json"
        ? jsonTextSignature(jsonText, draftRules).signature
        : stableBucketJsonSignature(draftRules),
    [draftRules, editorMode, jsonText],
  );
  const dirty = editorOpen && draftSignature !== baselineSignature;

  return {
    addDraftRule,
    closeEditor,
    dirty,
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
