import {
  adminRgwCreatePayload,
  adminRgwUserCreatePayload,
  emptyAdminRgwCreateForm,
  emptyAdminRgwUserCreateForm,
} from "./adminRgwCreateForm";

describe("adminRgwCreateForm", () => {
  it("builds normalized common create payload values", () => {
    const form = {
      ...emptyAdminRgwCreateForm("10"),
      name: " Account ",
      rgw_tenant: " tenant-a ",
      email: " account@example.test ",
      tags: [{ label: " Team ", color_key: "sky" as const, scope: "standard" as const }],
      quota_max_size_gb: "2",
      quota_max_objects: "100",
    };

    expect(adminRgwCreatePayload(form, true)).toEqual({
      name: "Account",
      rgw_tenant: "tenant-a",
      email: "account@example.test",
      tags: [{ id: undefined, label: "Team", color_key: "sky", scope: "standard" }],
      quota_max_size_gb: 2,
      quota_max_size_unit: "GiB",
      quota_max_objects: 100,
      storage_endpoint_id: 10,
    });
    expect(adminRgwCreatePayload(form, false).rgw_tenant).toBe("");
  });

  it("adds the normalized UID for S3 User creation", () => {
    const form = {
      ...emptyAdminRgwUserCreateForm("10"),
      name: " RGW User ",
      uid: " user-a ",
    };

    expect(adminRgwUserCreatePayload(form, true)).toEqual({
      name: "RGW User",
      uid: "user-a",
      rgw_tenant: "",
      email: undefined,
      tags: [],
      quota_max_size_gb: undefined,
      quota_max_size_unit: undefined,
      quota_max_objects: undefined,
      storage_endpoint_id: 10,
    });
  });
});
