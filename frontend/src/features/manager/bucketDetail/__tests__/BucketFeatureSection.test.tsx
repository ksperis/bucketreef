import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BucketFeatureSection from "../BucketFeatureSection";

describe("BucketFeatureSection", () => {
  it("names the configuration and actions and makes unsaved state explicit", () => {
    render(
      <BucketFeatureSection
        title="Replication"
        description="Replicate objects."
        mode="hybrid"
        visualState="unsaved"
        presentation="workbench"
        successMessage="Replication updated"
        actions={<button type="button">Save</button>}
        testId="feature-section"
      >
        <input aria-label="Role ARN" />
      </BucketFeatureSection>,
    );
    expect(screen.getByRole("region", { name: "Replication" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Replication actions" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(screen.getByTestId("feature-section")).toHaveAttribute("data-feature-mode", "hybrid");
    expect(screen.getByTestId("feature-section")).toHaveAttribute("data-feature-presentation", "collection");
    expect(screen.getByText("Replication updated")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Role ARN" })).toBeEnabled();
  });

  it("locks every field and action while pending, including example insertion", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const example = vi.fn();
    render(
      <BucketFeatureSection
        title="Policy"
        description="Bucket policy."
        mode="json"
        visualState="unsaved"
        busy
        actions={<button onClick={save}>Save</button>}
      >
        <textarea aria-label="Policy JSON" defaultValue="draft" />
        <button onClick={example}>Use example</button>
      </BucketFeatureSection>,
    );
    expect(screen.getByRole("group", { name: "Policy configuration" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("textbox")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Use example" }));
    expect(save).not.toHaveBeenCalled();
    expect(example).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("draft");
  });

  it("retains readable diagnostics when a feature is unavailable", () => {
    render(
      <BucketFeatureSection title="CORS" description="Cross-origin rules." mode="json" visualState="disabled">
        <p>The endpoint does not support CORS.</p>
        <textarea aria-label="CORS JSON" />
      </BucketFeatureSection>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Unavailable");
    expect(screen.getByText("The endpoint does not support CORS.")).toBeVisible();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("highlights configured features with an explicit configured badge", () => {
    render(
      <BucketFeatureSection
        title="Versioning"
        description="Keep object versions."
        mode="graphical"
        visualState="configured"
      >
        <p>Enabled</p>
      </BucketFeatureSection>,
    );
    expect(screen.getByRole("region", { name: "Versioning" })).toHaveAttribute(
      "data-feature-state",
      "configured",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Configured");
  });

  it("lets configured collection summaries replace the generic configured badge", () => {
    render(
      <BucketFeatureSection
        title="Lifecycle rules"
        description="Object expiration and cleanup."
        mode="hybrid"
        visualState="configured"
        presentation="collection"
        showConfiguredBadge={false}
        actions={<span>3 rules</span>}
      >
        <p>Configured lifecycle rules</p>
      </BucketFeatureSection>,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Lifecycle rules actions" })).toHaveTextContent("3 rules");
  });

  it("renders an explicit inactive state for a neutral feature", () => {
    render(
      <BucketFeatureSection title="ACL" description="Bucket grants." mode="graphical" visualState="neutral">
        <p>AccessDenied</p>
      </BucketFeatureSection>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Inactive");
    expect(screen.getByRole("group", { name: "ACL configuration" })).toHaveAttribute(
      "data-feature-presentation",
      "simple",
    );
    expect(screen.getByText("AccessDenied")).toBeVisible();
  });
});
