import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import PageHeader from "../PageHeader";

describe("PageHeader", () => {
  it("renders title, description, breadcrumbs and actions", () => {
    const { container } = render(
      <MemoryRouter>
        <PageHeader
          title="Cost"
          description="Monthly usage and cost overview."
          breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Cost" }]}
          actions={[{ label: "Refresh", onClick: () => undefined, variant: "ghost" }]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Cost" })).toBeInTheDocument();
    expect(screen.getByText("Monthly usage and cost overview.")).toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    expect(within(breadcrumb).getByText("Cost")).toHaveAttribute("aria-current", "page");
    expect(within(breadcrumb).getByText("/")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" }).parentElement).toHaveClass("sm:pt-6");
    expect(container.querySelector("header")).not.toHaveClass("ui-surface-card");
  });

  it("renders secondary actions and right content in the same action area", () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Storage Spaces"
          rightContent={<span>Current period</span>}
          actions={[{ label: "Export", onClick: () => undefined, variant: "secondary" }]}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Current period")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toHaveClass("ui-button-secondary");
    expect(screen.getByRole("button", { name: "Export" }).parentElement).not.toHaveClass("sm:pt-6");
  });

  it("renders page inventory actions with compact listing controls", () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="OpenStack"
          actionPresentation="listing"
          actions={[{ label: "Add cloud", onClick: () => undefined }]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Add cloud" })).toHaveClass(
      "ui-list-action",
      "ui-list-action-primary"
    );
    expect(screen.getByRole("button", { name: "Add cloud" })).not.toHaveClass("ui-button-base");
  });

  it("passes a11y checks with breadcrumb links and actions [a11y]", async () => {
    const { container } = render(
      <MemoryRouter>
        <PageHeader
          title="Storage Spaces"
          description="Manage end-user storage spaces."
          breadcrumbs={[{ label: "Portal", to: "/portal" }, { label: "Storage Spaces" }]}
          actions={[{ label: "Create", onClick: () => undefined, variant: "primary" }]}
        />
      </MemoryRouter>
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
