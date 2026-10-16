/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { createFolder } from "../../api/browserObjects";
import { useBrowserI18n } from "./browserI18n";

type CreatedFolder = {
  name: string;
  prefix: string;
};

type UseBrowserCreateFolderOptions = {
  contextIdForApi: S3ExecutionContextSelector;
  bucketName: string;
  hasContext: boolean;
  parentPrefix: string;
  requestOptions?: BrowserRequestOptions;
  onCreated: (folder: CreatedFolder) => Promise<void> | void;
};

export function useBrowserCreateFolder({
  contextIdForApi,
  bucketName,
  hasContext,
  parentPrefix,
  requestOptions,
  onCreated,
}: UseBrowserCreateFolderOptions) {
  const { text } = useBrowserI18n();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setName("");
    setError(null);
  }, []);

  const open = useCallback(() => {
    if (!bucketName || !hasContext) return;
    reset();
    setLoading(false);
    setShowModal(true);
  }, [bucketName, hasContext, reset]);

  const close = useCallback(() => {
    if (loading) return;
    setShowModal(false);
    reset();
  }, [loading, reset]);

  const submit = async () => {
    if (!bucketName || !hasContext || loading) return;
    const normalizedName = name.replace(/^\/+|\/+$/g, "");
    if (!normalizedName) {
      setError(text("Folder name is required."));
      return;
    }
    const folderPrefix = `${parentPrefix}${normalizedName}/`;
    setLoading(true);
    setError(null);
    try {
      await createFolder(
        contextIdForApi,
        bucketName,
        folderPrefix,
        requestOptions,
      );
      setShowModal(false);
      reset();
      await onCreated({ name: normalizedName, prefix: folderPrefix });
    } catch {
      setError(text("Unable to create folder."));
    } finally {
      setLoading(false);
    }
  };

  return {
    showModal,
    name,
    loading,
    error,
    open,
    setName,
    submit,
    close,
  };
}
