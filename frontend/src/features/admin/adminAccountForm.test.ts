import {
  adminAccountCreatePayload,
  buildCreateAccountDraft,
  buildImportAccountDraft,
  emptyAdminAccountCreateForm,
} from "./adminAccountForm";

describe("adminAccountForm", () => {
  it("normalizes create and import drafts before unsaved-change comparisons", () => {
    const form = {
      name: "Account",
      storage_endpoint_id: "10",
      tags: [
        { label: " Team ", color_key: "sky" as const, scope: "standard" as const },
        { label: "env", color_key: "neutral" as const, scope: "standard" as const },
      ],
    };

    expect(buildCreateAccountDraft(form, "10")).toEqual({
      form: {
        name: "Account",
        storage_endpoint_id: "",
        tags: [
          { id: undefined, label: "env", color_key: "neutral", scope: "standard" },
          { id: undefined, label: "Team", color_key: "sky", scope: "standard" },
        ],
      },
    });
    expect(buildImportAccountDraft("account-a", "10", "10")).toEqual({
      importText: "account-a",
      importTenantEndpointId: "",
    });
  });

  it("builds the create payload from normalized form values", () => {
    const form = {
      ...emptyAdminAccountCreateForm("10"),
      name: " Account ",
      rgw_tenant: " tenant-a ",
      email: " account@example.test ",
      tags: [{ label: " Team ", color_key: "sky" as const, scope: "standard" as const }],
      quota_max_size_gb: "2",
      quota_max_size_unit: "GiB",
      quota_max_objects: "100",
    };

    expect(adminAccountCreatePayload(form, true)).toEqual({
      name: "Account",
      rgw_tenant: "tenant-a",
      email: "account@example.test",
      tags: [{ id: undefined, label: "Team", color_key: "sky", scope: "standard" }],
      quota_max_size_gb: 2,
      quota_max_size_unit: "GiB",
      quota_max_objects: 100,
      storage_endpoint_id: 10,
    });
    expect(adminAccountCreatePayload(form, false).rgw_tenant).toBe("");
  });
});
