import {
  buildCreateAccountDraft,
  buildImportAccountDraft,
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

});
