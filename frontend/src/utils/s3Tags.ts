/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

/** S3 keys and values are literal. Only a completely empty draft row is omitted. */
export function prepareS3Tags(tags: ReadonlyArray<{ key: string; value: string }>) {
  const submitted = tags.map(({ key, value }) => ({ key, value }));
  if (submitted.some((tag) => !tag.key && tag.value.length > 0)) {
    throw new Error("Tag key is required when a value is provided.");
  }
  const filtered = submitted.filter((tag) => tag.key.length > 0);
  const seen = new Set<string>();
  for (const tag of filtered) {
    if (seen.has(tag.key)) throw new Error(`Duplicate tag key: ${tag.key}`);
    seen.add(tag.key);
  }
  return filtered;
}
