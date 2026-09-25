/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketReplication,
  getBucketReplication,
  putBucketReplication,
} from "../../../api/bucketDetails";
import {
  deleteCephAdminBucketReplication,
  getCephAdminBucketReplication,
  putCephAdminBucketReplication,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import { createUiDraftId } from "../../../utils/uiDraftId";
import {
  containsUnsupportedReplicationZone,
  isReplicationConfigurationConfigured,
  validateGraphicalReplication,
  validateJsonReplicationConfiguration,
} from "../bucketReplication";
import type { BucketFeatureEditorMode } from "./BucketFeatureEditorDialog";
import {
  jsonTextSignature,
  stableBucketJsonSignature,
} from "./bucketFeatureState";
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
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

function configurationText(configuration: Record<string, unknown>): string {
  return JSON.stringify(configuration, null, 2);
}

function createRuleIds(configuration: Record<string, unknown>): string[] {
  return replicationConfigurationRules(configuration).map(() =>
    createUiDraftId("replication-rule"),
  );
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
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketReplicationControllerOptions) {
  const [configuration, setConfiguration] = useState<Record<string, unknown>>({});
  const [draftConfiguration, setDraftConfiguration] = useState<Record<string, unknown>>({});
  const [draftRuleIds, setDraftRuleIds] = useState<string[]>([]);
  const [jsonText, setJsonText] = useState("{}");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<BucketFeatureEditorMode>("visual");
  const [editorTargetIndex, setEditorTargetIndex] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setLoadError(null);
    setStatus(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketReplication(endpointId, bucketName)
          : { configuration: {} }
        : await getBucketReplication(accountId, bucketName);
      applyBaseline(data.configuration);
    } catch (loadFailure) {
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
  }, [accountId, applyBaseline, bucketName, cephAdmin, enabled, endpointId]);

  const openEditorDraft = useCallback((
    nextDraft: Record<string, unknown>,
    mode: BucketFeatureEditorMode,
    targetIndex: number | null,
  ) => {
    setDraftConfiguration(nextDraft);
    setDraftRuleIds(createRuleIds(nextDraft));
    setJsonText(configurationText(nextDraft));
    setEditorMode(mode);
    setEditorTargetIndex(targetIndex);
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, []);

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
        setJsonText(configurationText(draftConfiguration));
        setEditorMode("json");
        return;
      }

      const parsed = parseReplicationEditorJson(jsonText);
      if (!parsed.configuration) {
        setEditorError(parsed.error);
        return;
      }
      setDraftConfiguration(parsed.configuration);
      setDraftRuleIds(createRuleIds(parsed.configuration));
      setEditorTargetIndex(null);
      setEditorMode("visual");
    },
    [draftConfiguration, editorMode, jsonText],
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
        await deleteCephAdminBucketReplication(endpointId as number, bucketName);
      } else {
        await deleteBucketReplication(accountId, bucketName);
      }
      return {};
    }
    const saved = cephAdmin
      ? await putCephAdminBucketReplication(endpointId as number, bucketName, nextConfiguration)
      : await putBucketReplication(accountId, bucketName, nextConfiguration);
    return normalizeReplicationEditorConfiguration(saved.configuration ?? nextConfiguration);
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

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
      setDraftConfiguration(cloneReplicationConfiguration(savedConfiguration));
      setDraftRuleIds(createRuleIds(savedConfiguration));
      setJsonText(configurationText(savedConfiguration));
      setStatus(replicationConfigurationRules(savedConfiguration).length === 0
        ? "Replication configuration cleared."
        : "Replication configuration updated.");
      setEditorTargetIndex(null);
      setEditorOpen(false);
    } catch (saveFailure) {
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
    saving,
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
    () =>
      editorMode === "json"
        ? jsonTextSignature(jsonText, {}).signature
        : stableBucketJsonSignature(draftConfiguration),
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
