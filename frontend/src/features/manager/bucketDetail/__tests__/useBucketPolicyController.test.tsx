import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketPolicyController } from "../useBucketPolicyController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketPolicy: vi.fn(),
  deleteCephAdminBucketPolicy: vi.fn(),
  getBucketPolicy: vi.fn(),
  getCephAdminBucketPolicy: vi.fn(),
  putBucketPolicy: vi.fn(),
  putCephAdminBucketPolicy: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketPolicy: (...args: unknown[]) => apiMocks.deleteBucketPolicy(...args),
  getBucketPolicy: (...args: unknown[]) => apiMocks.getBucketPolicy(...args),
  putBucketPolicy: (...args: unknown[]) => apiMocks.putBucketPolicy(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketPolicy: (...args: unknown[]) => apiMocks.deleteCephAdminBucketPolicy(...args),
  getCephAdminBucketPolicy: (...args: unknown[]) => apiMocks.getCephAdminBucketPolicy(...args),
  putCephAdminBucketPolicy: (...args: unknown[]) => apiMocks.putCephAdminBucketPolicy(...args),
}));

function renderPolicy(
  overrides: Partial<Parameters<typeof useBucketPolicyController>[0]> = {},
) {
  return renderHook(() =>
    useBucketPolicyController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const simplePolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "ReadObjects",
      Effect: "Allow",
      Principal: "*",
      Action: "s3:GetObject",
      Resource: "arn:aws:s3:::reports/*",
      Condition: {
        StringLike: {
          "s3:prefix": "public/*",
        },
      },
    },
  ],
};

describe("useBucketPolicyController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Manager visual edits local until Save and persists the complete policy", async () => {
    apiMocks.getBucketPolicy.mockResolvedValue({ policy: simplePolicy });
    apiMocks.putBucketPolicy.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, policy: unknown) => Promise.resolve({ policy }),
    );
    const { result } = renderPolicy();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftStatement(0, {
      actions: ["s3:GetObject", "s3:GetObjectVersion"],
    }));
    act(() => result.current.updateDraftCondition(0, "StringLike", "s3:prefix", ["public/*", "shared/*"]));

    expect(result.current.policy).toEqual(simplePolicy);
    expect(result.current.dirty).toBe(true);
    expect(apiMocks.putBucketPolicy).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketPolicy).not.toHaveBeenCalled();

    const expectedPolicy = result.current.draftPolicy;
    await act(async () => result.current.saveDraft());

    expect(apiMocks.putBucketPolicy).toHaveBeenCalledWith("acc-1", "reports", expectedPolicy);
    expect(result.current.policy).toEqual(expectedPolicy);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.status).toBe("Bucket policy updated");
    expect(result.current.dirty).toBe(false);
  });

  it("validates Visual statements before persistence", async () => {
    const { result } = renderPolicy();
    act(() => result.current.openEditor());
    act(() => result.current.addDraftStatement());

    await act(async () => result.current.saveDraft());
    expect(result.current.editorError).toBe("Statement1: at least one Action is required.");
    expect(apiMocks.putBucketPolicy).not.toHaveBeenCalled();

    act(() => result.current.updateDraftStatement(0, {
      actions: ["s3:GetObject"],
      resources: ["arn:aws:s3:::reports/*"],
    }));
    apiMocks.putBucketPolicy.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, policy: unknown) => Promise.resolve({ policy }),
    );
    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketPolicy).toHaveBeenCalledTimes(1);
  });

  it("keeps invalid JSON in JSON mode without calling an API", async () => {
    const { result } = renderPolicy();
    act(() => result.current.openEditor());
    act(() => result.current.updateEditorMode("json"));

    act(() => result.current.updateJsonText("{"));
    act(() => result.current.updateEditorMode("visual"));
    expect(result.current.editorMode).toBe("json");
    expect(result.current.editorError).toBe("Bucket policy JSON is invalid.");

    act(() => result.current.updateJsonText("[]"));
    await act(async () => result.current.saveDraft());
    expect(result.current.editorError).toBe("Bucket policy must be a JSON object.");

    act(() => result.current.updateJsonText('{"Statement":["invalid"]}'));
    await act(async () => result.current.saveDraft());
    expect(result.current.editorError).toBe("Policy Statement must be an object or an array of objects.");
    expect(apiMocks.putBucketPolicy).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketPolicy).not.toHaveBeenCalled();
  });

  it("round-trips JSON and preserves advanced statements exactly", async () => {
    const advancedStatement = {
      Sid: "Advanced",
      Effect: "Deny",
      Principal: {
        AWS: "arn:aws:iam::111122223333:root",
        Service: "example.amazonaws.com",
      },
      NotAction: "s3:GetObject",
      Resource: "arn:aws:s3:::reports/*",
      Condition: {
        NumericLessThan: { "s3:max-keys": 10 },
      },
      CustomCephField: { keep: true },
    };
    const advancedPolicy = {
      Version: "2012-10-17",
      Id: "keep-document-metadata",
      Statement: [advancedStatement],
      CustomTopLevel: { keep: true },
    };
    apiMocks.getBucketPolicy.mockResolvedValue({ policy: advancedPolicy });
    apiMocks.putBucketPolicy.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, policy: unknown) => Promise.resolve({ policy }),
    );
    const { result } = renderPolicy();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftStatement(0, { sid: "must-not-change" }));
    expect(result.current.draftPolicy).toEqual(advancedPolicy);

    act(() => result.current.updateEditorMode("json"));
    expect(JSON.parse(result.current.jsonText)).toEqual(advancedPolicy);
    act(() => result.current.updateEditorMode("visual"));
    expect(result.current.draftPolicy).toEqual(advancedPolicy);

    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketPolicy).toHaveBeenCalledWith("acc-1", "reports", advancedPolicy);
  });

  it("removes one statement inline while preserving policy metadata and untouched statements", async () => {
    const keepStatement = {
      Sid: "KeepMe",
      Effect: "Deny",
      Principal: "*",
      NotAction: "s3:DeleteObject",
      Resource: "arn:aws:s3:::reports/*",
      CustomStatementField: { keep: true },
    };
    const policy = {
      Version: "2012-10-17",
      Id: "document-id",
      Statement: [simplePolicy.Statement[0], keepStatement],
      CustomTopLevel: { keep: true },
    };
    apiMocks.getBucketPolicy.mockResolvedValue({ policy });
    apiMocks.putBucketPolicy.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, nextPolicy: unknown) => Promise.resolve({ policy: nextPolicy }),
    );
    const { result } = renderPolicy();

    await act(async () => result.current.load());
    await act(async () => result.current.removeStatementDirect(0));

    expect(apiMocks.putBucketPolicy).toHaveBeenCalledWith("acc-1", "reports", {
      Version: "2012-10-17",
      Id: "document-id",
      Statement: [keepStatement],
      CustomTopLevel: { keep: true },
    });
    expect(result.current.policy).toEqual({
      Version: "2012-10-17",
      Id: "document-id",
      Statement: [keepStatement],
      CustomTopLevel: { keep: true },
    });
  });

  it("deletes the Ceph Admin policy only when an empty draft is saved", async () => {
    apiMocks.getCephAdminBucketPolicy.mockResolvedValue({ policy: simplePolicy });
    apiMocks.deleteCephAdminBucketPolicy.mockResolvedValue(undefined);
    const { result } = renderPolicy({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.removeDraftStatement(0));

    expect(result.current.policy).toEqual(simplePolicy);
    expect(result.current.statementCount).toBe(1);
    expect(apiMocks.deleteCephAdminBucketPolicy).not.toHaveBeenCalled();

    await act(async () => result.current.saveDraft());
    expect(apiMocks.deleteCephAdminBucketPolicy).toHaveBeenCalledWith(7, "reports");
    expect(apiMocks.putCephAdminBucketPolicy).not.toHaveBeenCalled();
    expect(result.current.configured).toBe(false);
    expect(result.current.statementCount).toBe(0);
    expect(result.current.status).toBe("Bucket policy deleted");
  });

  it("persists non-empty Ceph Admin drafts through PUT", async () => {
    apiMocks.getCephAdminBucketPolicy.mockResolvedValue({ policy: simplePolicy });
    apiMocks.putCephAdminBucketPolicy.mockImplementation(
      (_endpointId: unknown, _bucketName: unknown, policy: unknown) => Promise.resolve({ policy }),
    );
    const { result } = renderPolicy({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftStatement(0, { effect: "Deny" }));
    const expected = result.current.draftPolicy;
    await act(async () => result.current.saveDraft());

    expect(apiMocks.putCephAdminBucketPolicy).toHaveBeenCalledWith(7, "reports", expected);
  });

  it("keeps the editor and draft after a failed save and supports retry", async () => {
    apiMocks.getBucketPolicy.mockResolvedValue({ policy: simplePolicy });
    apiMocks.putBucketPolicy.mockRejectedValueOnce(new Error("save failed"));
    const { result } = renderPolicy();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftStatement(0, { effect: "Deny" }));
    const failedDraft = result.current.draftPolicy;

    await act(async () => result.current.saveDraft());
    expect(result.current.editorOpen).toBe(true);
    expect(result.current.draftPolicy).toEqual(failedDraft);
    expect(result.current.policy).toEqual(simplePolicy);
    expect(result.current.editorError).toBeTruthy();

    apiMocks.putBucketPolicy.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, policy: unknown) => Promise.resolve({ policy }),
    );
    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketPolicy).toHaveBeenCalledTimes(2);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.policy).toEqual(failedDraft);
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const disabled = renderPolicy({ enabled: false });
    const missingEndpoint = renderPolicy({ cephAdmin: true, endpointId: null });

    await act(async () => disabled.result.current.load());
    act(() => disabled.result.current.openEditor());
    await act(async () => disabled.result.current.saveDraft());
    await act(async () => missingEndpoint.result.current.load());
    act(() => missingEndpoint.result.current.openEditor());
    await act(async () => missingEndpoint.result.current.saveDraft());

    expect(apiMocks.getBucketPolicy).not.toHaveBeenCalled();
    expect(apiMocks.putBucketPolicy).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketPolicy).not.toHaveBeenCalled();
    expect(apiMocks.getCephAdminBucketPolicy).not.toHaveBeenCalled();
    expect(apiMocks.putCephAdminBucketPolicy).not.toHaveBeenCalled();
    expect(apiMocks.deleteCephAdminBucketPolicy).not.toHaveBeenCalled();
  });
});
