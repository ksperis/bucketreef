/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3ExecutionContextSelector } from "../../../api/accountParams";
import { useBucketDetailsApi } from "../../shared/useBucketDetailsApi";
import {
  deleteCephAdminBucketEncryption,
  getCephAdminBucketEncryption,
  putCephAdminBucketEncryption,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError, isApiFeatureUnsupportedError } from "../../../utils/apiError";
import {
  bucketEditorDraftSignature,
  cloneBucketJsonValue,
  stableBucketJsonSignature,
} from "./bucketFeatureState";
import { useBucketFeatureEditorSession } from "./useBucketFeatureEditorSession";
import {
  createVisualEncryptionRule,
  parseEncryptionRulesJson,
  updateEncryptionVisualRule,
  validateVisualEncryptionRules,
  type EncryptionRuleRecord,
  type EncryptionVisualRulePatch,
} from "./encryptionEditorModel";

type UseBucketEncryptionControllerOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName?: string;
  cephAdmin: boolean;
  cephAdminTenant?: string | null;
  enabled: boolean;
  endpointId?: number | null;
};

function normalizeRules(value: unknown): EncryptionRuleRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rule): rule is EncryptionRuleRecord =>
      rule !== null && typeof rule === "object" && !Array.isArray(rule),
  );
}

function parseEncryptionEditorJson(text: string) {
  const parsed = parseEncryptionRulesJson(text);
  return { draft: parsed.rules, error: parsed.error };
}

export function useBucketEncryptionController({
  contextId,
  bucketName,
  cephAdmin,
  cephAdminTenant,
  enabled,
  endpointId,
}: UseBucketEncryptionControllerOptions) {
  const bucketDetailsApi = useBucketDetailsApi();
  const [rules, setRules] = useState<EncryptionRuleRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [featureUnsupported, setFeatureUnsupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const {
    closeEditor,
    draft: draftRules,
    editorError,
    editorMode,
    editorOpen,
    jsonText,
    openEditorDraft,
    replaceDraft,
    setDraft: setDraftRules,
    setEditorError,
    setEditorOpen,
    setStatus,
    status,
    updateEditorMode,
    updateJsonText,
  } = useBucketFeatureEditorSession<EncryptionRuleRecord[]>({
    initialDraft: [],
    initialJsonText: "[]",
    parseJson: parseEncryptionEditorJson,
  });

  const applyBaseline = useCallback((next: unknown) => {
    setRules(normalizeRules(next));
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      applyBaseline([]);
      setLoadError(null);
      setStatus(null);
      setEditorOpen(false);
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
        data = await getCephAdminBucketEncryption(endpointId, bucketName, cephAdminTenant);
      } else {
        data = await bucketDetailsApi.getBucketEncryption(contextId, bucketName);
      }
      applyBaseline(data.rules);
    } catch (loadFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(loadFailure));
      applyBaseline([]);
      setLoadError(
        extractApiError(
          loadFailure,
          "Unable to load bucket encryption settings.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [bucketDetailsApi, contextId, applyBaseline, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId, setEditorOpen, setStatus]);

  const openEditor = useCallback(() => {
    if (!enabled) return;
    openEditorDraft(cloneBucketJsonValue(rules), "visual", null);
  }, [enabled, openEditorDraft, rules]);

  const addDraftRule = useCallback(() => {
    setDraftRules((current) => [...current, createVisualEncryptionRule()]);
    setEditorError(null);
  }, [setDraftRules, setEditorError]);

  const removeDraftRule = useCallback((index: number) => {
    setDraftRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
    setEditorError(null);
  }, [setDraftRules, setEditorError]);

  const updateDraftRule = useCallback(
    (index: number, patch: EncryptionVisualRulePatch) => {
      setDraftRules((current) =>
        current.map((rule, ruleIndex) =>
          ruleIndex === index ? updateEncryptionVisualRule(rule, patch) : rule,
        ),
      );
      setEditorError(null);
    },
    [setDraftRules, setEditorError],
  );

  const saveDraft = useCallback(async () => {
    if (!bucketName || !enabled || saving) return;

    let nextRules = draftRules;
    if (editorMode === "json") {
      const parsed = parseEncryptionRulesJson(jsonText);
      if (!parsed.rules) {
        setEditorError(parsed.error);
        return;
      }
      nextRules = parsed.rules;
      setDraftRules(parsed.rules);
    } else {
      const validationError = validateVisualEncryptionRules(nextRules);
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
          await deleteCephAdminBucketEncryption(endpointId, bucketName, cephAdminTenant);
        } else {
          await bucketDetailsApi.deleteBucketEncryption(contextId, bucketName);
        }
        applyBaseline([]);
        replaceDraft([]);
        setStatus("Bucket encryption disabled.");
      } else {
        let saved;
        if (cephAdmin) {
          if (!endpointId) return;
          saved = await putCephAdminBucketEncryption(endpointId, bucketName, nextRules, cephAdminTenant);
        } else {
          saved = await bucketDetailsApi.putBucketEncryption(contextId, bucketName, nextRules);
        }
        const savedRules = normalizeRules(saved.rules ?? nextRules);
        applyBaseline(savedRules);
        replaceDraft(cloneBucketJsonValue(savedRules));
        setStatus("Bucket encryption updated.");
      }
      closeEditor();
    } catch (saveFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(saveFailure));
      setEditorError(
        extractApiError(saveFailure, "Unable to update bucket encryption settings."),
      );
    } finally {
      setSaving(false);
    }
  }, [bucketDetailsApi,
    contextId,
    applyBaseline,
    bucketName,
    cephAdmin,
    cephAdminTenant,
    draftRules,
    editorMode,
    enabled,
    endpointId,
    jsonText,
    replaceDraft,
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
