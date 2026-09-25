import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BucketAccessLoggingFeature from "../BucketAccessLoggingFeature";
import BucketCorsFeature from "../BucketCorsFeature";
import BucketReplicationFeature from "../BucketReplicationFeature";
import BucketWebsiteFeature from "../BucketWebsiteFeature";
import { useBucketAccessLoggingController } from "../useBucketAccessLoggingController";
import { useBucketCorsController } from "../useBucketCorsController";
import { useBucketReplicationController } from "../useBucketReplicationController";
import { useBucketWebsiteController } from "../useBucketWebsiteController";

vi.mock("../BucketFeatureSuggestions", () => ({
  useBucketFeatureSuggestions: () => ({
    buckets: { suggestions: [{ value: "logs-target" }, { value: "archive-target" }] },
    conditionKeys: {},
    conditionOperators: {},
    corsHeaders: {
      suggestions: [{ value: "Content-Type" }, { value: "ETag" }, { value: "x-amz-meta-*" }],
    },
    destinationBucketArns: {
      suggestions: [{ value: "arn:aws:s3:::target-bucket" }],
    },
    notificationEvents: {},
    objectKeys: {
      suggestions: [{ value: "index.html" }, { value: "errors/not-found.html" }],
    },
    policyActions: {},
    policyResources: {},
    prefixes: { suggestions: [{ value: "logs/" }, { value: "archive/" }] },
    storageClasses: {},
    suffixes: {},
    topicArns: {},
  }),
}));

function CorsHarness() {
  const controller = useBucketCorsController({
    accountId: "acc-1",
    bucketName: "source-bucket",
    cephAdmin: false,
    enabled: true,
    endpointId: null,
  });
  return <BucketCorsFeature controller={controller} />;
}

function WebsiteHarness() {
  const controller = useBucketWebsiteController({
    accountId: "acc-1",
    bucketName: "source-bucket",
    cephAdmin: false,
    enabled: true,
    endpointId: null,
  });
  return (
    <BucketWebsiteFeature
      blocked={false}
      bucketName="source-bucket"
      controller={controller}
      onRequestDelete={() => undefined}
    />
  );
}

function AccessLoggingHarness() {
  const controller = useBucketAccessLoggingController({
    accountId: "acc-1",
    bucketName: "source-bucket",
    cephAdmin: false,
    enabled: true,
    endpointId: null,
  });
  return (
    <BucketAccessLoggingFeature
      controller={controller}
      onRequestDisable={() => undefined}
    />
  );
}

function ReplicationHarness() {
  const controller = useBucketReplicationController({
    accountId: "acc-1",
    bucketName: "source-bucket",
    cephAdmin: false,
    enabled: true,
    endpointId: null,
  });
  return <BucketReplicationFeature blocked={false} controller={controller} />;
}

describe("bucket feature autocomplete integrations", () => {
  it("adds suggested CORS headers while retaining the visual rule editor", async () => {
    const user = userEvent.setup();
    render(<CorsHarness />);

    await user.click(screen.getByRole("button", { name: "Add rule", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Edit CORS rules" });
    const allowedHeader = within(dialog).getByRole("combobox", { name: "Add allowed header" });
    await user.type(allowedHeader, "Content");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(within(dialog).getByText("Content-Type")).toBeInTheDocument();

    const exposedHeader = within(dialog).getByRole("combobox", { name: "Add exposed header" });
    await user.type(exposedHeader, "ETag");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(within(dialog).getByText("ETag")).toBeInTheDocument();
  });

  it("suggests website object keys and constrains redirect protocol to http/https", async () => {
    const user = userEvent.setup();
    render(<WebsiteHarness />);

    await user.click(screen.getByRole("button", { name: "Configure" }));
    const dialog = screen.getByRole("dialog", { name: "Edit static website" });
    const indexDocument = within(dialog).getByRole("combobox", { name: "Index document" });
    await user.type(indexDocument, "index");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(indexDocument).toHaveValue("index.html");

    await user.click(within(dialog).getByRole("radio", { name: /Redirect all requests/ }));
    const protocol = within(dialog).getByRole("combobox", { name: "Protocol (optional)" });
    expect(within(protocol).getByRole("option", { name: "http" })).toBeInTheDocument();
    expect(within(protocol).getByRole("option", { name: "https" })).toBeInTheDocument();
  });

  it("suggests accessible access-log buckets while leaving target prefix free-form", async () => {
    const user = userEvent.setup();
    render(<AccessLoggingHarness />);

    await user.click(screen.getByRole("button", { name: "Configure" }));
    const dialog = screen.getByRole("dialog", { name: "Edit server access logging" });
    const targetBucket = within(dialog).getByRole("combobox", { name: "Target bucket" });
    await user.type(targetBucket, "logs");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(targetBucket).toHaveValue("logs-target");
    expect(within(dialog).getByRole("textbox", { name: "Target prefix (optional)" })).toBeInTheDocument();
  });

  it("suggests source prefixes and destination bucket ARNs for replication rules", async () => {
    const user = userEvent.setup();
    render(<ReplicationHarness />);

    await user.click(screen.getByRole("button", { name: "Add rule", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Edit replication configuration" });
    const prefix = within(dialog).getByRole("combobox", { name: "Prefix / filter" });
    await user.type(prefix, "logs");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(prefix).toHaveValue("logs/");

    const destination = within(dialog).getByRole("combobox", { name: "Destination bucket ARN" });
    await user.type(destination, "target");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(destination).toHaveValue("arn:aws:s3:::target-bucket");
  });
});
