import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketCorsController } from "../useBucketCorsController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketCors: vi.fn(),
  deleteCephAdminBucketCors: vi.fn(),
  getBucketCors: vi.fn(),
  getCephAdminBucketCors: vi.fn(),
  putBucketCors: vi.fn(),
  putCephAdminBucketCors: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketCors: (...args: unknown[]) => apiMocks.deleteBucketCors(...args),
  getBucketCors: (...args: unknown[]) => apiMocks.getBucketCors(...args),
  putBucketCors: (...args: unknown[]) => apiMocks.putBucketCors(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketCors: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketCors(...args),
  getCephAdminBucketCors: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketCors(...args),
  putCephAdminBucketCors: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketCors(...args),
}));

function renderCors(
  overrides: Partial<Parameters<typeof useBucketCorsController>[0]> = {},
) {
  return renderHook(() =>
    useBucketCorsController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketCorsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Manager visual edits local until Save, then PUTs the complete draft", async () => {
    apiMocks.getBucketCors.mockResolvedValue({
      rules: [{ AllowedMethods: ["GET"], AllowedOrigins: ["https://old.example"] }],
    });
    apiMocks.putBucketCors.mockImplementation(async (_accountId, _bucketName, rules) => ({ rules }));
    const { result } = renderCors();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, {
      allowedOrigins: ["https://app.example.com"],
      allowedMethods: ["GET", "PUT"],
      allowedHeaders: ["Content-Type"],
      exposeHeaders: ["ETag"],
      maxAgeSeconds: "3600",
    }));

    expect(result.current.dirty).toBe(true);
    expect(apiMocks.putBucketCors).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketCors).not.toHaveBeenCalled();

    await act(async () => result.current.saveDraft());

    expect(apiMocks.putBucketCors).toHaveBeenCalledWith("acc-1", "reports", [
      {
        AllowedOrigins: ["https://app.example.com"],
        AllowedMethods: ["GET", "PUT"],
        AllowedHeaders: ["Content-Type"],
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3600,
      },
    ]);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.rules[0]).toMatchObject({ MaxAgeSeconds: 3600 });
  });

  it("uses Ceph Admin PUT and keeps the same transactional boundary", async () => {
    apiMocks.getCephAdminBucketCors.mockResolvedValue({ rules: [] });
    apiMocks.putCephAdminBucketCors.mockImplementation(async (_endpointId, _bucketName, rules) => ({ rules }));
    const { result } = renderCors({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.addDraftRule());
    act(() => result.current.updateDraftRule(0, { allowedOrigins: ["https://admin.example"] }));
    expect(apiMocks.putCephAdminBucketCors).not.toHaveBeenCalled();

    await act(async () => result.current.saveDraft());

    expect(apiMocks.putCephAdminBucketCors).toHaveBeenCalledWith(7, "reports", [
      { AllowedOrigins: ["https://admin.example"], AllowedMethods: ["GET"] },
    ]);
  });

  it.each([
    { cephAdmin: false, endpointId: null, api: "manager" as const },
    { cephAdmin: true, endpointId: 7, api: "ceph" as const },
  ])("deletes only when an empty draft is saved ($api)", async ({ cephAdmin, endpointId }) => {
    const loaded = { rules: [{ AllowedMethods: ["GET"], AllowedOrigins: ["*"] }] };
    if (cephAdmin) apiMocks.getCephAdminBucketCors.mockResolvedValue(loaded);
    else apiMocks.getBucketCors.mockResolvedValue(loaded);
    apiMocks.deleteBucketCors.mockResolvedValue(undefined);
    apiMocks.deleteCephAdminBucketCors.mockResolvedValue(undefined);
    const { result } = renderCors({ cephAdmin, endpointId });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.removeDraftRule(0));

    expect(apiMocks.deleteBucketCors).not.toHaveBeenCalled();
    expect(apiMocks.deleteCephAdminBucketCors).not.toHaveBeenCalled();

    await act(async () => result.current.saveDraft());

    if (cephAdmin) {
      expect(apiMocks.deleteCephAdminBucketCors).toHaveBeenCalledWith(7, "reports");
    } else {
      expect(apiMocks.deleteBucketCors).toHaveBeenCalledWith("acc-1", "reports");
    }
    expect(result.current.rules).toEqual([]);
    expect(result.current.editorOpen).toBe(false);
  });

  it("round-trips Visual and JSON without losing advanced rules", async () => {
    const advancedRule = {
      ID: "advanced",
      AllowedMethods: ["GET"],
      AllowedOrigins: ["https://example.org"],
      CustomExtension: { preserve: [1, 2, 3] },
    };
    apiMocks.getBucketCors.mockResolvedValue({ rules: [advancedRule] });
    apiMocks.putBucketCors.mockImplementation(async (_accountId, _bucketName, rules) => ({ rules }));
    const { result } = renderCors();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    const originalAdvancedDraft = result.current.draftRules[0];
    act(() => result.current.updateDraftRule(0, { allowedOrigins: ["https://changed.example"] }));
    expect(result.current.draftRules[0]).toBe(originalAdvancedDraft);

    act(() => result.current.addDraftRule());
    act(() => result.current.updateDraftRule(1, { allowedOrigins: ["https://visual.example"] }));
    act(() => result.current.updateEditorMode("json"));
    expect(JSON.parse(result.current.jsonText)[0]).toEqual(advancedRule);

    act(() => result.current.updateEditorMode("visual"));
    expect(result.current.editorMode).toBe("visual");
    expect(result.current.draftRules[0]).toEqual(advancedRule);

    await act(async () => result.current.saveDraft());
    const savedRules = apiMocks.putBucketCors.mock.calls[0][2];
    expect(savedRules[0]).toEqual(advancedRule);
  });

  it("keeps invalid JSON on the JSON tab and rejects non-array JSON", async () => {
    apiMocks.getBucketCors.mockResolvedValue({ rules: [] });
    const { result } = renderCors();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateEditorMode("json"));
    act(() => result.current.updateJsonText("{"));
    act(() => result.current.updateEditorMode("visual"));

    expect(result.current.editorMode).toBe("json");
    expect(result.current.editorError).toBe("CORS rules JSON is invalid.");

    act(() => result.current.updateJsonText("{}"));
    await act(async () => result.current.saveDraft());
    expect(result.current.editorError).toBe("CORS JSON must be an array of rules.");
    expect(apiMocks.putBucketCors).not.toHaveBeenCalled();
  });

  it("validates supported Visual rules before persistence", async () => {
    apiMocks.getBucketCors.mockResolvedValue({ rules: [] });
    const { result } = renderCors();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.addDraftRule());
    await act(async () => result.current.saveDraft());

    expect(result.current.editorError).toBe("Rule 1: allowed origins cannot be empty.");
    expect(apiMocks.putBucketCors).not.toHaveBeenCalled();
  });

  it("keeps the modal and draft intact after a failed save so it can retry", async () => {
    apiMocks.getBucketCors.mockResolvedValue({
      rules: [{ AllowedMethods: ["GET"], AllowedOrigins: ["https://old.example"] }],
    });
    apiMocks.putBucketCors
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockImplementationOnce(async (_accountId, _bucketName, rules) => ({ rules }));
    const { result } = renderCors();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { allowedOrigins: ["https://new.example"] }));
    await act(async () => result.current.saveDraft());

    expect(result.current.editorOpen).toBe(true);
    expect(result.current.draftRules[0]).toMatchObject({ AllowedOrigins: ["https://new.example"] });
    expect(result.current.editorError).toBeTruthy();

    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketCors).toHaveBeenCalledTimes(2);
    expect(result.current.editorOpen).toBe(false);
  });
});
