/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketCors,
  getBucketCors,
  putBucketCors,
} from "../../../api/bucketDetails";
import {
  deleteCephAdminBucketCors,
  getCephAdminBucketCors,
  putCephAdminBucketCors,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import { jsonTextSignature, stableBucketJsonSignature } from "./bucketFeatureState";
import type { BucketFeatureEditorMode } from "./BucketFeatureEditorDialog";
import {
  createVisualCorsRule,
  parseCorsRulesJson,
  updateCorsVisualRule,
  validateVisualCorsRules,
  type CorsRuleRecord,
  type CorsVisualRulePatch,
} from "./corsEditorModel";

type UseBucketCorsControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

function normalizeRules(value: unknown): CorsRuleRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rule): rule is CorsRuleRecord =>
      rule !== null && typeof rule === "object" && !Array.isArray(rule),
  );
}

function cloneRules(rules: CorsRuleRecord[]): CorsRuleRecord[] {
  return JSON.parse(JSON.stringify(rules)) as CorsRuleRecord[];
}

function rulesText(rules: CorsRuleRecord[]): string {
  return JSON.stringify(rules, null, 2);
}

export function useBucketCorsController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketCorsControllerOptions) {
  const [rules, setRules] = useState<CorsRuleRecord[]>([]);
  const [draftRules, setDraftRules] = useState<CorsRuleRecord[]>([]);
  const [jsonText, setJsonText] = useState("[]");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<BucketFeatureEditorMode>("visual");
  const [editorTargetIndex, setEditorTargetIndex] = useState<number | null>(null);
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
        data = await getCephAdminBucketCors(endpointId, bucketName);
      } else {
        data = await getBucketCors(accountId, bucketName);
      }
      applyBaseline(data.rules);
    } catch (loadFailure) {
      applyBaseline([]);
      setLoadError(
        extractApiError(loadFailure, "Unable to load the CORS configuration."),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, applyBaseline, bucketName, cephAdmin, enabled, endpointId]);

  const openEditorDraft = useCallback((
    nextDraft: CorsRuleRecord[],
    mode: BucketFeatureEditorMode,
    targetIndex: number | null,
  ) => {
    setDraftRules(nextDraft);
    setJsonText(rulesText(nextDraft));
    setEditorMode(mode);
    setEditorTargetIndex(targetIndex);
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
    const nextDraft = [...cloneRules(rules), createVisualCorsRule()];
    openEditorDraft(nextDraft, "visual", nextDraft.length - 1);
  }, [openEditorDraft, rules]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorTargetIndex(null);
    setEditorError(null);
  }, []);

  const updateJsonText = useCallback((value: string) => {
    setJsonText(value);
    setEditorError(null);
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
      const parsed = parseCorsRulesJson(jsonText);
      if (!parsed.rules) {
        setEditorError(parsed.error);
        return;
      }
      setDraftRules(parsed.rules);
      setEditorTargetIndex(null);
      setEditorMode("visual");
    },
    [draftRules, editorMode, jsonText],
  );

  const addDraftRule = useCallback(() => {
    setDraftRules((current) => [...current, createVisualCorsRule()]);
    setEditorTargetIndex(null);
    setEditorError(null);
  }, []);

  const removeDraftRule = useCallback((index: number) => {
    setDraftRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
    setEditorError(null);
  }, []);

  const updateDraftRule = useCallback((index: number, patch: CorsVisualRulePatch) => {
    setDraftRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? updateCorsVisualRule(rule, patch) : rule,
      ),
    );
    setEditorError(null);
  }, []);

  const persistRules = useCallback(async (nextRules: CorsRuleRecord[]) => {
    if (!bucketName || !enabled || (cephAdmin && !endpointId)) return null;
    if (nextRules.length === 0) {
      if (cephAdmin) {
        await deleteCephAdminBucketCors(endpointId as number, bucketName);
      } else {
        await deleteBucketCors(accountId, bucketName);
      }
      return [];
    }
    const saved = cephAdmin
      ? await putCephAdminBucketCors(endpointId as number, bucketName, nextRules)
      : await putBucketCors(accountId, bucketName, nextRules);
    return normalizeRules(saved.rules ?? nextRules);
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

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
      setLoadError(extractApiError(removeFailure, "Unable to update the CORS configuration."));
    } finally {
      setSaving(false);
    }
  }, [applyBaseline, persistRules, rules, saving]);

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
      setDraftRules(cloneRules(savedRules));
      setJsonText(rulesText(savedRules));
      setStatus(savedRules.length === 0 ? "CORS configuration deleted" : "CORS configuration updated");
      setEditorTargetIndex(null);
      setEditorOpen(false);
    } catch (saveFailure) {
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
    configured: rules.length > 0,
    dirty,
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
