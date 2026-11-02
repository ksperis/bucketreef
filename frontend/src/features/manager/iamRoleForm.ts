/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

export const EMPTY_ASSUME_ROLE_DOCUMENT = "";
export const DEFAULT_ROLE_PATH = "/";

/** JSON syntax validation only; IAM policy semantics remain server-owned. */
export function parseIamRolePolicy(text: string):
  | { document: Record<string, unknown>; error: undefined }
  | { document: undefined; error: string } {
  if (!text.trim()) return { document: undefined, error: "Assume role policy is required." };
  try {
    return { document: JSON.parse(text) as Record<string, unknown>, error: undefined };
  } catch {
    return { document: undefined, error: "Assume role policy must be valid JSON." };
  }
}
