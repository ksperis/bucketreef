import { QUOTA_SIZE_UNIT_BYTES, QUOTA_SIZE_UNITS } from "./quotaUnits";

describe("quota size units", () => {
  it("defines the canonical API units", () => {
    expect(QUOTA_SIZE_UNITS).toEqual(["MiB", "GiB", "TiB"]);
  });

  it("maps each canonical unit to its byte factor", () => {
    expect(QUOTA_SIZE_UNIT_BYTES).toEqual({
      MiB: 1024 ** 2,
      GiB: 1024 ** 3,
      TiB: 1024 ** 4,
    });
  });
});
