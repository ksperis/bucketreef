import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "../../api/executionContexts";
import {
  resolveBrowserWorkspaceAccountDestination,
  resolveBrowserWorkspaceContext,
} from "./browserPageContextModel";

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

describe("resolveBrowserWorkspaceContext", () => {
  it("resolves the standalone Browser vocabulary and sidebar", () => {
    expect(
      resolveBrowserWorkspaceContext({
        pathname: "/browser/",
        workspaceSurface: "browser",
      }),
    ).toMatchObject({
      normalizedPath: "/browser",
      isMainBrowserPath: true,
      isEmbeddedBrowserPath: false,
      workspaceNoun: "bucket",
      workspaceObjectNounPlural: "objects",
      selectorWorkspaceNounTitle: "Buckets",
      showWorkspaceSidebar: true,
    });
  });

  it("uses Portal vocabulary only on the embedded Portal surface", () => {
    expect(
      resolveBrowserWorkspaceContext({
        pathname: "/portal/storage-spaces/42",
        workspaceSurface: "portal",
        lockedBucketName: " project-data ",
      }),
    ).toMatchObject({
      isPortalBrowserSurface: true,
      isEmbeddedBrowserPath: true,
      usePortalWorkspaceLabels: true,
      workspaceNoun: "storage space",
      workspaceNounCapitalized: "Storage Space",
      workspaceObjectNoun: "file",
      workspaceObjectNounPlural: "files",
      resolvedLockedBucketName: "project-data",
      showWorkspaceSidebar: false,
    });
  });

  it("keeps bucket vocabulary for Manager and Ceph Admin embeds", () => {
    for (const pathname of ["/manager/browser", "/ceph-admin/browser"]) {
      expect(
        resolveBrowserWorkspaceContext({
          pathname,
          workspaceSurface: pathname.startsWith("/manager")
            ? "manager"
            : "ceph-admin",
        }),
      ).toMatchObject({
        isEmbeddedBrowserPath: true,
        workspaceNoun: "bucket",
        workspaceObjectNoun: "object",
      });
    }
  });
});

describe("resolveBrowserWorkspaceAccountDestination", () => {
  it("keeps Portal contexts in Portal even when Manager access is also available", () => {
    expect(
      resolveBrowserWorkspaceAccountDestination({
        selectedContext: executionContext({
          kind: "portal_account",
          manager_role: "account_administrator",
        }),
        contextIdForApi: "project / 101",
        isPortalBrowserSurface: false,
      }),
    ).toEqual({
      workspace: "portal",
      contextId: "project / 101",
      path: "/portal?project=project%20%2F%20101",
    });
  });

  it("opens Manager-capable execution contexts with their explicit selected context id", () => {
    expect(
      resolveBrowserWorkspaceAccountDestination({
        selectedContext: executionContext({
          kind: "s3_user",
          id: "s3u/user 42",
        }),
        contextIdForApi: "different-api-context",
        isPortalBrowserSurface: false,
      }),
    ).toEqual({
      workspace: "manager",
      contextId: "s3u/user 42",
      path: "/manager?ctx=s3u%2Fuser%2042",
    });
  });

  it("does not expose an account action without an eligible destination", () => {
    expect(
      resolveBrowserWorkspaceAccountDestination({
        selectedContext: executionContext({ manager_role: null }),
        contextIdForApi: "101",
        isPortalBrowserSurface: false,
      }),
    ).toBeNull();

    expect(
      resolveBrowserWorkspaceAccountDestination({
        selectedContext: null,
        contextIdForApi: null,
        isPortalBrowserSurface: true,
      }),
    ).toBeNull();
  });
});
