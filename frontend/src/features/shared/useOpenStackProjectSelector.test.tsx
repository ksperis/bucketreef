import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "../../api/executionContexts";
import type { OpenStackProjectOption } from "../../api/openstack";
import { useOpenStackProjectSelector } from "./useOpenStackProjectSelector";

const apiMocks = vi.hoisted(() => ({
  activateOpenStackContext: vi.fn(),
  getOpenStackProjectAccess: vi.fn(),
  listOpenStackProjectOptions: vi.fn(),
}));

vi.mock("../../api/openstack", () => ({
  activateOpenStackContext: apiMocks.activateOpenStackContext,
  getOpenStackProjectAccess: apiMocks.getOpenStackProjectAccess,
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
};

const projectAccess = {
  targets: [{
    target_id: "catalog-s3-region-a",
    region_id: "region-a",
    interface: "public" as const,
    service_type: "s3",
    service_name: "S3",
    endpoint_url: "https://s3.example.test",
    storage_endpoint_id: null,
    storage_endpoint_name: null,
    allowed: true,
  }],
  access_keys: ["ACCESS-1"],
};

describe("useOpenStackProjectSelector", () => {
  beforeEach(() => {
    apiMocks.activateOpenStackContext.mockReset();
    apiMocks.getOpenStackProjectAccess.mockReset();
    apiMocks.listOpenStackProjectOptions.mockReset();
    apiMocks.listOpenStackProjectOptions.mockResolvedValue([projectOption]);
    apiMocks.getOpenStackProjectAccess.mockResolvedValue(projectAccess);
  });

  it("refreshes executable contexts before navigating to an activated OpenStack project", async () => {
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
    expect(result.current.selectorOptions).toEqual([
      expect.objectContaining({
        label: "Project A",
        description: "OpenStack · Cloud A · Person",
      }),
    ]);

    act(() => {
      result.current.handleContextChange(
        "openstack-project-option:conn-1:project-a",
        fallback,
      );
    });

    await waitFor(() => expect(onActivated).toHaveBeenCalledWith("os-existing"));
    expect(fallback).not.toHaveBeenCalled();
    expect(apiMocks.getOpenStackProjectAccess).toHaveBeenCalledWith("conn-1", "project-a");
    expect(apiMocks.activateOpenStackContext).toHaveBeenCalledWith(
      "conn-1",
      "project-a",
      "catalog-s3-region-a",
      "ACCESS-1",
    );
    expect(refreshContexts).toHaveBeenCalledTimes(1);
    expect(refreshContexts.mock.invocationCallOrder[0]).toBeLessThan(onActivated.mock.invocationCallOrder[0]);
    expect(result.current.candidateCount).toBe(0);
  });

  it("exposes Keystone regions for the active OpenStack context", async () => {
    const activeContext = {
      id: "os-existing",
      kind: "openstack_project",
      endpoint_url: "https://s3.example.test",
      openstack: {
        connection_id: "conn-1",
        cloud_name: "Cloud A",
        identity_name: "Person",
        project_id: "project-a",
        project_name: "Project A",
        region_id: "region-a",
      },
    } as ExecutionContext;

    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      activeContext,
      refreshContexts: vi.fn(async () => [activeContext]),
      onActivated: vi.fn(),
    }));

    await waitFor(() => expect(result.current.region.loading).toBe(false));
    expect(result.current.region.visible).toBe(true);
    expect(result.current.region.currentRegion).toBe("region-a");
    expect(result.current.region.currentTargetId).toBe("catalog-s3-region-a");
    expect(result.current.region.options).toEqual([
      expect.objectContaining({ value: "catalog-s3-region-a", label: "region-a" }),
    ]);
  });

  it("keeps policy-blocked Keystone regions visible and disables them", async () => {
    apiMocks.getOpenStackProjectAccess.mockResolvedValue({
      ...projectAccess,
      targets: [
        projectAccess.targets[0],
        {
          ...projectAccess.targets[0],
          target_id: "catalog-s3-region-b",
          region_id: "region-b",
          endpoint_url: "https://unmanaged.example.test",
          allowed: false,
        },
      ],
    });
    const activeContext = {
      id: "os-existing",
      kind: "openstack_project",
      endpoint_url: "https://s3.example.test",
      openstack: {
        connection_id: "conn-1",
        cloud_name: "Cloud A",
        identity_name: "Person",
        project_id: "project-a",
        project_name: "Project A",
        region_id: "region-a",
      },
    } as ExecutionContext;
    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      activeContext,
      refreshContexts: vi.fn(async () => [activeContext]),
      onActivated: vi.fn(),
    }));

    await waitFor(() => expect(result.current.region.loading).toBe(false));
    expect(result.current.region.options).toEqual([
      expect.objectContaining({ value: "catalog-s3-region-a", disabled: false }),
      expect.objectContaining({ value: "catalog-s3-region-b", disabled: true, title: "unmanagedRegion" }),
    ]);
  });
});
