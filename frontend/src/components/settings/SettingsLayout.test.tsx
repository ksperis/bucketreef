/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsChoiceRow, SettingsSwitch } from "./SettingsLayout";

describe("SettingsSwitch", () => {
  it("exposes a named switch and toggles with Space or pointer without submitting a form", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event) => event.preventDefault());
    function Settings() {
      const [checked, setChecked] = useState(false);
      return (
        <form onSubmit={submit}>
          <SettingsSwitch
            ariaLabel="Quota alerts"
            checked={checked}
            onChange={setChecked}
          />
        </form>
      );
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
    render(
      <SettingsSwitch
        ariaLabel="Quota alerts"
        checked
        disabled
        onChange={change}
      />,
    );
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

it("shares choice-row styling while keeping native exclusive radio keyboard behavior", async () => {
  const user = userEvent.setup();
  function Choices() {
    const [selected, setSelected] = useState("read");
    return <fieldset className="settings-fields"><legend>Permission</legend>
      <SettingsChoiceRow type="radio" name="permission" title="Read" ariaLabel="Read"
        checked={selected === "read"} onChange={() => setSelected("read")} description="Read documents" />
      <SettingsChoiceRow type="radio" name="permission" title="Write" ariaLabel="Write"
        checked={selected === "write"} onChange={() => setSelected("write")} description="Write documents" />
      <SettingsChoiceRow title="Independent option" checked={false} onChange={() => {}} />
    </fieldset>;
  }
  render(<Choices />);
  await user.tab();
  expect(screen.getByRole("radio", { name: "Read" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("radio", { name: "Write" })).toHaveFocus();
  expect(screen.getByRole("radio", { name: "Write" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Read" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Independent option" })).not.toBeChecked();
});
