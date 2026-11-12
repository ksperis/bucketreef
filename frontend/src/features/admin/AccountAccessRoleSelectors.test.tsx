import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountAccessRoleSelectors from "./AccountAccessRoleSelectors";

const { portal } = vi.hoisted(() => ({ portal: { enabled: true } }));
vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({ generalSettings: { portal_enabled: portal.enabled } }),
}));

describe("AccountAccessRoleSelectors", () => {
  beforeEach(() => { portal.enabled = true; });

  it("hides new Portal grants and permits reduction when Portal is disabled", () => {
    portal.enabled = false;
    const onChange = vi.fn();
    const initial = { manager_role: "account_administrator", portal_role: null, allow_manager_browser_data_access: false } as const;
    const { rerender } = render(<AccountAccessRoleSelectors label="Project" value={initial} onChange={onChange} />);
    expect(screen.queryByRole("combobox", { name: "Portal role for Project" })).not.toBeInTheDocument();
    rerender(<AccountAccessRoleSelectors label="Project" value={{ ...initial, portal_role: "portal_user" }} onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Portal role for Project" });
    expect(within(select).queryByRole("option", { name: "Portal Manager" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(initial);
  });

  it("names both authorization axes visibly", () => {
    render(
      <AccountAccessRoleSelectors
        label="Research Archive"
        value={{ manager_role: null, portal_role: "portal_user", allow_manager_browser_data_access: false }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(screen.getByText("Portal")).toBeInTheDocument();
  });

  it("highlights assigned Manager and Portal roles", () => {
    render(
      <AccountAccessRoleSelectors
        label="Research Archive"
        value={{ manager_role: "account_administrator", portal_role: "portal_user", allow_manager_browser_data_access: false }}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Manager role for Research Archive" }),
    ).toHaveClass("bg-amber-50", "font-semibold");
    expect(
      screen.getByRole("combobox", { name: "Portal role for Research Archive" }),
    ).toHaveClass("bg-sky-50", "font-semibold");
  });

  it("keeps Portal roles editable independently of local surface state", () => {
    const onChange = vi.fn();
    render(
      <AccountAccessRoleSelectors
        label="Research Archive"
        value={{ manager_role: null, portal_role: "portal_manager", allow_manager_browser_data_access: false }}
        onChange={onChange}
      />,
    );

    const portalSelect = screen.getByRole("combobox", {
      name: "Portal role for Research Archive",
    });
    expect(portalSelect).toBeEnabled();
    const managerSelect = screen.getByRole("combobox", {
      name: "Manager role for Research Archive",
    });
    expect(
      within(managerSelect).getByRole("option", { name: "No Manager access" }),
    ).toBeEnabled();
    fireEvent.change(portalSelect, { target: { value: "portal_user" } });
    expect(onChange).toHaveBeenCalledWith({
      manager_role: null,
      portal_role: "portal_user",
      allow_manager_browser_data_access: false,
    });
  });

  it("shows the required-role message only when validation is requested", () => {
    const onChange = vi.fn();
    render(
      <AccountAccessRoleSelectors
        label="Research Archive"
        value={{ manager_role: "account_administrator", portal_role: null, allow_manager_browser_data_access: false }}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Manager role for Research Archive" }),
      { target: { value: "" } },
    );

    expect(onChange).toHaveBeenCalledWith({
      manager_role: null,
      portal_role: null,
      allow_manager_browser_data_access: false,
    });

    render(
      <AccountAccessRoleSelectors
        label="Empty association"
        value={{ manager_role: null, portal_role: null, allow_manager_browser_data_access: false }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Choose at least one role for this association."),
    ).not.toBeInTheDocument();

    render(
      <AccountAccessRoleSelectors
        label="Selected empty association"
        value={{ manager_role: null, portal_role: null, allow_manager_browser_data_access: false }}
        onChange={vi.fn()}
        showValidation
      />,
    );
    expect(
      screen.getByText("Choose at least one role for this association."),
    ).toBeInTheDocument();
  });

  it("allows a Manager-only grant to be cleared before choosing another role", () => {
    const onChange = vi.fn();
    render(
      <AccountAccessRoleSelectors
        label="Empty association"
        value={{ manager_role: "account_administrator", portal_role: null, allow_manager_browser_data_access: false }}
        onChange={onChange}
      />,
    );

    const managerSelect = screen.getByRole("combobox", {
      name: "Manager role for Empty association",
    });
    expect(
      within(managerSelect).getByRole("option", { name: "No Manager access" }),
    ).toBeEnabled();

    fireEvent.change(managerSelect, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({
      manager_role: null,
      portal_role: null,
      allow_manager_browser_data_access: false,
    });
  });

  it("emits only API grant fields when the displayed value contains row metadata", () => {
    const onChange = vi.fn();
    const value = {
      id: 7,
      label: "Research Archive",
      manager_role: "account_administrator" as const,
      portal_role: "portal_user" as const,
      allow_manager_browser_data_access: true,
    };
    render(
      <AccountAccessRoleSelectors
        label={value.label}
        value={value}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Manager role for Research Archive" }),
      { target: { value: "" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Portal role for Research Archive" }),
      { target: { value: "portal_manager" } },
    );

    expect(onChange).toHaveBeenNthCalledWith(1, {
      manager_role: null,
      portal_role: "portal_user",
      allow_manager_browser_data_access: false,
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      manager_role: "account_administrator",
      portal_role: "portal_manager",
      allow_manager_browser_data_access: true,
    });
  });
});
