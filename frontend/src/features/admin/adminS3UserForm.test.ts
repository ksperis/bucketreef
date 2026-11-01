import type { S3User } from "../../api/s3Users";
import {
  adminS3UserForm,
  adminS3UserPayload,
  emptyAdminS3UserForm,
} from "./adminS3UserForm";

function makeUser(overrides: Partial<S3User> = {}): S3User {
  return {
    id: 1,
    name: "RGW User",
    rgw_user_uid: "rgw-user",
    rgw_tenant: "",
    tags: [],
    email: null,
    created_at: null,
    user_links: [],
    group_links: [],
    quota_max_size_gb: null,
    quota_max_objects: null,
    storage_endpoint_id: 10,
    storage_endpoint_name: "Ceph",
    storage_endpoint_url: "https://rgw.example.test",
    bucket_count: 0,
    allow_bucket_quota_management: null,
    allow_access_key_management: null,
    allow_access_key_metadata: null,
    allow_access_key_expiration: null,
    allow_activity_history: null,
    allow_rgw_usage_metrics: null,
    allow_cost_estimation: null,
    allow_bucket_usage_stats: null,
    allow_bucket_usage_stats_collection: null,
    allow_multisite_endpoint_switching: null,
    allow_managed_private_connection_provisioning: null,
    ...overrides,
  };
}

describe("adminS3UserForm", () => {
  it("projects persisted user values into editable form state", () => {
    const form = adminS3UserForm(makeUser({
      email: "user@example.test",
      quota_max_size_gb: 0.5,
      quota_max_objects: 42,
      allow_access_key_management: true,
      user_links: [{
        user_id: 7,
        user_email: "ui@example.test",
        user_full_name: "UI User",
        user_avatar: null,
        allow_manager_browser_data_access: true,
      }],
    }));

    expect(form).toEqual(expect.objectContaining({
      email: "user@example.test",
      quota_max_size_gb: "512",
      quota_max_size_unit: "MiB",
      quota_max_objects: "42",
      allow_access_key_management: true,
    }));
    expect(form.user_links).toEqual([
      { user_id: 7, allow_manager_browser_data_access: true },
    ]);
  });

  it("builds a privilege-aware update payload from canonical association links", () => {
    const form = {
      ...emptyAdminS3UserForm(),
      name: "Updated",
      quota_max_size_gb: "2",
      quota_max_size_unit: "GiB",
      quota_max_objects: "100",
      allow_bucket_quota_management: true,
      allow_bucket_usage_stats: true,
      allow_bucket_usage_stats_collection: false,
      user_links: [{
        user_id: 7,
        allow_manager_browser_data_access: true,
      }],
    };

    expect(adminS3UserPayload(form, true, false)).toEqual({
      name: "Updated",
      email: undefined,
      tags: [],
      user_links: [{ user_id: 7, allow_manager_browser_data_access: true }],
      group_links: [],
      allow_bucket_usage_stats: true,
      allow_bucket_usage_stats_collection: false,
      quota_max_size_gb: 2,
      quota_max_size_unit: "GiB",
      quota_max_objects: 100,
    });

    expect(adminS3UserPayload(form, false, true)).toEqual(expect.objectContaining({
      allow_bucket_quota_management: true,
      allow_access_key_management: null,
    }));
    expect(adminS3UserPayload(form, false, true)).not.toHaveProperty("quota_max_size_gb");
  });
});
