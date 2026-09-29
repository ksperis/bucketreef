import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TopbarControlTrigger, { TopbarStaticControl } from "../TopbarControlTrigger";

describe("TopbarControlTrigger", () => {
  it("renders the label and value in icon-label mode with the shared control shell", () => {
    render(
      <TopbarControlTrigger
        mode="icon_label"
        label="Account"
        value="Account_test (s3-z1)"
        ariaLabel="Select account"
        icon={<span aria-hidden="true">A</span>}
        onClick={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "Select account" });
    expect(trigger).toHaveClass("h-10", "rounded-lg", "shell-control");
    expect(screen.getByText("Account")).toHaveClass("font-medium");
    expect(screen.getByText("Account_test (s3-z1)")).toBeInTheDocument();
  });

  it("keeps icon-only controls square and accessible", () => {
    render(
      <TopbarControlTrigger
        mode="icon"
        label="Endpoint"
        value="s3-z1"
        ariaLabel="Select endpoint"
        icon={<span aria-hidden="true">E</span>}
      />
    );

    const trigger = screen.getByRole("button", { name: "Select endpoint" });
    expect(trigger).toHaveClass("h-9", "w-9");
    expect(screen.getByText("s3-z1")).toHaveClass("sr-only");
  });

  it("renders static icon context without button semantics or interactive styling", () => {
    render(
      <TopbarStaticControl
        mode="icon"
        label="Endpoint"
        value="s3-z1"
        ariaLabel="Endpoint s3-z1"
        icon={<span data-testid="endpoint-icon">E</span>}
      />
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Endpoint s3-z1" })).toHaveClass("shell-control-static", "h-9", "w-9");
    expect(screen.getByTestId("endpoint-icon").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("uses the static shell presentation for labeled fixed context", () => {
    render(
      <TopbarStaticControl
        mode="icon_label"
        label="Project"
        value="Research"
        ariaLabel="Project Research"
      />
    );

    expect(screen.getByRole("group", { name: "Project Research" })).toHaveClass("shell-control-static", "h-10");
    expect(screen.getByRole("group", { name: "Project Research" })).not.toHaveClass("shell-control");
  });
});
