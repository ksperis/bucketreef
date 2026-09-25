import { expect, test, type Page } from "@playwright/test";

import { buildBaseRules } from "./fixtures/base";
import { superAdminUser } from "./fixtures/users";
import { registerApiMocks } from "./mockApi";
import { seedUiPreferences } from "./uiPreferences";
import type { MockRule } from "./types";

const lifecycleRules = [
  {
    ID: "archive-logs",
    Status: "Enabled",
    Filter: { Prefix: "logs/" },
    Expiration: { Days: 90 },
  },
  {
    ID: "old-versions",
    Status: "Enabled",
    Filter: { Prefix: "" },
    NoncurrentVersionExpiration: { NoncurrentDays: 30 },
  },
  {
    ID: "abort-multipart",
    Status: "Disabled",
    Filter: { Prefix: "" },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
  },
];

const bucketPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "AllowAnalyticsRead",
      Effect: "Allow",
      Principal: { AWS: "arn:aws:iam::analytics:role/reader" },
      Action: "s3:GetObject",
      Resource: "arn:aws:s3:::helios-retail-logs/reports/*",
    },
    {
      Sid: "DenyUnencryptedUpload",
      Effect: "Deny",
      Principal: "*",
      Action: "s3:PutObject",
      Resource: "arn:aws:s3:::helios-retail-logs/*",
      Condition: { StringNotEquals: { "s3:x-amz-server-side-encryption": "AES256" } },
    },
  ],
};

const corsRules = [
  {
    ID: "browser-app",
    AllowedOrigins: ["https://app.example.com"],
    AllowedMethods: ["GET", "PUT"],
    AllowedHeaders: ["Content-Type", "x-amz-*"],
    MaxAgeSeconds: 3600,
  },
  {
    ID: "public-read",
    AllowedOrigins: ["*"],
    AllowedMethods: ["GET", "HEAD"],
    MaxAgeSeconds: 600,
  },
];

const replicationConfiguration = {
  Role: "arn:aws:iam::helios:role/replication",
  Rules: [
    {
      ID: "idf-dr",
      Status: "Enabled",
      Priority: 10,
      Filter: { Prefix: "" },
      Destination: { Bucket: "arn:aws:s3:::helios-retail-logs-dr" },
      DeleteMarkerReplication: { Status: "Disabled" },
    },
    {
      ID: "archive-reports",
      Status: "Enabled",
      Priority: 20,
      Filter: { Prefix: "reports/" },
      Destination: { Bucket: "arn:aws:s3:::helios-report-archive" },
      DeleteMarkerReplication: { Status: "Disabled" },
    },
  ],
};

const notificationConfiguration = {
  TopicConfigurations: [
    {
      Id: "object-created",
      TopicArn: "arn:aws:sns:default:helios:ingest",
      Events: ["s3:ObjectCreated:*"],
      Filter: { Key: { FilterRules: [{ Name: "prefix", Value: "uploads/" }] } },
    },
    {
      Id: "object-removed",
      TopicArn: "arn:aws:sns:default:helios:audit",
      Events: ["s3:ObjectRemoved:*"],
    },
  ],
};

function bucketResource(resource: string | undefined) {
  switch (resource) {
    case "stats":
      return { name: "helios-retail-logs", owner: "RGW-HELIOS", used_bytes: 182554321, object_count: 1284 };
    case "properties":
      return {
        versioning_status: "Enabled",
        object_lock_enabled: false,
        object_lock: null,
        public_access_block: null,
        lifecycle_rules: lifecycleRules,
        cors_rules: corsRules,
      };
    case "versioning":
      return { status: "Enabled", enabled: true };
    case "object-lock":
      return { enabled: false, mode: null, days: null, years: null };
    case "lifecycle":
      return { rules: lifecycleRules };
    case "encryption":
      return { rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] };
    case "notifications":
      return { configuration: notificationConfiguration };
    case "logging":
      return { enabled: true, target_bucket: "helios-audit-logs", target_prefix: "s3-access/helios-retail-logs/" };
    case "website":
      return { index_document: "index.html", error_document: "error.html", redirect_all_requests_to: null, routing_rules: [] };
    case "replication":
      return { configuration: replicationConfiguration };
    case "policy":
      return { policy: bucketPolicy };
    case "acl":
      return {
        owner: "RGW-HELIOS",
        grants: [{
          grantee: {
            type: "CanonicalUser",
            id: "RGW-HELIOS",
            display_name: "RGW-HELIOS",
          },
          permission: "FULL_CONTROL",
        }],
      };
    case "cors":
      return { rules: corsRules };
    case "tags":
      return { tags: [{ key: "env", value: "prod" }, { key: "team", value: "retail" }] };
    case "public-access-block":
      return {
        block_public_acls: true,
        ignore_public_acls: true,
        block_public_policy: true,
        restrict_public_buckets: false,
      };
    default:
      return null;
  }
}

function bucketWorkbenchRules(): MockRule[] {
  const inheritedRules = buildBaseRules();
  const executionContextsRule = inheritedRules.find((rule) => rule.id === "execution-contexts");
  const baseRules = inheritedRules.filter(
    (rule) => rule.id !== "workspace-access" && rule.id !== "execution-contexts",
  );
  return [
    {
      id: "workspace-access-manager",
      path: /^\/me\/workspace-access$/,
      body: {
        admin: { available: true, context_count: 1 },
        ceph_admin: { available: true, context_count: 1 },
        storage_ops: { available: false, context_count: 0 },
        manager: { available: true, context_count: 2 },
        browser: { available: true, context_count: 2 },
        portal: { available: true, context_count: 1 },
        default_workspace: "manager",
      },
    },
    {
      id: "execution-contexts",
      path: /^\/me\/execution-contexts$/,
      body: (ctx) => {
        const payload =
          typeof executionContextsRule?.body === "function"
            ? executionContextsRule.body(ctx)
            : executionContextsRule?.body;
        if (!Array.isArray(payload)) return payload;
        return payload.map((context) => {
          if (!context || typeof context !== "object" || Array.isArray(context)) return context;
          if (!("id" in context) || context.id !== "acc-helios") return context;
          const capabilities =
            "storage_endpoint_capabilities" in context &&
            context.storage_endpoint_capabilities &&
            typeof context.storage_endpoint_capabilities === "object" &&
            !Array.isArray(context.storage_endpoint_capabilities)
              ? context.storage_endpoint_capabilities
              : {};
          return {
            ...context,
            storage_endpoint_capabilities: { ...capabilities, sse: true },
          };
        });
      },
    },
    {
      id: "bucket-workbench-resources",
      method: "GET",
      path: /^\/manager\/buckets\/helios-retail-logs\/(stats|versioning|object-lock|lifecycle|encryption|notifications|logging|website|replication|policy|acl|cors|tags|public-access-block)$/,
      body: ({ url }) => bucketResource(url.pathname.split("/").at(-1)),
    },
    {
      id: "bucket-workbench-ceph-resources",
      method: "GET",
      path: /^\/ceph-admin\/endpoints\/11\/buckets\/helios-retail-logs\/(properties|versioning|object-lock|lifecycle|encryption|notifications|logging|website|replication|policy|acl|cors|tags|public-access-block)$/,
      body: ({ url }) => bucketResource(url.pathname.split("/").at(-1)),
    },
    {
      id: "bucket-workbench-lifecycle-save",
      method: "PUT",
      path: /^\/manager\/buckets\/helios-retail-logs\/lifecycle$/,
      body: ({ requestBodyText }) => JSON.parse(requestBodyText),
    },
    {
      id: "bucket-workbench-ceph-lifecycle-save",
      method: "PUT",
      path: /^\/ceph-admin\/endpoints\/11\/buckets\/helios-retail-logs\/lifecycle$/,
      body: ({ requestBodyText }) => JSON.parse(requestBodyText),
    },
    ...baseRules,
  ];
}

async function openBucketConfiguration(
  page: Page,
  surface: "manager" | "ceph-admin",
  theme: "light" | "dark",
  width: number,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const registry = await registerApiMocks(page, bucketWorkbenchRules(), `bucket-features-${surface}-${theme}-${width}`, superAdminUser);
  await page.setViewportSize({ width, height: 900 });
  await seedUiPreferences(page, {
    selectedWorkspace: surface,
    selectedManagerExecutionContextId: "acc-helios",
    selectedCephAdminEndpointId: "11",
    theme,
  });
  await page.goto(surface === "manager"
    ? "/manager/buckets/helios-retail-logs"
    : "/ceph-admin/buckets/helios-retail-logs?ep=11");
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  const lifecycle = page.getByTestId("bucket-feature-lifecycle");
  await expect(lifecycle).toBeVisible();
  await expect(lifecycle).toHaveAttribute("data-feature-presentation", "collection");
  return { errors, lifecycle, registry };
}

for (const surface of ["manager", "ceph-admin"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      test(`${surface} bucket feature cards ${theme} ${width}`, async ({ page }, testInfo) => {
      const { errors, lifecycle, registry } = await openBucketConfiguration(page, surface, theme, width);
      await expect(lifecycle.getByText("3 rules", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await expect(page.getByTestId("bucket-feature-versioning")).toHaveAttribute("data-feature-presentation", "simple");
      await expect(page.getByTestId("bucket-feature-encryption")).toHaveAttribute("data-feature-presentation", "simple");
      await expect(page.getByTestId("bucket-feature-object-lock")).toHaveAttribute("data-feature-presentation", "simple");
      await expect(page.getByTestId("bucket-feature-tags")).toHaveAttribute("data-feature-presentation", "simple");

      const table = lifecycle.getByRole("table");
      await expect(table).toBeVisible();
      if (width >= 768) {
        await expect(table.getByRole("columnheader", { name: "Rule" })).toBeVisible();
        await expect(table.getByRole("columnheader", { name: "Scope" })).toBeVisible();
        await expect(table.getByRole("columnheader", { name: "Actions" })).toBeVisible();
        await expect(table.getByRole("columnheader", { name: "Status" })).toBeVisible();
        await expect(table.getByRole("columnheader", { name: "Manage" })).toBeVisible();
      } else {
        expect(await table.locator("thead").evaluate((node) => getComputedStyle(node).display)).toBe("none");
        expect(await lifecycle.getByRole("button", { name: "Remove", exact: true }).first().evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }

      await page.screenshot({
        path: testInfo.outputPath(`bucket-properties-${surface}-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });

      await page.getByRole("tab", { name: "Permissions", exact: true }).click();
      for (const testId of ["bucket-feature-policy", "bucket-feature-cors"]) {
        await expect(page.getByTestId(testId)).toHaveAttribute("data-feature-presentation", "collection");
      }
      for (const testId of ["bucket-feature-block-public-access", "bucket-feature-acl"]) {
        await expect(page.getByTestId(testId)).toHaveAttribute("data-feature-presentation", "simple");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await page.screenshot({
        path: testInfo.outputPath(`bucket-permissions-${surface}-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });

      await page.getByRole("tab", { name: "Advanced", exact: true }).click();
      for (const testId of ["bucket-feature-replication", "bucket-feature-notifications"]) {
        await expect(page.getByTestId(testId)).toHaveAttribute("data-feature-presentation", "collection");
      }
      for (const testId of ["bucket-feature-website", "bucket-feature-access-logging"]) {
        await expect(page.getByTestId(testId)).toHaveAttribute("data-feature-presentation", "simple");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await page.screenshot({
        path: testInfo.outputPath(`bucket-advanced-${surface}-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      expect(errors).toEqual([]);
      registry.assertNoUnmatched();
    });
    }
  }
}

const corsVisualQaRules = [
  {
    ID: "browser-app",
    AllowedOrigins: ["https://app.example.com", "https://admin.example.com"],
    AllowedMethods: ["GET", "PUT"],
    AllowedHeaders: ["Content-Type", "x-amz-*"],
    ExposeHeaders: ["ETag", "x-amz-request-id"],
    MaxAgeSeconds: 3600,
  },
  {
    ID: "public-read",
    AllowedOrigins: ["*"],
    AllowedMethods: ["GET", "HEAD"],
    ExposeHeaders: ["ETag"],
  },
  {
    ID: "uploads",
    AllowedOrigins: ["https://uploads.example.com"],
    AllowedMethods: ["POST", "PUT"],
    AllowedHeaders: ["*"],
  },
  {
    ID: "advanced-preserved",
    AllowedOrigins: ["https://advanced.example.com"],
    AllowedMethods: ["GET"],
    CustomExtension: { preserve: true },
  },
];

function corsVisualQaMockRules(): MockRule[] {
  return [
    {
      id: "bucket-workbench-cors-visual-qa",
      method: "GET",
      path: /^\/manager\/buckets\/helios-retail-logs\/cors$/,
      body: { rules: corsVisualQaRules },
    },
    ...bucketWorkbenchRules(),
  ];
}

for (const width of [1440, 390]) {
  test(`Manager bucket CORS editor visual QA ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const registry = await registerApiMocks(
      page,
      corsVisualQaMockRules(),
      `bucket-cors-visual-${width}`,
      superAdminUser,
    );
    await page.setViewportSize({ width, height: 900 });
    await seedUiPreferences(page, {
      selectedWorkspace: "manager",
      selectedManagerExecutionContextId: "acc-helios",
      theme: "light",
    });
    await page.goto("/manager/buckets/helios-retail-logs");
    await page.getByRole("tab", { name: "Permissions", exact: true }).click();

    const cors = page.getByTestId("bucket-feature-cors");
    await expect(cors).toBeVisible();
    await expect(cors.getByText("4 rules", { exact: true })).toBeVisible();
    await expect(cors.getByRole("textbox")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: testInfo.outputPath(`cors-summary-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });

    await cors.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit CORS rules" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Visual", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByTestId("cors-visual-rule")).toHaveCount(3);
    await expect(dialog.getByTestId("cors-advanced-rule")).toContainText("Advanced rule — edit in JSON");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.width ?? width + 1).toBeLessThanOrEqual(width);
    expect(dialogBox?.height ?? 901).toBeLessThanOrEqual(900);

    await page.screenshot({
      path: testInfo.outputPath(`cors-visual-editor-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });

    await dialog.getByRole("tab", { name: "JSON", exact: true }).click();
    const jsonEditor = dialog.getByLabel("CORS rules (JSON)");
    await expect(jsonEditor).toBeVisible();
    expect(JSON.parse(await jsonEditor.inputValue())).toEqual(corsVisualQaRules);
    await expect(dialog.getByRole("button", { name: /show example/i })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /use example/i })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: testInfo.outputPath(`cors-json-editor-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });

    expect(errors).toEqual([]);
    registry.assertNoUnmatched();
  });
}

const encryptionVisualQaRules = [
  {
    ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
  },
  {
    ApplyServerSideEncryptionByDefault: {
      SSEAlgorithm: "aws:kms",
      KMSMasterKeyID: "arn:aws:kms:eu-west-1:123456789012:key/example-key",
    },
    BucketKeyEnabled: true,
  },
  {
    ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms:dsse" },
    CustomProviderField: { preserve: true },
  },
];

function encryptionVisualQaMockRules(): MockRule[] {
  const baseRules = bucketWorkbenchRules();
  const executionContextsRule = baseRules.find((rule) => rule.id === "execution-contexts");
  return [
    {
      id: "bucket-workbench-encryption-visual-qa",
      method: "GET",
      path: /^\/manager\/buckets\/helios-retail-logs\/encryption$/,
      body: { rules: encryptionVisualQaRules },
    },
    {
      id: "bucket-workbench-encryption-context",
      method: "GET",
      path: /^\/me\/execution-contexts$/,
      body: (ctx) => {
        const payload =
          typeof executionContextsRule?.body === "function"
            ? executionContextsRule.body(ctx)
            : executionContextsRule?.body;
        if (!Array.isArray(payload)) return payload;
        return payload.map((context) => {
          if (!context || typeof context !== "object" || Array.isArray(context)) return context;
          if (!("id" in context) || context.id !== "acc-helios") return context;
          const capabilities =
            "storage_endpoint_capabilities" in context &&
            context.storage_endpoint_capabilities &&
            typeof context.storage_endpoint_capabilities === "object" &&
            !Array.isArray(context.storage_endpoint_capabilities)
              ? context.storage_endpoint_capabilities
              : {};
          return {
            ...context,
            storage_endpoint_capabilities: { ...capabilities, sse: true },
          };
        });
      },
    },
    ...baseRules,
  ];
}

for (const width of [1440, 390]) {
  test(`Manager bucket encryption editor visual QA ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const registry = await registerApiMocks(
      page,
      encryptionVisualQaMockRules(),
      `bucket-encryption-visual-${width}`,
      superAdminUser,
    );
    await page.setViewportSize({ width, height: 900 });
    await seedUiPreferences(page, {
      selectedWorkspace: "manager",
      selectedManagerExecutionContextId: "acc-helios",
      theme: "light",
    });
    await page.goto("/manager/buckets/helios-retail-logs");
    await page.getByRole("tab", { name: "Properties", exact: true }).click();

    const encryption = page.getByTestId("bucket-feature-encryption");
    await expect(encryption).toBeVisible();
    await expect(encryption.getByText("Enabled · 3 rules", { exact: true })).toBeVisible();
    await expect(encryption.getByRole("textbox")).toHaveCount(0);
    await expect(encryption.getByText("AES256", { exact: true })).toBeVisible();
    await expect(encryption.getByText("aws:kms", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: testInfo.outputPath(`encryption-summary-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });

    await encryption.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit server-side encryption" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Visual", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByTestId("encryption-visual-rule")).toHaveCount(2);
    await expect(dialog.getByTestId("encryption-advanced-rule")).toContainText("Advanced rule — edit in JSON");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.width ?? width + 1).toBeLessThanOrEqual(width);
    expect(dialogBox?.height ?? 901).toBeLessThanOrEqual(900);

    await page.screenshot({
      path: testInfo.outputPath(`encryption-visual-editor-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });

    await dialog.getByRole("tab", { name: "JSON", exact: true }).click();
    const jsonEditor = dialog.getByLabel("Encryption rules (JSON)");
    await expect(jsonEditor).toBeVisible();
    expect(JSON.parse(await jsonEditor.inputValue())).toEqual(encryptionVisualQaRules);
    await expect(dialog.getByRole("button", { name: /show example/i })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /use example/i })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: testInfo.outputPath(`encryption-json-editor-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });

    expect(errors).toEqual([]);
    registry.assertNoUnmatched();
  });
}

const policyVisualQaDocument = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "ReadPublicObjects",
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: ["arn:aws:s3:::helios-retail-logs/public/*"],
      Condition: { StringLike: { "s3:prefix": ["public/*"] } },
    },
  ],
};

const notificationsVisualQaConfiguration = {
  TopicConfigurations: [
    {
      Id: "uploads",
      TopicArn: "arn:aws:sns:default:RGW-HELIOS:uploads",
      Events: ["s3:ObjectCreated:*"],
      Filter: {
        Key: {
          FilterRules: [
            { Name: "prefix", Value: "uploads/" },
            { Name: "suffix", Value: ".json" },
          ],
        },
      },
    },
  ],
};

const replicationVisualQaConfiguration = {
  Role: "arn:aws:iam::123456789012:role/replication-role",
  Rules: [
    {
      ID: "archive-logs",
      Status: "Enabled",
      Priority: 1,
      Filter: { Prefix: "logs/" },
      Destination: { Bucket: "arn:aws:s3:::helios-retail-archive" },
      DeleteMarkerReplication: { Status: "Disabled" },
    },
  ],
};

function remainingEditorVisualQaRules(): MockRule[] {
  return [
    {
      id: "bucket-workbench-lifecycle-editor-visual-qa",
      method: "GET",
      path: /^\/manager\/buckets\/helios-retail-logs\/lifecycle$/,
      body: { rules: [lifecycleRules[0]] },
    },
    {
      id: "bucket-workbench-policy-editor-visual-qa",
      method: "GET",
      path: /^\/manager\/buckets\/helios-retail-logs\/policy$/,
      body: { policy: policyVisualQaDocument },
    },
    {
      id: "bucket-workbench-notifications-editor-visual-qa",
      method: "GET",
      path: /^\/manager\/buckets\/helios-retail-logs\/notifications$/,
      body: { configuration: notificationsVisualQaConfiguration },
    },
    {
      id: "bucket-workbench-replication-editor-visual-qa",
      method: "GET",
      path: /^\/manager\/buckets\/helios-retail-logs\/replication$/,
      body: { configuration: replicationVisualQaConfiguration },
    },
    ...bucketWorkbenchRules(),
  ];
}

const remainingEditorVisualQaCases = [
  {
    id: "lifecycle",
    tab: "Properties",
    featureTestId: "bucket-feature-lifecycle",
    dialogName: "Edit lifecycle rules",
    visualItemTestId: "lifecycle-visual-rule",
    jsonLabel: "Lifecycle rules (JSON)",
  },
  {
    id: "policy",
    tab: "Permissions",
    featureTestId: "bucket-feature-policy",
    dialogName: "Edit bucket policy",
    visualItemTestId: "policy-visual-statement",
    jsonLabel: "Bucket policy (JSON)",
  },
  {
    id: "notifications",
    tab: "Advanced",
    featureTestId: "bucket-feature-notifications",
    dialogName: "Edit bucket notifications",
    visualItemTestId: "notifications-visual-topic",
    jsonLabel: "Notification configuration (JSON)",
  },
  {
    id: "replication",
    tab: "Advanced",
    featureTestId: "bucket-feature-replication",
    dialogName: "Edit replication configuration",
    visualItemTestId: "replication-visual-rule",
    jsonLabel: "Replication configuration (JSON)",
  },
] as const;

for (const width of [1440, 390]) {
  test(`Manager remaining bucket editors visual QA ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const registry = await registerApiMocks(
      page,
      remainingEditorVisualQaRules(),
      `bucket-remaining-editors-visual-${width}`,
      superAdminUser,
    );
    await page.setViewportSize({ width, height: 900 });
    await seedUiPreferences(page, {
      selectedWorkspace: "manager",
      selectedManagerExecutionContextId: "acc-helios",
      theme: "light",
    });
    await page.goto("/manager/buckets/helios-retail-logs");

    for (const editor of remainingEditorVisualQaCases) {
      await page.getByRole("tab", { name: editor.tab, exact: true }).click();
      const feature = page.getByTestId(editor.featureTestId);
      await expect(feature).toBeVisible();
      await feature.getByRole("button", { name: "Edit", exact: true }).click();

      const dialog = page.getByRole("dialog", { name: editor.dialogName });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("tab", { name: "Visual", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByTestId(editor.visualItemTestId)).toHaveCount(1);
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox?.width ?? width + 1).toBeLessThanOrEqual(width);
      expect(dialogBox?.height ?? 901).toBeLessThanOrEqual(900);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);

      await page.screenshot({
        path: testInfo.outputPath(`${editor.id}-visual-editor-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });

      await dialog.getByRole("tab", { name: "JSON", exact: true }).click();
      await expect(dialog.getByLabel(editor.jsonLabel)).toBeVisible();
      await expect(dialog.getByRole("button", { name: /show example/i })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: /use example/i })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);

      await page.screenshot({
        path: testInfo.outputPath(`${editor.id}-json-editor-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }

    expect(errors).toEqual([]);
    registry.assertNoUnmatched();
  });
}
