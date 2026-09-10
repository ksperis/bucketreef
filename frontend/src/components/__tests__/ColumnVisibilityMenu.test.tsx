/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import ColumnVisibilityMenu from "../ColumnVisibilityMenu";

function Harness() {
  const [checked, setChecked] = useState(false);
  return (
    <>
      <ColumnVisibilityMenu
        selectedCount={Number(checked)}
        onReset={() => setChecked(false)}
        resetDisabled={!checked}
        coreGroups={[{ id: "core", label: "Core", options: [
          { id: "unavailable", label: "Unavailable", checked: false, disabled: true, onToggle: () => undefined },
          { id: "owner", label: "Owner", checked, onToggle: () => setChecked((value) => !value) },
        ] }]}
        footerNote="Only selected columns are loaded."
      />
      <button type="button">Outside action</button>
    </>
  );
}

describe("ColumnVisibilityMenu", () => {
  it("keeps column selection open and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Columns" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Visible columns" });
    expect(container).not.toContainElement(dialog);
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    expect(screen.getByRole("checkbox", { name: "Owner" })).toHaveFocus();
    await user.keyboard(" ");
    expect(within(dialog).getByText("1 selected")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Owner" })).toBeChecked();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("checkbox", { name: "Owner" })).toBeChecked();
  });

  it("closes on outside focus without taking focus from the destination", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Columns" }));
    // The header's Close button is the only enabled control before the checkbox.
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Outside action" })).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes explicitly without changing the selected columns", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Columns" });
    await user.click(trigger);
    await user.click(screen.getByRole("checkbox", { name: "Owner" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("checkbox", { name: "Owner" })).toBeChecked();
  });

  it("offers one non-destructive reset only when columns differ from defaults", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Columns" }));
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled();
    expect(screen.getByText("Only selected columns are loaded.")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Owner" }));
    await user.click(reset);
    expect(reset).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Owner" })).not.toBeChecked();
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Outside action" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
