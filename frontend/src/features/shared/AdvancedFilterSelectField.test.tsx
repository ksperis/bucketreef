/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AdvancedFilterSelectField from "./AdvancedFilterSelectField";

const fieldState = {
  fieldClass: "field-state",
  labelClass: "label-state",
};

describe("AdvancedFilterSelectField", () => {
  it("associates the shared label and forwards value changes", () => {
    const onChange = vi.fn();

    render(
      <AdvancedFilterSelectField
        label="Status"
        fieldState={fieldState}
        value="any"
        onChange={onChange}
      >
        <option value="any">Any</option>
        <option value="active">Active</option>
      </AdvancedFilterSelectField>,
    );

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "active" } });

    expect(onChange).toHaveBeenCalledWith("active");
  });

  it("renders cost context and disabled styling through the shared field primitives", () => {
    render(
      <AdvancedFilterSelectField
        label="Owner suspended"
        costLevel="medium"
        costTooltip="Medium cost"
        disabled
        fieldState={fieldState}
        value="any"
        onChange={() => undefined}
      >
        <option value="any">Any</option>
      </AdvancedFilterSelectField>,
    );

    expect(screen.getByTitle("Medium cost")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Owner suspended" })).toBeDisabled();
    expect(screen.getByRole("combobox")).toHaveClass("disabled:cursor-not-allowed");
  });

  it("associates optional field guidance with the select", () => {
    render(
      <AdvancedFilterSelectField
        label="Versioning"
        hint="Versioning is disabled on this endpoint."
        fieldState={fieldState}
        value="any"
        onChange={() => undefined}
      >
        <option value="any">Any</option>
      </AdvancedFilterSelectField>,
    );

    const select = screen.getByRole("combobox", { name: "Versioning" });
    const hint = screen.getByText("Versioning is disabled on this endpoint.");
    expect(select).toHaveAttribute("aria-describedby", hint.id);
  });
});
