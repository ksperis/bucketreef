/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3ExecutionContextSelector } from "../../../api/accountParams";
import { useBucketDetailsApi } from "../../shared/useBucketDetailsApi";
import {
  deleteCephAdminBucketReplication,
  getCephAdminBucketReplication,
  putCephAdminBucketReplication,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError, isApiFeatureUnsupportedError } from "../../../utils/apiError";
import { createUiDraftId } from "../../../utils/uiDraftId";
import {
  containsUnsupportedReplicationZone,
  isReplicationConfigurationConfigured,
  validateGraphicalReplication,
  validateJsonReplicationConfiguration,
} from "../bucketReplication";
import {
  bucketEditorDraftSignature,
  stableBucketJsonSignature,
} from "./bucketFeatureState";
import { useBucketFeatureEditorSession } from "./useBucketFeatureEditorSession";
import {
  cloneReplicationConfiguration,
  createReplicationVisualRule,
  hasAdvancedReplicationTopLevelFields,
  isReplicationRuleVisuallyEditable,
  normalizeReplicationEditorConfiguration,
  parseReplicationEditorJson,
  readReplicationVisualRule,
  replicationConfigurationRole,
  replicationConfigurationRules,
  updateReplicationVisualRule,
  type ReplicationVisualRulePatch,
} from "./replicationEditorModel";

type UseBucketReplicationControllerOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName?: string;
  cephAdmin: boolean;
  cephAdminTenant?: string | null;
  enabled: boolean;
  endpointId?: number | null;
};

function createRuleIds(configuration: Record<string, unknown>): string[] {
  return replicationConfigurationRules(configuration).map(() =>
    createUiDraftId("replication-rule"),
  );
}

function parseReplicationEditorSessionJson(text: string) {
  const parsed = parseReplicationEditorJson(text);
  return { draft: parsed.configuration, error: parsed.error };
}

function validateEditableRules(
  configuration: Record<string, unknown>,
): string | null {
  const rules = replicationConfigurationRules(configuration);
  if (rules.length === 0) return null;

  const role = replicationConfigurationRole(configuration);
  if (!role.trim()) return "Role is required.";

  for (let index = 0; index < rules.length; index += 1) {
    const rawRule = rules[index];
    if (!isReplicationRuleVisuallyEditable(rawRule)) continue;
    const validationError = validateGraphicalReplication(role, [
      readReplicationVisualRule(rawRule),
    ]);
    if (validationError) {
      return validationError.replace(/^Rule 1:/, `Rule ${index + 1}:`);
    }
  }
  return null;
}

export function useBucketReplicationController({
  contextId,
  bucketName,
  cephAdmin,
  cephAdminTenant,
  enabled,
  endpointId,
}: UseBucketReplicationControllerOptions) {
  const bucketDetailsApi = useBucketDetailsApi();
  const [configuration, setConfiguration] = useState<Record<string, unknown>>({});
  const [draftRuleIds, setDraftRuleIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [featureUnsupported, setFeatureUnsupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const {
    closeEditor,
    draft: draftConfiguration,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    jsonText,
    openEditorDraft: openEditorSessionDraft,
    replaceDraft,
    setDraft: setDraftConfiguration,
    setEditorError,
    setEditorTargetIndex,
    setStatus,
    status,
    updateEditorMode: updateEditorSessionMode,
    updateJsonText,
  } = useBucketFeatureEditorSession<Record<string, unknown>>({
    initialDraft: {},
    initialJsonText: "{}",
    parseJson: parseReplicationEditorSessionJson,
  });

  const applyBaseline = useCallback((next: unknown) => {
    setConfiguration(normalizeReplicationEditorConfiguration(next));
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
          ? await getCephAdminBucketReplication(endpointId, bucketName, cephAdminTenant)
          : { configuration: {} }
        : await bucketDetailsApi.getBucketReplication(contextId, bucketName);
      applyBaseline(data.configuration);
    } catch (loadFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(loadFailure));
      applyBaseline({});
      setLoadError(
        extractApiError(
          loadFailure,
          "Unable to load bucket replication configuration.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [bucketDetailsApi, contextId, applyBaseline, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const openEditorDraft = useCallback((
    nextDraft: Record<string, unknown>,
    mode: "visual" | "json",
    targetIndex: number | null,
  ) => {
    setDraftRuleIds(createRuleIds(nextDraft));
    openEditorSessionDraft(nextDraft, mode, targetIndex);
  }, [openEditorSessionDraft]);

  const openEditor = useCallback(() => {
    openEditorDraft(cloneReplicationConfiguration(configuration), "visual", null);
  }, [configuration, openEditorDraft]);

  const openEditorFor = useCallback((index: number) => {
    openEditorDraft(cloneReplicationConfiguration(configuration), "visual", index);
  }, [configuration, openEditorDraft]);

  const openJsonEditor = useCallback(() => {
    openEditorDraft(cloneReplicationConfiguration(configuration), "json", null);
  }, [configuration, openEditorDraft]);

  const openEditorWithNew = useCallback(() => {
    const nextDraft = cloneReplicationConfiguration(configuration);
    const nextRules = [
      ...replicationConfigurationRules(nextDraft),
      createReplicationVisualRule(),
    ];
    nextDraft.Rules = nextRules;
    openEditorDraft(nextDraft, "visual", nextRules.length - 1);
  }, [configuration, openEditorDraft]);

  const updateEditorMode = useCallback(
    (nextMode: "visual" | "json") => {
      const parsedDraft = updateEditorSessionMode(nextMode);
      if (nextMode === "visual" && parsedDraft) {
        setDraftRuleIds(createRuleIds(parsedDraft));
      }
    },
    [updateEditorSessionMode],
  );

  const updateRole = useCallback((value: string) => {
    setDraftConfiguration((current) => ({ ...current, Role: value }));
    setEditorError(null);
  }, []);

  const updateRule = useCallback(
    (uiId: string, patch: ReplicationVisualRulePatch) => {
      const index = draftRuleIds.indexOf(uiId);
      if (index < 0) return;
      setDraftConfiguration((current) => {
        const rules = replicationConfigurationRules(current);
        return {
          ...current,
          Rules: rules.map((rule, ruleIndex) =>
            ruleIndex === index
              ? updateReplicationVisualRule(rule, patch)
              : rule,
          ),
        };
      });
      setEditorError(null);
    },
    [draftRuleIds],
  );

  const addRule = useCallback(() => {
    setDraftConfiguration((current) => ({
      ...current,
      Rules: [
        ...replicationConfigurationRules(current),
        createReplicationVisualRule(),
      ],
    }));
    setDraftRuleIds((current) => [
      ...current,
      createUiDraftId("replication-rule"),
    ]);
    setEditorTargetIndex(null);
    setEditorError(null);
  }, []);

  const removeRule = useCallback(
    (uiId: string) => {
      const index = draftRuleIds.indexOf(uiId);
      if (index < 0) return;
      setDraftConfiguration((current) => ({
        ...current,
        Rules: replicationConfigurationRules(current).filter(
          (_, ruleIndex) => ruleIndex !== index,
        ),
      }));
      setDraftRuleIds((current) =>
        current.filter((_, ruleIndex) => ruleIndex !== index),
      );
      setEditorError(null);
    },
    [draftRuleIds],
  );

  const persistConfiguration = useCallback(async (nextConfiguration: Record<string, unknown>) => {
    if (!bucketName || !enabled || (cephAdmin && !endpointId)) return null;
    const nextRules = replicationConfigurationRules(nextConfiguration);
    if (nextRules.length === 0) {
      if (cephAdmin) {
        await deleteCephAdminBucketReplication(endpointId as number, bucketName, cephAdminTenant);
      } else {
        await bucketDetailsApi.deleteBucketReplication(contextId, bucketName);
      }
      return {};
    }
    const saved = cephAdmin
      ? await putCephAdminBucketReplication(endpointId as number, bucketName, nextConfiguration, cephAdminTenant)
      : await bucketDetailsApi.putBucketReplication(contextId, bucketName, nextConfiguration);
    return normalizeReplicationEditorConfiguration(saved.configuration ?? nextConfiguration);
  }, [bucketDetailsApi, contextId, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const persistDirectConfiguration = useCallback(async (
    nextConfiguration: Record<string, unknown>,
    successMessage: string,
  ) => {
    if (saving) return;
    setSaving(true);
    setLoadError(null);
    setStatus(null);
    try {
      const savedConfiguration = await persistConfiguration(nextConfiguration);
      if (savedConfiguration === null) return;
      applyBaseline(savedConfiguration);
      setStatus(successMessage);
    } catch (mutationFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(mutationFailure));
      setLoadError(extractApiError(mutationFailure, "Unable to update bucket replication configuration."));
    } finally {
      setSaving(false);
    }
  }, [applyBaseline, persistConfiguration, saving]);

  const removeRuleDirect = useCallback((index: number) => {
    const nextConfiguration = cloneReplicationConfiguration(configuration);
    nextConfiguration.Rules = replicationConfigurationRules(nextConfiguration).filter(
      (_, ruleIndex) => ruleIndex !== index,
    );
    void persistDirectConfiguration(nextConfiguration, "Replication rule removed.");
  }, [configuration, persistDirectConfiguration]);

  const setRuleEnabled = useCallback((index: number, checked: boolean) => {
    const nextConfiguration = cloneReplicationConfiguration(configuration);
    nextConfiguration.Rules = replicationConfigurationRules(nextConfiguration).map(
      (rule, ruleIndex) =>
        ruleIndex === index && isReplicationRuleVisuallyEditable(rule)
          ? updateReplicationVisualRule(rule, { status: checked ? "Enabled" : "Disabled" })
          : rule,
    );
    void persistDirectConfiguration(
      nextConfiguration,
      `Replication rule ${checked ? "enabled" : "disabled"}.`,
    );
  }, [configuration, persistDirectConfiguration]);

  const saveDraft = useCallback(async () => {
    if (!bucketName || !enabled || saving || (cephAdmin && !endpointId)) return;

    let nextConfiguration = draftConfiguration;
    if (editorMode === "json") {
      const parsed = parseReplicationEditorJson(jsonText);
      if (!parsed.configuration) {
        setEditorError(parsed.error);
        return;
      }
      nextConfiguration = parsed.configuration;
      setDraftConfiguration(parsed.configuration);
      setDraftRuleIds(createRuleIds(parsed.configuration));
    }

    const nextRules = replicationConfigurationRules(nextConfiguration);
    if (nextRules.length > 0) {
      const jsonValidationError = validateJsonReplicationConfiguration(
        nextConfiguration,
      );
      if (jsonValidationError) {
        setEditorError(jsonValidationError);
        return;
      }
      const visualValidationError = validateEditableRules(nextConfiguration);
      if (visualValidationError) {
        setEditorError(visualValidationError);
        return;
      }
    }

    setSaving(true);
    setEditorError(null);
    setStatus(null);
    try {
      const savedConfiguration = await persistConfiguration(nextConfiguration);
      if (savedConfiguration === null) return;
      applyBaseline(savedConfiguration);
      replaceDraft(cloneReplicationConfiguration(savedConfiguration));
      setDraftRuleIds(createRuleIds(savedConfiguration));
      setStatus(replicationConfigurationRules(savedConfiguration).length === 0
        ? "Replication configuration cleared."
        : "Replication configuration updated.");
      closeEditor();
    } catch (saveFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(saveFailure));
      setEditorError(
        extractApiError(
          saveFailure,
          "Unable to update bucket replication configuration.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [
    applyBaseline,
    bucketName,
    cephAdmin,
    draftConfiguration,
    editorMode,
    enabled,
    endpointId,
    jsonText,
    persistConfiguration,
    replaceDraft,
    saving,
    closeEditor,
  ]);

  const summaryRules = replicationConfigurationRules(configuration);
  const draftRules = replicationConfigurationRules(draftConfiguration);
  const rules = useMemo(
    () =>
      draftRules.map((rule, index) => ({
        uiId: draftRuleIds[index] ?? `replication-rule-${index}`,
        rule,
      })),
    [draftRuleIds, draftRules],
  );
  const baselineSignature = stableBucketJsonSignature(configuration);
  const draftSignature = useMemo(
    () => bucketEditorDraftSignature(editorMode, jsonText, draftConfiguration, {}),
    [draftConfiguration, editorMode, jsonText],
  );
  const parsedJson =
    editorMode === "json"
      ? parseReplicationEditorJson(jsonText).configuration
      : null;
  const warningConfiguration = parsedJson ?? draftConfiguration;
  const advancedRuleCount = replicationConfigurationRules(
    warningConfiguration,
  ).filter((rule) => !isReplicationRuleVisuallyEditable(rule)).length;

  return {
    featureUnsupported,
    addRule,
    advancedRuleCount,
    busy: loading || saving,
    closeEditor,
    configured: isReplicationConfigurationConfigured(configuration),
    dirty: editorOpen && draftSignature !== baselineSignature,
    draftSignature,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    error: loadError,
    hasAdvancedTopLevelFields:
      hasAdvancedReplicationTopLevelFields(warningConfiguration),
    hasUnsupportedZone: containsUnsupportedReplicationZone(warningConfiguration),
    jsonText,
    load,
    loading,
    openEditor,
    openEditorFor,
    openEditorWithNew,
    openJsonEditor,
    removeRule,
    removeRuleDirect,
    role: replicationConfigurationRole(draftConfiguration),
    ruleCount: summaryRules.length,
    rules,
    saveDraft,
    saving,
    setRuleEnabled,
    status,
    summaryRole: replicationConfigurationRole(configuration),
    summaryRules,
    updateEditorMode,
    updateJsonText,
    updateRole,
    updateRule,
  };
}
