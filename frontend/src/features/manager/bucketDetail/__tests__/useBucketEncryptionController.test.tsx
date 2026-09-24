import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketEncryptionController } from "../useBucketEncryptionController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketEncryption: vi.fn(),
  deleteCephAdminBucketEncryption: vi.fn(),
  getBucketEncryption: vi.fn(),
  getCephAdminBucketEncryption: vi.fn(),
  putBucketEncryption: vi.fn(),
  putCephAdminBucketEncryption: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketEncryption: (...args: unknown[]) =>
    apiMocks.deleteBucketEncryption(...args),
  getBucketEncryption: (...args: unknown[]) =>
    apiMocks.getBucketEncryption(...args),
  putBucketEncryption: (...args: unknown[]) =>
    apiMocks.putBucketEncryption(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketEncryption: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketEncryption(...args),
  getCephAdminBucketEncryption: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketEncryption(...args),
  putCephAdminBucketEncryption: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketEncryption(...args),
}));

function renderEncryption(
  overrides: Partial<Parameters<typeof useBucketEncryptionController>[0]> = {},
) {
  return renderHook(() =>
    useBucketEncryptionController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketEncryptionController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Manager visual edits local until Save and persists the complete draft", async () => {
    apiMocks.getBucketEncryption.mockResolvedValue({
      rules: [
        {
          ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
        },
      ],
    });
    const savedRules = [
      {
        ApplyServerSideEncryptionByDefault: {
          SSEAlgorithm: "aws:kms",
          KMSMasterKeyID: "key-1",
        },
        BucketKeyEnabled: true,
      },
    ];
    apiMocks.putBucketEncryption.mockResolvedValue({ rules: savedRules });
    const { result } = renderEncryption();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { algorithm: "aws:kms" }));
    act(() =>
      result.current.updateDraftRule(0, {
        kmsKeyId: "key-1",
        bucketKeyState: "enabled",
      }),
    );

    expect(result.current.dirty).toBe(true);
    expect(apiMocks.putBucketEncryption).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketEncryption).not.toHaveBeenCalled();

    act(() => result.current.updateEditorMode("json"));
    expect(JSON.parse(result.current.jsonText)).toEqual(savedRules);
    await act(async () => result.current.saveDraft());

    expect(apiMocks.putBucketEncryption).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      savedRules,
    );
    expect(result.current.rules).toEqual(savedRules);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.status).toBe("Bucket encryption updated.");
  });

  it("preserves advanced rules through Visual and JSON without rewriting them", async () => {
    const advancedRule = {
      ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms:dsse" },
      CustomProviderField: { keep: true },
    };
    apiMocks.getBucketEncryption.mockResolvedValue({ rules: [advancedRule] });
    const { result } = renderEncryption();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { bucketKeyState: "enabled" }));
    expect(result.current.draftRules).toEqual([advancedRule]);

    act(() => result.current.updateEditorMode("json"));
    expect(JSON.parse(result.current.jsonText)).toEqual([advancedRule]);
    act(() => result.current.updateEditorMode("visual"));
    expect(result.current.draftRules).toEqual([advancedRule]);
    expect(apiMocks.putBucketEncryption).not.toHaveBeenCalled();
  });

  it("keeps invalid JSON in JSON mode and performs no API call", async () => {
    apiMocks.getBucketEncryption.mockResolvedValue({ rules: [] });
    const { result } = renderEncryption();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateEditorMode("json"));
    act(() => result.current.updateJsonText("{}"));
    act(() => result.current.updateEditorMode("visual"));

    expect(result.current.editorMode).toBe("json");
    expect(result.current.editorError).toBe("Encryption JSON must be an array of rules.");
    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketEncryption).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketEncryption).not.toHaveBeenCalled();
    expect(result.current.editorOpen).toBe(true);
  });

  it("uses Ceph Admin PUT for a non-empty draft", async () => {
    apiMocks.getCephAdminBucketEncryption.mockResolvedValue({
      rules: [
        {
          ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
        },
      ],
    });
    apiMocks.putCephAdminBucketEncryption.mockImplementation(
      async (_endpointId: number, _bucketName: string, rules: unknown[]) => ({ rules }),
    );
    const { result } = renderEncryption({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { algorithm: "aws:kms" }));
    await act(async () => result.current.saveDraft());

    expect(apiMocks.putCephAdminBucketEncryption).toHaveBeenCalledWith(
      7,
      "reports",
      [
        {
          ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" },
        },
      ],
    );
    expect(apiMocks.deleteCephAdminBucketEncryption).not.toHaveBeenCalled();
  });

  it("deletes through Ceph Admin only when an empty draft is saved", async () => {
    apiMocks.getCephAdminBucketEncryption.mockResolvedValue({
      rules: [
        {
          ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
        },
      ],
    });
    apiMocks.deleteCephAdminBucketEncryption.mockResolvedValue(undefined);
    const { result } = renderEncryption({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.removeDraftRule(0));

    expect(apiMocks.deleteCephAdminBucketEncryption).not.toHaveBeenCalled();
    await act(async () => result.current.saveDraft());

    expect(apiMocks.deleteCephAdminBucketEncryption).toHaveBeenCalledWith(7, "reports");
    expect(apiMocks.putCephAdminBucketEncryption).not.toHaveBeenCalled();
    expect(result.current.configured).toBe(false);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.status).toBe("Bucket encryption disabled.");
  });

  it("keeps the modal draft intact after a failed save so it can be retried", async () => {
    apiMocks.getBucketEncryption.mockResolvedValue({
      rules: [
        {
          ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
        },
      ],
    });
    apiMocks.putBucketEncryption.mockRejectedValue(new Error("provider failure"));
    const { result } = renderEncryption();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftRule(0, { algorithm: "aws:kms" }));
    const draftBeforeSave = result.current.draftRules;

    await act(async () => result.current.saveDraft());

    expect(result.current.editorOpen).toBe(true);
    expect(result.current.draftRules).toEqual(draftBeforeSave);
    expect(result.current.rules[0]).toEqual({
      ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
    });
    expect(result.current.editorError).toBeTruthy();
  });

  it("does not access encryption APIs when the feature is disabled", async () => {
    const { result } = renderEncryption({ enabled: false });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());

    expect(apiMocks.getBucketEncryption).not.toHaveBeenCalled();
    expect(apiMocks.putBucketEncryption).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketEncryption).not.toHaveBeenCalled();
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.rules).toEqual([]);
  });
});
