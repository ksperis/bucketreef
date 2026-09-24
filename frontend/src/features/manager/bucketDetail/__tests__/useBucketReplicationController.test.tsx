import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketReplicationController } from "../useBucketReplicationController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketReplication: vi.fn(),
  deleteCephAdminBucketReplication: vi.fn(),
  getBucketReplication: vi.fn(),
  getCephAdminBucketReplication: vi.fn(),
  putBucketReplication: vi.fn(),
  putCephAdminBucketReplication: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketReplication: (...args: unknown[]) =>
    apiMocks.deleteBucketReplication(...args),
  getBucketReplication: (...args: unknown[]) =>
    apiMocks.getBucketReplication(...args),
  putBucketReplication: (...args: unknown[]) =>
    apiMocks.putBucketReplication(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketReplication: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketReplication(...args),
  getCephAdminBucketReplication: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketReplication(...args),
  putCephAdminBucketReplication: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketReplication(...args),
}));

function renderReplication(
  overrides: Partial<Parameters<typeof useBucketReplicationController>[0]> = {},
) {
  return renderHook(() =>
    useBucketReplicationController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const graphicalConfiguration = {
  Role: "arn:aws:iam::123456789012:role/replication-role",
  Rules: [
    {
      ID: "archive",
      Status: "Enabled",
      Priority: 4,
      Filter: { Prefix: "logs/" },
      Destination: { Bucket: "arn:aws:s3:::archive" },
      DeleteMarkerReplication: { Status: "Disabled" },
    },
  ],
};

describe("useBucketReplicationController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a Manager summary and copies it into a modal draft", async () => {
    apiMocks.getBucketReplication.mockResolvedValue({
      configuration: graphicalConfiguration,
    });
    const { result } = renderReplication();

    await act(async () => result.current.load());

    expect(apiMocks.getBucketReplication).toHaveBeenCalledWith(
      "acc-1",
      "reports",
    );
    expect(result.current.configured).toBe(true);
    expect(result.current.ruleCount).toBe(1);
    expect(result.current.summaryRole).toBe(graphicalConfiguration.Role);
    expect(result.current.editorOpen).toBe(false);

    act(() => result.current.openEditor());

    expect(result.current.editorOpen).toBe(true);
    expect(result.current.editorMode).toBe("visual");
    expect(result.current.role).toBe(graphicalConfiguration.Role);
    expect(result.current.rules).toHaveLength(1);
    expect(result.current.rules[0].rule).toEqual(graphicalConfiguration.Rules[0]);
    expect(result.current.dirty).toBe(false);
  });

  it("keeps visual edits local and persists the complete configuration only on Save", async () => {
    apiMocks.getBucketReplication.mockResolvedValue({
      configuration: graphicalConfiguration,
    });
    apiMocks.putBucketReplication.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, configuration: unknown) =>
        Promise.resolve({ configuration }),
    );
    const { result } = renderReplication();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    const uiId = result.current.rules[0].uiId;

    act(() => {
      result.current.updateRole("arn:aws:iam::123456789012:role/new-role");
      result.current.updateRule(uiId, {
        status: "Disabled",
        priority: "8",
        prefix: "archive/",
        destinationBucket: "arn:aws:s3:::new-target",
        deleteMarkerStatus: "Enabled",
      });
    });

    expect(result.current.dirty).toBe(true);
    expect(apiMocks.putBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketReplication).not.toHaveBeenCalled();

    await act(async () => result.current.saveDraft());

    expect(apiMocks.putBucketReplication).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      {
        Role: "arn:aws:iam::123456789012:role/new-role",
        Rules: [
          {
            ID: "archive",
            Status: "Disabled",
            Priority: 8,
            Filter: { Prefix: "archive/" },
            Destination: { Bucket: "arn:aws:s3:::new-target" },
            DeleteMarkerReplication: { Status: "Enabled" },
          },
        ],
      },
    );
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.summaryRole).toBe(
      "arn:aws:iam::123456789012:role/new-role",
    );
    expect(result.current.status).toBe("Replication configuration updated.");
  });

  it("deletes replication only when an empty draft is saved", async () => {
    apiMocks.getCephAdminBucketReplication.mockResolvedValue({
      configuration: graphicalConfiguration,
    });
    apiMocks.deleteCephAdminBucketReplication.mockResolvedValue(undefined);
    const { result } = renderReplication({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    const uiId = result.current.rules[0].uiId;

    act(() => result.current.removeRule(uiId));

    expect(result.current.rules).toHaveLength(0);
    expect(result.current.dirty).toBe(true);
    expect(apiMocks.deleteCephAdminBucketReplication).not.toHaveBeenCalled();

    await act(async () => result.current.saveDraft());

    expect(apiMocks.deleteCephAdminBucketReplication).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.configured).toBe(false);
    expect(result.current.ruleCount).toBe(0);
    expect(result.current.editorOpen).toBe(false);
  });

  it("validates JSON before returning to Visual and keeps the user on JSON", async () => {
    apiMocks.getBucketReplication.mockResolvedValue({
      configuration: graphicalConfiguration,
    });
    const { result } = renderReplication();

    await act(async () => result.current.load());
    act(() => {
      result.current.openEditor();
      result.current.updateEditorMode("json");
    });

    act(() => result.current.updateJsonText("{"));
    act(() => result.current.updateEditorMode("visual"));
    expect(result.current.editorMode).toBe("json");
    expect(result.current.editorError).toBe(
      "Replication configuration JSON is invalid.",
    );

    act(() => result.current.updateJsonText('{"Rules":{}}'));
    act(() => result.current.updateEditorMode("visual"));
    expect(result.current.editorMode).toBe("json");
    expect(result.current.editorError).toBe(
      "Replication configuration Rules must be an array.",
    );
    expect(apiMocks.putBucketReplication).not.toHaveBeenCalled();
  });

  it("round-trips advanced rules without rewriting them in Visual mode", async () => {
    const advancedRule = {
      ID: "advanced",
      Status: "Enabled",
      Filter: { Prefix: "logs/", Tag: { Key: "team", Value: "storage" } },
      Destination: {
        Bucket: "arn:aws:s3:::archive",
        StorageClass: "STANDARD_IA",
      },
      DeleteMarkerReplication: { Status: "Disabled" },
      ExistingObjectReplication: { Status: "Enabled" },
    };
    const advancedConfiguration = {
      Role: graphicalConfiguration.Role,
      Rules: [advancedRule],
      ExtraTopLevel: { keep: true },
    };
    apiMocks.getBucketReplication.mockResolvedValue({
      configuration: advancedConfiguration,
    });
    const { result } = renderReplication();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());

    expect(result.current.advancedRuleCount).toBe(1);
    expect(result.current.hasAdvancedTopLevelFields).toBe(true);
    expect(result.current.rules[0].rule).toEqual(advancedRule);
    const uiId = result.current.rules[0].uiId;

    act(() => result.current.updateRule(uiId, { status: "Disabled" }));
    expect(result.current.rules[0].rule).toEqual(advancedRule);
    expect(result.current.dirty).toBe(false);

    act(() => result.current.updateEditorMode("json"));
    expect(JSON.parse(result.current.jsonText)).toEqual(advancedConfiguration);
    act(() => result.current.updateEditorMode("visual"));

    expect(result.current.rules[0].rule).toEqual(advancedRule);
    expect(result.current.dirty).toBe(false);
  });

  it("keeps the modal draft after a failed save and supports retry", async () => {
    apiMocks.getBucketReplication.mockResolvedValue({
      configuration: graphicalConfiguration,
    });
    apiMocks.putBucketReplication
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockImplementationOnce(
        (_accountId: unknown, _bucketName: unknown, configuration: unknown) =>
          Promise.resolve({ configuration }),
      );
    const { result } = renderReplication();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    const uiId = result.current.rules[0].uiId;
    act(() =>
      result.current.updateRule(uiId, {
        destinationBucket: "arn:aws:s3:::retry-target",
      }),
    );

    await act(async () => result.current.saveDraft());

    expect(result.current.editorOpen).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(result.current.rules[0].rule).toMatchObject({
      Destination: { Bucket: "arn:aws:s3:::retry-target" },
    });
    expect(result.current.editorError).toBeTruthy();

    await act(async () => result.current.saveDraft());

    expect(apiMocks.putBucketReplication).toHaveBeenCalledTimes(2);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it("saves a supported Ceph Admin visual draft through the Ceph Admin API", async () => {
    apiMocks.getCephAdminBucketReplication.mockResolvedValue({
      configuration: graphicalConfiguration,
    });
    apiMocks.putCephAdminBucketReplication.mockImplementation(
      (_endpointId: unknown, _bucketName: unknown, configuration: unknown) =>
        Promise.resolve({ configuration }),
    );
    const { result } = renderReplication({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    const uiId = result.current.rules[0].uiId;
    act(() => result.current.updateRule(uiId, { priority: "9" }));

    await act(async () => result.current.saveDraft());

    expect(apiMocks.putCephAdminBucketReplication).toHaveBeenCalledWith(
      7,
      "reports",
      expect.objectContaining({
        Role: graphicalConfiguration.Role,
        Rules: [expect.objectContaining({ Priority: 9 })],
      }),
    );
  });

  it("preserves unsupported Zone in the draft but rejects it before PUT", async () => {
    const zoneConfiguration = {
      Role: graphicalConfiguration.Role,
      Rules: [
        {
          ID: "zone-rule",
          Status: "Enabled",
          Destination: {
            Bucket: "arn:aws:s3:::archive",
            Zone: "zone-a",
          },
        },
      ],
    };
    apiMocks.getBucketReplication.mockResolvedValue({
      configuration: zoneConfiguration,
    });
    const { result } = renderReplication();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    expect(result.current.advancedRuleCount).toBe(1);
    expect(result.current.hasUnsupportedZone).toBe(true);

    await act(async () => result.current.saveDraft());

    expect(result.current.editorError).toBe(
      "Destination.Zone is not supported in V1.",
    );
    expect(result.current.editorOpen).toBe(true);
    expect(apiMocks.putBucketReplication).not.toHaveBeenCalled();
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const disabled = renderReplication({ enabled: false });
    const missingEndpoint = renderReplication({
      cephAdmin: true,
      endpointId: null,
    });

    await act(async () => disabled.result.current.load());
    act(() => disabled.result.current.openEditor());
    await act(async () => disabled.result.current.saveDraft());

    await act(async () => missingEndpoint.result.current.load());
    act(() => missingEndpoint.result.current.openEditor());
    await act(async () => missingEndpoint.result.current.saveDraft());

    expect(apiMocks.getBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.putBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.getCephAdminBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.putCephAdminBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.deleteCephAdminBucketReplication).not.toHaveBeenCalled();
  });
});
