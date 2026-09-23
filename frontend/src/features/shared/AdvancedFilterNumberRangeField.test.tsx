/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AdvancedFilterNumberRangeField from "./AdvancedFilterNumberRangeField";

const fieldState = { fieldClass: "", labelClass: "range-label" };
const minFieldState = { fieldClass: "min-state", labelClass: "" };
const maxFieldState = { fieldClass: "max-state", labelClass: "" };

describe("AdvancedFilterNumberRangeField", () => {
  it("exposes clear minimum and maximum controls and forwards changes", () => {
    const onMinChange = vi.fn();
    const onMaxChange = vi.fn();

    render(
      <AdvancedFilterNumberRangeField
        label="Quota bytes"
        fieldState={fieldState}
        minFieldState={minFieldState}
        maxFieldState={maxFieldState}
        minValue="10"
        maxValue="100"
        onMinChange={onMinChange}
        onMaxChange={onMaxChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Quota bytes minimum" }), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quota bytes maximum" }), {
      target: { value: "200" },
    });

    expect(onMinChange).toHaveBeenCalledWith("20");
    expect(onMaxChange).toHaveBeenCalledWith("200");
  });

  it("keeps per-bound state styling and shared cost context", () => {
    render(
      <AdvancedFilterNumberRangeField
        label="Quota usage size %"
        costLevel="medium"
        costTooltip="Medium cost"
        inputMin={0}
        fieldState={fieldState}
        minFieldState={minFieldState}
        maxFieldState={maxFieldState}
        minValue=""
        maxValue=""
        onMinChange={() => undefined}
        onMaxChange={() => undefined}
      />,
    );

    expect(screen.getByTitle("Medium cost")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Quota usage size % minimum" })).toHaveClass("min-state");
    expect(screen.getByRole("spinbutton", { name: "Quota usage size % maximum" })).toHaveClass("max-state");
  });
});
