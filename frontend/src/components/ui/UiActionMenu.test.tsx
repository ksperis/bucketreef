/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import Modal from "../Modal";
import UiActionMenu from "./UiActionMenu";

function Harness({ onSelect = () => undefined, allDisabled = false }: { onSelect?: () => void; allDisabled?: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return <>
    <button type="button">Before</button>
    <UiActionMenu
      ariaLabel="Actions for example"
      trigger="Actions"
      triggerClassName="ui-list-action"
      sections={[
        { id: "empty", label: "Hidden section", items: [] },
        { id: "navigation", items: [
          { id: "view", label: "View", disabled: allDisabled, onSelect },
          { id: "unavailable", label: "Unavailable", disabled: true, disabledReason: "Requires access", onSelect },
          { id: "configure", label: "Configure", disabled: allDisabled, onSelect: () => setDialogOpen(true) },
        ] },
        { id: "danger", label: "Destructive actions", items: [
          { id: "delete", label: "Delete", danger: true, disabled: allDisabled, onSelect },
        ] },
      ]}
    />
    <button type="button">After</button>
    {dialogOpen ? <Modal title="Configure example" onClose={() => setDialogOpen(false)}><p>Configuration</p></Modal> : null}
  </>;
}

describe("UiActionMenu", () => {
  it("navigates enabled actions and restores focus on Escape without executing", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const trigger = screen.getByRole("button", { name: "Actions for example" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
    expect(screen.queryByText("Hidden section")).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "View" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Configure" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "View" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Home}{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger before opening a dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Actions for example" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Configure" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Configure example" });
    await user.click(within(dialog).getByRole("button", { name: "Close modal" }));
    expect(trigger).toHaveFocus();
  });

  it("continues Tab navigation from the trigger in either direction", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Actions for example" });
    await user.click(trigger);
    // user-event captures the old portal focus before dispatching keydown.
    // Separate our key handler from native Tab traversal (also checked in Chromium).
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "View" }), { key: "Tab" });
    expect(trigger).toHaveFocus();
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
    await user.click(trigger);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "View" }), { key: "Tab", shiftKey: true });
    expect(trigger).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
  });

  it("explains unavailable actions and permits explicit close when none can run", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness allDisabled onSelect={onSelect} />);
    const trigger = screen.getByRole("button", { name: "Actions for example" });
    await user.click(trigger);
    const close = screen.getByRole("button", { name: "Close Actions for example" });
    expect(close).toHaveFocus();
    const unavailable = screen.getByRole("menuitem", { name: /Unavailable/ });
    expect(unavailable).toHaveTextContent("Requires access");
    await user.click(unavailable);
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(close);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("dismisses outside interactions without stealing focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Actions for example" }));
    await user.click(screen.getByRole("button", { name: "After" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });
});
