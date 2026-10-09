/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
export type NamingValidationProfile = "ceph" | "standard";
export type IAMEntity = "user" | "group" | "role" | "policy";

/** Format only: callers decide when to show the required-field error. */
export function iamNameFormatError(value: string, entity: IAMEntity): string | undefined {
  if (!value) return undefined;
  const limit = entity === "user" || entity === "role" ? 64 : 128;
  if (value.length > limit || /[^A-Za-z0-9_+=,.@-]/.test(value)) {
    return limit === 64
      ? "Name must contain 1–64 ASCII letters, digits or _+=,.@-."
      : "Name must contain 1–128 ASCII letters, digits or _+=,.@-.";
  }
  return undefined;
}

export function inlinePolicyNameFormatError(value: string, entity: IAMEntity, profile: NamingValidationProfile): string | undefined {
  if (!value) return undefined;
  if (profile === "ceph") {
    if (entity === "role") return undefined;
    if (value.length > 128 || /[^A-Za-z0-9:=,.@-]/.test(value)) {
      return "Ceph inline policy name must contain 1–128 ASCII letters, digits or :=,.@-.";
    }
    return undefined;
  }
  return iamNameFormatError(value, "policy");
}

export function topicNameFormatError(value: string): string | undefined {
  if (value && (value.length > 256 || /[^A-Za-z0-9_-]/.test(value))) {
    return "Topic name must contain 1–256 ASCII letters, digits, underscores or hyphens.";
  }
  return undefined;
}

export function rgwTenantFormatError(value: string): string | undefined {
  if (value && /[^A-Za-z0-9_]/.test(value)) return "Tenant must contain only ASCII letters, digits or underscores.";
  if (value.length === 20 && /^RGW[0-9]{17}$/.test(value)) return "Tenant must not be a reserved RGW account ID.";
  return undefined;
}

export function rgwUserUidFormatError(value: string, tenant?: string): string | undefined {
  if (!value) return undefined;
  const first = value.indexOf("$");
  const second = first < 0 ? -1 : value.indexOf("$", first + 1);
  const parsedTenant = first < 0 ? "" : value.slice(0, first);
  const namespace = second < 0 ? "" : value.slice(first + 1, second);
  const identifier = second >= 0 ? value.slice(second + 1) : first >= 0 ? value.slice(first + 1) : value;
  const effectiveTenant = tenant?.trim() || parsedTenant;
  const tenantError = rgwTenantFormatError(effectiveTenant);
  if (tenantError) return tenantError;
  if (!identifier) return "UID must contain a non-empty user identifier after '$'.";
  if (identifier.length === 20 && /^RGW[0-9]{17}$/.test(identifier)) return "UID must not be a reserved RGW account ID.";
  if (!effectiveTenant && !namespace && identifier === "anonymous") return "UID 'anonymous' is reserved.";
  // Reject lone UTF-16 surrogates instead of silently replacing them during JSON transport.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return "UID must be valid UTF-8.";
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return "UID must be valid UTF-8.";
  }
  return undefined;
}
