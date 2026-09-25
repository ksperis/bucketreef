/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketNotifications,
  getBucketNotifications,
  putBucketNotifications,
} from "../../../api/bucketDetails";
import {
  deleteCephAdminBucketNotifications,
  getCephAdminBucketNotifications,
  putCephAdminBucketNotifications,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import type { BucketFeatureEditorMode } from "./BucketFeatureEditorDialog";
import {
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
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

function createNotificationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return `notification-${crypto.randomUUID()}`;
    } catch {
      // Fall through when randomUUID is not available in the runtime.
    }
  }
  return `notification-${Math.random().toString(36).slice(2, 10)}`;
}

function asConfiguration(value: unknown): NotificationConfigurationRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as NotificationConfigurationRecord;
}

function cloneConfiguration(
  configuration: NotificationConfigurationRecord,
): NotificationConfigurationRecord {
  return JSON.parse(JSON.stringify(configuration)) as NotificationConfigurationRecord;
}

function configurationText(configuration: NotificationConfigurationRecord): string {
  return JSON.stringify(configuration, null, 2);
}

function isEmptyConfiguration(configuration: NotificationConfigurationRecord): boolean {
  return Object.keys(normalizeNotificationConfiguration(configuration)).length === 0;
}

export function useBucketNotificationsController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketNotificationsControllerOptions) {
  const [configuration, setConfiguration] = useState<NotificationConfigurationRecord>({});
  const [draftConfiguration, setDraftConfiguration] = useState<NotificationConfigurationRecord>({});
  const [jsonText, setJsonText] = useState("{}");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<BucketFeatureEditorMode>("visual");
  const [editorTargetIndex, setEditorTargetIndex] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyBaseline = useCallback((value: unknown) => {
    setConfiguration(cloneConfiguration(asConfiguration(value)));
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
          ? await getCephAdminBucketNotifications(endpointId, bucketName)
          : { configuration: {} }
        : await getBucketNotifications(accountId, bucketName);
      applyBaseline(data.configuration ?? {});
    } catch (loadFailure) {
      applyBaseline({});
      setLoadError(
        extractApiError(loadFailure, "Unable to load bucket notifications."),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, applyBaseline, bucketName, cephAdmin, enabled, endpointId]);

  const openEditorDraft = useCallback((
    nextDraft: NotificationConfigurationRecord,
    mode: BucketFeatureEditorMode,
    targetIndex: number | null,
  ) => {
    setDraftConfiguration(nextDraft);
    setJsonText(configurationText(nextDraft));
    setEditorMode(mode);
    setEditorTargetIndex(targetIndex);
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, []);

  const openEditor = useCallback(() => {
    openEditorDraft(cloneConfiguration(configuration), "visual", null);
  }, [configuration, openEditorDraft]);

  const openEditorFor = useCallback((index: number) => {
    openEditorDraft(cloneConfiguration(configuration), "visual", index);
  }, [configuration, openEditorDraft]);

  const openJsonEditor = useCallback(() => {
    openEditorDraft(cloneConfiguration(configuration), "json", null);
  }, [configuration, openEditorDraft]);

  const openEditorWithNew = useCallback(() => {
    const nextDraft = addNotificationTopic(
      cloneConfiguration(configuration),
      createVisualNotificationTopic(createNotificationId()),
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
        setJsonText(configurationText(draftConfiguration));
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
        createVisualNotificationTopic(createNotificationId()),
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
        await deleteCephAdminBucketNotifications(endpointId as number, bucketName);
      } else {
        await deleteBucketNotifications(accountId, bucketName);
      }
      return {};
    }
    const saved = cephAdmin
      ? await putCephAdminBucketNotifications(endpointId as number, bucketName, nextConfiguration)
      : await putBucketNotifications(accountId, bucketName, nextConfiguration);
    return cloneConfiguration(asConfiguration(saved.configuration ?? nextConfiguration));
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

  const removeTopicDirect = useCallback(async (index: number) => {
    if (saving) return;
    setSaving(true);
    setLoadError(null);
    setStatus(null);
    try {
      const nextConfiguration = removeNotificationTopicAt(
        cloneConfiguration(configuration),
        index,
      );
      const savedConfiguration = await persistConfiguration(nextConfiguration);
      if (savedConfiguration === null) return;
      applyBaseline(savedConfiguration);
      setStatus(isEmptyConfiguration(savedConfiguration) ? "Notifications cleared." : "Notification removed.");
    } catch (removeFailure) {
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
      setJsonText(configurationText(savedConfiguration));
      setStatus(isEmptyConfiguration(savedConfiguration) ? "Notifications cleared." : "Notifications updated.");
      setEditorTargetIndex(null);
      setEditorOpen(false);
    } catch (saveFailure) {
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
