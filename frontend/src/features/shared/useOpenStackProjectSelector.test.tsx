import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "../../api/executionContexts";
import type { OpenStackProjectOption } from "../../api/openstack";
import { useOpenStackProjectSelector } from "./useOpenStackProjectSelector";

const apiMocks = vi.hoisted(() => ({
  activateOpenStackContext: vi.fn(),
  listOpenStackKeys: vi.fn(),
  listOpenStackProjectOptions: vi.fn(),
}));

vi.mock("../../api/openstack", () => ({
  activateOpenStackContext: apiMocks.activateOpenStackContext,
  listOpenStackKeys: apiMocks.listOpenStackKeys,
  listOpenStackProjectOptions: apiMocks.listOpenStackProjectOptions,
  openStackProjectOptionValue: (option: OpenStackProjectOption) =>
    `openstack-project-option:${option.connection_id}:${option.project_id}`,
}));

vi.mock("./openstackMessages", () => ({
  useOpenStackI18n: () => ({
    text: (message: string) => message,
    errorText: (failure: unknown) => failure instanceof Error ? failure.message : String(failure),
  }),
}));

const projectOption: OpenStackProjectOption = {
  connection_id: "conn-1",
  cloud_id: 1,
  cloud_name: "Cloud A",
  identity_name: "Person",
  keystone_user_id: "keystone-user",
  project_id: "project-a",
  project_name: "Project A",
  project_domain_id: "domain-a",
  endpoints: [{ id: 7, name: "S3", region: "region-a" }],
};

describe("useOpenStackProjectSelector", () => {
  beforeEach(() => {
    apiMocks.activateOpenStackContext.mockReset();
    apiMocks.listOpenStackKeys.mockReset();
    apiMocks.listOpenStackProjectOptions.mockReset();
    apiMocks.listOpenStackProjectOptions.mockResolvedValue([projectOption]);
  });

  it("refreshes executable contexts before navigating to an activated OpenStack project", async () => {
    apiMocks.listOpenStackKeys.mockResolvedValue(["ACCESS-1"]);
    apiMocks.activateOpenStackContext.mockResolvedValue("os-existing");
    const refreshContexts = vi.fn(async () => [
      { id: "os-existing", kind: "openstack_project" } as ExecutionContext,
    ]);
    const onActivated = vi.fn();
    const fallback = vi.fn();

    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      refreshContexts,
      onActivated,
    }));

    await waitFor(() => expect(result.current.candidateCount).toBe(1));

    act(() => {
      result.current.handleContextChange(
        "openstack-project-option:conn-1:project-a",
        fallback,
      );
    });

    await waitFor(() => expect(onActivated).toHaveBeenCalledWith("os-existing"));
    expect(fallback).not.toHaveBeenCalled();
    expect(apiMocks.listOpenStackKeys).toHaveBeenCalledWith("conn-1", "project-a");
    expect(apiMocks.activateOpenStackContext).toHaveBeenCalledWith(
      "conn-1",
      "project-a",
      7,
      "ACCESS-1",
    );
    expect(refreshContexts).toHaveBeenCalledTimes(1);
    expect(refreshContexts.mock.invocationCallOrder[0]).toBeLessThan(onActivated.mock.invocationCallOrder[0]);
    expect(result.current.candidateCount).toBe(0);
  });
});
