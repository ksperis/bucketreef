import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_SURFACES, type GeneralSettings } from "../api/appSettings";
import { DEFAULT_MANAGER_FEATURE_POLICIES, DEFAULT_PROJECT_COLLECTION_POLICIES, DEFAULT_PROJECT_FEATURE_POLICIES } from "../api/featurePolicies";
import type { EffectiveUserAccess } from "../api/users";
import type { WorkspaceAccess } from "../api/executionContexts";
import type { SessionUser } from "./workspaces";
import { resolveAvailableWorkspacesWithFlags, resolvePostLoginPath, resolvePostLoginPathWithWorkspaceAccess } from "./workspaces";

const NO_MANAGER_TOOLS = {
  bucket_compare: false,
  bucket_integrity_check: false,
  bucket_migration: false,
  bucket_purge: false,
  feature_rules: false,
};

function effectiveAccess(overrides: Partial<EffectiveUserAccess> = {}): EffectiveUserAccess {
  return {
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    has_owned_private_connections: false,
    browser_advanced_features_enabled: false,
    account_links: [],
    s3_user_details: [],
    s3_connection_details: [],
    ...overrides,
    manager_tool_access: {
      ...NO_MANAGER_TOOLS,
      ...overrides.manager_tool_access,
    },
  };
}

function accountLink(
  accountId: number,
  managerRole: "account_administrator" | null,
  portalRole: "portal_user" | "portal_manager" | null,
): EffectiveUserAccess["account_links"][number] {
  return {
    account_id: accountId,
    manager_role: managerRole,
    portal_role: portalRole,
    provenance: {
      direct_manager_role: managerRole,
      direct_portal_role: portalRole,
      direct_determines_effective_manager_role: Boolean(managerRole),
      direct_determines_effective_portal_role: Boolean(portalRole),
      groups: [],
    },
  };
}

const baseSettings: GeneralSettings = {
  project_feature_policies: DEFAULT_PROJECT_FEATURE_POLICIES,
  project_collection_policies: DEFAULT_PROJECT_COLLECTION_POLICIES,
  manager_feature_policies: DEFAULT_MANAGER_FEATURE_POLICIES,
  rgw_account_id_prefix: "80",
  allow_managed_rgw_tenant_creation: false,
  documentation_base_url: "https://docs.bucketreef.ksperis.com",
  manager_enabled: true,
  openstack_enabled: false,
  ceph_admin_enabled: true,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: false,
  browser_portal_enabled: false,
  browser_ceph_admin_enabled: true,
  portal_enabled: false,
  cost_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
  require_passkey_for_admins: false,
  require_passkey_for_users: false,
  allow_user_profile_name_edit: false,
  allow_user_external_identity_unlink: false,
};

const adminUser: SessionUser = {
  id: 1,
  email: "admin@example.com",
  role: "ui_admin",
  effective_access: effectiveAccess({
    can_access_ceph_admin: true,
    can_access_storage_ops: true,
    account_links: [accountLink(1, "account_administrator", null)],
  }),
};

const superAdminUser: SessionUser = {
  id: 2,
  email: "superadmin@example.com",
  role: "ui_superadmin",
  effective_access: effectiveAccess({
    can_access_ceph_admin: true,
    can_access_storage_ops: true,
    account_links: [accountLink(2, "account_administrator", null)],
  }),
};

describe("resolveAvailableWorkspacesWithFlags", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns English workspace labels", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(adminUser, {
      ...baseSettings,
      storage_ops_enabled: true,
    }, { manager: true, browser: true });

    expect(workspaces.find((workspace) => workspace.id === "admin")?.label).toBe("Admin (platform)");
    expect(workspaces.find((workspace) => workspace.id === "browser")?.label).toBe("Browser (objects)");
  });

  it("hides runtime-disabled surfaces even when database features are enabled", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      adminUser,
      { ...baseSettings, storage_ops_enabled: true, portal_enabled: true },
      { manager: true, browser: true, portal: true },
      {
        ...DEFAULT_RUNTIME_SURFACES,
        admin: false,
        ceph_admin: false,
        storage_ops: false,
      },
    );

    expect(workspaces.map((workspace) => workspace.id)).not.toContain("admin");
    expect(workspaces.map((workspace) => workspace.id)).not.toContain("ceph-admin");
    expect(workspaces.map((workspace) => workspace.id)).not.toContain("storage-ops");
  });

  it("hides Storage Ops for admin-like users when feature flag is disabled", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(adminUser, {
      ...baseSettings,
      storage_ops_enabled: false,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
  });

  it("shows Storage Ops for admin-like users when feature flag is enabled", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(adminUser, {
      ...baseSettings,
      storage_ops_enabled: true,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("hides Storage Ops for admin-like users without dedicated permission", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...adminUser,
        effective_access: effectiveAccess({
          ...adminUser.effective_access,
          can_access_storage_ops: false,
        }),
      },
      {
        ...baseSettings,
        storage_ops_enabled: true,
      }
    );
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
  });

  it("hides context workspaces for admin-like users without an authorized context", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...adminUser,
        effective_access: effectiveAccess({
          ...adminUser.effective_access,
          account_links: [],
          s3_user_details: [],
          s3_connection_details: [],
        }),
      },
      {
        ...baseSettings,
        storage_ops_enabled: true,
      },
      { manager: false, browser: false }
    );

    expect(workspaces.map((workspace) => workspace.id)).toEqual(["admin", "ceph-admin"]);
  });

  it("does not expose Storage Ops to standard users without dedicated permission", () => {
    const user: SessionUser = {
      id: 5,
      email: "user@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        account_links: [accountLink(12, "account_administrator", null)],
      }),
    };
    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      storage_ops_enabled: true,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
  });

  it("does not expose Storage Ops without an authorized Manager context", () => {
    const user: SessionUser = {
      id: 16,
      email: "ops-without-context@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        can_access_storage_ops: true,
        account_links: [accountLink(24, null, "portal_user")],
      }),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(
      user,
      {
        ...baseSettings,
        portal_enabled: true,
        storage_ops_enabled: true,
      },
      { manager: false, browser: true }
    );

    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
    expect(workspaces.some((workspace) => workspace.id === "browser")).toBe(true);
  });

  it("exposes Storage Ops to standard users with dedicated permission when feature is enabled", () => {
    const user: SessionUser = {
      id: 6,
      email: "ops-user@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        can_access_storage_ops: true,
        account_links: [accountLink(24, "account_administrator", null)],
      }),
    };
    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      storage_ops_enabled: true,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("exposes Portal only for explicit portal account roles when feature is enabled", () => {
    const user: SessionUser = {
      id: 7,
      email: "portal-user@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        account_links: [accountLink(24, null, "portal_user")],
      }),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
  });

  it("prefers effective_access for inherited account, portal, and Storage Ops access", () => {
    const user: SessionUser = {
      id: 13,
      email: "grouped-user@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        can_access_storage_ops: true,
        account_links: [accountLink(42, "account_administrator", "portal_user")],
      }),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
      storage_ops_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "manager")).toBe(true);
    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("does not infer Browser access from shared connections", () => {
    const user: SessionUser = {
      id: 14,
      email: "grouped-browser@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        s3_connection_details: [{ id: 55, name: "shared-browser" }],
      }),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, baseSettings);

    expect(workspaces.some((workspace) => workspace.id === "browser")).toBe(false);
  });

  it("exposes Portal for portal managers when feature is enabled", () => {
    const user: SessionUser = {
      id: 9,
      email: "portal-manager@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        account_links: [accountLink(24, null, "portal_manager")],
      }),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
    });

    expect(workspaces.find((workspace) => workspace.id === "portal")).toMatchObject({
      label: "Portal (self-service)",
      path: "/portal",
    });
  });

  it("does not expose standard Browser to Portal-only users", () => {
    const user: SessionUser = {
      id: 15,
      email: "portal-browser@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        account_links: [accountLink(24, null, "portal_user")],
      }),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      browser_root_enabled: false,
      portal_enabled: true,
      browser_portal_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "browser")).toBe(false);
  });

  it("exposes Portal for admin users with an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...adminUser,
        effective_access: effectiveAccess({
          ...adminUser.effective_access,
          account_links: [accountLink(24, "account_administrator", "portal_manager")],
        }),
      },
      {
        ...baseSettings,
        portal_enabled: true,
      }
    );

    expect(workspaces.find((workspace) => workspace.id === "portal")).toMatchObject({
      label: "Portal (self-service)",
      path: "/portal",
    });
  });

  it("exposes Portal for superadmin users with an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...superAdminUser,
        effective_access: effectiveAccess({
          ...superAdminUser.effective_access,
          account_links: [accountLink(24, null, "portal_user")],
        }),
      },
      {
        ...baseSettings,
        portal_enabled: true,
      }
    );

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
  });

  it("does not expose Portal for admin users without an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...adminUser,
        effective_access: effectiveAccess({
          ...adminUser.effective_access,
          account_links: [],
        }),
      },
      {
        ...baseSettings,
        portal_enabled: true,
      }
    );

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("does not expose Portal when the feature flag is disabled", () => {
    const user: SessionUser = {
      id: 10,
      email: "portal-disabled@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        account_links: [accountLink(24, null, "portal_user")],
      }),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: false,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("does not expose Portal for plain account links", () => {
    const user: SessionUser = {
      id: 8,
      email: "plain-user@example.com",
      role: "ui_user",
      effective_access: effectiveAccess(),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("does not expose Portal when the account link has no portal role", () => {
    const user: SessionUser = {
      id: 11,
      email: "missing-role@example.com",
      role: "ui_user",
      effective_access: effectiveAccess(),
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("redirects a portal-only user to Portal", () => {
    const user: SessionUser = {
      id: 12,
      email: "portal-only@example.com",
      role: "ui_user",
      effective_access: effectiveAccess({
        account_links: [accountLink(24, null, "portal_user")],
      }),
    };

    expect(resolvePostLoginPath(user, { ...baseSettings, portal_enabled: true })).toBe("/portal");
  });

  it.each([true, false])("routes a contextless user according to OpenStack cloud admission (%s)", (allowed) => {
    const user: SessionUser = { id: 13, email: "cloud-only@example.test", role: "ui_user", effective_access: effectiveAccess() };
    const unavailable = { available: false, context_count: 0 };
    const access: WorkspaceAccess = {
      admin: unavailable, ceph_admin: unavailable, storage_ops: unavailable,
      manager: unavailable, browser: unavailable, portal: unavailable,
      default_workspace: null, openstack_connect_available: allowed,
    };
    expect(resolvePostLoginPathWithWorkspaceAccess(user, baseSettings, access)).toBe(allowed ? "/profile?tab=openstack" : "/unauthorized");
  });
});
