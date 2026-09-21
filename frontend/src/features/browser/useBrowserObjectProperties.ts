/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchObjectMetadata,
  getObjectTags,
  updateObjectMetadata,
  updateObjectTags,
} from "../../api/browserObjects";
import type {
  ObjectMetadata,
  ObjectMetadataUpdate,
  ObjectTag,
  ObjectTags,
} from "../../api/browserContracts";
import { extractApiError } from "../../utils/apiError";
import { prepareS3Tags } from "../../utils/s3Tags";
import { formatLocalDateTime, toIsoString } from "./browserUtils";
import { normalizeObjectDetailPairs } from "./browserObjectDetailsModel";
import { runBrowserScopedSave } from "./browserScopedSave";
import type { BrowserItem } from "./browserTypes";

export type BrowserObjectMetadataDraft = {
  contentType: string;
  cacheControl: string;
  contentDisposition: string;
  contentEncoding: string;
  contentLanguage: string;
  expires: string;
};

export type BrowserObjectPropertyEntry = ObjectTag & { id: string };
export type BrowserObjectPropertyEntryField = "key" | "value";
type PropertySection = "metadata" | "tags" | "storageClass";
export type BrowserObjectDirtySections = Record<PropertySection, boolean>;
type SavedDraft = { section: PropertySection; signature: string };

type UseBrowserObjectPropertiesOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  isDeleted: boolean;
  item: BrowserItem;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64?: string | null;
};

const emptyMetadataDraft = (): BrowserObjectMetadataDraft => ({
  contentType: "",
  cacheControl: "",
  contentDisposition: "",
  contentEncoding: "",
  contentLanguage: "",
  expires: "",
});

const metadataDraftFromResponse = (metadata: ObjectMetadata): BrowserObjectMetadataDraft => ({
  contentType: metadata.content_type ?? "",
  cacheControl: metadata.cache_control ?? "",
  contentDisposition: metadata.content_disposition ?? "",
  contentEncoding: metadata.content_encoding ?? "",
  contentLanguage: metadata.content_language ?? "",
  expires: formatLocalDateTime(metadata.expires),
});

const draftSignatures = ({
  metadataDraft,
  metadataItems,
  storageClass,
  tags,
}: {
  metadataDraft: BrowserObjectMetadataDraft;
  metadataItems: Array<Pick<ObjectTag, "key" | "value">>;
  storageClass: string;
  tags: Array<Pick<ObjectTag, "key" | "value">>;
}): Record<PropertySection, string> => ({
    metadata: JSON.stringify({
      metadataDraft,
      metadataItems: metadataItems.map(({ key, value }) => ({ key, value })),
    }),
    storageClass,
    tags: JSON.stringify(tags.map(({ key, value }) => ({ key, value }))),
  });

export function useBrowserObjectProperties({
  accountId,
  bucketName,
  isDeleted,
  item,
  requestOptions,
  sseCustomerKeyBase64,
}: UseBrowserObjectPropertiesOptions) {
  const scope = JSON.stringify([
    accountId,
    bucketName,
    isDeleted,
    item.key,
    item.type,
    requestOptions?.workspaceSurface ?? null,
    sseCustomerKeyBase64 ?? null,
  ]);
  const [metadata, setMetadata] = useState<ObjectMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagsVersionId, setTagsVersionId] = useState<string | null>(null);
  const [metadataDraft, setMetadataDraft] = useState(emptyMetadataDraft);
  const [metadataItems, setMetadataItems] = useState<
    BrowserObjectPropertyEntry[]
  >([]);
  const [tagsDraft, setTagsDraft] = useState<BrowserObjectPropertyEntry[]>([]);
  const [storageClass, setStorageClass] = useState("");
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [savingStorageClass, setSavingStorageClass] = useState(false);
  const [baselineSignatures, setBaselineSignatures] = useState<Record<PropertySection, string> | null>(null);
  const currentSignatures = useMemo(() => draftSignatures({
    metadataDraft, metadataItems, storageClass, tags: tagsDraft,
  }), [metadataDraft, metadataItems, storageClass, tagsDraft]);
  const draftStateRef = useRef({ baselineSignatures, currentSignatures });
  draftStateRef.current = { baselineSignatures, currentSignatures };
  const acceptedDraftRef = useRef<SavedDraft | null>(null);
  const activeSaveRef = useRef<symbol | null>(null);
  const tagIdRef = useRef(0);
  const metadataIdRef = useRef(0);
  const loadingRef = useRef(false);
  const loadedRef = useRef(false);
  const readFailedRef = useRef(false);
  const requestIdRef = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const nextTagId = useCallback(() => {
    tagIdRef.current += 1;
    return `tag-${tagIdRef.current}`;
  }, []);

  const nextMetadataId = useCallback(() => {
    metadataIdRef.current += 1;
    return `meta-${metadataIdRef.current}`;
  }, []);

  const updateMetadataDraft = useCallback(
    (field: keyof BrowserObjectMetadataDraft, value: string) => {
      setMetadataDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const addMetadataItem = useCallback(() => {
    setMetadataItems((current) => [
      ...current,
      { id: nextMetadataId(), key: "", value: "" },
    ]);
  }, [nextMetadataId]);

  const updateMetadataItem = useCallback(
    (
      id: string,
      field: BrowserObjectPropertyEntryField,
      value: string,
    ) => {
      setMetadataItems((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, [field]: value } : entry,
        ),
      );
    },
    [],
  );

  const removeMetadataItem = useCallback((id: string) => {
    setMetadataItems((current) =>
      current.filter((entry) => entry.id !== id),
    );
  }, []);

  const addTag = useCallback(() => {
    setTagsDraft((current) => [
      ...current,
      { id: nextTagId(), key: "", value: "" },
    ]);
  }, [nextTagId]);

  const updateTag = useCallback(
    (
      id: string,
      field: BrowserObjectPropertyEntryField,
      value: string,
    ) => {
      setTagsDraft((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, [field]: value } : entry,
        ),
      );
    },
    [],
  );

  const removeTag = useCallback((id: string) => {
    setTagsDraft((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const resetPropertiesDrafts = useCallback(
    (nextMetadata: ObjectMetadata | null, baseItem: BrowserItem,
      preserve: { metadata?: boolean; storageClass?: boolean } = {}) => {
      if (!nextMetadata) {
        setMetadataDraft(emptyMetadataDraft());
        setMetadataItems([]);
        setStorageClass(baseItem.storageClass ?? "");
        return;
      }
      if (!preserve.metadata) {
        setMetadataDraft(metadataDraftFromResponse(nextMetadata));
        setMetadataItems(
          Object.entries(nextMetadata.metadata || {}).map(([key, value]) => ({
            id: nextMetadataId(), key, value,
          })),
        );
      }
      if (!preserve.storageClass) {
        setStorageClass(nextMetadata.storage_class ?? baseItem.storageClass ?? "");
      }
    },
    [nextMetadataId],
  );

  const resetTagsDraft = useCallback(
    (nextTags: ObjectTag[]) => {
      setTagsDraft(
        nextTags.map((tag) => ({
          id: nextTagId(),
          key: tag.key,
          value: tag.value,
        })),
      );
    },
    [nextTagId],
  );

  const reset = useCallback(
    (baseItem: BrowserItem) => {
      requestIdRef.current += 1;
      loadingRef.current = false;
      loadedRef.current = false;
      readFailedRef.current = false;
      setMetadata(null);
      setLoading(false);
      setLoaded(false);
      setError(null);
      setTagsVersionId(null);
      setSavingMetadata(false);
      setSavingTags(false);
      setSavingStorageClass(false);
      setBaselineSignatures(null);
      acceptedDraftRef.current = null;
      activeSaveRef.current = null;
      resetPropertiesDrafts(null, baseItem);
      resetTagsDraft([]);
    },
    [resetPropertiesDrafts, resetTagsDraft],
  );

  const isCurrentScope = useCallback(
    () => scope === scopeRef.current,
    [scope],
  );

  const load = useCallback(
    async (force = false, acceptedDraft?: SavedDraft) => {
      if (scope !== scopeRef.current) return;
      if (!accountId || !bucketName || item.type !== "file" || isDeleted) {
        return;
      }
      if (!force && (loadingRef.current || loadedRef.current || readFailedRef.current)) return;
      if (acceptedDraft) acceptedDraftRef.current = acceptedDraft;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const [nextMetadata, nextTags] = await Promise.all([
          fetchObjectMetadata(
            accountId,
            bucketName,
            item.key,
            null,
            sseCustomerKeyBase64,
            undefined,
            requestOptions,
          ),
          getObjectTags(
            accountId,
            bucketName,
            item.key,
            null,
            requestOptions,
          ),
        ]);
        if (requestId !== requestIdRef.current) return;
        setMetadata(nextMetadata);
        setTagsVersionId(nextTags.version_id ?? null);
        const draftState = draftStateRef.current;
        const accepted = acceptedDraftRef.current;
        // A refresh advances the remote baseline, never an unrelated dirty draft.
        // Only the exact submitted section can be accepted after a successful write.
        const preserve = (section: PropertySection) => Boolean(
          draftState.baselineSignatures &&
          draftState.currentSignatures[section] !== draftState.baselineSignatures[section] &&
          !(accepted?.section === section && accepted.signature === draftState.currentSignatures[section]),
        );
        resetPropertiesDrafts(nextMetadata, item, {
          metadata: preserve("metadata"), storageClass: preserve("storageClass"),
        });
        if (!preserve("tags")) resetTagsDraft(nextTags.tags ?? []);
        setBaselineSignatures(
          draftSignatures({
            metadataDraft: metadataDraftFromResponse(nextMetadata),
            metadataItems: Object.entries(nextMetadata.metadata || {}).map(
              ([key, value]) => ({ key, value }),
            ),
            storageClass:
              nextMetadata.storage_class ?? item.storageClass ?? "",
            tags: nextTags.tags ?? [],
          }),
        );
        acceptedDraftRef.current = null;
        loadedRef.current = true;
        readFailedRef.current = false;
        setLoaded(true);
        return true;
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return;
        setError(
          extractApiError(loadError, "Unable to load object details."),
        );
        // Keep the last known values and dirty guard, but require a successful
        // retry before a mutation can reuse a potentially stale VersionId.
        loadedRef.current = false;
        readFailedRef.current = true;
        setLoaded(false);
        return false;
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [
      accountId,
      bucketName,
      isDeleted,
      item,
      requestOptions,
      resetPropertiesDrafts,
      resetTagsDraft,
      scope,
      sseCustomerKeyBase64,
    ],
  );

  const runSectionSave = useCallback(async <T,>(
    section: PropertySection,
    signature: string,
    setSaving: (value: boolean) => void,
    operation: () => Promise<T>,
  ): Promise<T | null> => {
    if (!isCurrentScope() || !loadedRef.current || loadingRef.current || activeSaveRef.current) return null;
    const operationId = Symbol(section);
    activeSaveRef.current = operationId;
    const ownsOperation = () => isCurrentScope() && activeSaveRef.current === operationId;
    try {
      return await runBrowserScopedSave(ownsOperation, setSaving, async () => {
        const value = await operation();
        if (!ownsOperation()) return null;
        const refreshed = await load(true, { section, signature });
        return refreshed ? value : null;
      });
    } finally {
      if (activeSaveRef.current === operationId) activeSaveRef.current = null;
    }
  }, [isCurrentScope, load]);

  const saveMetadata = useCallback(async () => {
    if (!isCurrentScope() || !accountId || !bucketName || !item.key) {
      return false;
    }
    return (
      (await runSectionSave("metadata", currentSignatures.metadata, setSavingMetadata, async () => {
        const payload: ObjectMetadataUpdate = {
          key: item.key,
          version_id: metadata?.version_id ?? tagsVersionId ?? null,
          content_type: metadataDraft.contentType,
          cache_control: metadataDraft.cacheControl,
          content_disposition: metadataDraft.contentDisposition,
          content_encoding: metadataDraft.contentEncoding,
          content_language: metadataDraft.contentLanguage,
          expires: toIsoString(metadataDraft.expires),
          metadata: normalizeObjectDetailPairs(metadataItems),
        };
        await updateObjectMetadata(
          accountId,
          bucketName,
          payload,
          undefined,
          requestOptions,
        );
        return true;
      })) ?? false
    );
  }, [
    accountId,
    bucketName,
    isCurrentScope,
    item.key,
    runSectionSave,
    currentSignatures.metadata,
    metadata?.version_id,
    metadataDraft,
    metadataItems,
    requestOptions,
    tagsVersionId,
  ]);

  const saveTags = useCallback(async () => {
    if (!isCurrentScope() || !accountId || !bucketName || !item.key) {
      return false;
    }
    return (
      (await runSectionSave("tags", currentSignatures.tags, setSavingTags, async () => {
        await updateObjectTags(
          accountId,
          bucketName,
          {
            key: item.key,
            version_id: metadata?.version_id ?? tagsVersionId ?? null,
            tags: prepareS3Tags(tagsDraft),
          } satisfies ObjectTags,
          undefined,
          requestOptions,
        );
        return true;
      })) ?? false
    );
  }, [
    accountId,
    bucketName,
    isCurrentScope,
    item.key,
    runSectionSave,
    currentSignatures.tags,
    metadata?.version_id,
    requestOptions,
    tagsDraft,
    tagsVersionId,
  ]);

  const saveStorageClass = useCallback(async () => {
    if (
      !isCurrentScope() ||
      !accountId ||
      !bucketName ||
      !item.key ||
      !storageClass
    ) {
      return null;
    }
    return runSectionSave("storageClass", currentSignatures.storageClass, setSavingStorageClass, async () => {
      await updateObjectMetadata(
        accountId,
        bucketName,
        {
          key: item.key,
          version_id: metadata?.version_id ?? tagsVersionId ?? null,
          storage_class: storageClass,
        },
        undefined,
        requestOptions,
      );
      return storageClass;
    });
  }, [
    accountId,
    bucketName,
    isCurrentScope,
    item.key,
    runSectionSave,
    currentSignatures.storageClass,
    metadata?.version_id,
    requestOptions,
    storageClass,
    tagsVersionId,
  ]);

  const dirtySections: BrowserObjectDirtySections = {
    metadata: baselineSignatures !== null && baselineSignatures.metadata !== currentSignatures.metadata,
    tags: baselineSignatures !== null && baselineSignatures.tags !== currentSignatures.tags,
    storageClass: baselineSignatures !== null && baselineSignatures.storageClass !== currentSignatures.storageClass,
  };
  const hasUnsavedChanges = Object.values(dirtySections).some(Boolean);

  return {
    metadata,
    loading,
    loaded,
    error,
    versionId: metadata?.version_id ?? tagsVersionId ?? undefined,
    metadataDraft,
    updateMetadataDraft,
    metadataItems,
    addMetadataItem,
    updateMetadataItem,
    removeMetadataItem,
    tagsDraft,
    addTag,
    updateTag,
    removeTag,
    storageClass,
    setStorageClass,
    savingMetadata,
    savingTags,
    savingStorageClass,
    hasUnsavedChanges,
    dirtySections,
    load,
    reset,
    isCurrentScope,
    saveMetadata,
    saveTags,
    saveStorageClass,
  };
}
