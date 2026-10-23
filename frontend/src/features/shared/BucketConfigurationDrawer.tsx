/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useI18n } from "../../i18n";
import { BucketDetailContent } from "../manager/BucketDetailPage";
import DetailsDrawerNavigation, {
  guardDetailsDrawerNavigation,
  type DetailsDrawerNavigationState,
} from "./DetailsDrawerNavigation";
import DetailsDrawerShell from "./DetailsDrawerShell";

type BucketConfigurationDrawerMode = "ceph-admin" | "manager" | "storage-ops";

type BucketConfigurationDrawerProps = {
  bucketName: string;
  contextId?: string | null;
  tenant?: string | null;
  mode: BucketConfigurationDrawerMode;
  navigation?: DetailsDrawerNavigationState;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export default function BucketConfigurationDrawer({
  bucketName,
  contextId = null,
  tenant = null,
  mode,
  navigation,
  onClose,
  onDirtyChange,
}: BucketConfigurationDrawerProps) {
  const { t } = useI18n();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingTransitionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setDirty(false);
    setBusy(false);
  }, [bucketName, contextId, mode, tenant]);

  const handleDirtyChange = useCallback(
    (nextDirty: boolean) => {
      setDirty(nextDirty);
      onDirtyChange?.(nextDirty);
    },
    [onDirtyChange],
  );

  const completePendingTransition = useCallback(() => {
    const action = pendingTransitionRef.current;
    pendingTransitionRef.current = null;
    action?.();
  }, []);

  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: dirty,
    disabled: busy,
    onClose: completePendingTransition,
    description: t({
      en: "You have unsaved bucket settings. Leaving this bucket will discard them.",
      fr: "Vous avez des paramètres de bucket non enregistrés. Quitter ce bucket les abandonnera.",
      de: "Sie haben ungespeicherte Bucket-Einstellungen. Beim Verlassen dieses Buckets werden sie verworfen.",
      zh: "您有未保存的存储桶设置。离开此存储桶将放弃这些更改。",
    }),
  });

  const requestTransition = useCallback(
    (action: () => void) => {
      if (busy) return;
      pendingTransitionRef.current = action;
      closeGuard.requestClose();
    },
    [busy, closeGuard],
  );

  const guardedNavigation = useMemo<DetailsDrawerNavigationState | undefined>(() => {
    return guardDetailsDrawerNavigation(navigation, requestTransition);
  }, [navigation, requestTransition]);

  const navigationActions = guardedNavigation ? (
    <DetailsDrawerNavigation
      navigation={guardedNavigation}
      labels={{
        group: t({
          en: "Loaded buckets",
          fr: "Buckets chargés",
          de: "Geladene Buckets",
          zh: "已加载的存储桶",
        }),
        previous: t({
          en: "Previous bucket",
          fr: "Bucket précédent",
          de: "Vorheriger Bucket",
          zh: "上一个存储桶",
        }),
        next: t({
          en: "Next bucket",
          fr: "Bucket suivant",
          de: "Nächster Bucket",
          zh: "下一个存储桶",
        }),
      }}
    />
  ) : undefined;

  return (
    <DetailsDrawerShell
      title={bucketName}
      subtitle={
        <p className="ui-caption text-[var(--ui-text-muted)]">
          {t({
            en: "Bucket settings",
            fr: "Paramètres du bucket",
            de: "Bucket-Einstellungen",
            zh: "存储桶设置",
          })}
        </p>
      }
      actions={navigationActions}
      returnFocus={navigation?.returnFocus}
      onClose={() => requestTransition(onClose)}
      width="wide"
    >
      <BucketDetailContent
        mode={mode === "ceph-admin" ? "ceph-admin" : "manager"}
        bucketNameOverride={bucketName}
        cephAdminTenantOverride={mode === "ceph-admin" ? tenant : null}
        contextIdOverride={mode === "ceph-admin" ? null : contextId}
        hideQuotaTab={mode === "storage-ops"}
        embedded
        hideObjectsTab={mode === "manager"}
        onDirtyChange={handleDirtyChange}
        onBusyChange={setBusy}
      />
      {closeGuard.confirmationDialog}
    </DetailsDrawerShell>
  );
}
