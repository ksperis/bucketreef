/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  SettingsTriStateSwitch,
  type SettingsTriStateOption,
} from "./SettingsLayout";

type Policy = "disabled" | "targeted" | "default_on";

const options = [
  { value: "disabled", label: "Disabled", symbol: "×" },
  { value: "targeted", label: "Targeted activation", symbol: "◎" },
  { value: "default_on", label: "Enabled by default", symbol: "✓" },
] satisfies readonly [
  SettingsTriStateOption<Policy>,
  SettingsTriStateOption<Policy>,
  SettingsTriStateOption<Policy>,
];

function Example() {
  const [value, setValue] = useState<Policy>("targeted");
  return <SettingsTriStateSwitch ariaLabel="Feature policy" value={value} options={options} onChange={setValue} />;
}

describe("SettingsTriStateSwitch", () => {
  it("exposes one accessible radio choice while keeping compact symbols visual-only", async () => {
    const user = userEvent.setup();
    render(<Example />);

    const group = screen.getByRole("radiogroup", { name: "Feature policy" });
    expect(within(group).getByRole("radio", { name: "Targeted activation" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getAllByRole("radio")).toHaveLength(3);

    await user.click(within(group).getByRole("radio", { name: "Enabled by default" }));
    expect(within(group).getByRole("radio", { name: "Enabled by default" })).toHaveAttribute("aria-checked", "true");
  });

  it("supports radio-group arrow navigation", async () => {
    const user = userEvent.setup();
    render(<Example />);

    const group = screen.getByRole("radiogroup", { name: "Feature policy" });
    const targeted = within(group).getByRole("radio", { name: "Targeted activation" });
    targeted.focus();
    await user.keyboard("{ArrowRight}");

    expect(within(group).getByRole("radio", { name: "Enabled by default" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "Enabled by default" })).toHaveFocus();
  });

  it("keeps an enabled fallback tabbable when the selected option is disabled", () => {
    const constrainedOptions = [
      options[0],
      options[1],
      { ...options[2], disabled: true },
    ] satisfies readonly [
      SettingsTriStateOption<Policy>,
      SettingsTriStateOption<Policy>,
      SettingsTriStateOption<Policy>,
    ];
    render(<SettingsTriStateSwitch ariaLabel="Constrained feature" value="default_on"
      options={constrainedOptions} onChange={() => undefined} />);

    const group = screen.getByRole("radiogroup", { name: "Constrained feature" });
    const selected = within(group).getByRole("radio", { name: "Enabled by default" });
    expect(selected).toHaveAttribute("aria-checked", "true");
    expect(selected).toBeDisabled();
    expect(selected).toHaveAttribute("tabindex", "-1");
    expect(within(group).getByRole("radio", { name: "Disabled" })).toHaveAttribute("tabindex", "0");
  });
});
