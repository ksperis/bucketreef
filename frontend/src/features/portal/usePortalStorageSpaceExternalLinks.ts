/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  listPortalStorageSpacePublicLinks,
  type PortalPublicLink,
} from "../../api/portalSharing";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";
import { usePortalPublicLinkActions } from "./usePortalPublicLinkActions";
import type { PortalStorageSpaceDetailTab } from "./usePortalStorageSpaceNavigation";

type UsePortalStorageSpaceExternalLinksOptions = {
  accountId: S3AccountSelector;
  activeTab: PortalStorageSpaceDetailTab;
  space: PortalWorkspaceSpace | null;
  onMessage: (message: string | null) => void;
};

export function usePortalStorageSpaceExternalLinks({
  accountId,
  activeTab,
  space,
  onMessage,
}: UsePortalStorageSpaceExternalLinksOptions) {
  const { t } = useI18n();
  const [links, setLinks] = useState<PortalPublicLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<PortalPublicLink | null>(null);

  const canListLinks = Boolean(
    space &&
      space.status !== "Archived" &&
      (space.role === "Owner" || space.role === "Manager"),
  );

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== "external-links" || !space || !accountId || !canListLinks) {
      setLinks([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    listPortalStorageSpacePublicLinks(accountId, space.id, { includeRevoked: true })
      .then((nextLinks) => {
        if (!cancelled) setLinks(nextLinks);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setLinks([]);
          setError(
            extractApiError(
              err,
              t({
                en: "Unable to load external links.",
                fr: "Impossible de charger les liens externes.",
                de: "Externe Links können nicht geladen werden.",
                zh: "无法加载外部链接。",
              }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, activeTab, canListLinks, space, t]);

  const { busyLinkId, copyLink, revokeLink } = usePortalPublicLinkActions({
    accountId,
    onLinksUpdated: (nextLinks) => setLinks(nextLinks),
    onMessage,
    onError: setError,
  });

  const unavailableReason = space?.status === "Archived"
    ? t({
        en: "Restore this archived space to review links.",
        fr: "Restaurez cet espace archivé pour voir ses liens.",
        de: "Archivierte Bereiche zeigen keine externen Links.",
        zh: "请恢复此已归档空间以查看链接。",
      })
    : space && space.role !== "Owner" && space.role !== "Manager"
      ? t({
          en: "Only owners and managers can review links.",
          fr: "Accès propriétaire ou gestionnaire requis.",
          de: "Nur Owner und Manager sehen externe Links.",
          zh: "只有所有者和管理员可以查看链接。",
        })
      : null;

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: links.length,
  });

  const confirmRevoke = async () => {
    if (!pendingRevoke) return;
    try {
      await revokeLink(pendingRevoke);
    } finally {
      setPendingRevoke(null);
    }
  };

  return {
    links,
    error,
    unavailableReason,
    tableStatus,
    busyLinkId,
    copyLink,
    pendingRevoke,
    requestRevoke: setPendingRevoke,
    cancelRevoke: () => setPendingRevoke(null),
    confirmRevoke,
  };
}
