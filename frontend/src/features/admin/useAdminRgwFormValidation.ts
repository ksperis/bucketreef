/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { rgwUserUidFormatError, rgwTenantFormatError } from "../../utils/resourceNames";
import { rgwAccountNameFormatError } from "../../utils/rgwAccountName";

/** Bind native and RGW-specific validation to named fields, retaining failed drafts. */
export function useAdminRgwFormValidation(values: Record<string, unknown>, fieldErrors: Record<string, string | undefined>) {
  const [attempted, setAttempted] = useState(false);
  const [nativeErrors, setNativeErrors] = useState<Record<string, {value: unknown; message: string}>>({});
  const errors = attempted ? {...Object.fromEntries(Object.entries(nativeErrors)
    .filter(([key, error]) => values[key] === error.value).map(([key, error]) => [key, error.message])), ...fieldErrors} : {};
  return {
    errors,
    reset: () => { setAttempted(false); setNativeErrors({}); },
    validate: (form: HTMLFormElement) => {
      setAttempted(true);
      const native: typeof nativeErrors = {};
      for (const control of Array.from(form.elements)) {
        if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) || !control.name || control.disabled || control.validity.valid) continue;
        native[control.name] = {value: values[control.name], message: control.validity.typeMismatch ? "Enter a valid email address." : control.validity.badInput ? "Enter a valid number." : control.validationMessage};
      }
      setNativeErrors(native);
      if (Object.values(fieldErrors).some(Boolean) || Object.keys(native).length > 0) {
        focusFirstInvalidField(form);
        return false;
      }
      return true;
    },
  };
}

export function rgwCreateErrors(value: {name: string; storage_endpoint_id: string; quota_max_size_gb: string; quota_max_objects: string; uid?: string; rgw_tenant?: string}, kind: "account" | "user" = "account"): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!value.name.trim()) errors.name = "Enter a name.";
  else if (kind === "account") {
    const nameFormatError = rgwAccountNameFormatError(value.name);
    if (nameFormatError) errors.name = nameFormatError;
  }
  const tenant = value.rgw_tenant?.trim() ?? "";
  const tenantError = rgwTenantFormatError(tenant);
  if (tenantError) errors.rgw_tenant = tenantError;
  if (kind === "user") {
    const uidError = rgwUserUidFormatError(value.uid?.trim() ?? "", tenant);
    if (uidError) errors.uid = uidError;
    const qualifiedTenant = value.uid?.trim().split("$")[0];
    if (value.uid?.includes("$") && tenant && qualifiedTenant !== tenant) {
      errors.uid = "UID tenant and Tenant field must match.";
    }
  }
  if (!value.storage_endpoint_id) errors.storage_endpoint_id = "Select a Ceph endpoint.";
  return { ...errors, ...adminQuotaErrors(value) };
}

export function adminQuotaErrors(value: { quota_max_size_gb: string; quota_max_objects: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (value.quota_max_size_gb && (!Number.isFinite(Number(value.quota_max_size_gb)) || Number(value.quota_max_size_gb) < 0)) errors.quota_max_size_gb = "Enter a non-negative storage quota.";
  if (value.quota_max_objects && (!Number.isSafeInteger(Number(value.quota_max_objects)) || Number(value.quota_max_objects) < 0)) errors.quota_max_objects = "Enter a non-negative whole number within the supported range.";
  return errors;
}

export function rgwImportEntries(text: string, kind: "account" | "user", allowTenant = true) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const entries = kind === "account" ? lines : lines.map(line => line.trim());
  const tenantQualified = kind === "user" ? lines.filter(line => line.includes("$")) : [];
  const invalid = lines.filter((_, index) => kind === "account" ? !/^RGW\d{17}$/.test(entries[index]) : !entries[index] || Boolean(rgwUserUidFormatError(entries[index])) || entries[index].endsWith("$") || entries[index].startsWith("$") || entries[index].includes("/") || /\s/.test(entries[index]));
  return {entries, error: !entries.length ? "Enter at least one identifier." : !allowTenant && tenantQualified.length ? "Tenant-qualified RGW user IDs require Managed RGW tenant creation." : invalid.length ? `Invalid identifiers: ${invalid.join(", ")}` : undefined};
}

/** One account per line, optionally followed by the existing root UID. */
export function rgwAccountImportEntries(text: string) {
  const rows = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const entries = rows.map(row => {
    const [rgw_account_id, root_uid, ...extra] = row.split(/\s+/);
    return {rgw_account_id, root_uid, invalid: extra.length > 0 || !/^RGW\d{17}$/i.test(rgw_account_id) ||
      Boolean(root_uid && (root_uid.startsWith("$") || root_uid.endsWith("$")))};
  });
  const invalid = entries.filter(entry => entry.invalid);
  return {entries, error: !entries.length ? "Enter at least one identifier." : invalid.length ? "Enter a valid RGW account ID followed by an optional root UID." : undefined};
}
