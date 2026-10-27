import { buildBaseRules } from "./fixtures/base";
import { multisiteRules } from "./fixtures/multisite";
import type { DocScreenshotScenario, LocalStorageSeed, MockRule } from "./types";
import { adminUser, storageOpsAdminUser, storageUser, superAdminUser } from "./fixtures/users";
import { DEFAULT_MANAGER_FEATURE_POLICIES } from "../../src/api/featurePolicies";

function baseStorage(): LocalStorageSeed {
  return {
    selectedWorkspace: "admin",
    selectedManagerExecutionContextId: "acc-helios",
    selectedBrowserExecutionContextId: "acc-helios",
    selectedPortalAccountId: "101",
    selectedCephAdminEndpointId: "11",
  };
}

function withBaseRules(...extraRules: MockRule[]): MockRule[] {
  return [...extraRules,
    { id: "admin-navigation-pending", path: /^\/admin\/navigation\/pending-requests$/, body: { identity_link_requests: 0, portal_requests: 0 } },
    { id: "browser-favorites", method: "GET", path: /^\/users\/me\/browser-favorites$/, body: [] },
    ...multisiteRules(),
    ...buildBaseRules(),
  ];
}

const BROWSER_ROOT_UI_STATE_STORAGE_KEY = "browser:root-ui-state:v3";
const BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY = "browser:root-context-selections:v2";
const BROWSER_FOCUSED_BUCKET = "helios-retail-logs";
const BROWSER_FOCUSED_PREFIX = "daily/";
const BROWSER_FOCUSED_OBJECT_KEY = "daily/report-2026-03-08.json";

function buildBrowserRootUiStateEntry(layout: {
  showFolders: boolean;
}) {
  return JSON.stringify({
    density: "compact",
    showFolders: layout.showFolders,
    foldersPanelWidthPx: 280,
    objectColumns: [],
    objectColumnWidths: {},
  });
}

const browserContextSelectionsEntry = JSON.stringify({
  "acc-helios": {
    bucketName: BROWSER_FOCUSED_BUCKET,
    prefix: BROWSER_FOCUSED_PREFIX,
  },
});

const browserFoldersPanelStateEntry = buildBrowserRootUiStateEntry({
  showFolders: true,
});

const browserVersioningEnabledRule: MockRule = {
  id: "browser-versioning-enabled",
  path: /^\/browser\/buckets\/[^/]+\/versioning$/,
  body: {
    status: "Enabled",
    enabled: true,
  },
};

const browserObjectVersionsRule: MockRule = {
  id: "browser-object-versions-with-history",
  path: /^\/browser\/buckets\/[^/]+\/versions$/,
  body: ({ url }) => {
    const key = url.searchParams.get("key") ?? "";
    if (key !== BROWSER_FOCUSED_OBJECT_KEY) {
      return {
        prefix: url.searchParams.get("prefix") ?? "",
        versions: [],
        delete_markers: [],
        is_truncated: false,
      };
    }
    return {
      prefix: BROWSER_FOCUSED_PREFIX,
      versions: [
        {
          key,
          version_id: "v-2026-03-08-0900",
          is_latest: true,
          is_delete_marker: false,
          last_modified: "2026-03-08T09:00:00Z",
          size: 84251,
          etag: "\"3d4f1a\"",
          storage_class: "STANDARD",
        },
        {
          key,
          version_id: "v-2026-03-08-0715",
          is_latest: false,
          is_delete_marker: false,
          last_modified: "2026-03-08T07:15:00Z",
          size: 83890,
          etag: "\"1c0af9\"",
          storage_class: "STANDARD",
        },
      ],
      delete_markers: [
        {
          key,
          version_id: "m-2026-03-07-2210",
          is_latest: false,
          is_delete_marker: true,
          last_modified: "2026-03-07T22:10:00Z",
          size: null,
          etag: null,
          storage_class: "STANDARD",
        },
      ],
      is_truncated: false,
    };
  },
};

const browserDelayedDeleteRule: MockRule = {
  id: "browser-delete-with-progress",
  method: "POST",
  path: /^\/browser\/buckets\/[^/]+\/delete$/,
  delayMs: 800,
  body: ({ requestBodyText }) => {
    let payload: { objects?: Array<{ key?: string }> } = {};
    try {
      payload = JSON.parse(requestBodyText || "{}") as {
        objects?: Array<{ key?: string }>;
      };
    } catch {
      payload = {};
    }
    return {
      deleted: payload.objects?.length ?? 0,
    };
  },
};

const managerBucketDetailRules: MockRule[] = [
  {
    id: "manager-bucket-detail-stats",
    path: /^\/manager\/buckets\/[^/]+\/stats$/,
    body: {
      name: "helios-retail-logs",
      owner: "RGW58084876167649330",
      owner_name: "Helios Platform",
      used_bytes: 182_554_321,
      object_count: 1284,
    },
  },
  {
    id: "manager-bucket-detail-versioning",
    path: /^\/manager\/buckets\/[^/]+\/versioning$/,
    body: { status: "Enabled", enabled: true },
  },
  {
    id: "manager-bucket-detail-object-lock",
    path: /^\/manager\/buckets\/[^/]+\/object-lock$/,
    body: { enabled: false, mode: null, days: null, years: null },
  },
  {
    id: "manager-bucket-detail-lifecycle",
    path: /^\/manager\/buckets\/[^/]+\/lifecycle$/,
    body: {
      rules: [
        {
          ID: "expire-old-logs",
          Status: "Enabled",
          Filter: { Prefix: "archive/" },
          Expiration: { Days: 90 },
        },
      ],
    },
  },
  {
    id: "manager-bucket-detail-notifications",
    path: /^\/manager\/buckets\/[^/]+\/notifications$/,
    body: { configuration: {} },
  },
  {
    id: "manager-bucket-detail-replication",
    path: /^\/manager\/buckets\/[^/]+\/replication$/,
    body: { configuration: {} },
  },
  {
    id: "manager-bucket-detail-acl",
    path: /^\/manager\/buckets\/[^/]+\/acl$/,
    body: { owner: "RGW58084876167649330", grants: [] },
  },
  {
    id: "manager-bucket-detail-cors",
    path: /^\/manager\/buckets\/[^/]+\/cors$/,
    body: { rules: [] },
  },
  {
    id: "manager-bucket-detail-public-access",
    path: /^\/manager\/buckets\/[^/]+\/public-access-block$/,
    body: {
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: true,
    },
  },
];

const noManagerContextsRule: MockRule = {
  id: "no-manager-contexts",
  path: /^\/me\/execution-contexts$/,
  body: ({ url }) => {
    const workspace = url.searchParams.get("workspace") ?? "manager";
    if (workspace === "manager") return [];
    return [
      {
        kind: "account",
        id: "acc-helios",
        display_name: "Helios Retail",
        manager_account_is_admin: true,
        endpoint_id: 11,
        endpoint_name: "Default",
        endpoint_provider: "ceph",
        endpoint_url: "https://s3-default.docs.example.com",
        storage_endpoint_capabilities: { iam: true, sns: true, usage: true, metrics: true, static_website: true, sts: false, replication: true },
        capabilities: { can_manage_iam: true, sts_capable: false, admin_api_capable: true },
      },
    ];
  },
};

const bucketCompareWithDifferencesRule: MockRule = {
  id: "manager-bucket-compare-with-differences",
  method: "POST",
  path: /^\/manager\/buckets\/compare$/,
  body: ({ requestBodyText }) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(requestBodyText || "{}") as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const sourceBucket = String(payload.source_bucket ?? "helios-retail-logs");
    const targetBucket = String(payload.target_bucket ?? "blueharbor-curated");
    return {
      source_context_id: "acc-helios",
      target_context_id: String(payload.target_context_id ?? "conn-blueharbor"),
      source_bucket: sourceBucket,
      target_bucket: targetBucket,
      compare_mode: "md5_or_size",
      has_differences: true,
      content_diff: {
        compare_mode: "md5_or_size",
        source_count: 1284,
        target_count: 1278,
        matched_count: 1272,
        different_count: 4,
        only_source_count: 6,
        only_target_count: 2,
        ignored_after_cutoff_count: 3,
        only_source_sample: ["daily/2026-03-07/report.json", "logs/part-0081.gz"],
        only_target_sample: ["daily/2026-03-06/report.json"],
        only_source_details: [
          {
            key: "daily/2026-03-07/report.json",
            size: 82144,
            etag: "9f2cdd0e8a1321ab1f18aa22f3ad0001",
            last_modified: "2026-03-07T18:25:00Z",
            storage_class: "STANDARD",
          },
          {
            key: "logs/part-0081.gz",
            size: 5242880,
            etag: "837cdd0e8a1321ab1f18aa22f3ad0002",
            last_modified: "2026-03-07T19:10:00Z",
            storage_class: "STANDARD",
          },
        ],
        only_target_details: [
          {
            key: "daily/2026-03-06/report.json",
            size: 81800,
            etag: "714cdd0e8a1321ab1f18aa22f3ad0003",
            last_modified: "2026-03-06T18:25:00Z",
            storage_class: "STANDARD_IA",
          },
        ],
        different_sample: [
          {
            key: "daily/2026-03-08/report.json",
            source_size: 84251,
            target_size: 84912,
            source_etag: "\"3d4f1a\"",
            target_etag: "\"44af18\"",
            source_last_modified: "2026-03-08T18:25:00Z",
            target_last_modified: "2026-03-08T18:30:00Z",
            source_storage_class: "STANDARD",
            target_storage_class: "STANDARD_IA",
            compare_by: "md5",
          },
        ],
      },
      config_diff: {
        changed: true,
        sections: [
          {
            key: "versioning_status",
            label: "Versioning",
            source: "Enabled",
            target: "Suspended",
            changed: true,
          },
        ],
      },
    };
  },
};

const storageOpsEnabledGeneralSettingsRule: MockRule = {
  id: "settings-general-storage-ops-enabled",
  path: /^\/settings\/general$/,
  body: {
    manager_feature_policies: DEFAULT_MANAGER_FEATURE_POLICIES,
    manager_enabled: true,
    ceph_admin_enabled: true,
    browser_enabled: true,
    browser_root_enabled: true,
    browser_manager_enabled: true,
    browser_portal_enabled: true,
    browser_ceph_admin_enabled: true,
    portal_enabled: true,
    cost_enabled: false,
    endpoint_status_enabled: true,
    bucket_migration_enabled: true,
    bucket_compare_enabled: true,
    bucket_integrity_check_enabled: true,
    manager_ceph_s3_user_keys_enabled: true,
    storage_ops_enabled: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: true,
    allow_login_custom_endpoint: false,
  },
};

const costEnabledGeneralSettingsRule: MockRule = {
  id: "settings-general-cost-enabled",
  path: /^\/settings\/general$/,
  body: {
    manager_enabled: true,
    ceph_admin_enabled: true,
    browser_enabled: true,
    browser_root_enabled: true,
    browser_manager_enabled: true,
    browser_portal_enabled: true,
    browser_ceph_admin_enabled: true,
    portal_enabled: true,
    cost_enabled: true,
    endpoint_status_enabled: true,
    bucket_migration_enabled: true,
    bucket_compare_enabled: true,
    bucket_integrity_check_enabled: true,
    manager_ceph_s3_user_keys_enabled: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: true,
    allow_login_custom_endpoint: false,
  },
};

const bucketPurgeEnabledGeneralSettingsRule: MockRule = {
  id: "settings-general-bucket-purge-enabled",
  path: /^\/settings\/general$/,
  body: {
    manager_feature_policies: {
      ...DEFAULT_MANAGER_FEATURE_POLICIES,
      bucket_purge: "default_on",
    },
    manager_enabled: true,
    ceph_admin_enabled: true,
    browser_enabled: true,
    browser_root_enabled: true,
    browser_manager_enabled: true,
    browser_portal_enabled: true,
    browser_ceph_admin_enabled: true,
    portal_enabled: true,
    cost_enabled: false,
    endpoint_status_enabled: true,
    bucket_migration_enabled: true,
    bucket_compare_enabled: true,
    bucket_integrity_check_enabled: true,
    bucket_purge_enabled: true,
    manager_ceph_s3_user_keys_enabled: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: true,
    allow_login_custom_endpoint: false,
  },
};

const endpointStatusLatencyOverviewRule: MockRule = {
  id: "admin-endpoint-status-latency-overview",
  path: /^\/admin\/health\/latency-overview$/,
  body: ({ url }) => ({
    generated_at: "2026-03-08T09:00:00Z",
    window: url.searchParams.get("window") ?? "day",
    start: "2026-03-07T09:00:00Z",
    end: "2026-03-08T09:00:00Z",
    endpoints: [
      {
        endpoint_id: 11,
        name: "Default",
        endpoint_url: "https://s3-default.docs.example.com",
        status: "up",
        checked_at: "2026-03-08T09:00:00Z",
        latency_ms: 82,
        check_mode: "http",
        check_target_url: "https://s3-default.docs.example.com/health",
        min_latency_ms: 71,
        avg_latency_ms: 79,
        max_latency_ms: 96,
        sample_count: 24,
      },
      {
        endpoint_id: 12,
        name: "Archive",
        endpoint_url: "https://s3-archive.docs.example.com",
        status: "degraded",
        checked_at: "2026-03-08T09:00:00Z",
        latency_ms: 390,
        check_mode: "http",
        check_target_url: "https://s3-archive.docs.example.com/health",
        min_latency_ms: 280,
        avg_latency_ms: 356,
        max_latency_ms: 420,
        sample_count: 24,
      },
    ],
  }),
};

const endpointStatusOverviewRule: MockRule = {
  id: "admin-endpoint-status-overview",
  path: /^\/admin\/health\/overview$/,
  body: ({ url }) => ({
    generated_at: "2026-03-08T09:00:00Z",
    window: url.searchParams.get("window") ?? "week",
    start: "2026-03-01T00:00:00Z",
    end: "2026-03-08T09:00:00Z",
    endpoints: [
      {
        endpoint_id: 11,
        name: "Default",
        endpoint_url: "https://s3-default.docs.example.com",
        status: "up",
        checked_at: "2026-03-08T09:00:00Z",
        latency_ms: 82,
        check_mode: "http",
        check_target_url: "https://s3-default.docs.example.com/health",
        availability_pct: 99.8,
        baseline_latency_ms: 78,
        timeline: [
          { timestamp: "2026-03-01T00:00:00Z", end_timestamp: "2026-03-02T00:00:00Z", status: "up", latency_ms: 77 },
          { timestamp: "2026-03-02T00:00:00Z", end_timestamp: "2026-03-03T00:00:00Z", status: "up", latency_ms: 79 },
          { timestamp: "2026-03-03T00:00:00Z", end_timestamp: "2026-03-04T00:00:00Z", status: "up", latency_ms: 75 },
          { timestamp: "2026-03-04T00:00:00Z", end_timestamp: "2026-03-05T00:00:00Z", status: "up", latency_ms: 81 },
          { timestamp: "2026-03-05T00:00:00Z", end_timestamp: "2026-03-06T00:00:00Z", status: "up", latency_ms: 84 },
          { timestamp: "2026-03-06T00:00:00Z", end_timestamp: "2026-03-07T00:00:00Z", status: "up", latency_ms: 80 },
          { timestamp: "2026-03-07T00:00:00Z", end_timestamp: "2026-03-08T09:00:00Z", status: "up", latency_ms: 82 },
        ],
      },
      {
        endpoint_id: 12,
        name: "Archive",
        endpoint_url: "https://s3-archive.docs.example.com",
        status: "degraded",
        checked_at: "2026-03-08T09:00:00Z",
        latency_ms: 390,
        check_mode: "http",
        check_target_url: "https://s3-archive.docs.example.com/health",
        availability_pct: 94.1,
        baseline_latency_ms: 310,
        timeline: [
          { timestamp: "2026-03-01T00:00:00Z", end_timestamp: "2026-03-02T00:00:00Z", status: "up", latency_ms: 305 },
          { timestamp: "2026-03-02T00:00:00Z", end_timestamp: "2026-03-03T00:00:00Z", status: "up", latency_ms: 298 },
          { timestamp: "2026-03-03T00:00:00Z", end_timestamp: "2026-03-04T00:00:00Z", status: "degraded", latency_ms: 352, reason: "Latency spike" },
          { timestamp: "2026-03-04T00:00:00Z", end_timestamp: "2026-03-05T00:00:00Z", status: "up", latency_ms: 312 },
          { timestamp: "2026-03-05T00:00:00Z", end_timestamp: "2026-03-06T00:00:00Z", status: "down", latency_ms: null, reason: "Gateway timeout" },
          { timestamp: "2026-03-06T00:00:00Z", end_timestamp: "2026-03-07T00:00:00Z", status: "up", latency_ms: 301 },
          { timestamp: "2026-03-07T00:00:00Z", end_timestamp: "2026-03-08T09:00:00Z", status: "degraded", latency_ms: 390, reason: "High latency" },
        ],
      },
    ],
  }),
};

const endpointStatusGlobalIncidentsRule: MockRule = {
  id: "admin-endpoint-status-incidents-global",
  path: /^\/admin\/health\/incidents-global$/,
  body: ({ url }) => ({
    window: url.searchParams.get("window") ?? "half_year",
    start: "2025-09-08T00:00:00Z",
    end: "2026-03-08T09:00:00Z",
    total: 2,
    incidents: [
      {
        endpoint_id: 12,
        endpoint_name: "Archive",
        endpoint_url: "https://s3-archive.docs.example.com",
        status: "degraded",
        start: "2026-03-08T08:42:00Z",
        end: null,
        duration_minutes: 18,
        check_mode: "http",
      },
      {
        endpoint_id: 12,
        endpoint_name: "Archive",
        endpoint_url: "https://s3-archive.docs.example.com",
        status: "down",
        start: "2026-03-05T10:00:00Z",
        end: "2026-03-05T11:30:00Z",
        duration_minutes: 90,
        check_mode: "http",
      },
    ],
  }),
};

const costSummaryRule: MockRule = {
  id: "admin-cost-summary",
  path: /^\/admin\/cost\/summary$/,
  body: {
    month: "2026-03",
    storage_endpoint_id: null,
    usage: {
      bytes_in: 912_000_000,
      bytes_out: 3_420_000_000,
      ops_total: 18_450_000,
    },
    storage: {
      avg_bytes: 2_950_000_000,
      avg_gb_month: 91.4,
      total_objects: 1_540_000,
    },
    coverage: {
      days_collected: 27,
      days_in_month: 31,
      coverage_ratio: 27 / 31,
      storage_days_collected: 27,
      usage_days_collected: 27,
    },
    cost: {
      currency: "EUR",
      storage_cost: 92.5,
      egress_cost: 41.2,
      ingress_cost: 5.3,
      requests_cost: 18.6,
      total_cost: 157.6,
      pricing_source: "global",
    },
  },
};

const costSubjectsRule: MockRule = {
  id: "admin-cost-subjects",
  path: /^\/admin\/cost\/subjects$/,
  body: {
    items: [
      {
        storage_endpoint_id: 11,
        storage_endpoint_name: "Primary",
        subject_type: "account",
        subject_id: 101,
        name: "Helios Retail",
        rgw_identifier: "RGW-HELIOS",
        storage: {
          avg_bytes: 2_350_000_000,
          avg_gb_month: 72.8,
          total_objects: 1_284_000,
        },
        usage: {
          bytes_in: 620_000_000,
          bytes_out: 2_100_000_000,
          ops_total: 12_450_000,
        },
        coverage: {
          days_collected: 27,
          days_in_month: 31,
          coverage_ratio: 27 / 31,
          storage_days_collected: 27,
          usage_days_collected: 27,
        },
        cost: {
          currency: "EUR",
          total_cost: 96.4,
        },
      },
    ],
    total: 1,
    page: 1,
    page_size: 25,
    has_next: false,
  },
};

const costSubjectDetailRule: MockRule = {
  id: "admin-cost-subject-detail",
  path: /^\/admin\/cost\/subject\/account\/\d+$/,
  body: ({ url }) => {
    const subjectId = Number(url.pathname.split("/").at(-1) ?? "101");
    const detailById = {
      101: {
        month: "2026-03",
        storage_endpoint_id: 11,
        storage_endpoint_name: "Primary",
        subject_type: "account",
        subject_id: 101,
        name: "Helios Retail",
        rgw_identifier: "RGW-HELIOS",
        daily: [
          { day: "2026-03-01", storage_bytes: 2_180_000_000, bytes_in: 21_000_000, bytes_out: 78_000_000, ops_total: 430_000 },
          { day: "2026-03-05", storage_bytes: 2_260_000_000, bytes_in: 24_000_000, bytes_out: 82_000_000, ops_total: 455_000 },
          { day: "2026-03-10", storage_bytes: 2_320_000_000, bytes_in: 26_000_000, bytes_out: 84_000_000, ops_total: 468_000 },
          { day: "2026-03-15", storage_bytes: 2_380_000_000, bytes_in: 22_000_000, bytes_out: 79_000_000, ops_total: 447_000 },
          { day: "2026-03-20", storage_bytes: 2_440_000_000, bytes_in: 25_000_000, bytes_out: 88_000_000, ops_total: 479_000 },
          { day: "2026-03-25", storage_bytes: 2_510_000_000, bytes_in: 27_000_000, bytes_out: 92_000_000, ops_total: 498_000 },
          { day: "2026-03-27", storage_bytes: 2_550_000_000, bytes_in: 28_000_000, bytes_out: 94_000_000, ops_total: 505_000 },
        ],
        usage: {
          bytes_in: 620_000_000,
          bytes_out: 2_100_000_000,
          ops_total: 12_450_000,
        },
        storage: {
          avg_bytes: 2_350_000_000,
          avg_gb_month: 72.8,
          total_objects: 1_284_000,
        },
        coverage: {
          days_collected: 27,
          days_in_month: 31,
          coverage_ratio: 27 / 31,
          storage_days_collected: 27,
          usage_days_collected: 27,
        },
        cost: {
          currency: "EUR",
          total_cost: 96.4,
          pricing_source: "global",
        },
      },
      102: {
        month: "2026-03",
        subject_type: "account",
        subject_id: 102,
        name: "Northwind Ops",
        rgw_identifier: "RGW-NORTHWIND",
        daily: [
          { day: "2026-03-01", storage_bytes: 380_000_000, bytes_in: 6_000_000, bytes_out: 21_000_000, ops_total: 110_000 },
          { day: "2026-03-10", storage_bytes: 405_000_000, bytes_in: 5_000_000, bytes_out: 24_000_000, ops_total: 118_000 },
          { day: "2026-03-20", storage_bytes: 430_000_000, bytes_in: 4_000_000, bytes_out: 27_000_000, ops_total: 124_000 },
          { day: "2026-03-27", storage_bytes: 445_000_000, bytes_in: 7_000_000, bytes_out: 29_000_000, ops_total: 131_000 },
        ],
        usage: {
          bytes_in: 142_000_000,
          bytes_out: 680_000_000,
          ops_total: 3_120_000,
        },
        storage: {
          avg_bytes: 420_000_000,
          avg_gb_month: 13.0,
          total_objects: 212_000,
        },
        coverage: {
          days_collected: 27,
          days_in_month: 31,
          coverage_ratio: 27 / 31,
          storage_days_collected: 27,
          usage_days_collected: 27,
        },
        cost: {
          currency: "EUR",
          total_cost: 31.8,
          pricing_source: "global",
        },
      },
      103: {
        month: "2026-03",
        subject_type: "account",
        subject_id: 103,
        name: "BlueHarbor Data",
        rgw_identifier: "RGW-BLUEHARBOR",
        daily: [
          { day: "2026-03-01", storage_bytes: 160_000_000, bytes_in: 3_000_000, bytes_out: 18_000_000, ops_total: 92_000 },
          { day: "2026-03-10", storage_bytes: 172_000_000, bytes_in: 4_000_000, bytes_out: 20_000_000, ops_total: 95_000 },
          { day: "2026-03-20", storage_bytes: 184_000_000, bytes_in: 5_000_000, bytes_out: 23_000_000, ops_total: 99_000 },
          { day: "2026-03-27", storage_bytes: 196_000_000, bytes_in: 6_000_000, bytes_out: 24_000_000, ops_total: 101_000 },
        ],
        usage: {
          bytes_in: 150_000_000,
          bytes_out: 640_000_000,
          ops_total: 2_880_000,
        },
        storage: {
          avg_bytes: 180_000_000,
          avg_gb_month: 5.6,
          total_objects: 44_000,
        },
        coverage: {
          days_collected: 27,
          days_in_month: 31,
          coverage_ratio: 27 / 31,
          storage_days_collected: 27,
          usage_days_collected: 27,
        },
        cost: {
          currency: "EUR",
          total_cost: 22.5,
          pricing_source: "global",
        },
      },
    } as const;
    const detail = detailById[subjectId as keyof typeof detailById] ?? detailById[101];
    const totalCost = detail.cost.total_cost;
    const history = Array.from({ length: 12 }, (_, index) => {
      const month = index + 4;
      const year = month > 12 ? 2026 : 2025;
      const resolvedMonth = month > 12 ? month - 12 : month;
      const factor = 0.72 + index * 0.025;
      return {
        month: `${year}-${String(resolvedMonth).padStart(2, "0")}`,
        coverage: {
          days_collected: 28,
          days_in_month: 30,
          coverage_ratio: 28 / 30,
          storage_days_collected: 28,
          usage_days_collected: 28,
        },
        cost: {
          currency: "EUR",
          storage_cost: totalCost * factor * 0.55,
          egress_cost: totalCost * factor * 0.27,
          ingress_cost: totalCost * factor * 0.03,
          requests_cost: totalCost * factor * 0.15,
          total_cost: totalCost * factor,
          pricing_source: "global",
        },
      };
    });
    history[history.length - 1] = {
      month: detail.month,
      coverage: detail.coverage,
      cost: {
        currency: "EUR",
        storage_cost: totalCost * 0.55,
        egress_cost: totalCost * 0.27,
        ingress_cost: totalCost * 0.03,
        requests_cost: totalCost * 0.15,
        total_cost: totalCost,
        pricing_source: "global",
      },
    };
    return {
      ...detail,
      usage: {
        ...detail.usage,
        ops_breakdown: {
          get: Math.round(detail.usage.ops_total * 0.68),
          put: Math.round(detail.usage.ops_total * 0.19),
          list: Math.round(detail.usage.ops_total * 0.09),
          delete: Math.round(detail.usage.ops_total * 0.04),
        },
      },
      cost: history[history.length - 1].cost,
      history,
    };
  },
};

const portalCostMeRule: MockRule = {
  id: "portal-cost-me",
  path: /^\/portal\/cost\/me$/,
  body: {
    month: "2026-03",
    subject_type: "account",
    subject_id: 101,
    name: "Helios Retail",
    rgw_identifier: "RGW-HELIOS",
    daily: [
      { day: "2026-03-01", storage_bytes: 2_180_000_000, bytes_in: 21_000_000, bytes_out: 78_000_000, ops_total: 430_000 },
      { day: "2026-03-08", storage_bytes: 2_260_000_000, bytes_in: 24_000_000, bytes_out: 82_000_000, ops_total: 455_000 },
    ],
    usage: {
      bytes_in: 620_000_000,
      bytes_out: 2_100_000_000,
      ops_total: 12_450_000,
    },
    storage: {
      avg_bytes: 2_350_000_000,
      avg_gb_month: 72.8,
      total_objects: 1_284_000,
    },
    coverage: {
      days_collected: 27,
      days_in_month: 31,
      coverage_ratio: 27 / 31,
      storage_days_collected: 27,
      usage_days_collected: 27,
    },
    cost: {
      currency: "EUR",
      total_cost: 96.4,
      pricing_source: "global",
    },
  },
};

const storageOpsBucketsPayload = {
  items: [
    {
      name: "acc-helios::helios-retail-logs",
      bucket_name: "helios-retail-logs",
      context_id: "acc-helios",
      context_name: "Helios Retail",
      context_kind: "account",
      endpoint_name: "Default",
      owner: "RGW58084876167649330",
      owner_name: "Helios Platform",
      used_bytes: 182_554_321,
      object_count: 1284,
      tags: [
        { key: "env", value: "prod" },
        { key: "team", value: "platform" },
      ],
      features: {
        versioning: { state: "enabled", tone: "active" },
        lifecycle: { state: "configured", tone: "active" },
      },
    },
    {
      name: "conn-blueharbor::northwind-iot-events",
      bucket_name: "northwind-iot-events",
      context_id: "conn-blueharbor",
      context_name: "BlueHarbor Shared Connection",
      context_kind: "connection",
      endpoint_name: "Archive",
      owner: "RGW93423330686004300",
      owner_name: "Northwind Ops",
      used_bytes: 88_000_000,
      object_count: 4292,
      tags: [{ key: "env", value: "prod" }],
      features: {
        versioning: { state: "disabled", tone: "inactive" },
        lifecycle: { state: "configured", tone: "active" },
      },
    },
  ],
  total: 2,
  page: 1,
  page_size: 25,
  has_next: false,
};

const storageOpsBucketsRule: MockRule = {
  id: "storage-ops-buckets",
  path: /^\/storage-ops\/buckets$/,
  body: storageOpsBucketsPayload,
};

const storageOpsSummaryRule: MockRule = {
  id: "storage-ops-summary",
  path: /^\/storage-ops\/summary$/,
  body: {
    total_contexts: 4,
    total_accounts: 2,
    total_s3_users: 1,
    total_connections: 1,
    total_shared_connections: 1,
    total_private_connections: 0,
    total_endpoints: 2,
  },
};

const storageOpsBucketsStreamRule: MockRule = {
  id: "storage-ops-buckets-stream",
  path: /^\/storage-ops\/buckets\/stream$/,
  body: {
    result: storageOpsBucketsPayload,
  },
};

const cephBulkLifecycleUiTag = {
  id: 42,
  label: "retention-audit-2026",
  color_key: "blue",
  scope: "standard" as const,
  visibility: "shared" as const,
};

const cephBulkLifecycleTagsAppliedStateKey = "ceph-bulk-lifecycle-tags-applied";

const cephBulkLifecycleBuckets = [
  ["etl-dev-ingest-01", "ETL Ingest"],
  ["etl-dev-ingest-02", "ETL Ingest"],
  ["etl-dev-ingest-03", "ETL Ingest"],
  ["etl-dev-transform-01", "ETL Transform"],
  ["etl-dev-transform-02", "ETL Transform"],
  ["etl-dev-transform-03", "ETL Transform"],
  ["etl-dev-archive-01", "ETL Archive"],
  ["etl-dev-quality-01", "ETL Quality"],
  ["etl-prod-critical-01", "ETL Production"],
  ["backup-immutable-01", "Backup Platform"],
].map(([name, ownerName], index) => ({
  name,
  tenant: null,
  owner: `RGW-DOC-${index + 1}`,
  owner_name: ownerName,
  owner_suspended: false,
  used_bytes: 20_000_000 + index * 3_500_000,
  object_count: 120 + index * 19,
  quota_max_size_bytes: null,
  quota_max_objects: null,
  owner_used_bytes: null,
  owner_object_count: null,
  owner_quota_max_size_bytes: null,
  owner_quota_max_objects: null,
  tags: [{ key: "workload", value: name.startsWith("etl-") ? "etl" : "backup" }],
  features: {
    versioning: { state: "disabled", tone: "inactive" },
    lifecycle: {
      state:
        name.startsWith("etl-dev-ingest-")
          ? "not_set"
          : "configured",
      tone:
        name.startsWith("etl-dev-ingest-")
          ? "inactive"
          : "active",
    },
  },
  column_details: null,
  ui_tags: [],
}));

function cephBulkLifecycleRulesForBucket(bucketName: string) {
  if (bucketName.startsWith("etl-dev-transform-")) {
    return [
      {
        ID: "tmp-cleanup",
        Status: "Enabled",
        Filter: { Prefix: "tmp/" },
        Expiration: { Days: 60 },
      },
    ];
  }
  if (bucketName === "etl-dev-archive-01") {
    return [
      {
        ID: "archive-retention",
        Status: "Enabled",
        Filter: { Prefix: "archive/" },
        Expiration: { Days: 365 },
      },
    ];
  }
  if (bucketName === "etl-dev-quality-01") {
    return [
      {
        ID: "tmp-cleanup",
        Status: "Enabled",
        Filter: { Prefix: "tmp/" },
        Expiration: { Days: 30 },
      },
    ];
  }
  return [];
}

const cephBulkLifecycleListRule: MockRule = {
  id: "ceph-bulk-lifecycle-buckets",
  method: "GET",
  path: /^\/ceph-admin\/endpoints\/11\/buckets$/,
  body: ({ url, state }) => {
    const filter = (url.searchParams.get("filter") ?? "").trim().toLowerCase();
    const baseItems = filter
      ? cephBulkLifecycleBuckets.filter((bucket) => bucket.name.toLowerCase().includes(filter))
      : cephBulkLifecycleBuckets;
    const tagsApplied = state.get(cephBulkLifecycleTagsAppliedStateKey) === true;
    const items = baseItems.map((bucket) => ({
      ...bucket,
      ui_tags:
        tagsApplied && bucket.name.startsWith("etl-dev-")
          ? [cephBulkLifecycleUiTag]
          : bucket.ui_tags,
    }));
    return {
      items,
      total: items.length,
      page: 1,
      page_size: Number(url.searchParams.get("page_size") ?? 50),
      has_next: false,
      stats_available: true,
      stats_warning: null,
    };
  },
};

const cephBulkLifecycleUiTagsGetRule: MockRule = {
  id: "ceph-bulk-lifecycle-ui-tags-get",
  method: "GET",
  path: /^\/ceph-admin\/endpoints\/11\/bucket-ui-tags$/,
  body: { definitions: [cephBulkLifecycleUiTag] },
};

const cephBulkLifecycleUiTagsPatchRule: MockRule = {
  id: "ceph-bulk-lifecycle-ui-tags-patch",
  method: "PATCH",
  path: /^\/ceph-admin\/endpoints\/11\/bucket-ui-tags$/,
  body: ({ state }) => {
    state.set(cephBulkLifecycleTagsAppliedStateKey, true);
    return { definitions: [cephBulkLifecycleUiTag] };
  },
};

const cephBulkLifecycleGetRule: MockRule = {
  id: "ceph-bulk-lifecycle-get",
  method: "GET",
  path: /^\/ceph-admin\/endpoints\/11\/buckets\/[^/]+\/lifecycle$/,
  body: ({ url }) => {
    const match = url.pathname.match(/\/buckets\/([^/]+)\/lifecycle$/);
    const bucketName = decodeURIComponent(match?.[1] ?? "");
    return { rules: cephBulkLifecycleRulesForBucket(bucketName) };
  },
};

const cephBulkLifecyclePutRule: MockRule = {
  id: "ceph-bulk-lifecycle-put",
  method: "PUT",
  path: /^\/ceph-admin\/endpoints\/11\/buckets\/[^/]+\/lifecycle$/,
  body: ({ requestBodyText }) => {
    try {
      const payload = JSON.parse(requestBodyText || "{}") as { rules?: unknown[] };
      return { rules: payload.rules ?? [] };
    } catch {
      return { rules: [] };
    }
  },
};

function cephTutorialBucket(
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    name,
    tenant: null,
    owner: "RGW-DOCS",
    owner_name: "Docs storage team",
    owner_suspended: false,
    used_bytes: 2_000_000_000,
    object_count: 12_000,
    quota_max_size_bytes: null,
    quota_max_objects: null,
    owner_used_bytes: null,
    owner_object_count: null,
    owner_quota_max_size_bytes: null,
    owner_quota_max_objects: null,
    tags: [{ key: "env", value: "prod" }],
    features: {
      versioning: { state: "enabled", tone: "active" },
      lifecycle: { state: "configured", tone: "active" },
    },
    column_details: null,
    ui_tags: [],
    ...overrides,
  };
}

function cephTutorialBucketListRule(
  id: string,
  items: Array<Record<string, unknown>>,
): MockRule {
  return {
    id,
    method: "GET",
    path: /^\/ceph-admin\/endpoints\/11\/buckets$/,
    body: ({ url }) => ({
      items,
      total: items.length,
      page: 1,
      page_size: Number(url.searchParams.get("page_size") ?? 25),
      has_next: false,
      stats_available: true,
      stats_warning: null,
    }),
  };
}

const cephQuotaReviewBuckets = [
  cephTutorialBucket("analytics-prod-raw", {
    owner_name: "Analytics",
    used_bytes: 8_200_000_000_000,
    object_count: 7_800_000,
    quota_max_size_bytes: 10_000_000_000_000,
    quota_max_objects: 10_000_000,
  }),
  cephTutorialBucket("research-prod-sequences", {
    owner_name: "Research",
    used_bytes: 9_100_000_000_000,
    object_count: 18_600_000,
    quota_max_size_bytes: 10_000_000_000_000,
    quota_max_objects: 20_000_000,
  }),
  cephTutorialBucket("ml-prod-models", {
    owner_name: "ML Platform",
    used_bytes: 4_600_000_000_000,
    object_count: 4_350_000,
    quota_max_size_bytes: 5_000_000_000_000,
    quota_max_objects: 5_000_000,
  }),
];

const cephIndexCheckBuckets = [
  cephTutorialBucket("payments-prod-events", { owner_name: "Payments" }),
  cephTutorialBucket("catalog-prod-media", { owner_name: "Catalog" }),
  cephTutorialBucket("orders-prod-archive", { owner_name: "Orders" }),
];

const cephIndexCheckStreamRule: MockRule = {
  id: "ceph-tutorial-index-check-stream",
  method: "POST",
  path: /^\/ceph-admin\/endpoints\/11\/bucket-index-check\/stream$/,
  contentType: "text/event-stream",
  body: [
    "event: progress",
    'data: {"request_id":"docs-index-audit","stage":"complete","bucket_name":"orders-prod-archive","tenant":null,"total_buckets":3,"completed_buckets":3,"failed_buckets":1,"message":"Bucket index checks complete"}',
    "",
    "event: result",
    'data: {"status":"completed_with_errors","total_buckets":3,"completed_buckets":3,"failed_buckets":1,"started_at":"2026-10-26T09:00:00Z","finished_at":"2026-10-26T09:00:02Z","buckets":[{"name":"payments-prod-events","tenant":null,"status":"completed","duration_seconds":0.4,"operation":"check_bucket_index","rgw_status_code":200,"rgw_error_code":null,"message":"Index is consistent","result":{}},{"name":"catalog-prod-media","tenant":null,"status":"failed","duration_seconds":0.7,"operation":"check_bucket_index","rgw_status_code":500,"rgw_error_code":"IndexMismatch","message":"Header and index entry counts differ","result":{}},{"name":"orders-prod-archive","tenant":null,"status":"completed","duration_seconds":0.3,"operation":"check_bucket_index","rgw_status_code":200,"rgw_error_code":null,"message":"Index is consistent","result":{}}]}',
    "",
    "",
  ].join("\n"),
};

const cephVersionRetentionStreamRule: MockRule = {
  id: "ceph-tutorial-version-retention-stream",
  method: "GET",
  path: /^\/ceph-admin\/endpoints\/11\/buckets\/stream$/,
  contentType: "text/event-stream",
  body: [
    "event: result",
    `data: ${JSON.stringify({
      items: [
        cephTutorialBucket("archive-prod-records", { owner_name: "Records" }),
        cephTutorialBucket("ml-prod-checkpoints", { owner_name: "ML Platform" }),
      ],
      total: 2,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: true,
      stats_warning: null,
    })}`,
    "",
    "event: done",
    'data: {"request_id":"docs-version-retention"}',
    "",
    "",
  ].join("\n"),
};

const cephNotificationBuckets = [
  cephTutorialBucket("project-prod-ingest-01", { owner_name: "Project ingest" }),
  cephTutorialBucket("project-prod-ingest-02", { owner_name: "Project ingest" }),
];

const cephNotificationGetRule: MockRule = {
  id: "ceph-tutorial-notification-get",
  method: "GET",
  path: /^\/ceph-admin\/endpoints\/11\/buckets\/project-prod-ingest-0[12]\/notifications$/,
  body: ({ url }) => {
    const firstBucket = url.pathname.includes("project-prod-ingest-01");
    const topicConfigurations = [
      {
        Id: "audit-removals",
        TopicArn: "arn:aws:sns:default::audit-events",
        Events: ["s3:ObjectRemoved:*"],
      },
    ];
    if (firstBucket) {
      topicConfigurations.push({
        Id: "project-ingest-events",
        TopicArn: "arn:aws:sns:default::project-ingest",
        Events: ["s3:ObjectCreated:*"],
        Filter: {
          Key: { FilterRules: [{ Name: "prefix", Value: "staging/" }] },
        },
      } as typeof topicConfigurations[number]);
    }
    return { configuration: { TopicConfigurations: topicConfigurations } };
  },
};

function cephPublicAuditResource(resource: string | undefined) {
  switch (resource) {
    case "properties":
      return {
        versioning_status: "Enabled",
        object_lock: null,
        public_access_block: null,
        lifecycle_rules: [],
        cors_rules: [],
      };
    case "versioning":
      return { status: "Enabled", enabled: true };
    case "object-lock":
      return { enabled: false, mode: null, days: null, years: null };
    case "lifecycle":
      return { rules: [] };
    case "encryption":
      return {
        rules: [
          {
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      };
    case "notifications":
      return { configuration: {} };
    case "logging":
      return { enabled: true, target_bucket: "security-audit-logs", target_prefix: "public-assets/" };
    case "website":
      return { index_document: "index.html", error_document: "error.html", redirect_all_requests_to: null, routing_rules: [] };
    case "replication":
      return { configuration: {} };
    case "policy":
      return {
        policy: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "PartnerReadFromOfficeNetwork",
              Effect: "Allow",
              Principal: "*",
              Action: "s3:GetObject",
              Resource: "arn:aws:s3:::public-assets-prod/shared/*",
              Condition: {
                IpAddress: { "aws:SourceIp": "203.0.113.0/24" },
              },
            },
            {
              Sid: "DenyInsecureTransport",
              Effect: "Deny",
              Principal: "*",
              Action: "s3:*",
              Resource: [
                "arn:aws:s3:::public-assets-prod",
                "arn:aws:s3:::public-assets-prod/*",
              ],
              Condition: {
                Bool: { "aws:SecureTransport": "false" },
              },
            },
          ],
        },
      };
    case "acl":
      return {
        owner: "RGW-DOCS",
        grants: [
          {
            grantee: {
              type: "CanonicalUser",
              id: "RGW-DOCS",
              display_name: "RGW-DOCS",
            },
            permission: "FULL_CONTROL",
          },
        ],
      };
    case "cors":
      return { rules: [] };
    case "tags":
      return { tags: [{ key: "classification", value: "partner-shared" }] };
    case "public-access-block":
      return {
        block_public_acls: true,
        ignore_public_acls: true,
        block_public_policy: false,
        restrict_public_buckets: false,
      };
    default:
      return null;
  }
}

const cephPublicAuditResourcesRule: MockRule = {
  id: "ceph-tutorial-public-audit-resources",
  method: "GET",
  path: /^\/ceph-admin\/endpoints\/11\/buckets\/public-assets-prod\/(properties|versioning|object-lock|lifecycle|encryption|notifications|logging|website|replication|policy|acl|cors|tags|public-access-block)$/,
  body: ({ url }) =>
    cephPublicAuditResource(url.pathname.split("/").at(-1)),
};

const cephEncryptionAuditBuckets = [
  cephTutorialBucket("finance-prod-ledger", {
    owner_name: "Finance",
    features: {
      server_side_encryption: { state: "configured", tone: "active" },
    },
    column_details: {
      sse_algorithms: ["aws:kms"],
      sse_kms_key_ids: ["finance-prod-key"],
    },
  }),
  cephTutorialBucket("finance-prod-reports", {
    owner_name: "Finance",
    features: {
      server_side_encryption: { state: "configured", tone: "active" },
    },
    column_details: {
      sse_algorithms: ["aws:kms"],
      sse_kms_key_ids: ["legacy-finance-key"],
    },
  }),
  cephTutorialBucket("finance-prod-export", {
    owner_name: "Finance",
    features: {
      server_side_encryption: { state: "configured", tone: "active" },
    },
    column_details: {
      sse_algorithms: ["AES256"],
      sse_kms_key_ids: [],
    },
  }),
];

export const scenarios: DocScreenshotScenario[] = [
  {
    id: "user-overview",
    docPage: "user/index.md",
    route: "/admin",
    outputBasename: "user-overview",
    waitFor: "h1:has-text('Admin overview')",
    user: superAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "manager-profile",
    docPage: "manager/en/profile.md",
    route: "/manager/profile",
    outputBasename: "manager-profile",
    waitFor: "h1:has-text('My profile')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    actions: [{ type: "wait", selector: "text=Personal details" }],
    mockRules: withBaseRules(),
  },
  {
    id: "portal-profile",
    docPage: "portal/en/profile.md",
    route: "/portal/profile",
    outputBasename: "portal-profile",
    waitFor: "h1:has-text('My profile')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [{ type: "wait", selector: "text=Personal details" }],
    mockRules: withBaseRules(),
  },
  {
    id: "browser-profile",
    docPage: "browser/en/profile.md",
    route: "/browser/profile",
    outputBasename: "browser-profile",
    waitFor: "h1:has-text('My profile')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "browser" },
    actions: [{ type: "wait", selector: "text=Personal details" }],
    mockRules: withBaseRules(),
  },
  {
    id: "start-here",
    docPage: "user/start-here.md",
    route: "/admin",
    outputBasename: "start-here",
    waitFor: "h1:has-text('Admin overview')",
    user: superAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "admin" },
    actions: [{ type: "click", selector: "button[aria-label='Switch workspace']" }],
    mockRules: withBaseRules(),
  },
  {
    id: "use-cases-storage-admin",
    docPage: "user/use-cases-storage-admin.md",
    route: "/manager",
    outputBasename: "use-cases-storage-admin",
    waitFor: "h1:has-text('Manager dashboard')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "use-cases-storage-user",
    docPage: "user/use-cases-storage-user.md",
    route: "/browser",
    outputBasename: "use-cases-storage-user",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    user: storageUser,
    storage: {
      ...baseStorage(),
      selectedWorkspace: "browser",
      extraEntries: {
        [BROWSER_ROOT_UI_STATE_STORAGE_KEY]: browserFoldersPanelStateEntry,
      },
      extraSessionEntries: {
        [BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY]: browserContextSelectionsEntry,
      },
    },
    actions: [
      { type: "wait", selector: "text=report-2026-03-08.json" },
      { type: "click", selector: "button:has-text('report-2026-03-08.json')" },
      { type: "click", selector: "button[role='tab']:has-text('Properties')" },
      { type: "wait", selector: "text=Storage class" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-admin",
    docPage: "user/workspace-admin.md",
    route: "/admin",
    outputBasename: "workspace-admin",
    waitFor: "h1:has-text('Admin overview')",
    user: superAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "feature-endpoint-status-admin",
    docPage: "user/feature-endpoint-status-admin.md",
    route: "/admin/endpoint-status",
    outputBasename: "admin-endpoint-status",
    waitFor: "h1:has-text('Endpoint Status')",
    user: superAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "admin" },
    actions: [
      { type: "wait", selector: "text=Endpoint Latency" },
      { type: "wait", selector: "text=Endpoint Timelines" },
      { type: "wait", selector: "text=Incidents" },
      { type: "click", selector: "button:has-text('Degraded')" },
    ],
    mockRules: withBaseRules(
      endpointStatusLatencyOverviewRule,
      endpointStatusOverviewRule,
      endpointStatusGlobalIncidentsRule,
    ),
  },
  {
    id: "feature-cost-admin",
    docPage: "user/feature-cost-admin.md",
    route: "/admin/cost",
    outputBasename: "admin-cost",
    waitFor: "h1:has-text('Cost')",
    user: superAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "admin" },
    actions: [
      { type: "wait", selector: "text=Estimated cost" },
      { type: "wait", selector: "input[placeholder*='Search subjects']" },
      { type: "wait", selector: "tr:has-text('Helios Retail')" },
      { type: "wait", selector: "tr:has-text('Helios Retail') a:has-text('View')" },
    ],
    mockRules: withBaseRules(
      costEnabledGeneralSettingsRule,
      costSummaryRule,
      costSubjectsRule,
      costSubjectDetailRule,
    ),
  },
  {
    id: "gallery-admin-ui-users",
    docPage: "user/screenshots-gallery.md",
    route: "/admin/users",
    outputBasename: "admin-ui-users",
    waitFor: "h1:has-text('UI Users')",
    user: superAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "admin" },
    actions: [{ type: "wait", selector: "text=platform.admin@example.com" }],
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-admin-storage-endpoints",
    docPage: "user/screenshots-gallery.md",
    route: "/admin/storage-endpoints",
    outputBasename: "admin-storage-endpoints",
    waitFor: "h1:has-text('S3 Endpoints')",
    user: superAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "admin" },
    actions: [{ type: "wait", selector: "text=https://s3-default.docs.example.com" }],
    mockRules: withBaseRules({ id: "endpoint-pending", path: /^\/admin\/navigation\/pending-requests$/, body: { identity_link_requests: 0, portal_requests: 0 } }),
  },
  {
    id: "workspace-manager",
    docPage: "user/workspace-manager.md",
    route: "/manager",
    outputBasename: "workspace-manager",
    waitFor: "h1:has-text('Manager dashboard')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    actions: [{ type: "wait", selector: "[data-kpi-card]" }],
    mockRules: withBaseRules(),
  },
  {
    id: "manager-activity",
    docPage: "manager/en/activity.md",
    route: "/manager?ctx=acc-helios",
    outputBasename: "manager-activity",
    waitFor: "h1:has-text('Manager dashboard')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    actions: [
      { type: "wait", selector: "a[href='/manager/activity']" },
      { type: "click", selector: "a[href='/manager/activity']" },
      { type: "wait", selector: "h1:has-text('Activity history')" },
      { type: "wait", selector: "text=helios-retail-logs" },
      { type: "wait", selector: "text=backup-operator" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "manager-access-keys",
    docPage: "manager/en/iam/access-keys.md",
    route: "/manager/ceph/keys",
    outputBasename: "manager-access-keys",
    waitFor: "h1:has-text('Ceph access keys')",
    user: adminUser,
    storage: {
      ...baseStorage(),
      selectedWorkspace: "manager",
      selectedManagerExecutionContextId: "s3u-903",
    },
    actions: [
      { type: "wait", selector: "text=Operations client" },
      { type: "wait", selector: "button:has-text('Create my private access')" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-browser",
    docPage: "user/workspace-browser.md",
    route: "/browser?bucket=helios-retail-logs",
    outputBasename: "workspace-browser",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "browser" },
    actions: [{ type: "wait", selector: "text=daily/report-2026-03-08.json" }],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-portal",
    docPage: "user/workspace-portal.md",
    route: "/portal",
    outputBasename: "workspace-portal",
    waitFor: "h1:has-text('Dashboard')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [
      { type: "wait", selector: "text=Storage overview" },
      { type: "wait", selector: "text=genomics-2026" },
      { type: "wait", selector: "text=Recent activity" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "portal-collaborators",
    docPage: "portal/en/collaboration.md",
    route: "/portal/shares",
    outputBasename: "portal-collaborators",
    waitFor: "h1:has-text('Collaborators')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [
      { type: "wait", selector: "text=Alice Martin" },
      { type: "wait", selector: "text=Chen Wei" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "portal-history",
    docPage: "portal/en/activity.md",
    route: "/portal/history",
    outputBasename: "portal-history",
    waitFor: "h1:has-text('History')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [{ type: "wait", selector: "[aria-label='Recent activity']" }],
    mockRules: withBaseRules(),
  },
  {
    id: "portal-help-requests",
    docPage: "portal/en/help-requests.md",
    route: "/portal/requests",
    outputBasename: "portal-help-requests",
    waitFor: "h1:has-text('Help requests')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [{ type: "wait", selector: "text=History (3)" }],
    mockRules: withBaseRules(),
  },
  {
    id: "portal-object-versions",
    docPage: "portal/en/files/versions.md",
    route: "/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F&object=raw-data%2F2024%2F03%2Fsample_001.fastq.gz&object_view=history",
    outputBasename: "portal-object-versions",
    waitFor: "[role='complementary'] h2:has-text('sample_001.fastq.gz')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [
      { type: "wait", selector: "ol[aria-label='File versions']" },
      { type: "wait", selector: "text=Previous version" },
    ],
    capture: { selector: "[role='complementary']", padding: 24 },
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-portal-storage-spaces",
    docPage: "user/screenshots-gallery.md",
    route: "/portal/storage-spaces",
    outputBasename: "portal-storage-spaces",
    waitFor: "h1:has-text('Spaces')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [
      { type: "wait", selector: "text=genomics-2026" },
      { type: "wait", selector: "text=photos" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-portal-object-list",
    docPage: "user/screenshots-gallery.md",
    route: "/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F",
    outputBasename: "portal-object-list",
    waitFor: "h1:has-text('genomics-2026')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [
      { type: "wait", selector: "text=sample_001.fastq.gz" },
      { type: "wait", selector: "text=01-fastq" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-portal-object-detail",
    docPage: "user/screenshots-gallery.md",
    route: "/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F&object=raw-data%2F2024%2F03%2Fsample_001.fastq.gz&object_view=details",
    outputBasename: "portal-object-detail",
    waitFor: "[role='complementary'] h2:has-text('sample_001.fastq.gz')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [
      { type: "wait", selector: "text=General information" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-portal-usage",
    docPage: "user/screenshots-gallery.md",
    route: "/portal/usage",
    outputBasename: "portal-usage",
    waitFor: "h1:has-text('Storage health')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [
      { type: "click", selector: "button:has-text('By space')" },
      { type: "wait", selector: "text=Spaces by stored data" },
      { type: "wait", selector: "text=Spaces by files" },
    ],
    mockRules: withBaseRules(
      costEnabledGeneralSettingsRule,
      portalCostMeRule,
    ),
  },
  {
    id: "gallery-portal-access-keys",
    docPage: "user/screenshots-gallery.md",
    route: "/portal/access-keys",
    outputBasename: "portal-access-keys",
    waitFor: "h1:has-text('External S3 tools')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [
      { type: "wait", selector: "button:has-text('Configure a tool'):enabled" },
      { type: "click", selector: "button:has-text('Configure a tool')" },
      { type: "wait", selector: "text=Cyberduck / Mountain Duck" },
      { type: "wait", selector: "text=WinSCP" },
    ],
    capture: { selector: "[role='dialog']", padding: 28 },
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-portal-settings",
    docPage: "user/screenshots-gallery.md",
    route: "/portal/settings",
    outputBasename: "portal-settings",
    waitFor: "h2:has-text('New Storage Space defaults')",
    user: storageUser,
    storage: { ...baseStorage(), selectedWorkspace: "portal" },
    actions: [{ type: "wait", selector: "text=Version history retention" }],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-ceph-admin",
    docPage: "user/workspace-ceph-admin.md",
    route: "/ceph-admin/buckets",
    outputBasename: "workspace-ceph-admin",
    waitFor: "h1:has-text('Buckets')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-ceph-admin-dashboard",
    docPage: "user/screenshots-gallery.md",
    route: "/ceph-admin",
    outputBasename: "ceph-admin-dashboard",
    waitFor: "h1:has-text('Ceph Admin')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [{ type: "wait", selector: "text=In progress" }],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-storage-ops",
    docPage: "user/workspace-storage-ops.md",
    route: "/storage-ops/buckets",
    outputBasename: "workspace-storage-ops",
    waitFor: "h1:has-text('Buckets')",
    user: storageOpsAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "storage-ops" },
    mockRules: withBaseRules(storageOpsEnabledGeneralSettingsRule, storageOpsBucketsRule, storageOpsBucketsStreamRule),
  },
  {
    id: "gallery-storage-ops-dashboard",
    docPage: "user/screenshots-gallery.md",
    route: "/storage-ops",
    outputBasename: "storage-ops-dashboard",
    waitFor: "h1:has-text('Storage Ops')",
    user: storageOpsAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "storage-ops" },
    mockRules: withBaseRules(storageOpsEnabledGeneralSettingsRule, storageOpsSummaryRule, storageOpsBucketsRule, storageOpsBucketsStreamRule),
  },
  {
    id: "feature-buckets",
    docPage: "user/feature-buckets.md",
    route: "/manager/buckets",
    outputBasename: "feature-buckets",
    waitFor: "h1:has-text('Buckets')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "feature-bucket-usage-stats",
    docPage: "user/feature-bucket-usage-stats.md",
    route: "/manager/metrics",
    outputBasename: "feature-bucket-usage-stats",
    waitFor: "h1:has-text('Usage & Metrics')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    actions: [
      { type: "click", selector: "button:has-text('Usage composition')" },
      { type: "wait", selector: "text=Account usage composition" },
      { type: "wait", selector: "text=Data types" },
      { type: "wait", selector: "text=3 / 3 buckets covered" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "howto-manager-bucket-configuration",
    docPage: "user/howto-manager-bucket-configuration.md",
    route: "/manager/buckets/helios-retail-logs",
    outputBasename: "manager-bucket-configuration",
    waitFor: "h1:has-text('helios-retail-logs')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    actions: [{ type: "wait", selector: "text=Versioning" }],
    mockRules: withBaseRules(...managerBucketDetailRules),
  },
  {
    id: "feature-iam",
    docPage: "user/feature-iam.md",
    route: "/manager/users",
    outputBasename: "feature-iam",
    waitFor: "h1:has-text('Users')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "manager-embedded-browser",
    docPage: "manager/en/browser/object-operations.md",
    route: "/manager/browser?ctx=acc-helios&bucket=helios-retail-logs",
    outputBasename: "manager-embedded-browser",
    waitFor: "h1:has-text('Browser')",
    user: adminUser,
    storage: {
      ...baseStorage(),
      selectedWorkspace: "manager",
      selectedManagerExecutionContextId: "acc-helios",
    },
    actions: [
      { type: "wait", selector: "text=RGW logs will attribute operations to" },
      { type: "wait", selector: "text=report-2026-03-08.json" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "feature-objects-browser",
    docPage: "user/feature-objects-browser.md",
    route: "/browser",
    outputBasename: "feature-objects-browser",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    user: storageUser,
    storage: {
      ...baseStorage(),
      selectedWorkspace: "browser",
      extraEntries: {
        [BROWSER_ROOT_UI_STATE_STORAGE_KEY]: browserFoldersPanelStateEntry,
      },
      extraSessionEntries: {
        [BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY]: browserContextSelectionsEntry,
      },
    },
    actions: [
      { type: "wait", selector: "text=report-2026-03-08.json" },
      { type: "click", selector: "input[aria-label='Select loaded items']" },
      { type: "click", selector: "button[aria-label='Delete']" },
      { type: "wait", selector: "text=Delete objects" },
      { type: "click", selector: "[role='dialog'] button:has-text('Delete')" },
      { type: "wait", selector: "section[aria-label='Operations']" },
      { type: "click", selector: "section[aria-label='Operations'] button[aria-label='Expand operations']" },
      { type: "click", selector: "section[aria-label='Operations'] button[aria-label='Operations overview']" },
      { type: "wait", selector: "[role='dialog']:has-text('Operations overview')" },
      { type: "click", selector: "button:has-text('Show files')" },
      { type: "wait", selector: "text=errors-2026-03-08.log" },
    ],
    mockRules: withBaseRules(browserDelayedDeleteRule),
    workflowVideo: {
      outputBasename: "feature-objects-browser.workflow",
      trimStartMs: 1500,
      pauseAfterActionMs: 700,
      finalPauseMs: 1800,
    },
    postScreenshotWaitMs: 2500,
    postScreenshotActions: [
      { type: "click", selector: "[role='dialog'] button:has-text('Close')" },
    ],
  },
  {
    id: "feature-object-versions-browser",
    docPage: "user/feature-object-versions-browser.md",
    route: "/browser",
    outputBasename: "feature-object-versions-browser",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    user: storageUser,
    storage: {
      ...baseStorage(),
      selectedWorkspace: "browser",
      extraEntries: {
        [BROWSER_ROOT_UI_STATE_STORAGE_KEY]: browserFoldersPanelStateEntry,
      },
      extraSessionEntries: {
        [BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY]: browserContextSelectionsEntry,
      },
    },
    actions: [
      { type: "wait", selector: "text=report-2026-03-08.json" },
      { type: "click", selector: "button[aria-label='More actions for report-2026-03-08.json']" },
      { type: "click", selector: "[role='menu'] button:has-text('Versions')" },
      { type: "wait", selector: "[role='complementary'] h2[title='report-2026-03-08.json']" },
      { type: "wait", selector: "[role='tab'][aria-selected='true']:has-text('Versions')" },
      { type: "wait", selector: "text=v: v-2026-03-08-0715" },
    ],
    mockRules: withBaseRules(
      browserVersioningEnabledRule,
      browserObjectVersionsRule,
    ),
    capture: { selector: "[role='complementary']", padding: 20 },
  },
  {
    id: "feature-topics",
    docPage: "user/feature-topics.md",
    route: "/manager/topics",
    outputBasename: "feature-topics",
    waitFor: "h1:has-text('SNS Topics')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "howto-ceph-advanced-filter",
    docPage: "user/howto-ceph-advanced-filter.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-advanced-filter",
    waitFor: "h1:has-text('Buckets')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [
      { type: "click", selector: "button:has-text('Advanced filter')" },
      { type: "wait", selector: "p:has-text('Advanced filter')" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "howto-ceph-ui-tags",
    docPage: "user/howto-ceph-ui-tags.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-ui-tags",
    waitFor: "h1:has-text('Buckets')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [
      { type: "click", selector: "table tbody tr:first-child input[type='checkbox']" },
      { type: "click", selector: "button[aria-label='Actions for 1 selected bucket']" },
      { type: "click", selector: "[role='menuitem']:has-text('Manage UI tags')" },
      { type: "wait", selector: "input[placeholder='new-tag']" },
      { type: "fill", selector: "input[placeholder='new-tag']", value: "review" },
      { type: "click", selector: "button:has-text('Configure')" },
      { type: "wait", selector: "[role='group'][aria-label='Tag settings for review']" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "ceph-admin-bulk-lifecycle",
    docPage: "admin/en/storage/ceph-admin/bulk-lifecycle-campaign.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-bulk-lifecycle",
    waitFor: "h1:has-text('Buckets')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [
      { type: "fill", selector: "textarea[placeholder='Bucket name(s)']", value: "etl-dev-" },
      { type: "wait", selector: "text=Page 1 of 1 · 8 results" },
      { type: "click", selector: "input[aria-label='Select all filtered buckets']" },
      { type: "wait", selector: "text=8 buckets selected" },
      { type: "click", selector: "button[aria-label='Actions for 8 selected buckets']" },
      { type: "click", selector: "[role='menuitem']:has-text('Manage UI tags')" },
      { type: "wait", selector: "text=Manage UI tags" },
      { type: "click", selector: "button[aria-label='Add UI tag retention-audit-2026']" },
      { type: "wait", selector: "table tbody tr:first-child:has-text('retention-audit-2026')" },
      { type: "pause", durationMs: 1800 },
      { type: "wait", selector: "button[aria-label='Actions for 8 selected buckets']" },
      { type: "click", selector: "button[aria-label='Actions for 8 selected buckets']" },
      { type: "click", selector: "[role='menuitem']:has-text('Configure selected buckets')" },
      { type: "wait", selector: "h1:has-text('Configure selected buckets')" },
      { type: "select", selector: "#bucket-ops-bulk-operation", value: "add_lifecycle" },
      {
        type: "fill",
        selector: "#bucket-ops-bulk-lifecycle-rules",
        value: '{"ID":"tmp-cleanup","Status":"Enabled","Filter":{"Prefix":"tmp/"},"Expiration":{"Days":30}}',
      },
      { type: "click", selector: "button:has-text('Format JSON')" },
      { type: "click", selector: "button:has-text('Preview')" },
      { type: "wait", selector: "text=Changes: 7 / Unchanged: 1 / Errors: 0" },
      { type: "scroll", selector: "p:has-text('Before')" },
      { type: "pause", durationMs: 2200 },
      { type: "click", selector: "button:has-text('Apply changes')" },
      { type: "wait", selector: "text=Updated 7 buckets" },
      { type: "press", selector: "body", key: "Home" },
    ],
    mockRules: withBaseRules(
      cephBulkLifecycleListRule,
      cephBulkLifecycleUiTagsGetRule,
      cephBulkLifecycleUiTagsPatchRule,
      cephBulkLifecycleGetRule,
      cephBulkLifecyclePutRule,
    ),
    workflowVideo: {
      outputBasename: "ceph-admin-bulk-lifecycle.workflow",
      trimStartMs: 1500,
      pauseAfterActionMs: 1200,
      finalPauseMs: 3000,
    },
  },
  {
    id: "ceph-admin-multipart-cleanup-audit",
    docPage: "admin/en/storage/ceph-admin/multipart-upload-cleanup.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-multipart-cleanup-audit",
    waitFor: "h1:has-text('Buckets')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [
      { type: "click", selector: "button:has-text('Advanced filter')" },
      { type: "click", selector: "button:has-text('Feature details')" },
      {
        type: "select",
        selector: "#bucket-ops-feature-detail-lifecycleRuleTypeMode",
        value: "has_not",
      },
      {
        type: "select",
        selector: "#bucket-ops-feature-detail-lifecycleRuleTypeValue",
        value: "abort_multipart",
      },
      {
        type: "scroll",
        selector: "#bucket-ops-feature-detail-lifecycleRuleTypeValue",
      },
    ],
    mockRules: withBaseRules(),
    capture: { selector: "[role='dialog']", padding: 0 },
  },
  {
    id: "ceph-admin-version-retention-audit",
    docPage: "admin/en/storage/ceph-admin/versioned-bucket-retention.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-version-retention-audit",
    waitFor: "h1:has-text('Buckets')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [
      { type: "click", selector: "button:has-text('Advanced filter')" },
      { type: "click", selector: "button:has-text('Feature states')" },
      {
        type: "select",
        selector: "select:has(option[value='suspended'])",
        value: "enabled",
      },
      { type: "click", selector: "button:has-text('Feature details')" },
      {
        type: "select",
        selector: "#bucket-ops-feature-detail-lifecycleRuleTypeMode",
        value: "has_not",
      },
      {
        type: "select",
        selector: "#bucket-ops-feature-detail-lifecycleRuleTypeValue",
        value: "noncurrent_expiration",
      },
      { type: "click", selector: "button:has-text('Apply filters')" },
      { type: "wait", selector: ".ui-list-active-filters" },
    ],
    mockRules: withBaseRules(cephVersionRetentionStreamRule),
    capture: { selector: ".ui-list-active-filters", padding: 18 },
  },
  {
    id: "ceph-admin-quota-capacity-review",
    docPage: "admin/en/storage/ceph-admin/quota-capacity-review.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-quota-capacity-review",
    waitFor: "text=analytics-prod-raw",
    user: adminUser,
    storage: {
      ...baseStorage(),
      selectedWorkspace: "ceph-admin",
      extraEntries: {
        "ceph-admin.bucket_list.columns.v2": JSON.stringify([
          "owner_name",
          "used_bytes",
          "quota_max_size_bytes",
          "quota_usage_size_percent",
          "object_count",
          "quota_usage_object_percent",
        ]),
      },
    },
    mockRules: withBaseRules(
      cephTutorialBucketListRule(
        "ceph-tutorial-quota-review-buckets",
        cephQuotaReviewBuckets,
      ),
    ),
    capture: { selector: "table", padding: 18 },
  },
  {
    id: "ceph-admin-public-access-audit",
    docPage: "admin/en/storage/ceph-admin/public-access-audit.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-public-access-audit",
    waitFor: "button:has-text('public-assets-prod')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [
      { type: "click", selector: "button:has-text('public-assets-prod')" },
      { type: "wait", selector: "[role='complementary']" },
      { type: "click", selector: "[role='tab']:has-text('Permissions')" },
      {
        type: "wait",
        selector: "[data-testid='bucket-feature-block-public-access']",
      },
      { type: "wait", selector: "[data-testid='bucket-feature-policy']" },
    ],
    mockRules: withBaseRules(
      cephTutorialBucketListRule("ceph-tutorial-public-audit-bucket", [
        cephTutorialBucket("public-assets-prod", { owner_name: "Digital assets" }),
      ]),
      cephPublicAuditResourcesRule,
    ),
    capture: { selector: "[role='complementary']", padding: 0 },
  },
  {
    id: "ceph-admin-bucket-index-check-results",
    docPage: "admin/en/storage/ceph-admin/bucket-index-checks.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-bucket-index-check-results",
    waitFor: "text=payments-prod-events",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [
      {
        type: "click",
        selector: "input[aria-label='Select all filtered buckets']",
      },
      {
        type: "click",
        selector: "button[aria-label='Actions for 3 selected buckets']",
      },
      {
        type: "click",
        selector: "[role='menuitem']:has-text('Check bucket indexes')",
      },
      { type: "wait", selector: "h1:has-text('Check bucket indexes')" },
      { type: "click", selector: "button:has-text('Run index checks')" },
      { type: "wait", selector: "text=Header and index entry counts differ" },
    ],
    mockRules: withBaseRules(
      cephTutorialBucketListRule(
        "ceph-tutorial-index-check-buckets",
        cephIndexCheckBuckets,
      ),
      cephIndexCheckStreamRule,
    ),
    capture: {
      selector:
        "div.space-y-4:has(table:has-text('Header and index entry counts differ'))",
      padding: 12,
    },
  },
  {
    id: "ceph-admin-notification-rollout-preview",
    docPage: "admin/en/storage/ceph-admin/notification-rollout.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-notification-rollout-preview",
    waitFor: "text=project-prod-ingest-01",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "ceph-admin" },
    actions: [
      {
        type: "click",
        selector: "input[aria-label='Select all filtered buckets']",
      },
      {
        type: "click",
        selector: "button[aria-label='Actions for 2 selected buckets']",
      },
      {
        type: "click",
        selector: "[role='menuitem']:has-text('Configure selected buckets')",
      },
      {
        type: "wait",
        selector: "h1:has-text('Configure selected buckets')",
      },
      {
        type: "select",
        selector: "#bucket-ops-bulk-operation",
        value: "add_notifications",
      },
      {
        type: "fill",
        selector: "#bucket-ops-bulk-notification-configuration",
        value:
          '{"TopicConfigurations":[{"Id":"project-ingest-events","TopicArn":"arn:aws:sns:default::project-ingest","Events":["s3:ObjectCreated:*"],"Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"incoming/"}]}}}]}',
      },
      { type: "click", selector: "button:has-text('Format JSON')" },
      { type: "click", selector: "button:has-text('Preview')" },
      { type: "wait", selector: "text=Changes: 2 / Unchanged: 0 / Errors: 0" },
      { type: "scroll", selector: "p:has-text('Before')" },
    ],
    mockRules: withBaseRules(
      cephTutorialBucketListRule(
        "ceph-tutorial-notification-buckets",
        cephNotificationBuckets,
      ),
      cephNotificationGetRule,
    ),
  },
  {
    id: "ceph-admin-encryption-kms-audit",
    docPage: "admin/en/storage/ceph-admin/encryption-kms-audit.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-encryption-kms-audit",
    waitFor: "text=finance-prod-ledger",
    user: adminUser,
    storage: {
      ...baseStorage(),
      selectedWorkspace: "ceph-admin",
      extraEntries: {
        "ceph-admin.bucket_list.columns.v2": JSON.stringify([
          "owner_name",
          "server_side_encryption",
          "sse_algorithms",
          "sse_kms_key_ids",
        ]),
      },
    },
    mockRules: withBaseRules(
      cephTutorialBucketListRule(
        "ceph-tutorial-encryption-audit-buckets",
        cephEncryptionAuditBuckets,
      ),
    ),
    capture: { selector: "table", padding: 18 },
  },
  {
    id: "howto-storage-ops-ui-tags",
    docPage: "user/howto-storage-ops-ui-tags.md",
    route: "/storage-ops/buckets",
    outputBasename: "storage-ops-ui-tags",
    waitFor: "h1:has-text('Buckets')",
    user: storageOpsAdminUser,
    storage: { ...baseStorage(), selectedWorkspace: "storage-ops" },
    actions: [
      { type: "click", selector: "table tbody tr:first-child input[type='checkbox']" },
      { type: "click", selector: "button[aria-label='Actions for 1 selected bucket']" },
      { type: "click", selector: "[role='menuitem']:has-text('Manage UI tags')" },
      { type: "wait", selector: "input[placeholder='new-tag']" },
      { type: "fill", selector: "input[placeholder='new-tag']", value: "review" },
      { type: "click", selector: "button:has-text('Configure')" },
      { type: "wait", selector: "[role='group'][aria-label='Tag settings for review']" },
    ],
    mockRules: withBaseRules(storageOpsEnabledGeneralSettingsRule, storageOpsBucketsRule, storageOpsBucketsStreamRule),
  },
  {
    id: "feature-bucket-compare",
    docPage: "user/feature-bucket-compare.md",
    route: "/manager/bucket-compare",
    outputBasename: "feature-bucket-compare",
    waitFor: "h1:has-text('Bucket compare')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    actions: [
      { type: "click", selector: "table tbody tr:first-child input[type='checkbox']" },
      { type: "click", selector: "button:has-text('Compare selected')" },
      { type: "wait", selector: "label:has-text('Target context')" },
      { type: "select", selector: "select", value: "conn-blueharbor" },
      { type: "fill", selector: "input[type='datetime-local']", value: "2026-03-09T00:00" },
      { type: "click", selector: "button:has-text('Run comparison')" },
      { type: "wait", selector: "text=With differences: 1" },
    ],
    mockRules: withBaseRules(bucketCompareWithDifferencesRule),
  },
  {
    id: "feature-bucket-integrity-check",
    docPage: "user/feature-bucket-integrity-check.md",
    route: "/manager/bucket-integrity",
    outputBasename: "feature-bucket-integrity-check",
    waitFor: "h1:has-text('Bucket integrity')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    actions: [
      { type: "wait", selector: "input[placeholder='Filter buckets']" },
      { type: "wait", selector: "text=helios-retail-logs" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "feature-bucket-purge",
    docPage: "user/feature-bucket-purge.md",
    route: "/manager/bucket-purge",
    outputBasename: "feature-bucket-purge",
    waitFor: "h1:has-text('Bucket purge')",
    user: {
      ...adminUser,
      manager_tool_access: { ...adminUser.manager_tool_access, bucket_purge: true },
      effective_access: {
        ...adminUser.effective_access,
        manager_tool_access: {
          ...adminUser.effective_access.manager_tool_access,
          bucket_purge: true,
        },
      },
    },
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    actions: [
      { type: "wait", selector: "text=helios-retail-logs" },
      { type: "click", selector: "table tbody tr:first-child input[type='checkbox']" },
      { type: "click", selector: "button:has-text('Purge selected')" },
      { type: "wait", selector: "text=Type PURGE 1 BUCKETS" },
    ],
    capture: { selector: ".workflow-page-content", padding: 28 },
    mockRules: withBaseRules(bucketPurgeEnabledGeneralSettingsRule),
  },
  {
    id: "feature-bucket-migration",
    docPage: "user/feature-bucket-migration.md",
    route: "/manager/migrations",
    outputBasename: "feature-bucket-migration",
    waitFor: "h1:has-text('Bucket Migration')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "troubleshooting",
    docPage: "user/troubleshooting.md",
    route: "/manager/users",
    outputBasename: "troubleshooting",
    waitFor: "h1:has-text('Users')",
    user: adminUser,
    storage: { ...baseStorage(), selectedWorkspace: "manager", selectedManagerExecutionContextId: undefined },
    mockRules: withBaseRules(noManagerContextsRule),
  },
];
