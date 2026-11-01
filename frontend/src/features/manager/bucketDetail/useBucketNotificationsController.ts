/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3ExecutionContextSelector } from "../../../api/accountParams";
import { useBucketDetailsApi } from "../../shared/useBucketDetailsApi";
import {
  deleteCephAdminBucketNotifications,
  getCephAdminBucketNotifications,
  putCephAdminBucketNotifications,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError, isApiFeatureUnsupportedError } from "../../../utils/apiError";
import { createUiDraftId } from "../../../utils/uiDraftId";
import type { BucketFeatureEditorMode } from "./BucketFeatureEditorDialog";
import {
  cloneBucketJsonValue,
  formatBucketJsonValue,
  jsonTextSignature,
  normalizeNotificationConfiguration,
  stableBucketJsonSignature,
} from "./bucketFeatureState";
import {
  addNotificationTopic,
  createVisualNotificationTopic,
  hasAdvancedNotificationConfiguration,
  hasAdvancedNotificationTopLevel,
  notificationTopicConfigurations,
  parseNotificationConfigurationJson,
  removeNotificationTopicAt,
  updateNotificationTopicAt,
  validateNotificationVisualConfiguration,
  type NotificationConfigurationRecord,
  type NotificationVisualTopicPatch,
} from "./notificationEditorModel";

type UseBucketNotificationsControllerOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName?: string;
  cephAdmin: boolean;
  cephAdminTenant?: string | null;
  enabled: boolean;
  endpointId?: number | null;
};

function asConfiguration(value: unknown): NotificationConfigurationRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as NotificationConfigurationRecord;
}

function isEmptyConfiguration(configuration: NotificationConfigurationRecord): boolean {
  return Object.keys(normalizeNotificationConfiguration(configuration)).length === 0;
}

export function useBucketNotificationsController({
  contextId,
  bucketName,
  cephAdmin,
  cephAdminTenant,
  enabled,
  endpointId,
}: UseBucketNotificationsControllerOptions) {
  const bucketDetailsApi = useBucketDetailsApi();
  const [configuration, setConfiguration] = useState<NotificationConfigurationRecord>({});
  const [draftConfiguration, setDraftConfiguration] = useState<NotificationConfigurationRecord>({});
  const [jsonText, setJsonText] = useState("{}");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<BucketFeatureEditorMode>("visual");
  const [editorTargetIndex, setEditorTargetIndex] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [featureUnsupported, setFeatureUnsupported] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyBaseline = useCallback((value: unknown) => {
    setConfiguration(cloneBucketJsonValue(asConfiguration(value)));
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
          ? await getCephAdminBucketNotifications(endpointId, bucketName, cephAdminTenant)
          : { configuration: {} }
        : await bucketDetailsApi.getBucketNotifications(contextId, bucketName);
      applyBaseline(data.configuration);
    } catch (loadFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(loadFailure));
      applyBaseline({});
      setLoadError(
        extractApiError(loadFailure, "Unable to load bucket notifications."),
      );
    } finally {
      setLoading(false);
    }
  }, [bucketDetailsApi, contextId, applyBaseline, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const openEditorDraft = useCallback((
    nextDraft: NotificationConfigurationRecord,
    mode: BucketFeatureEditorMode,
    targetIndex: number | null,
  ) => {
    setDraftConfiguration(nextDraft);
    setJsonText(formatBucketJsonValue(nextDraft));
    setEditorMode(mode);
    setEditorTargetIndex(targetIndex);
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, []);

  const openEditor = useCallback(() => {
    openEditorDraft(cloneBucketJsonValue(configuration), "visual", null);
  }, [configuration, openEditorDraft]);

  const openEditorFor = useCallback((index: number) => {
    openEditorDraft(cloneBucketJsonValue(configuration), "visual", index);
  }, [configuration, openEditorDraft]);

  const openJsonEditor = useCallback(() => {
    openEditorDraft(cloneBucketJsonValue(configuration), "json", null);
  }, [configuration, openEditorDraft]);

  const openEditorWithNew = useCallback(() => {
    const nextDraft = addNotificationTopic(
      cloneBucketJsonValue(configuration),
      createVisualNotificationTopic(createUiDraftId("notification")),
    );
    const nextTopics = notificationTopicConfigurations(nextDraft);
    openEditorDraft(nextDraft, "visual", nextTopics.length - 1);
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
        setJsonText(formatBucketJsonValue(draftConfiguration));
        setEditorMode("json");
        return;
      }
      const parsed = parseNotificationConfigurationJson(jsonText);
      if (!parsed.configuration) {
        setEditorError(parsed.error);
        return;
      }
      setDraftConfiguration(parsed.configuration);
      setEditorTargetIndex(null);
      setEditorMode("visual");
    },
    [draftConfiguration, editorMode, jsonText],
  );

  const addDraftTopic = useCallback(() => {
    setDraftConfiguration((current) =>
      addNotificationTopic(
        current,
        createVisualNotificationTopic(createUiDraftId("notification")),
      ),
    );
    setEditorTargetIndex(null);
    setEditorError(null);
  }, []);

  const removeDraftTopic = useCallback((index: number) => {
    setDraftConfiguration((current) => removeNotificationTopicAt(current, index));
    setEditorError(null);
  }, []);

  const updateDraftTopic = useCallback(
    (index: number, patch: NotificationVisualTopicPatch) => {
      setDraftConfiguration((current) => updateNotificationTopicAt(current, index, patch));
      setEditorError(null);
    },
    [],
  );

  const persistConfiguration = useCallback(async (
    nextConfiguration: NotificationConfigurationRecord,
  ) => {
    if (!bucketName || !enabled || (cephAdmin && !endpointId)) return null;
    if (isEmptyConfiguration(nextConfiguration)) {
      if (cephAdmin) {
        await deleteCephAdminBucketNotifications(endpointId as number, bucketName, cephAdminTenant);
      } else {
        await bucketDetailsApi.deleteBucketNotifications(contextId, bucketName);
      }
      return {};
    }
    const saved = cephAdmin
      ? await putCephAdminBucketNotifications(endpointId as number, bucketName, nextConfiguration, cephAdminTenant)
      : await bucketDetailsApi.putBucketNotifications(contextId, bucketName, nextConfiguration);
    return cloneBucketJsonValue(asConfiguration(saved.configuration ?? nextConfiguration));
  }, [bucketDetailsApi, contextId, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const removeTopicDirect = useCallback(async (index: number) => {
    if (saving) return;
    setSaving(true);
    setLoadError(null);
    setStatus(null);
    try {
      const nextConfiguration = removeNotificationTopicAt(
        cloneBucketJsonValue(configuration),
        index,
      );
      const savedConfiguration = await persistConfiguration(nextConfiguration);
      if (savedConfiguration === null) return;
      applyBaseline(savedConfiguration);
      setStatus(isEmptyConfiguration(savedConfiguration) ? "Notifications cleared." : "Notification removed.");
    } catch (removeFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(removeFailure));
      setLoadError(extractApiError(removeFailure, "Unable to update bucket notifications."));
    } finally {
      setSaving(false);
    }
  }, [applyBaseline, configuration, persistConfiguration, saving]);

  const saveDraft = useCallback(async () => {
    if (!bucketName || !enabled || saving) return;
    let nextConfiguration = draftConfiguration;
    if (editorMode === "json") {
      const parsed = parseNotificationConfigurationJson(jsonText);
      if (!parsed.configuration) {
        setEditorError(parsed.error);
        return;
      }
      nextConfiguration = parsed.configuration;
      setDraftConfiguration(parsed.configuration);
    } else {
      const validationError = validateNotificationVisualConfiguration(nextConfiguration);
      if (validationError) {
        setEditorError(validationError);
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
      setDraftConfiguration(savedConfiguration);
      setJsonText(formatBucketJsonValue(savedConfiguration));
      setStatus(isEmptyConfiguration(savedConfiguration) ? "Notifications cleared." : "Notifications updated.");
      setEditorTargetIndex(null);
      setEditorOpen(false);
    } catch (saveFailure) {
      setFeatureUnsupported(isApiFeatureUnsupportedError(saveFailure));
      setEditorError(
        extractApiError(saveFailure, "Unable to update bucket notifications."),
      );
    } finally {
      setSaving(false);
    }
  }, [
    applyBaseline,
    bucketName,
    draftConfiguration,
    editorMode,
    enabled,
    jsonText,
    persistConfiguration,
    saving,
  ]);

  const configured = !isEmptyConfiguration(configuration);
  const topics = useMemo(
    () => notificationTopicConfigurations(configuration),
    [configuration],
  );
  const draftTopics = useMemo(
    () => notificationTopicConfigurations(draftConfiguration),
    [draftConfiguration],
  );
  const baselineSignature = stableBucketJsonSignature(configuration);
  const draftSignature = useMemo(
    () =>
      editorMode === "json"
        ? jsonTextSignature(jsonText, draftConfiguration).signature
        : stableBucketJsonSignature(draftConfiguration),
    [draftConfiguration, editorMode, jsonText],
  );
  const dirty = editorOpen && draftSignature !== baselineSignature;

  return {
    featureUnsupported,
    addDraftTopic,
    closeEditor,
    configuration,
    configured,
    dirty,
    draftConfiguration,
    draftSignature,
    draftTopics,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    error: loadError,
    hasAdvancedConfiguration: hasAdvancedNotificationConfiguration(configuration),
    hasAdvancedDraftTopLevel: hasAdvancedNotificationTopLevel(draftConfiguration),
    jsonText,
    load,
    loading,
    openEditor,
    openEditorFor,
    openEditorWithNew,
    openJsonEditor,
    removeDraftTopic,
    removeTopicDirect,
    saveDraft,
    saving,
    status,
    topicCount: topics.length,
    topics,
    updateDraftTopic,
    updateEditorMode,
    updateJsonText,
  };
}
