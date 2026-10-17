/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type CephAdminRgwAccessKey = {
  access_key: string;
  status?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  user?: string | null;
  subuser?: string | null;
  is_private_access_managed?: boolean;
  managed_connection_id?: number | null;
};

export type CephAdminRgwGeneratedAccessKey = {
  access_key: string;
  secret_key: string;
};

const userParams = (tenant?: string | null, expectedAccountId?: string | null) => ({
  ...(tenant ? { tenant } : {}),
  ...(expectedAccountId ? { expected_account_id: expectedAccountId } : {}),
});

export async function listCephAdminUserKeys(
  endpointId: number,
  uid: string,
  tenant?: string | null,
  expectedAccountId?: string | null,
): Promise<CephAdminRgwAccessKey[]> {
  const { data } = await client.get<CephAdminRgwAccessKey[]>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/keys`,
    { params: userParams(tenant, expectedAccountId) }
  );
  return data;
}

export async function createCephAdminUserKey(
  endpointId: number,
  uid: string,
  tenant?: string | null,
  expectedAccountId?: string | null,
): Promise<CephAdminRgwGeneratedAccessKey> {
  const { data } = await client.post<CephAdminRgwGeneratedAccessKey>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/keys`,
    undefined,
    { params: userParams(tenant, expectedAccountId) }
  );
  return data;
}

export async function updateCephAdminUserKeyStatus(
  endpointId: number,
  uid: string,
  accessKey: string,
  active: boolean,
  tenant?: string | null,
  expectedAccountId?: string | null,
): Promise<CephAdminRgwAccessKey> {
  const { data } = await client.put<CephAdminRgwAccessKey>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/keys/${encodeURIComponent(accessKey)}/status`,
    { active },
    { params: userParams(tenant, expectedAccountId) }
  );
  return data;
}

export async function deleteCephAdminUserKey(
  endpointId: number,
  uid: string,
  accessKey: string,
  tenant?: string | null,
  expectedAccountId?: string | null,
): Promise<void> {
  await client.delete(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/keys/${encodeURIComponent(accessKey)}`,
    { params: userParams(tenant, expectedAccountId) }
  );
}
