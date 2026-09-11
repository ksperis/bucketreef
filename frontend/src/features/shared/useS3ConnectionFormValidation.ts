/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import type { S3ConnectionValidationField } from "./s3ConnectionFormModel";

type Result = { error: null } | { error: string; field: S3ConnectionValidationField };

/** Associate the existing payload validation with fields without duplicating its rules. */
export function useS3ConnectionFormValidation(result: Result, customEndpointUrl?: string) {
  const [attempted, setAttempted] = useState(false);
  const [invalidUrl, setInvalidUrl] = useState<string | null>(null);
  return {
    errorFor: (field: S3ConnectionValidationField): string | undefined => {
      if (!attempted) return undefined;
      if (result.error !== null && result.field === field) return result.error;
      if (field === "endpointUrl" && invalidUrl !== null && invalidUrl === customEndpointUrl) return "Enter a valid endpoint URL.";
      return undefined;
    },
    validate: (form: HTMLFormElement) => {
      setAttempted(true);
      // General fields may be unmounted while an association tab is selected.
      const url = document.createElement("input");
      url.type = "url";
      url.value = customEndpointUrl ?? "";
      const invalid = url.validity.typeMismatch;
      setInvalidUrl(invalid ? url.value : null);
      if (result.error !== null || invalid) {
        focusFirstInvalidField(form);
        return false;
      }
      return true;
    },
    reset: () => { setAttempted(false); setInvalidUrl(null); },
  };
}
