import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import AdvancedFilterTextMatchField from "./AdvancedFilterTextMatchField";

describe("AdvancedFilterTextMatchField", () => {
  it("shares field semantics and match-mode behavior", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onMatchModeChange = vi.fn();

    render(
      <AdvancedFilterTextMatchField
        label="Owner"
        costLevel="low"
        costTooltip="Low cost"
        fieldState={{ fieldClass: "field-state", labelClass: "label-state" }}
        forcesExact={false}
        matchMode="contains"
        onChange={onChange}
        onMatchModeChange={onMatchModeChange}
        placeholder="owner uid(s)"
        value=""
      />,
    );

    const input = screen.getByLabelText("Owner");
    expect(input).toHaveClass("ui-list-control", "field-state");
    expect(screen.getByRole("button", { name: "Contains" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Exact" })).toHaveAttribute("aria-pressed", "false");

    await user.type(input, "demo");
    await user.click(screen.getByRole("button", { name: "Exact" }));
    expect(onChange).toHaveBeenCalled();
    expect(onMatchModeChange).toHaveBeenCalledWith("exact");
  });

  it("keeps both mode choices locked when exact matching is forced", () => {
    render(
      <AdvancedFilterTextMatchField
        label="Identity"
        costLevel="medium"
        costTooltip="Medium cost"
        fieldState={{ fieldClass: "", labelClass: "" }}
        forcesExact
        matchMode="exact"
        onChange={() => undefined}
        onMatchModeChange={() => undefined}
        value="demo"
      />,
    );

    expect(screen.getByRole("button", { name: "Contains" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exact" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exact" })).toHaveAttribute("aria-pressed", "true");
  });
});
