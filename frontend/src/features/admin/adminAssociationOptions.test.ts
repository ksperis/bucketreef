import { describe, expect, it } from "vitest";
import { buildAdminAssociationLookup } from "./adminAssociationOptions";

describe("buildAdminAssociationLookup", () => {
  it("indexes association values by id", () => {
    const lookup = buildAdminAssociationLookup(
      [[
        { id: 1, name: "Alpha" },
        { id: 2, name: "Beta" },
      ]],
      (item) => item.id,
      (item) => item.name,
    );

    expect([...lookup.entries()]).toEqual([
      [1, "Alpha"],
      [2, "Beta"],
    ]);
  });

  it("lets later catalogues refresh persisted labels", () => {
    const lookup = buildAdminAssociationLookup(
      [
        [{ id: 1, name: "Persisted" }, { id: 2, name: "Selected only" }],
        [{ id: 1, name: "Current" }],
      ],
      (item) => item.id,
      (item) => item.name,
    );

    expect([...lookup.entries()]).toEqual([
      [1, "Current"],
      [2, "Selected only"],
    ]);
  });
});
