/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { describe, expect, it } from "vitest";

import { canonicalizeUiTags } from "./uiTags";

describe("canonicalizeUiTags", () => {
  it("returns the same canonical value regardless of tag order", () => {
    const tags = [
      { id: 2, label: "Beta", color_key: "blue" as const, scope: "standard" as const },
      { id: 1, label: "Alpha", color_key: "red" as const, scope: "standard" as const },
    ];

    expect(canonicalizeUiTags(tags)).toEqual(canonicalizeUiTags([...tags].reverse()));
  });
});
