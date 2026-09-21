/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
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

export function rgwCreateErrors(value: {name: string; storage_endpoint_id: string; quota_max_size_gb: string; quota_max_objects: string}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!value.name.trim()) errors.name = "Enter a name.";
  else {
    const nameFormatError = rgwAccountNameFormatError(value.name);
    if (nameFormatError) errors.name = nameFormatError;
  }
  if (!value.storage_endpoint_id) errors.storage_endpoint_id = "Select a Ceph endpoint.";
  if (value.quota_max_size_gb && (!Number.isFinite(Number(value.quota_max_size_gb)) || Number(value.quota_max_size_gb) < 0)) errors.quota_max_size_gb = "Enter a non-negative storage quota.";
  if (value.quota_max_objects && (!Number.isSafeInteger(Number(value.quota_max_objects)) || Number(value.quota_max_objects) < 0)) errors.quota_max_objects = "Enter a non-negative whole number within the supported range.";
  return errors;
}

export function rgwImportEntries(text: string, kind: "account" | "user") {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const entries = kind === "account" ? lines : lines.map(line => (line.includes("/") ? line.split("/", 2)[1] : line).trim());
  const invalid = lines.filter((_, index) => kind === "account" ? !/^RGW\d{17}$/.test(entries[index]) : !entries[index]);
  return {entries, error: !entries.length ? "Enter at least one identifier." : invalid.length ? `Invalid identifiers: ${invalid.join(", ")}` : undefined};
}
