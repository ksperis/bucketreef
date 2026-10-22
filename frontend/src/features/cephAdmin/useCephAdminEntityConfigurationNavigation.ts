/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import type { CephAdminRgwAccount } from "../../api/cephAdminAccounts";
import type { CephAdminRgwUser } from "../../api/cephAdminUsers";
import useDetailsDrawerListNavigation from "../shared/useDetailsDrawerListNavigation";

const CEPH_ADMIN_CONFIGURE_ROW_KEY_ATTR = "data-ceph-admin-configure-row-key";

type ConfigurationDefinition<Row, Target> = {
  items: readonly Row[];
  selectedEndpointId: number | null;
  targetFromRow: (row: Row) => Target | null;
  rowMatchesTarget: (row: Row, target: Target) => boolean;
  rowKey: (row: Row) => string;
};

function findConfigureButton(rowKey: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>(`[${CEPH_ADMIN_CONFIGURE_ROW_KEY_ATTR}]`),
    ).find((element) => element.getAttribute(CEPH_ADMIN_CONFIGURE_ROW_KEY_ATTR) === rowKey) ?? null
  );
}

function useCephAdminEntityConfigurationNavigation<Row, Target>({
  items,
  selectedEndpointId,
  targetFromRow,
  rowMatchesTarget,
  rowKey,
}: ConfigurationDefinition<Row, Target>) {
  const { close, navigation, open, target, viewedRowKey } = useDetailsDrawerListNavigation({
    items,
    resetKey: selectedEndpointId,
    targetFromRow,
    rowMatchesTarget,
    rowKey,
    findRowAction: findConfigureButton,
  });
  return {
    closeConfiguration: close,
    configurationNavigation: navigation,
    configurationTarget: target,
    openConfiguration: open,
    viewedRowKey,
  };
}

type AccountConfigurationTarget = {
  accountId: string;
};

export function useCephAdminAccountConfigurationNavigation({
  items,
  selectedEndpointId,
}: {
  items: readonly CephAdminRgwAccount[];
  selectedEndpointId: number | null;
}) {
  const targetFromRow = useCallback(
    (account: CephAdminRgwAccount): AccountConfigurationTarget => ({ accountId: account.account_id }),
    [],
  );
  const rowMatchesTarget = useCallback(
    (account: CephAdminRgwAccount, target: AccountConfigurationTarget) =>
      account.account_id === target.accountId,
    [],
  );

  return useCephAdminEntityConfigurationNavigation({
    items,
    selectedEndpointId,
    targetFromRow,
    rowMatchesTarget,
    rowKey: (account) => account.account_id,
  });
}

type UserConfigurationTarget = {
  uid: string;
  tenant: string | null;
  expectedAccountId?: string | null;
};

export function useCephAdminUserConfigurationNavigation({
  items,
  selectedEndpointId,
  accountScopeLoaded,
}: {
  items: readonly CephAdminRgwUser[];
  selectedEndpointId: number | null;
  accountScopeLoaded: boolean;
}) {
  const targetFromRow = useCallback(
    (user: CephAdminRgwUser): UserConfigurationTarget => ({
      uid: user.uid,
      tenant: user.tenant?.trim() || null,
      expectedAccountId: user.account_id ?? (accountScopeLoaded ? null : undefined),
    }),
    [accountScopeLoaded],
  );
  const rowMatchesTarget = useCallback(
    (user: CephAdminRgwUser, target: UserConfigurationTarget) =>
      user.uid === target.uid && (user.tenant?.trim() || null) === target.tenant,
    [],
  );

  return useCephAdminEntityConfigurationNavigation({
    items,
    selectedEndpointId,
    targetFromRow,
    rowMatchesTarget,
    rowKey: (user) => `${user.tenant ?? ""}:${user.uid}`,
  });
}
