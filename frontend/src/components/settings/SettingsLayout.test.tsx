/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsSwitch } from "./SettingsLayout";

describe("SettingsSwitch", () => {
  it("exposes a named switch and toggles with Space or pointer without submitting a form", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(event => event.preventDefault());
    function Settings() {
      const [checked, setChecked] = useState(false);
      return <form onSubmit={submit}><SettingsSwitch ariaLabel="Quota alerts" checked={checked} onChange={setChecked} /></form>;
    }
    render(<Settings />);
    const control = screen.getByRole("switch", { name: "Quota alerts" });
    expect(control).not.toBeChecked();
    await user.tab();
    expect(control).toHaveFocus();
    await user.keyboard(" ");
    expect(control).toBeChecked();
    await user.click(control);
    expect(control).not.toBeChecked();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not change or receive keyboard focus when disabled", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<SettingsSwitch ariaLabel="Quota alerts" checked disabled onChange={change} />);
    const control = screen.getByRole("switch", { name: "Quota alerts" });
    await user.click(control);
    await user.tab();
    await user.keyboard(" ");
    expect(control).toBeChecked();
    expect(control).toBeDisabled();
    expect(control).not.toHaveFocus();
    expect(change).not.toHaveBeenCalled();
  });
});
