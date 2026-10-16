/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type S3ConnectionRgwIdentityDefaults = {
  userUid: string;
  tenant: string;
  accountId: string | null;
};

const accessKeySuffix = (accessKey: string): string => accessKey.trim().slice(-4);

const withAccessKeySuffix = (base: string, accessKey: string): string => {
  const normalizedBase = base.trim() || "connection";
  const suffix = accessKeySuffix(accessKey);
  return suffix ? `${normalizedBase}-${suffix}` : normalizedBase;
};

export const buildCephConnectionDefaults = (
  uid: string,
  accessKey: string,
  options?: { accountId?: string | null; tenant?: string | null }
): {
  name: string;
  rgwIdentity: S3ConnectionRgwIdentityDefaults;
} => {
  const normalizedUid = uid.trim() || "user";
  const accountId = options?.accountId?.trim() || "";
  const tenant = options?.tenant?.trim() || "";
  return {
    name: `ceph-${withAccessKeySuffix(normalizedUid, accessKey)}`,
    rgwIdentity: {
      userUid: normalizedUid,
      tenant,
      accountId: accountId || null,
    },
  };
};
