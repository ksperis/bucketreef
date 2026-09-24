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

  const openEditor = useCallback(() => {
    const nextDraft = cloneRules(rules);
    setDraftRules(nextDraft);
    setJsonText(rulesText(nextDraft));
    setEditorMode("visual");
    setLastRemovedRule(null);
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, [rules]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
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
      setLastRemovedRule(null);
      setEditorMode("visual");
    },
    [draftRules, editorMode, jsonText],
  );

  const addDraftRule = useCallback(() => {
    setDraftRules((current) => [...current, createVisualLifecycleRule(createRuleId())]);
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
      if (nextRules.length === 0) {
        if (cephAdmin) {
          if (!endpointId) return;
          await deleteCephAdminBucketLifecycle(endpointId, bucketName);
        } else {
          await deleteBucketLifecycle(accountId, bucketName);
        }
        applyBaseline([]);
        setStatus("Lifecycle deleted");
      } else {
        let saved;
        if (cephAdmin) {
          if (!endpointId) return;
          saved = await putCephAdminBucketLifecycle(endpointId, bucketName, nextRules);
        } else {
          saved = await putBucketLifecycle(accountId, bucketName, nextRules);
        }
        const savedRules = normalizeRules(saved.rules ?? nextRules);
        applyBaseline(savedRules);
        setDraftRules(cloneRules(savedRules));
        setJsonText(rulesText(savedRules));
        setStatus("Lifecycle updated");
      }
      setLastRemovedRule(null);
      setEditorOpen(false);
    } catch (saveFailure) {
      setEditorError(extractApiError(saveFailure, "Invalid or unsaved lifecycle."));
    } finally {
      setSaving(false);
    }
  }, [
    accountId,
    applyBaseline,
    bucketName,
    cephAdmin,
    draftRules,
    editorMode,
    enabled,
    endpointId,
    jsonText,
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
    error: loadError,
    hasRules: rules.length > 0,
    jsonText,
    lastRemovedRule,
    load,
    loading,
    openEditor,
    removeDraftRule,
    restoreLastRemovedRule,
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
