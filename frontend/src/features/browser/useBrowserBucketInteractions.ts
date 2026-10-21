/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

type UseBrowserBucketInteractionsOptions = {
  bucketConfigurationEnabled: boolean;
  bucketManagementEnabled: boolean;
  clearActiveItem: () => void;
  closeBucketMenu: () => void;
  openBucketConfigurationTarget: (bucketName: string) => void;
  openCreateBucketForm: () => void;
  requestDetailsDrawerTransition: (transition: () => void) => boolean;
  selectBucket: (bucketName: string) => boolean;
  setBucketFilter: (value: string) => void;
};

export function useBrowserBucketInteractions({
  bucketConfigurationEnabled,
  bucketManagementEnabled,
  clearActiveItem,
  closeBucketMenu,
  openBucketConfigurationTarget,
  openCreateBucketForm,
  requestDetailsDrawerTransition,
  selectBucket,
  setBucketFilter,
}: UseBrowserBucketInteractionsOptions) {
  const selectBucketFromMenu = useCallback(
    (bucketName: string) => {
      closeBucketMenu();
      requestDetailsDrawerTransition(() => {
        if (selectBucket(bucketName)) clearActiveItem();
      });
    },
    [
      clearActiveItem,
      closeBucketMenu,
      requestDetailsDrawerTransition,
      selectBucket,
    ],
  );

  const resetBucketMenu = useCallback(() => {
    closeBucketMenu();
    setBucketFilter("");
  }, [closeBucketMenu, setBucketFilter]);

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
