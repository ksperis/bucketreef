import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "../api/executionContexts";
import { CLIENT_STORAGE_KEYS } from "../utils/clientStorage";
import { useExecutionContextCatalog } from "./useExecutionContextCatalog";

const apiMocks = vi.hoisted(() => ({
  listExecutionContexts: vi.fn(),
}));

vi.mock("../api/executionContexts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/executionContexts")>();
  return {
    ...actual,
    listExecutionContexts: apiMocks.listExecutionContexts,
  };
});

vi.mock("../utils/workspaces", () => ({
  readStoredUser: () => ({ authType: "password" }),
}));

function context(id: string, kind: ExecutionContext["kind"] = "account"): ExecutionContext {
  return {
    id,
    kind,
    display_name: id,
  } as ExecutionContext;
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/manager?ctx=os-region-a"]}>{children}</MemoryRouter>;
}

describe("useExecutionContextCatalog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMocks.listExecutionContexts.mockReset();
  });

  it("prefers a newly activated context during refresh instead of falling back to another account", async () => {
    apiMocks.listExecutionContexts
      .mockResolvedValueOnce([
        context("os-region-a", "openstack_project"),
        context("account-other"),
      ])
      .mockResolvedValueOnce([
        context("account-other"),
        context("os-region-b", "openstack_project"),
      ]);

    const { result } = renderHook(() => useExecutionContextCatalog({
      scope: "manager",
      storageKey: CLIENT_STORAGE_KEYS.selectedManagerExecutionContext,
      accessDeniedMessage: "denied",
    }), { wrapper });

    await waitFor(() => expect(result.current.selectedContextId).toBe("os-region-a"));

    await act(async () => {
      await result.current.refreshContexts("os-region-b");
    });

    await waitFor(() => expect(result.current.selectedContextId).toBe("os-region-b"));
    expect(result.current.selectedContext?.id).toBe("os-region-b");
    expect(result.current.selectedContextId).not.toBe("account-other");
  });
});
