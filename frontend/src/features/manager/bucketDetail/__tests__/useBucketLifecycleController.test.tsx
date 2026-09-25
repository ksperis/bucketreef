import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketLifecycleController } from "../useBucketLifecycleController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketLifecycle: vi.fn(),
  deleteCephAdminBucketLifecycle: vi.fn(),
  getBucketLifecycle: vi.fn(),
  getCephAdminBucketLifecycle: vi.fn(),
  putBucketLifecycle: vi.fn(),
  putCephAdminBucketLifecycle: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketLifecycle: (...args: unknown[]) => apiMocks.deleteBucketLifecycle(...args),
  getBucketLifecycle: (...args: unknown[]) => apiMocks.getBucketLifecycle(...args),
  putBucketLifecycle: (...args: unknown[]) => apiMocks.putBucketLifecycle(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketLifecycle: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketLifecycle(...args),
  getCephAdminBucketLifecycle: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketLifecycle(...args),
  putCephAdminBucketLifecycle: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketLifecycle(...args),
}));

function renderLifecycle(
  overrides: Partial<Parameters<typeof useBucketLifecycleController>[0]> = {},
) {
  return renderHook(() =>
    useBucketLifecycleController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const existingRule = {
  ID: "expire-logs",
  Status: "Enabled",
  Filter: { Prefix: "logs/" },
  Expiration: { Days: 30 },
};

describe("useBucketLifecycleController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Manager visual edits local until Save and then persists the complete configuration", async () => {
    apiMocks.getBucketLifecycle.mockResolvedValue({ rules: [existingRule] });
    apiMocks.putBucketLifecycle.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, rules: unknown) => Promise.resolve({ rules }),
    );
    const { result } = renderLifecycle();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { status: "Disabled" }));
    act(() => result.current.addDraftRule());
    act(() => result.current.updateDraftRule(1, { expirationDays: "30" }));

    expect(result.current.rules).toEqual([existingRule]);
    expect(result.current.draftRules).toHaveLength(2);
    expect(result.current.draftRules[0].Status).toBe("Disabled");
    expect(result.current.draftRules[1].ID).toMatch(/^rule-/);
    expect(result.current.dirty).toBe(true);
    expect(apiMocks.putBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketLifecycle).not.toHaveBeenCalled();

    const expectedRules = result.current.draftRules;
    await act(async () => result.current.saveDraft());

    expect(apiMocks.putBucketLifecycle).toHaveBeenCalledWith("acc-1", "reports", expectedRules);
    expect(result.current.rules).toEqual(expectedRules);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.status).toBe("Lifecycle updated");
    expect(result.current.dirty).toBe(false);
  });

  it("validates JSON without leaving JSON mode or calling the API", async () => {
    const { result } = renderLifecycle();
    act(() => result.current.openEditor());
    act(() => result.current.updateEditorMode("json"));

    act(() => result.current.updateJsonText("{"));
    act(() => result.current.updateEditorMode("visual"));
    expect(result.current.editorMode).toBe("json");
    expect(result.current.editorError).toBe("Lifecycle rules JSON is invalid.");

    act(() => result.current.updateJsonText("{}"));
    await act(async () => result.current.saveDraft());
    expect(result.current.editorError).toBe("JSON must be an array of rules.");

    act(() => result.current.updateJsonText('["not-a-rule"]'));
    await act(async () => result.current.saveDraft());
    expect(result.current.editorError).toBe("Each lifecycle rule must be a JSON object.");
    expect(result.current.editorOpen).toBe(true);
    expect(apiMocks.putBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketLifecycle).not.toHaveBeenCalled();
  });

  it("round-trips JSON to Visual and preserves advanced rules exactly", async () => {
    const advancedRule = {
      ID: "advanced",
      Status: "Enabled",
      Filter: { And: { Prefix: "archive/", Tags: [{ Key: "tier", Value: "cold" }] } },
      Expiration: { Date: "2030-01-01T00:00:00Z" },
      CustomCephField: { keep: true },
    };
    const simpleRule = { ...existingRule, ID: "simple" };
    apiMocks.getBucketLifecycle.mockResolvedValue({ rules: [advancedRule] });
    apiMocks.putBucketLifecycle.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, rules: unknown) => Promise.resolve({ rules }),
    );
    const { result } = renderLifecycle();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateEditorMode("json"));
    expect(JSON.parse(result.current.jsonText)).toEqual([advancedRule]);

    act(() => result.current.updateJsonText(JSON.stringify([advancedRule, simpleRule], null, 2)));
    act(() => result.current.updateEditorMode("visual"));
    expect(result.current.draftRules).toEqual([advancedRule, simpleRule]);

    act(() => result.current.updateDraftRule(0, { id: "must-not-change" }));
    expect(result.current.draftRules[0]).toEqual(advancedRule);

    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketLifecycle).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      [advancedRule, simpleRule],
    );
  });

  it("targets row editors and preserves advanced fields during direct toggle and removal", async () => {
    const advancedRule = {
      ID: "advanced",
      Status: "Enabled",
      Filter: { And: { Prefix: "archive/", Tags: [{ Key: "tier", Value: "cold" }] } },
      Expiration: { Date: "2030-01-01T00:00:00Z" },
      CustomCephField: { keep: true },
    };
    const secondRule = { ...existingRule, ID: "second" };
    apiMocks.getBucketLifecycle.mockResolvedValue({ rules: [advancedRule, secondRule] });
    apiMocks.putBucketLifecycle.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, rules: unknown) => Promise.resolve({ rules }),
    );
    const { result } = renderLifecycle();

    await act(async () => result.current.load());
    act(() => result.current.openEditorFor(1));
    expect(result.current.editorOpen).toBe(true);
    expect(result.current.editorTargetIndex).toBe(1);
    expect(result.current.draftRules).toEqual([advancedRule, secondRule]);

    act(() => result.current.closeEditor());
    act(() => result.current.openEditorWithNew());
    expect(result.current.editorTargetIndex).toBe(2);
    expect(result.current.draftRules).toHaveLength(3);
    act(() => result.current.closeEditor());

    act(() => result.current.setRuleEnabled(0, false));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(apiMocks.putBucketLifecycle).toHaveBeenNthCalledWith(1, "acc-1", "reports", [
      { ...advancedRule, Status: "Disabled" },
      secondRule,
    ]);

    act(() => result.current.removeRuleDirect(1));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(apiMocks.putBucketLifecycle).toHaveBeenNthCalledWith(2, "acc-1", "reports", [
      { ...advancedRule, Status: "Disabled" },
    ]);
    expect(result.current.rules).toEqual([{ ...advancedRule, Status: "Disabled" }]);
  });

  it("deletes Lifecycle only when an empty Ceph Admin draft is saved", async () => {
    apiMocks.getCephAdminBucketLifecycle.mockResolvedValue({ rules: [existingRule] });
    apiMocks.deleteCephAdminBucketLifecycle.mockResolvedValue(undefined);
    const { result } = renderLifecycle({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.removeDraftRule(0));

    expect(result.current.draftRules).toEqual([]);
    expect(result.current.rules).toEqual([existingRule]);
    expect(apiMocks.deleteCephAdminBucketLifecycle).not.toHaveBeenCalled();

    await act(async () => result.current.saveDraft());
    expect(apiMocks.deleteCephAdminBucketLifecycle).toHaveBeenCalledWith(7, "reports");
    expect(apiMocks.putCephAdminBucketLifecycle).not.toHaveBeenCalled();
    expect(result.current.rules).toEqual([]);
    expect(result.current.status).toBe("Lifecycle deleted");
  });

  it("restores a removed rule without discarding other draft edits", async () => {
    const secondRule = { ...existingRule, ID: "expire-archive", Filter: { Prefix: "archive/" } };
    apiMocks.getBucketLifecycle.mockResolvedValue({ rules: [existingRule, secondRule] });
    const { result } = renderLifecycle();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { expirationDays: "45" }));
    act(() => result.current.removeDraftRule(1));

    expect(result.current.draftRules).toEqual([
      { ...existingRule, Expiration: { Days: 45 } },
    ]);
    expect(result.current.lastRemovedRule?.rule).toEqual(secondRule);

    act(() => result.current.restoreLastRemovedRule());
    expect(result.current.draftRules).toEqual([
      { ...existingRule, Expiration: { Days: 45 } },
      secondRule,
    ]);
    expect(result.current.lastRemovedRule).toBeNull();
  });

  it("blocks an incomplete transition and preserves a storage class entered before Days", async () => {
    apiMocks.putBucketLifecycle.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, rules: unknown) => Promise.resolve({ rules }),
    );
    const { result } = renderLifecycle();

    act(() => result.current.openEditor());
    act(() => result.current.addDraftRule());
    act(() =>
      result.current.updateDraftRule(0, { transitionStorageClass: "DEEP_ARCHIVE" }),
    );

    expect(result.current.draftRules[0].Transitions).toEqual([
      { StorageClass: "DEEP_ARCHIVE" },
    ]);
    await act(async () => result.current.saveDraft());
    expect(result.current.editorError).toContain("requires both Days and Storage class");
    expect(apiMocks.putBucketLifecycle).not.toHaveBeenCalled();

    act(() => result.current.updateDraftRule(0, { transitionDays: "30" }));
    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketLifecycle).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      [
        expect.objectContaining({
          Transitions: [{ Days: 30, StorageClass: "DEEP_ARCHIVE" }],
        }),
      ],
    );
  });

  it("persists non-empty Ceph Admin drafts through PUT", async () => {
    apiMocks.getCephAdminBucketLifecycle.mockResolvedValue({ rules: [existingRule] });
    apiMocks.putCephAdminBucketLifecycle.mockImplementation(
      (_endpointId: unknown, _bucketName: unknown, rules: unknown) => Promise.resolve({ rules }),
    );
    const { result } = renderLifecycle({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { expirationDays: "45" }));
    await act(async () => result.current.saveDraft());

    expect(apiMocks.putCephAdminBucketLifecycle).toHaveBeenCalledWith(
      7,
      "reports",
      [{ ...existingRule, Expiration: { Days: 45 } }],
    );
  });

  it("keeps the editor and draft intact after a failed save so the user can retry", async () => {
    apiMocks.getBucketLifecycle.mockResolvedValue({ rules: [existingRule] });
    apiMocks.putBucketLifecycle.mockRejectedValueOnce(new Error("save failed"));
    const { result } = renderLifecycle();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { expirationDays: "60" }));
    const failedDraft = result.current.draftRules;

    await act(async () => result.current.saveDraft());
    expect(result.current.editorOpen).toBe(true);
    expect(result.current.draftRules).toEqual(failedDraft);
    expect(result.current.rules).toEqual([existingRule]);
    expect(result.current.editorError).toContain("save failed");

    apiMocks.putBucketLifecycle.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, rules: unknown) => Promise.resolve({ rules }),
    );
    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketLifecycle).toHaveBeenCalledTimes(2);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.rules).toEqual(failedDraft);
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const disabled = renderLifecycle({ enabled: false });
    const missingEndpoint = renderLifecycle({ cephAdmin: true, endpointId: null });

    await act(async () => disabled.result.current.load());
    act(() => disabled.result.current.openEditor());
    await act(async () => disabled.result.current.saveDraft());
    await act(async () => missingEndpoint.result.current.load());
    act(() => missingEndpoint.result.current.openEditor());
    await act(async () => missingEndpoint.result.current.saveDraft());

    expect(apiMocks.getBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.putBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.getCephAdminBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.putCephAdminBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.deleteCephAdminBucketLifecycle).not.toHaveBeenCalled();
  });
});
