import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExecutionContext } from "../../api/executionContexts";
import { useBrowserWorkspaceAccountAction } from "./useBrowserWorkspaceAccountAction";

const executionContext = (
  overrides: Partial<ExecutionContext>,
): ExecutionContext => ({
  kind: "account",
  id: "101",
  display_name: "Project 101",
  tags: [],
  endpoint_tags: [],
  endpoint_name: "Primary",
  endpoint_is_default: true,
  endpoint_url: "https://s3.example.test",
  storage_endpoint_capabilities: {},
  capabilities: {
    can_manage_iam: true,
    sts_capable: false,
    admin_api_capable: true,
  },
  ...overrides,
});

function wrapper({ children }: PropsWithChildren) {
  return <MemoryRouter initialEntries={["/browser"]}>{children}</MemoryRouter>;
}

describe("useBrowserWorkspaceAccountAction", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("owns Portal workspace persistence and navigation", () => {
    const selectedContext = executionContext({
      kind: "portal_account",
      manager_role: "account_administrator",
    });
    const { result } = renderHook(
      () => ({
        action: useBrowserWorkspaceAccountAction({
          selectedContext,
          contextIdForApi: "project / 101",
          isPortalBrowserSurface: false,
        }),
        location: useLocation(),
      }),
      { wrapper },
    );

    expect(result.current.action?.label).toBe("Open in Portal");
    act(() => result.current.action?.onClick());

    expect(window.localStorage.getItem("selectedPortalAccountId")).toBe(
      "project / 101",
    );
    expect(window.localStorage.getItem("selectedWorkspace")).toBe("portal");
    expect(`${result.current.location.pathname}${result.current.location.search}`).toBe(
      "/portal?project=project%20%2F%20101",
    );
  });

  it("owns Manager workspace persistence and navigation", () => {
    const selectedContext = executionContext({
      kind: "s3_user",
      id: "s3u/user 42",
    });
    const { result } = renderHook(
      () => ({
        action: useBrowserWorkspaceAccountAction({
          selectedContext,
          contextIdForApi: "different-api-context",
          isPortalBrowserSurface: false,
        }),
        location: useLocation(),
      }),
      { wrapper },
    );

    expect(result.current.action?.label).toBe("Open in Manager");
    act(() => result.current.action?.onClick());

    expect(
      window.localStorage.getItem("selectedManagerExecutionContextId"),
    ).toBe("s3u/user 42");
    expect(window.localStorage.getItem("selectedWorkspace")).toBe("manager");
    expect(`${result.current.location.pathname}${result.current.location.search}`).toBe(
      "/manager?ctx=s3u%2Fuser%2042",
    );
  });

  it("returns no action when the selected context has no workspace destination", () => {
    const { result } = renderHook(
      () =>
        useBrowserWorkspaceAccountAction({
          selectedContext: executionContext({ manager_role: null }),
          contextIdForApi: "101",
          isPortalBrowserSurface: false,
        }),
      { wrapper },
    );

    expect(result.current).toBeUndefined();
  });
});
