/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";

type UseBrowserBucketInteractionsOptions = {
  bucketConfigurationEnabled: boolean;
  bucketManagementEnabled: boolean;
  clearActiveItem: () => void;
  openBucketConfigurationTarget: (bucketName: string) => void;
  openCreateBucketForm: () => void;
  requestDetailsDrawerTransition: (transition: () => void) => boolean;
  selectBucket: (bucketName: string) => boolean;
  setBucketFilter: (value: string) => void;
  setShowBucketMenu: Dispatch<SetStateAction<boolean>>;
};

export function useBrowserBucketInteractions({
  bucketConfigurationEnabled,
  bucketManagementEnabled,
  clearActiveItem,
  openBucketConfigurationTarget,
  openCreateBucketForm,
  requestDetailsDrawerTransition,
  selectBucket,
  setBucketFilter,
  setShowBucketMenu,
}: UseBrowserBucketInteractionsOptions) {
  const selectBucketFromMenu = useCallback(
    (bucketName: string) => {
      setShowBucketMenu(false);
      requestDetailsDrawerTransition(() => {
        if (selectBucket(bucketName)) clearActiveItem();
      });
    },
    [
      clearActiveItem,
      requestDetailsDrawerTransition,
      selectBucket,
      setShowBucketMenu,
    ],
  );

  const resetBucketMenu = useCallback(() => {
    setShowBucketMenu(false);
    setBucketFilter("");
  }, [setBucketFilter, setShowBucketMenu]);

  const openBucketConfiguration = useCallback(
    (bucketName: string) => {
      if (!bucketConfigurationEnabled) return;
      const normalized = bucketName.trim();
      if (!normalized) return;
      resetBucketMenu();
      requestDetailsDrawerTransition(() =>
        openBucketConfigurationTarget(normalized),
      );
    },
    [
      bucketConfigurationEnabled,
      openBucketConfigurationTarget,
      requestDetailsDrawerTransition,
      resetBucketMenu,
    ],
  );

  const openCreateBucket = useCallback(() => {
    if (!bucketManagementEnabled) return;
    resetBucketMenu();
    openCreateBucketForm();
  }, [bucketManagementEnabled, openCreateBucketForm, resetBucketMenu]);

  return {
    openBucketConfiguration,
    openCreateBucket,
    selectBucketFromMenu,
  };
}
