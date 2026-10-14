/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

export function iamPathFormatError(value: string): string | undefined {
  if (value.length > 512) return "IAM path must be at most 512 characters.";
  if (value === "/") return undefined;
  if (!value.startsWith("/") || !value.endsWith("/") || value.length < 3) {
    return "IAM path must be '/' or start and end with '/'.";
  }
  for (const character of value.slice(1, -1)) {
    const code = character.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) return "IAM path contains unsupported characters.";
  }
  return undefined;
}

export function roleMaxSessionDurationError(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 3600 || value > 43200) {
    return "Maximum session duration must be between 3600 and 43200 seconds.";
  }
  return undefined;
}
