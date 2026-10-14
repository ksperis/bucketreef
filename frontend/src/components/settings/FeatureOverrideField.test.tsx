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
    expect(screen.queryByText("Explicit override")).not.toBeInTheDocument();
    expect(screen.queryByText("Override")).not.toBeInTheDocument();

    await user.click(within(group).getByRole("radio", { name: "Disabled" }));
    expect(within(group).getByRole("radio", { name: "Disabled" }))
      .toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "Disabled" }))
      .toHaveClass("settings-tristate-option-disabled-selected");
  });

  it("renders an inherited disabled value with the danger ghost treatment", () => {
    render(<FeatureOverrideField title="Metadata" value={null} policy="targeted" onChange={() => undefined} triState />);

    const inherited = screen.getByRole("radio", { name: "Inherited platform value — Disabled" });
    expect(inherited).toHaveAttribute("aria-checked", "true");
    expect(inherited).toHaveClass("settings-tristate-option-inherit-disabled-selected");
    expect(inherited).toHaveTextContent("×");
  });

  it("blocks activation while keeping safe choices editable under a platform prohibition", async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState<boolean | null>(null);
      return <FeatureOverrideField title="Keys" value={value} policy="disabled" onChange={setValue} triState />;
    }
    render(<Editor />);

    expect(screen.getByText("Platform disabled")).toBeVisible();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Override")).not.toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Keys" });
    expect(group).not.toHaveAttribute("aria-disabled");
    const inherited = within(group).getByRole("radio", { name: "Inherited platform value — Disabled" });
    expect(inherited).toHaveAttribute("aria-checked", "true");
    expect(inherited).not.toBeDisabled();
    expect(within(group).getByRole("radio", { name: "Enabled" })).toBeDisabled();
    const disabled = within(group).getByRole("radio", { name: "Disabled" });
    expect(disabled).not.toBeDisabled();
    await user.click(disabled);
    expect(disabled).toHaveAttribute("aria-checked", "true");
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

  it("lets an administrator clear a stored enabled override after the platform disables it", async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState<boolean | null>(true);
      return <><FeatureOverrideField title="Keys" value={value} policy="disabled" onChange={setValue} help="Requires a compatible endpoint." triState />
        <output>{value === null ? "inherited" : String(value)}</output></>;
    }
    render(<Editor />);
    expect(screen.getByText("Platform disabled")).toBeVisible();
    expect(screen.queryByText("Stored override: Enabled")).not.toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Keys" });
    const enabled = within(group).getByRole("radio", { name: "Enabled" });
    expect(enabled).toHaveAttribute("aria-checked", "true");
    expect(enabled).toBeDisabled();
    const inherited = within(group).getByRole("radio", { name: "Inherited platform value — Disabled" });
    expect(inherited).not.toBeDisabled();
    await user.click(inherited);
    expect(screen.getByRole("status")).toHaveTextContent("inherited");
    await user.click(screen.getByRole("button", { name: "Keys: information" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("compatible endpoint");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("prevents a new enabled choice in the select presentation while allowing cleanup", async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState<boolean | null>(true);
      return <><FeatureOverrideField title="History" value={value} policy="disabled" onChange={setValue} />
        <output>{value === null ? "inherited" : String(value)}</output></>;
    }
    render(<Editor />);

    const select = screen.getByRole("combobox", { name: "History" });
    expect(within(select).getByRole("option", { name: "Enabled" })).toBeDisabled();
    await user.selectOptions(select, "inherit");
    expect(screen.getByRole("status")).toHaveTextContent("inherited");
  });

  it("shows an endpoint constraint as a badge while keeping safe override choices editable", async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState<boolean | null>(null);
      return <FeatureOverrideField title="Quota" value={value} policy="default_on" onChange={setValue}
        unavailable="Endpoint permission required" triState />;
    }
    render(<Editor />);

    expect(screen.getByText("Endpoint permission required")).toBeVisible();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Explicit override")).not.toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Quota" });
    expect(group).not.toHaveAttribute("aria-disabled");
    expect(within(group).getByRole("radio", { name: "Enabled" })).toBeDisabled();
    expect(within(group).getByRole("radio", { name: "Inherited platform value — Enabled" })).not.toBeDisabled();
    const disabled = within(group).getByRole("radio", { name: "Disabled" });
    expect(disabled).not.toBeDisabled();
    await user.click(disabled);
    expect(disabled).toHaveAttribute("aria-checked", "true");
  });

  it("renders a stored enabled override as unavailable when its endpoint prerequisite is missing", () => {
    render(<FeatureOverrideField title="Quota" value policy="default_on" onChange={() => undefined}
      unavailable="Endpoint permission required" triState />);

    const group = screen.getByRole("radiogroup", { name: "Quota" });
    const enabled = within(group).getByRole("radio", { name: "Enabled" });
    expect(enabled).toHaveAttribute("aria-checked", "true");
    expect(enabled).toBeDisabled();
    expect(enabled).toHaveClass("settings-tristate-option-unavailable-selected");
  });
});
