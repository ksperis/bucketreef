import { render, screen } from "@testing-library/react";

import TopbarStaticAccountControl from "../TopbarStaticAccountControl";

describe("TopbarStaticAccountControl", () => {
  it("renders icon mode as non-interactive context information", () => {
    render(
      <TopbarStaticAccountControl
        mode="icon"
        selectedLabel="Research account"
        title="IAM Identity: alice"
        icon={<span data-testid="account-icon">A</span>}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Account context Research account")).toHaveClass("sr-only");
    expect(screen.getByTestId("account-icon").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTitle("IAM Identity: alice")).toHaveClass("shell-control");
  });

  it("shares label geometry while preserving optional muted and badge content", () => {
    render(
      <TopbarStaticAccountControl
        mode="icon_label"
        selectedLabel="No account selected"
        icon={<span>A</span>}
        muted
        badge={<span>Session</span>}
      />,
    );

    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("No account selected")).toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("No account selected").closest("div.shell-control")).toHaveClass("shell-muted-text");
  });
});
