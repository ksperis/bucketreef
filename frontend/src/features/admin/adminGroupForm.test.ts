import type { UiGroup } from "../../api/groups";
import {
  adminGroupForm,
  adminGroupPayload,
  emptyAdminGroupForm,
} from "./adminGroupForm";

function makeGroup(overrides: Partial<UiGroup> = {}): UiGroup {
  return {
    id: 4,
    name: "Operators",
    system_key: null,
    description: "Storage operators",
    avatar: {
      source: "preset",
      initials: "OP",
      icon: "shield",
      url: null,
      updated_at: null,
    },
    can_access_ceph_admin: true,
    can_access_storage_ops: true,
    can_create_manual_private_connections: true,
    can_provision_managed_private_connections: true,
    allow_multisite_endpoint_switching: true,
    manager_tool_access: {
      bucket_compare: true,
      bucket_integrity_check: false,
      bucket_migration: false,
      bucket_purge: false,
      feature_rules: true,
    },
    browser_advanced_features_enabled: true,
    user_details: [
      {
        id: 12,
        email: "user@example.test",
        role: "ui_user",
        full_name: "User",
        avatar: null,
      },
    ],
    account_details: [],
    account_links: [
      {
        account_id: 21,
        manager_role: "account_administrator",
        portal_role: null,
        allow_manager_browser_data_access: true,
      },
    ],
    s3_user_links: [
      {
        s3_user_id: 31,
        allow_manager_browser_data_access: true,
      },
    ],
    s3_user_details: [],
    s3_connection_details: [{ id: 41, name: "shared" }],
    openstack_cloud_details: [{ id: 51, name: "cloud" }],
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("adminGroupForm", () => {
  it("projects persisted group associations into editable IDs", () => {
    const form = adminGroupForm(makeGroup());

    expect(form).toEqual(expect.objectContaining({
      name: "Operators",
      avatar_source: "preset",
      avatar_icon: "shield",
      user_ids: [12],
      account_links: [{
        account_id: 21,
        manager_role: "account_administrator",
        portal_role: null,
        allow_manager_browser_data_access: true,
      }],
      s3_user_links: [{
        s3_user_id: 31,
        allow_manager_browser_data_access: true,
      }],
      s3_connection_ids: [41],
      openstack_cloud_ids: [51],
    }));
  });

  it("omits immutable members, disabled OpenStack links, and avatar source during an upload", () => {
    const form = {
      ...emptyAdminGroupForm(),
      name: "  All users  ",
      description: "",
      avatar_source: "uploaded" as const,
      user_ids: [12, 13],
      openstack_cloud_ids: [51],
      account_links: [{
        account_id: 21,
        manager_role: "account_administrator" as const,
        portal_role: null,
        allow_manager_browser_data_access: true,
      }],
    };

    const payload = adminGroupPayload(form, {
      includeMembers: false,
      openStackEnabled: false,
      avatarUploadPending: true,
    });

    expect(payload).toEqual(expect.objectContaining({
      name: "All users",
      description: null,
      avatar_source: undefined,
      account_links: [{
        account_id: 21,
        manager_role: "account_administrator",
        portal_role: null,
        allow_manager_browser_data_access: true,
      }],
    }));
    expect(payload).not.toHaveProperty("user_ids");
    expect(payload).not.toHaveProperty("openstack_cloud_ids");
  });
});
