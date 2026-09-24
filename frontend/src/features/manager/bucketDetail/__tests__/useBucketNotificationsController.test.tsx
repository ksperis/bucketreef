import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketNotificationsController } from "../useBucketNotificationsController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketNotifications: vi.fn(),
  deleteCephAdminBucketNotifications: vi.fn(),
  getBucketNotifications: vi.fn(),
  getCephAdminBucketNotifications: vi.fn(),
  putBucketNotifications: vi.fn(),
  putCephAdminBucketNotifications: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketNotifications: (...args: unknown[]) =>
    apiMocks.deleteBucketNotifications(...args),
  getBucketNotifications: (...args: unknown[]) =>
    apiMocks.getBucketNotifications(...args),
  putBucketNotifications: (...args: unknown[]) =>
    apiMocks.putBucketNotifications(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketNotifications: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketNotifications(...args),
  getCephAdminBucketNotifications: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketNotifications(...args),
  putCephAdminBucketNotifications: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketNotifications(...args),
}));

function renderNotifications(
  overrides: Partial<Parameters<typeof useBucketNotificationsController>[0]> = {},
) {
  return renderHook(() =>
    useBucketNotificationsController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const initialTopic = {
  Id: "created",
  TopicArn: "arn:aws:sns:default:acc-1:events",
  Events: ["s3:ObjectCreated:*"],
};

describe("useBucketNotificationsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Manager visual edits local until Save, then PUTs the complete configuration", async () => {
    const initial = { TopicConfigurations: [initialTopic] };
    const updated = {
      TopicConfigurations: [
        {
          ...initialTopic,
          Id: "uploads",
          Filter: { Key: { FilterRules: [{ Name: "prefix", Value: "uploads/" }] } },
        },
      ],
    };
    apiMocks.getBucketNotifications.mockResolvedValue({ configuration: initial });
    apiMocks.putBucketNotifications.mockResolvedValue({ configuration: updated });
    const { result } = renderNotifications();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftTopic(0, { id: "uploads", prefix: "uploads/" }));

    expect(result.current.dirty).toBe(true);
    expect(apiMocks.putBucketNotifications).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketNotifications).not.toHaveBeenCalled();

    await act(async () => result.current.saveDraft());

    expect(apiMocks.putBucketNotifications).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      updated,
    );
    expect(apiMocks.getBucketNotifications).toHaveBeenCalledTimes(1);
    expect(result.current.configuration).toEqual(updated);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.status).toBe("Notifications updated.");
  });

  it("keeps invalid JSON in JSON mode and does not persist it", async () => {
    apiMocks.getBucketNotifications.mockResolvedValue({ configuration: {} });
    const { result } = renderNotifications();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateEditorMode("json"));
    act(() => result.current.updateJsonText("{"));
    act(() => result.current.updateEditorMode("visual"));

    expect(result.current.editorMode).toBe("json");
    expect(result.current.editorError).toBe("Notification configuration JSON is invalid.");

    await act(async () => result.current.saveDraft());
    expect(result.current.editorOpen).toBe(true);
    expect(apiMocks.putBucketNotifications).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketNotifications).not.toHaveBeenCalled();

    act(() => result.current.updateJsonText("[]"));
    await act(async () => result.current.saveDraft());
    expect(result.current.editorError).toBe(
      "Notification configuration must be a JSON object.",
    );
  });

  it("round-trips advanced notification structures without changing them", async () => {
    const advancedTopic = {
      Id: "advanced",
      TopicArn: "arn:aws:sns:default:acc-1:advanced",
      Events: ["s3:ObjectRemoved:*"],
      Filter: {
        Key: {
          FilterRules: [
            { Name: "prefix", Value: "archive/" },
            { Name: "custom", Value: "kept" },
          ],
        },
      },
      CustomField: { nested: true },
    };
    const initial = {
      TopicConfigurations: [initialTopic, advancedTopic],
      QueueConfigurations: [
        { Id: "queue", QueueArn: "arn:aws:sqs:default:acc-1:q", Events: ["s3:ObjectCreated:*"] },
      ],
    };
    apiMocks.getBucketNotifications.mockResolvedValue({ configuration: initial });
    const { result } = renderNotifications();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftTopic(0, { suffix: ".json" }));
    const advancedBefore = structuredClone(
      (result.current.draftConfiguration.TopicConfigurations as unknown[])[1],
    );
    const queueBefore = structuredClone(result.current.draftConfiguration.QueueConfigurations);

    act(() => result.current.updateEditorMode("json"));
    const serialized = JSON.parse(result.current.jsonText);
    expect(serialized.TopicConfigurations[1]).toEqual(advancedBefore);
    expect(serialized.QueueConfigurations).toEqual(queueBefore);

    act(() => result.current.updateEditorMode("visual"));
    expect((result.current.draftConfiguration.TopicConfigurations as unknown[])[1]).toEqual(
      advancedBefore,
    );
    expect(result.current.draftConfiguration.QueueConfigurations).toEqual(queueBefore);
    expect(apiMocks.putBucketNotifications).not.toHaveBeenCalled();
  });

  it("PUTs Ceph Admin notifications through the same transactional editor", async () => {
    const initial = { TopicConfigurations: [initialTopic] };
    const updated = {
      TopicConfigurations: [
        { ...initialTopic, Events: ["s3:ObjectRemoved:*"] },
      ],
    };
    apiMocks.getCephAdminBucketNotifications.mockResolvedValue({ configuration: initial });
    apiMocks.putCephAdminBucketNotifications.mockResolvedValue({ configuration: updated });
    const { result } = renderNotifications({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftTopic(0, { events: ["s3:ObjectRemoved:*"] }));
    await act(async () => result.current.saveDraft());

    expect(apiMocks.putCephAdminBucketNotifications).toHaveBeenCalledWith(
      7,
      "reports",
      updated,
    );
    expect(apiMocks.getCephAdminBucketNotifications).toHaveBeenCalledTimes(1);
    expect(result.current.editorOpen).toBe(false);
  });

  it("DELETEs only on Save when the last Ceph Admin topic is removed", async () => {
    apiMocks.getCephAdminBucketNotifications.mockResolvedValue({
      configuration: { TopicConfigurations: [initialTopic] },
    });
    apiMocks.deleteCephAdminBucketNotifications.mockResolvedValue(undefined);
    const { result } = renderNotifications({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.removeDraftTopic(0));

    expect(apiMocks.deleteCephAdminBucketNotifications).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);

    await act(async () => result.current.saveDraft());

    expect(apiMocks.deleteCephAdminBucketNotifications).toHaveBeenCalledWith(7, "reports");
    expect(apiMocks.getCephAdminBucketNotifications).toHaveBeenCalledTimes(1);
    expect(result.current.configured).toBe(false);
    expect(result.current.topicCount).toBe(0);
    expect(result.current.status).toBe("Notifications cleared.");
  });

  it("keeps the draft open after a failed save and allows retry", async () => {
    const initial = { TopicConfigurations: [initialTopic] };
    apiMocks.getBucketNotifications.mockResolvedValue({ configuration: initial });
    apiMocks.putBucketNotifications
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockImplementationOnce((_accountId, _bucketName, configuration) =>
        Promise.resolve({ configuration }),
      );
    const { result } = renderNotifications();

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.updateDraftTopic(0, { id: "retry-me" }));
    await act(async () => result.current.saveDraft());

    expect(result.current.editorOpen).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(result.current.editorError).toBeTruthy();
    expect((result.current.draftConfiguration.TopicConfigurations as Array<{ Id: string }>)[0].Id).toBe(
      "retry-me",
    );

    await act(async () => result.current.saveDraft());
    expect(apiMocks.putBucketNotifications).toHaveBeenCalledTimes(2);
    expect(result.current.editorOpen).toBe(false);
    expect(result.current.status).toBe("Notifications updated.");
  });

  it("does not access APIs when the bucket context is unavailable", async () => {
    const { result } = renderNotifications({ enabled: false });

    await act(async () => result.current.load());
    act(() => result.current.openEditor());
    act(() => result.current.addDraftTopic());
    await act(async () => result.current.saveDraft());

    expect(apiMocks.getBucketNotifications).not.toHaveBeenCalled();
    expect(apiMocks.putBucketNotifications).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketNotifications).not.toHaveBeenCalled();
  });
});
