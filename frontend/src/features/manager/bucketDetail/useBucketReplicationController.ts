/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { BucketDetailControllerOptions } from "./bucketDetailControllerOptions";
import { useBucketDetailsApi } from "../../shared/useBucketDetailsApi";
import {
  deleteCephAdminBucketReplication,
  getCephAdminBucketReplication,
  putCephAdminBucketReplication,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError, isApiFeatureUnsupportedError } from "../../../utils/apiError";
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
import { useEditorRowIds } from "../../../hooks/useEditorRowIds";
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
}: BucketDetailControllerOptions) {
  const bucketDetailsApi = useBucketDetailsApi();
  const [configuration, setConfiguration] = useState<Record<string, unknown>>({});
  const {
    appendRowId: appendDraftRuleId,
    removeRowId: removeDraftRuleId,
    resetRowIds: resetDraftRuleIds,
    rowIds: draftRuleIds,
  } = useEditorRowIds("replication-rule");
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
  }, [bucketDetailsApi, contextId, applyBaseline, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId, setStatus]);

  const openEditorDraft = useCallback((
    nextDraft: Record<string, unknown>,
    mode: "visual" | "json",
    targetIndex: number | null,
  ) => {
    resetDraftRuleIds(replicationConfigurationRules(nextDraft).length);
    openEditorSessionDraft(nextDraft, mode, targetIndex);
  }, [openEditorSessionDraft, resetDraftRuleIds]);

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
        resetDraftRuleIds(replicationConfigurationRules(parsedDraft).length);
      }
    },
    [resetDraftRuleIds, updateEditorSessionMode],
  );

  const updateRole = useCallback((value: string) => {
    setDraftConfiguration((current) => ({ ...current, Role: value }));
    setEditorError(null);
  }, [setDraftConfiguration, setEditorError]);

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
    [draftRuleIds, setDraftConfiguration, setEditorError],
  );

  const addRule = useCallback(() => {
    setDraftConfiguration((current) => ({
      ...current,
      Rules: [
        ...replicationConfigurationRules(current),
        createReplicationVisualRule(),
      ],
    }));
    appendDraftRuleId();
    setEditorTargetIndex(null);
    setEditorError(null);
  }, [appendDraftRuleId, setDraftConfiguration, setEditorError, setEditorTargetIndex]);

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
      removeDraftRuleId(index);
      setEditorError(null);
    },
    [draftRuleIds, removeDraftRuleId, setDraftConfiguration, setEditorError],
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
  }, [applyBaseline, persistConfiguration, saving, setStatus]);

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
      resetDraftRuleIds(replicationConfigurationRules(parsed.configuration).length);
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
      resetDraftRuleIds(replicationConfigurationRules(savedConfiguration).length);
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
    resetDraftRuleIds,
    saving,
    closeEditor,
    setDraftConfiguration,
    setEditorError,
    setStatus,
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
