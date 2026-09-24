import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminAssociationCheckboxOptions, AdminAssociationLinkedTable, AdminAssociationPickerPanel, AdminAssociationSectionHeader, AdminAssociationTabs } from "./AdminAssociationPicker";

describe("AdminAssociationPicker", () => {
  it("renders the shared linked table and its picker action", () => {
    const onAction = vi.fn();
    render(
      <AdminAssociationLinkedTable
        title="Linked UI groups"
        toolbar={{ countLabel: "1 linked", actionLabel: "Add UI groups", onAction }}
        headers={[{ label: "Group" }, { label: "Actions", align: "right" }]}
        hasItems
        emptyLabel="No linked groups yet."
        rows={
          <tr>
            <td>Operators</td>
            <td className="ui-table-actions-cell w-px text-right">Remove</td>
          </tr>
        }
      />
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Operators")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toHaveClass(
      "w-px",
      "whitespace-nowrap",
    );
    expect(screen.getByText("Remove").closest("td")).toHaveClass("w-px", "ui-table-actions-cell");
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders a reusable section header action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <AdminAssociationSectionHeader
        title="Linked users"
        countLabel="2 linked"
        actionLabel="Add users"
        onAction={onAction}
      />
    );

    expect(screen.getByRole("region", { name: "Linked users" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("2 linked")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add users" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("keeps one count and the active action with keyboard-accessible association tabs", async () => {
    const user = userEvent.setup();
    const addAccounts = vi.fn();
    const addConnections = vi.fn();
    function Associations() {
      const [active, setActive] = useState("accounts");
      return <AdminAssociationTabs activeTab={active} onChange={setActive} tabs={[
        { id: "accounts", label: "Accounts", count: 1, actionLabel: "Add accounts", onAction: addAccounts,
          content: <p>Account memberships</p> },
        { id: "connections", label: "Connections", count: 0, actionLabel: "Add connections", onAction: addConnections,
          hint: "Shared connections only", content: <p>Connection memberships</p> },
      ]} />;
    }
    render(<Associations />);
    const accounts = screen.getByRole("tab", { name: "Accounts (1)" });
    expect(screen.getByRole("tabpanel", { name: "Accounts (1)" })).toHaveTextContent("Account memberships");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText(/linked|total/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add accounts" }));
    expect(addAccounts).toHaveBeenCalledTimes(1);
    accounts.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Connections (0)" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Connections (0)" })).toHaveTextContent("Connection memberships");
    expect(screen.queryByRole("button", { name: "Add accounts" })).not.toBeInTheDocument();
    expect(screen.getByText("Shared connections only")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add connections" }));
    expect(addConnections).toHaveBeenCalledTimes(1);
    screen.getByRole("tab", { name: "Connections (0)" }).focus();
    await user.keyboard("{Home}");
    expect(accounts).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Connections (0)" })).toHaveFocus();
  });

  it("renders common search, states, and footer actions", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const onCancel = vi.fn();
    const onAdd = vi.fn();

    render(
      <AdminAssociationPickerPanel
        title="Add accounts"
        hint="(search by name)"
        search=""
        onSearchChange={onSearchChange}
        loading={false}
        availableCount={1}
        maxVisibleOptions={10}
        selectedCount={1}
        loadingLabel="Loading accounts..."
        searchAriaLabel="Search accounts"
        addDisabled={false}
        onCancel={onCancel}
        onAdd={onAdd}
      >
        <div>Helios Retail</div>
      </AdminAssociationPickerPanel>
    );

    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "hel");
    expect(onSearchChange).toHaveBeenLastCalledWith("l");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Add selected" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("renders shared checkbox options and forwards the selected id", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <AdminAssociationCheckboxOptions
        options={[
          { id: 1, label: "Operators" },
          { id: 2, label: "Readers" },
        ]}
        selectedIds={[1]}
        onToggle={onToggle}
        getLabel={(option) => option.label}
      />
    );

    expect(screen.getByRole("checkbox", { name: "Operators" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Operators" })).toHaveClass("h-4", "w-4");
    await user.click(screen.getByRole("checkbox", { name: "Readers" }));
    expect(onToggle).toHaveBeenCalledWith(2);
  });
});
