import { buildAdminQuotaSizeEditorValue } from "./adminQuotaForm";

describe("buildAdminQuotaSizeEditorValue", () => {
  it("keeps missing and whole GiB quota values in GiB", () => {
    expect(buildAdminQuotaSizeEditorValue()).toEqual({ value: "", unit: "GiB" });
    expect(buildAdminQuotaSizeEditorValue(null)).toEqual({ value: "", unit: "GiB" });
    expect(buildAdminQuotaSizeEditorValue(4)).toEqual({ value: "4", unit: "GiB" });
  });

  it("presents fractional GiB quota values as MiB", () => {
    expect(buildAdminQuotaSizeEditorValue(0.5)).toEqual({ value: "512", unit: "MiB" });
  });

  it.each([0, 0.5001, 1 / 1024 ** 2])("keeps an exact GiB value when converting it to whole MiB would change the limit: %s", value => {
    expect(buildAdminQuotaSizeEditorValue(value)).toEqual({ value: String(value), unit: "GiB" });
  });
});
