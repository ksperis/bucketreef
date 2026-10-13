/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import FeatureOverrideField from "./FeatureOverrideField";

describe("resource feature inheritance", () => {
  it("renders the ghost inherited value in the tri-state presentation", async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState<boolean | null>(null);
      return <FeatureOverrideField title="Metadata" value={value} policy="default_on" onChange={setValue} triState />;
    }
    render(<Editor />);

    const group = screen.getByRole("radiogroup", { name: "Metadata" });
    const inherited = screen.getByRole("radio", { name: "Inherited platform value — Enabled" });
    expect(inherited).toHaveAttribute("aria-checked", "true");
    expect(inherited).toHaveClass("settings-tristate-option-inherit-ghost-selected");
    expect(inherited).toHaveTextContent("✓");

    await user.click(within(group).getByRole("radio", { name: "Disabled" }));
    expect(within(group).getByRole("radio", { name: "Disabled" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the inherited effective disabled value and blocks explicit enablement", () => {
    render(<FeatureOverrideField title="Keys" value={null} policy="disabled" onChange={() => undefined} triState />);

    const group = screen.getByRole("radiogroup", { name: "Keys" });
    const inherited = within(group).getByRole("radio", { name: "Inherited platform value — Disabled" });
    expect(inherited).toHaveAttribute("aria-checked", "true");
    expect(inherited).toHaveTextContent("×");
    expect(within(group).getByRole("radio", { name: "Enabled" })).toBeDisabled();
  });

  it("keeps an explicit opt-out distinct from the platform value", async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState<boolean | null>(false);
      return <><FeatureOverrideField title="Metadata" value={value} policy="default_on" onChange={setValue} />
        <output>{value === null ? "inherited" : String(value)}</output></>;
    }
    render(<Editor />);
    const select = screen.getByRole("combobox", { name: "Metadata" });
    expect(select).toHaveValue("disabled");
    await user.selectOptions(select, "inherit");
    expect(screen.getByRole("status")).toHaveTextContent("inherited");
    expect(select).toHaveDisplayValue("Platform value — Enabled");
  });

  it("shows a platform prohibition, preserves the stored choice and allows inheritance reset", async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState<boolean | null>(true);
      return <FeatureOverrideField title="Keys" value={value} policy="disabled" onChange={setValue} help="Requires a compatible endpoint." />;
    }
    render(<Editor />);
    expect(screen.getByText("Platform disabled")).toBeVisible();
    expect(screen.getByRole("option", { name: "Enabled", exact: true })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox"), "inherit");
    expect(screen.getByRole("combobox")).toHaveValue("inherit");
    await user.click(screen.getByRole("button", { name: "Keys: information" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("compatible endpoint");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
