/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { BrowserDeletedObjectsOptions } from "./browserPageContract";

type UseBrowserListingVisibilityOptions = {
  deletedObjectsOptions?: BrowserDeletedObjectsOptions;
};

export function useBrowserListingVisibility({
  deletedObjectsOptions,
}: UseBrowserListingVisibilityOptions) {
  const [internalShowDeletedObjects, setInternalShowDeletedObjects] =
    useState(false);
  const [showFolderItems, setShowFolderItems] = useState(true);
  const showDeletedObjects =
    deletedObjectsOptions?.visible ?? internalShowDeletedObjects;

  const setDeletedObjectsVisible = useCallback((visible: boolean) => {
    if (visible === showDeletedObjects) return;
    if (deletedObjectsOptions?.visible === undefined) {
      setInternalShowDeletedObjects(visible);
    }
    deletedObjectsOptions?.onVisibilityChange?.(visible);
  }, [deletedObjectsOptions, showDeletedObjects]);

  const hideDeletedObjects = useCallback(() => {
    setDeletedObjectsVisible(false);
  }, [setDeletedObjectsVisible]);

  const toggleDeletedObjects = useCallback(() => {
    setDeletedObjectsVisible(!showDeletedObjects);
  }, [setDeletedObjectsVisible, showDeletedObjects]);

  const toggleFolderItems = useCallback(() => {
    setShowFolderItems((visible) => !visible);
  }, []);

  return {
    hideDeletedObjects,
    showDeletedObjects,
    showFolderItems,
    toggleDeletedObjects,
    toggleFolderItems,
  };
}
