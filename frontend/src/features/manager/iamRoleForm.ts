/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

/** JSON syntax validation only; IAM policy semantics remain server-owned. */
export function parseIamRolePolicy(text: string):
  | { document: Record<string, unknown>; error?: never }
  | { document?: never; error: string } {
  try {
    return { document: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { error: "Assume role policy must be valid JSON." };
  }
}
