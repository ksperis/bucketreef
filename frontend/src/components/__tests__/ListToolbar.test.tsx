import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UiInput from "../ui/UiInput";
import UiSelect from "../ui/UiSelect";
import ListToolbar from "../ListToolbar";

describe("ListToolbar", () => {
  it.each(["page", "section"] as const)("keeps %s controls in reading and keyboard order", async (variant) => {
    const user = userEvent.setup();
    const { container } = render(<ListToolbar variant={variant} title="Inventory"
      headingActions={<button>Add item</button>}
      search={<UiInput label="Search inventory" />}
      filters={<UiSelect label="Provider"><option>All</option></UiSelect>}
      columns={<button>Columns</button>} actions={<button>Refresh</button>}
      countLabel="12 entries" secondaryContent={<p>Only loaded records are filtered.</p>} />);
    const toolbar = screen.getByRole("region", { name: "Inventory" });
    const search = screen.getByLabelText("Search inventory");
    const filter = screen.getByLabelText("Provider");
    const columns = screen.getByRole("button", { name: "Columns" });
    const refresh = screen.getByRole("button", { name: "Refresh" });
    const count = screen.getByText("12 entries");
    const order = [search, filter, columns, refresh, count];
    order.slice(1).forEach((element, index) => {
      expect(order[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(count.parentElement).toBe(container.querySelector(".ui-list-toolbar-body"));
    if (variant === "section") {
      expect(screen.getByRole("heading", { name: "Inventory" })).toBeInTheDocument();
      await user.tab();
      expect(screen.getByRole("button", { name: "Add item" })).toHaveFocus();
      expect(screen.getByRole("button", { name: "Add item" }).closest(".ui-list-toolbar-heading")).not.toBeNull();
    } else {
      expect(toolbar.querySelector("h2")).toBeNull();
      expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    }
    for (const control of [search, filter, columns, refresh]) {
      await user.tab();
      expect(control).toHaveFocus();
    }
    expect(screen.getByText("Only loaded records are filtered.")).toBeVisible();
  });

  it("renders title, count and controls", () => {
    render(
      <div className="ui-surface-card">
        <ListToolbar variant="section"
          title="Users"
          description="All platform users."
          countLabel="12 users"
          search={<input aria-label="Search users" />}
          filters={<button type="button">Filters</button>}
          columns={<button type="button">Columns</button>}
          actions={<button type="button">Refresh</button>}
        />
      </div>
    );

    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("All platform users.")).toBeInTheDocument();
    expect(screen.getByText("12 users")).toBeInTheDocument();
    expect(screen.getByLabelText("Search users")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("can hide the visible heading while keeping an accessible label", () => {
    render(
      <div className="ui-surface-card">
        <ListToolbar
          title="Buckets"
          description="Paginated list of buckets."
          variant="page"
          countLabel="4 buckets"
          search={<input aria-label="Search buckets" />}
        />
      </div>
    );

    expect(screen.getByRole("region", { name: "Buckets" })).toBeInTheDocument();
    expect(screen.queryByText("Paginated list of buckets.")).not.toBeInTheDocument();
    expect(screen.getByText("4 buckets")).toBeInTheDocument();
    expect(screen.getByLabelText("Search buckets")).toBeInTheDocument();
  });
});
