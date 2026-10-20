/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchPortalProjectSettings,
  fetchPortalState,
  type PortalProjectSettings,
} from "../../api/portalAccounts";
import {
  fetchPortalCollaborators,
  type PortalCollaborator,
} from "../../api/portalCollaborators";
import {
  listPortalRequests,
  type PortalAdminRequest,
} from "../../api/portalRequests";
import { fetchPortalUsage, type PortalUsage } from "../../api/portalUsage";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";

type UsePortalRequestsDataOptions = {
  accountId: S3AccountSelector;
  hasAccountContext: boolean;
  summaryAllowsManagedRequests: boolean;
};

export function usePortalRequestsData({
  accountId,
  hasAccountContext,
  summaryAllowsManagedRequests,
}: UsePortalRequestsDataOptions) {
  const { t } = useI18n();
  const [requests, setRequests] = useState<PortalAdminRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [usage, setUsage] = useState<PortalUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<PortalCollaborator[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [collaboratorsError, setCollaboratorsError] = useState<string | null>(
    null,
  );
  const [projectSettings, setProjectSettings] =
    useState<PortalProjectSettings | null>(null);
  const [projectSettingsLoading, setProjectSettingsLoading] = useState(false);
  const [projectSettingsError, setProjectSettingsError] = useState<string | null>(
    null,
  );
  const [requestPermission, setRequestPermission] = useState<{
    accountId: string;
    canManage: boolean;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const selectedAccountKey = accountId == null ? null : String(accountId);
  const stateAllowsManagedRequests =
    requestPermission?.accountId === selectedAccountKey
      ? requestPermission.canManage
      : null;
  const permissionResolved =
    summaryAllowsManagedRequests || stateAllowsManagedRequests !== null;
  const canRequestManagedChanges =
    stateAllowsManagedRequests ?? summaryAllowsManagedRequests;

  useEffect(() => {
    if (!hasAccountContext || !accountId || !selectedAccountKey) {
      setRequestPermission(null);
      return;
    }
    let cancelled = false;
    void fetchPortalState(accountId)
      .then((state) => {
        if (cancelled) return;
        setRequestPermission({
          accountId: selectedAccountKey,
          canManage:
            state.portal_role === "portal_manager" ||
            state.can_manage_portal_users === true,
        });
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setRequestPermission({
          accountId: selectedAccountKey,
          canManage: summaryAllowsManagedRequests,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    hasAccountContext,
    selectedAccountKey,
    summaryAllowsManagedRequests,
  ]);

  const reloadRequests = useCallback(async () => {
    if (!hasAccountContext || !accountId) {
      setRequests([]);
      setRequestsLoading(false);
      setRequestsError(null);
      return;
    }
    setRequestsLoading(true);
    setRequestsError(null);
    try {
      setRequests(await listPortalRequests(accountId));
    } catch (err) {
      console.error(err);
      setRequestsError(
        extractApiError(
          err,
          t({
            en: "Unable to load requests.",
            fr: "Impossible de charger les demandes.",
            de: "Anfragen können nicht geladen werden.",
            zh: "无法加载请求。",
          }),
        ),
      );
    } finally {
      setRequestsLoading(false);
    }
  }, [accountId, hasAccountContext, t]);

  const reloadProjectSettings = useCallback(async () => {
    if (!hasAccountContext || !accountId || !canRequestManagedChanges) {
      setProjectSettings(null);
      setProjectSettingsLoading(false);
      setProjectSettingsError(null);
      return;
    }
    setProjectSettingsLoading(true);
    setProjectSettingsError(null);
    try {
      setProjectSettings(await fetchPortalProjectSettings(accountId));
    } catch (err) {
      console.error(err);
      setProjectSettings(null);
      setProjectSettingsError(
        extractApiError(
          err,
          t({
            en: "Unable to load project settings. Setting-change requests are unavailable.",
            fr: "Impossible de charger les paramètres du projet. Les demandes de modification sont indisponibles.",
            de: "Projekteinstellungen können nicht geladen werden. Änderungsanfragen sind nicht verfügbar.",
            zh: "无法加载项目设置。设置更改请求当前不可用。",
          }),
        ),
      );
    } finally {
      setProjectSettingsLoading(false);
    }
  }, [accountId, canRequestManagedChanges, hasAccountContext, t]);

  const reloadUsage = useCallback(async () => {
    if (!hasAccountContext || !accountId) {
      setUsage(null);
      setUsageLoading(false);
      setUsageError(null);
      return;
    }
    setUsageLoading(true);
    setUsageError(null);
    try {
      setUsage(await fetchPortalUsage(accountId));
    } catch (err) {
      console.error(err);
      setUsage(null);
      setUsageError(
        extractApiError(
          err,
          t({
            en: "Unable to load current usage.",
            fr: "Impossible de charger l'usage actuel.",
            de: "Aktuelle Nutzung kann nicht geladen werden.",
            zh: "无法加载当前用量。",
          }),
        ),
      );
    } finally {
      setUsageLoading(false);
    }
  }, [accountId, hasAccountContext, t]);

  const reloadCollaborators = useCallback(async () => {
    if (!hasAccountContext || !accountId || !canRequestManagedChanges) {
      setCollaborators([]);
      setCollaboratorsLoading(false);
      setCollaboratorsError(null);
      return;
    }
    setCollaboratorsLoading(true);
    setCollaboratorsError(null);
    try {
      const data = await fetchPortalCollaborators(accountId);
      setCollaborators(data.collaborators ?? []);
    } catch (err) {
      console.error(err);
      setCollaborators([]);
      setCollaboratorsError(
        extractApiError(
          err,
          t({
            en: "Unable to load collaborators.",
            fr: "Impossible de charger les collaborateurs.",
            de: "Mitwirkende konnen nicht geladen werden.",
            zh: "无法加载协作者。",
          }),
        ),
      );
    } finally {
      setCollaboratorsLoading(false);
    }
  }, [accountId, canRequestManagedChanges, hasAccountContext, t]);

  useEffect(() => {
    void reloadRequests();
  }, [reloadRequests]);

  useEffect(() => {
    void reloadProjectSettings();
  }, [reloadProjectSettings]);

  useEffect(() => {
    void reloadUsage();
  }, [reloadUsage]);

  useEffect(() => {
    void reloadCollaborators();
  }, [reloadCollaborators]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        reloadRequests(),
        reloadUsage(),
        reloadCollaborators(),
        reloadProjectSettings(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    reloadCollaborators,
    reloadProjectSettings,
    reloadRequests,
    reloadUsage,
  ]);

  return {
    permissionResolved,
    canRequestManagedChanges,
    requests,
    requestsLoading,
    requestsError,
    usage,
    usageLoading,
    usageError,
    collaborators,
    collaboratorsLoading,
    collaboratorsError,
    projectSettings,
    projectSettingsLoading,
    projectSettingsError,
    refreshing,
    refreshAll,
    reloadRequests,
    reloadCollaborators,
  };
}
