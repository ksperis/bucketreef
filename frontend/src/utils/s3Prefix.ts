/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export function parentS3Prefix(prefix: string): string {
  if (!prefix) return "";
  const withoutTrailingSlash = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const separatorIndex = withoutTrailingSlash.lastIndexOf("/");
  return separatorIndex < 0 ? "" : withoutTrailingSlash.slice(0, separatorIndex + 1);
}

export function recursiveS3PrefixesForKey(
  key: string,
  currentPrefix: string,
  isFolderMarker: boolean,
): string[] {
  const start = currentPrefix && key.startsWith(currentPrefix) ? currentPrefix.length : 0;
  const prefixes: string[] = [];
  for (let index = start; index < key.length; index += 1) {
    if (key[index] !== "/") continue;
    if (index === key.length - 1 && !isFolderMarker) continue;
    const prefix = key.slice(0, index + 1);
    if (prefix !== currentPrefix) prefixes.push(prefix);
  }
  return prefixes;
}
