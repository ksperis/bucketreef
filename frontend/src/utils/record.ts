export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: Iterable<string>,
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
