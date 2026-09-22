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
    expect(screen.getByTestId("feature-section")).toHaveAttribute("data-feature-presentation", "workbench");
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

  it("does not infer missing configuration or health from a neutral state", () => {
    render(
      <BucketFeatureSection title="ACL" description="Bucket grants." mode="graphical" visualState="neutral">
        <p>AccessDenied</p>
      </BucketFeatureSection>,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("group", { name: "ACL configuration" })).toHaveAttribute(
      "data-feature-presentation",
      "simple",
    );
    expect(screen.getByText("AccessDenied")).toBeVisible();
  });
});
