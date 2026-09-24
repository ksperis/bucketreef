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

  const openEditor = useCallback(() => {
    const nextDraft = cloneConfiguration(configuration);
    setDraftConfiguration(nextDraft);
    setJsonText(configurationText(nextDraft));
    setEditorMode("visual");
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, [configuration]);

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
      if (isEmptyConfiguration(nextConfiguration)) {
        if (cephAdmin) {
          if (!endpointId) return;
          await deleteCephAdminBucketNotifications(endpointId, bucketName);
        } else {
          await deleteBucketNotifications(accountId, bucketName);
        }
        applyBaseline({});
        setDraftConfiguration({});
        setJsonText("{}");
        setStatus("Notifications cleared.");
      } else {
        const saved = cephAdmin
          ? endpointId
            ? await putCephAdminBucketNotifications(
                endpointId,
                bucketName,
                nextConfiguration,
              )
            : { configuration: nextConfiguration }
          : await putBucketNotifications(accountId, bucketName, nextConfiguration);
        const savedConfiguration = cloneConfiguration(
          asConfiguration(saved.configuration ?? nextConfiguration),
        );
        applyBaseline(savedConfiguration);
        setDraftConfiguration(savedConfiguration);
        setJsonText(configurationText(savedConfiguration));
        setStatus("Notifications updated.");
      }
      setEditorOpen(false);
    } catch (saveFailure) {
      setEditorError(
        extractApiError(saveFailure, "Unable to update bucket notifications."),
      );
    } finally {
      setSaving(false);
    }
  }, [
    accountId,
    applyBaseline,
    bucketName,
    cephAdmin,
    draftConfiguration,
    editorMode,
    enabled,
    endpointId,
    jsonText,
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
    error: loadError,
    hasAdvancedConfiguration: hasAdvancedNotificationConfiguration(configuration),
    hasAdvancedDraftTopLevel: hasAdvancedNotificationTopLevel(draftConfiguration),
    jsonText,
    load,
    loading,
    openEditor,
    removeDraftTopic,
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
