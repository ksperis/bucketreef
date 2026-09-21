import { describe, expect, it } from "vitest";

import { rgwAccountNameFormatError } from "./rgwAccountName";

describe("rgwAccountNameFormatError", () => {
  it.each(["Research Account", "Équipe données", "account 😀"])("accepts %s", (value) => {
    expect(rgwAccountNameFormatError(value)).toBeUndefined();
  });

  it.each([
    ["tenant:account", "Account name must not contain ':'."],
    ["tenant$account", "Account name must not contain '$'."],
    ["invalid\ud800", "Account name must be valid UTF-8."],
    ["invalid\udc00", "Account name must be valid UTF-8."],
  ])("rejects %s", (value, message) => {
    expect(rgwAccountNameFormatError(value)).toBe(message);
  });
});
