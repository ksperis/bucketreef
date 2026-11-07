import { describe, expect, it } from "vitest";

import { escapeCsvCell } from "./csv";

describe("escapeCsvCell", () => {
  it("quotes cells and escapes embedded quotes", () => {
    expect(escapeCsvCell("plain")).toBe('"plain"');
    expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
  });
});
