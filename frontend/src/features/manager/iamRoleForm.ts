/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

export const DEFAULT_ASSUME_ROLE_DOCUMENT = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: "*" },
        Action: "sts:AssumeRole",
      },
    ],
  },
  null,
  2
);
export const DEFAULT_ROLE_PATH = "/";

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
