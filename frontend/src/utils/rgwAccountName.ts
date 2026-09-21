/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

export function rgwAccountNameFormatError(value: string): string | undefined {
  if (value.includes("$")) return "Account name must not contain '$'.";
  if (value.includes(":")) return "Account name must not contain ':'.";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) return "Account name must be valid UTF-8.";
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return "Account name must be valid UTF-8.";
    }
  }
  return undefined;
}
