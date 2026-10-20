/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import {
  listPortalStorageSpacePublicLinks,
  type PortalPublicLink,
} from "../../api/portalSharing";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";
import { usePortalPublicLinkActions } from "./usePortalPublicLinkActions";

type UsePortalExternalLinksOverviewOptions = {
  accountId: S3AccountSelector;
  spaces: PortalWorkspaceSpace[];
  requestedSpaceId: string | null;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
};

export function usePortalExternalLinksOverview({
  accountId,
  spaces,
  requestedSpaceId,
  onMessage,
  onError,
}: UsePortalExternalLinksOverviewOptions) {
  const [links, setLinks] = useState<PortalPublicLink[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<PortalPublicLink | null>(
    null,
  );

  const activeManagedTeamSpaces = useMemo(
    () =>
      spaces.filter(
        (space) =>
          space.status !== "Archived" &&
          space.role === "Manager" &&
          space.visibility === "shared",
      ),
    [spaces],
  );

  useEffect(() => {
    if (requestedSpaceId && spaces.some((space) => space.id === requestedSpaceId)) {
      setSelectedSpaceId(requestedSpaceId);
    }
  }, [requestedSpaceId, spaces]);

  useEffect(() => {
    if (
      selectedSpaceId &&
      !activeManagedTeamSpaces.some((space) => space.id === selectedSpaceId)
    ) {
      setSelectedSpaceId("");
    }
  }, [activeManagedTeamSpaces, selectedSpaceId]);

  useEffect(() => {
    let cancelled = false;
    if (!accountId || activeManagedTeamSpaces.length === 0) {
      setLinks([]);
      return () => {
        cancelled = true;
      };
    }

    Promise.all(
      activeManagedTeamSpaces.map((space) =>
        listPortalStorageSpacePublicLinks(accountId, space.id, {
          includeRevoked: true,
        }),
      ),
    )
      .then((results) => {
        if (!cancelled) setLinks(results.flat());
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setLinks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, activeManagedTeamSpaces]);

  const updateLinksAfterRevoke = useCallback(
    (updated: PortalPublicLink[], link: PortalPublicLink) =>
      setLinks((current) => [
        ...current.filter(
          (item) => item.storage_space_id !== link.storage_space_id,
        ),
        ...updated,
      ]),
    [],
  );

  const { busyLinkId, copyLink, revokeLink } = usePortalPublicLinkActions({
    accountId,
    onLinksUpdated: updateLinksAfterRevoke,
    onMessage,
    onError,
  });

  const selectedSpace =
    activeManagedTeamSpaces.find((space) => space.id === selectedSpaceId) ?? null;
  const visibleLinks = useMemo(
    () =>
      links.filter(
        (link) =>
          !selectedSpaceId || link.storage_space_id === selectedSpaceId,
      ),
    [links, selectedSpaceId],
  );
  const activeLinkCount = visibleLinks.filter(
    (link) => link.status === "Active",
  ).length;

  const requestRevoke = useCallback(
    (link: PortalPublicLink) => {
      if (!accountId) return;
      setPendingRevoke(link);
    },
    [accountId],
  );

  const confirmRevoke = useCallback(async () => {
    if (!pendingRevoke) return;
    try {
      await revokeLink(pendingRevoke);
    } finally {
      setPendingRevoke(null);
    }
  }, [pendingRevoke, revokeLink]);

  return {
    activeManagedTeamSpaces,
    selectedSpaceId,
    setSelectedSpaceId,
    selectedSpace,
    visibleLinks,
    activeLinkCount,
    tableStatus: visibleLinks.length === 0 ? ("empty" as const) : ("ready" as const),
    busyLinkId,
    copyLink,
    pendingRevoke,
    requestRevoke,
    cancelRevoke: () => setPendingRevoke(null),
    confirmRevoke,
  };
}
