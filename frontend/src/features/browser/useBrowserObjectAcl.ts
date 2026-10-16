/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { updateObjectAcl } from "../../api/browserObjects";
import { runBrowserScopedSave } from "./browserScopedSave";

type UseBrowserObjectAclOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName: string;
  objectKey: string;
  requestOptions?: BrowserRequestOptions;
  versionId?: string | null;
};

export function useBrowserObjectAcl({
  contextId,
  bucketName,
  objectKey,
  requestOptions,
  versionId,
}: UseBrowserObjectAclOptions) {
  const scope = JSON.stringify([
    contextId,
    bucketName,
    objectKey,
    requestOptions?.workspaceSurface ?? null,
    versionId ?? null,
  ]);
  const [value, setValue] = useState("private");
  const [saving, setSaving] = useState(false);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const isCurrentScope = useCallback(
    () => scope === scopeRef.current,
    [scope],
  );

  const reset = useCallback(() => {
    setValue("private");
    setSaving(false);
  }, []);

  const save = useCallback(async () => {
    if (!isCurrentScope() || !contextId || !bucketName || !objectKey) {
      return false;
    }
    return (
      (await runBrowserScopedSave(isCurrentScope, setSaving, async () => {
        await updateObjectAcl(
          contextId,
          bucketName,
          {
            key: objectKey,
            acl: value,
            version_id: versionId ?? null,
          },
          undefined,
          requestOptions,
        );
        return true;
      })) ?? false
    );
  }, [
    contextId,
    bucketName,
    isCurrentScope,
    objectKey,
    requestOptions,
    value,
    versionId,
  ]);

  useEffect(() => reset(), [reset, scope]);

  return {
    value,
    setValue,
    saving,
    isCurrentScope,
    save,
  };
}
