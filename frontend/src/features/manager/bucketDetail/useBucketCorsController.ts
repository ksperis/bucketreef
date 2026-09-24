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

  const openEditor = useCallback(() => {
    const nextDraft = cloneRules(rules);
    setDraftRules(nextDraft);
    setJsonText(rulesText(nextDraft));
    setEditorMode("visual");
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, [rules]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
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
      setEditorMode("visual");
    },
    [draftRules, editorMode, jsonText],
  );

  const addDraftRule = useCallback(() => {
    setDraftRules((current) => [...current, createVisualCorsRule()]);
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
      if (nextRules.length === 0) {
        if (cephAdmin) {
          if (!endpointId) return;
          await deleteCephAdminBucketCors(endpointId, bucketName);
        } else {
          await deleteBucketCors(accountId, bucketName);
        }
        applyBaseline([]);
        setStatus("CORS configuration deleted");
      } else {
        let saved;
        if (cephAdmin) {
          if (!endpointId) return;
          saved = await putCephAdminBucketCors(endpointId, bucketName, nextRules);
        } else {
          saved = await putBucketCors(accountId, bucketName, nextRules);
        }
        const savedRules = normalizeRules(saved.rules ?? nextRules);
        applyBaseline(savedRules);
        setDraftRules(cloneRules(savedRules));
        setJsonText(rulesText(savedRules));
        setStatus("CORS configuration updated");
      }
      setEditorOpen(false);
    } catch (saveFailure) {
      setEditorError(
        extractApiError(saveFailure, "Unable to update the CORS configuration."),
      );
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
    configured: rules.length > 0,
    dirty,
    draftRules,
    draftSignature,
    editorError,
    editorMode,
    editorOpen,
    error: loadError,
    jsonText,
    load,
    loading,
    openEditor,
    removeDraftRule,
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
