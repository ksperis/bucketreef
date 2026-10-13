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
    expect(within(group).getByRole("radio", { name: "Disabled" }))
      .toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "Disabled" }))
      .toHaveClass("settings-tristate-option-disabled-selected");
  });

  it("shows a platform prohibition as a static unavailable state", () => {
    render(<FeatureOverrideField title="Keys" value={null} policy="disabled" onChange={() => undefined} triState />);

    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText("Platform disabled")).toBeVisible();
    expect(screen.queryByRole("radiogroup", { name: "Keys" })).not.toBeInTheDocument();
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

  it("shows a platform prohibition and preserves the stored choice without an active control", async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState<boolean | null>(true);
      return <FeatureOverrideField title="Keys" value={value} policy="disabled" onChange={setValue} help="Requires a compatible endpoint." />;
    }
    render(<Editor />);
    expect(screen.getByText("Platform disabled")).toBeVisible();
    expect(screen.getByText("Stored override: Enabled")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keys: information" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("compatible endpoint");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
