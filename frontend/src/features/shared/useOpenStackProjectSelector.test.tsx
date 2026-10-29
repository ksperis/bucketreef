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
  selected_access_key: null,
};

describe("useOpenStackProjectSelector", () => {
  beforeEach(() => {
    apiMocks.activateOpenStackContext.mockReset();
    apiMocks.getOpenStackProjectAccess.mockReset();
    apiMocks.listOpenStackProjectOptions.mockReset();
    apiMocks.listOpenStackProjectOptions.mockResolvedValue({ options: [projectOption], warnings: [] });
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
    expect(refreshContexts).toHaveBeenCalledWith();
    expect(refreshContexts.mock.invocationCallOrder[0]).toBeLessThan(onActivated.mock.invocationCallOrder[0]);
    expect(result.current.candidateCount).toBe(0);
  });

  it("keeps healthy project candidates when some OpenStack connections fail discovery", async () => {
    apiMocks.listOpenStackProjectOptions.mockResolvedValue({
      options: [projectOption],
      warnings: [{
        connection_id: "conn-failed",
        cloud_name: "Cloud B",
        identity_name: "Other person",
        code: "provider_unavailable",
      }],
    });

    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      refreshContexts: vi.fn(async () => []),
      onActivated: vi.fn(),
    }));

    await waitFor(() => expect(result.current.candidateCount).toBe(1));
    expect(result.current.error).toBe("partialProjectDiscovery");
    expect(result.current.selectorOptions).toEqual([
      expect.objectContaining({ label: "Project A" }),
    ]);
  });

  it("ignores a stale project access response after another project is selected", async () => {
    const projectB = {
      ...projectOption,
      connection_id: "conn-2",
      project_id: "project-b",
      project_name: "Project B",
    };
    const projectBAccess = {
      targets: [{
        ...projectAccess.targets[0],
        target_id: "catalog-s3-region-b",
        region_id: "region-b",
        endpoint_url: "https://s3-b.example.test",
      }],
      access_keys: [],
    };
    let resolveProjectA: ((value: typeof projectAccess) => void) | undefined;
    const projectAAccess = new Promise<typeof projectAccess>((resolve) => {
      resolveProjectA = resolve;
    });
    apiMocks.listOpenStackProjectOptions.mockResolvedValue({ options: [projectOption, projectB], warnings: [] });
    apiMocks.getOpenStackProjectAccess.mockImplementation((_connectionId: string, projectId: string) => (
      projectId === "project-a" ? projectAAccess : Promise.resolve(projectBAccess)
    ));

    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      refreshContexts: vi.fn(async () => []),
      onActivated: vi.fn(),
    }));

    await waitFor(() => expect(result.current.candidateCount).toBe(2));
    act(() => {
      result.current.handleContextChange("openstack-project-option:conn-1:project-a", vi.fn());
      result.current.handleContextChange("openstack-project-option:conn-2:project-b", vi.fn());
    });
    await waitFor(() => expect(result.current.error).toBe("noKeys"));
    expect(result.current.region.options).toEqual([
      expect.objectContaining({ value: "catalog-s3-region-b", label: "region-b" }),
    ]);

    await act(async () => {
      resolveProjectA?.(projectAccess);
      await projectAAccess;
    });

    expect(result.current.error).toBe("noKeys");
    expect(result.current.region.options).toEqual([
      expect.objectContaining({ value: "catalog-s3-region-b", label: "region-b" }),
    ]);
  });

  it("ignores a stale project-options reload", async () => {
    const projectB = {
      ...projectOption,
      connection_id: "conn-2",
      project_id: "project-b",
      project_name: "Project B",
    };
    let resolveInitial: ((value: { options: OpenStackProjectOption[]; warnings: [] }) => void) | undefined;
    const initialRequest = new Promise<{ options: OpenStackProjectOption[]; warnings: [] }>((resolve) => {
      resolveInitial = resolve;
    });
    apiMocks.listOpenStackProjectOptions
      .mockReturnValueOnce(initialRequest)
      .mockResolvedValueOnce({ options: [projectB], warnings: [] });

    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      refreshContexts: vi.fn(async () => []),
      onActivated: vi.fn(),
    }));

    await waitFor(() => expect(apiMocks.listOpenStackProjectOptions).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.reloadOptions();
    });
    expect(result.current.selectorOptions).toEqual([
      expect.objectContaining({ label: "Project B" }),
    ]);

    await act(async () => {
      resolveInitial?.({ options: [projectOption], warnings: [] });
      await initialRequest;
    });

    expect(result.current.selectorOptions).toEqual([
      expect.objectContaining({ label: "Project B" }),
    ]);
  });

  it("uses the topbar region selector before activating a project with multiple regions", async () => {
    const regionB = {
      ...projectAccess.targets[0],
      target_id: "catalog-s3-region-b",
      region_id: "region-b",
      endpoint_url: "https://s3-b.example.test",
    };
    apiMocks.getOpenStackProjectAccess.mockResolvedValue({
      ...projectAccess,
      targets: [projectAccess.targets[0], regionB],
    });
    apiMocks.activateOpenStackContext.mockResolvedValue("os-region-b");
    const nextContext = {
      id: "os-region-b",
      kind: "openstack_project",
    } as ExecutionContext;
    const refreshContexts = vi.fn(async () => [nextContext]);
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

    await waitFor(() => expect(result.current.region.loading).toBe(false));
    expect(result.current.dialog).toBeNull();
    expect(result.current.region.visible).toBe(true);
    expect(result.current.region.currentRegion).toBeNull();
    expect(result.current.region.options).toEqual([
      expect.objectContaining({ value: "catalog-s3-region-a", label: "region-a" }),
      expect.objectContaining({ value: "catalog-s3-region-b", label: "region-b" }),
    ]);
    expect(apiMocks.activateOpenStackContext).not.toHaveBeenCalled();

    act(() => result.current.region.onChange("catalog-s3-region-b"));

    await waitFor(() => expect(onActivated).toHaveBeenCalledWith("os-region-b"));
    expect(apiMocks.activateOpenStackContext).toHaveBeenCalledWith(
      "conn-1",
      "project-a",
      "catalog-s3-region-b",
      "ACCESS-1",
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it("reports a missing EC2 credential without opening the activation dialog", async () => {
    apiMocks.getOpenStackProjectAccess.mockResolvedValue({
      ...projectAccess,
      access_keys: [],
    });
    const fallback = vi.fn();

    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      refreshContexts: vi.fn(async () => []),
      onActivated: vi.fn(),
    }));

    await waitFor(() => expect(result.current.candidateCount).toBe(1));
    act(() => {
      result.current.handleContextChange(
        "openstack-project-option:conn-1:project-a",
        fallback,
      );
    });

    await waitFor(() => expect(result.current.error).toBe("noKeys"));
    expect(result.current.dialog).toBeNull();
    expect(result.current.region.visible).toBe(false);
    expect(apiMocks.activateOpenStackContext).not.toHaveBeenCalled();
  });

  it("keeps the activated OpenStack project selected when switching regions", async () => {
    const regionB = {
      ...projectAccess.targets[0],
      target_id: "catalog-s3-region-b",
      region_id: "region-b",
      endpoint_url: "https://s3-b.example.test",
    };
    apiMocks.getOpenStackProjectAccess.mockResolvedValue({
      ...projectAccess,
      targets: [projectAccess.targets[0], regionB],
      access_keys: ["ACCESS-1", "ACCESS-2"],
      selected_access_key: "ACCESS-2",
    });
    apiMocks.activateOpenStackContext.mockResolvedValue("os-region-b");
    const activeContext = {
      id: "os-region-a",
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
    const nextContext = {
      ...activeContext,
      id: "os-region-b",
      endpoint_url: "https://s3-b.example.test",
      openstack: {
        ...activeContext.openstack!,
        region_id: "region-b",
      },
    } as ExecutionContext;
    const refreshContexts = vi.fn(async () => [nextContext]);
    const onActivated = vi.fn();

    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      activeContext,
      refreshContexts,
      onActivated,
    }));

    await waitFor(() => expect(result.current.region.loading).toBe(false));
    act(() => result.current.region.onChange("catalog-s3-region-b"));

    await waitFor(() => expect(onActivated).toHaveBeenCalledWith("os-region-b"));
    expect(result.current.dialog).toBeNull();
    expect(apiMocks.activateOpenStackContext).toHaveBeenCalledWith(
      "conn-1",
      "project-a",
      "catalog-s3-region-b",
      "ACCESS-2",
    );
    expect(refreshContexts).toHaveBeenCalledWith();
    expect(refreshContexts.mock.invocationCallOrder[0]).toBeLessThan(onActivated.mock.invocationCallOrder[0]);
  });

  it("serializes region activation while a previous activation is in flight", async () => {
    const regionB = {
      ...projectAccess.targets[0],
      target_id: "catalog-s3-region-b",
      region_id: "region-b",
      endpoint_url: "https://s3-b.example.test",
    };
    apiMocks.getOpenStackProjectAccess.mockResolvedValue({
      ...projectAccess,
      targets: [projectAccess.targets[0], regionB],
    });
    let resolveActivation: ((contextId: string) => void) | undefined;
    const activationRequest = new Promise<string>((resolve) => {
      resolveActivation = resolve;
    });
    apiMocks.activateOpenStackContext.mockReturnValue(activationRequest);
    const activeContext = {
      id: "os-region-a",
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
    const nextContext = {
      ...activeContext,
      id: "os-region-b",
      endpoint_url: "https://s3-b.example.test",
      openstack: { ...activeContext.openstack!, region_id: "region-b" },
    } as ExecutionContext;
    const onActivated = vi.fn();

    const { result } = renderHook(() => useOpenStackProjectSelector({
      enabled: true,
      activeContext,
      refreshContexts: vi.fn(async () => [activeContext, nextContext]),
      onActivated,
    }));

    await waitFor(() => expect(result.current.region.loading).toBe(false));
    act(() => {
      result.current.region.onChange("catalog-s3-region-b");
      result.current.region.onChange("catalog-s3-region-b");
    });
    expect(apiMocks.activateOpenStackContext).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);

    await act(async () => {
      resolveActivation?.("os-region-b");
      await activationRequest;
    });
    await waitFor(() => expect(onActivated).toHaveBeenCalledWith("os-region-b"));
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
