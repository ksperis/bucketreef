import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsField } from "./SettingsControls";

describe("SettingsField units", () => {
  it("keeps the unit, validation and additional help associated with the input", () => {
    const { rerender } = render(<>
      <p id="retention-help">Older versions only</p>
      <SettingsField label="Retention" type="number" unit="Days" help="Minimum: 1" aria-describedby="retention-help" />
    </>);
    expect(screen.getByRole("spinbutton", { name: "Retention" })).toHaveAccessibleDescription("Days Minimum: 1 Older versions only");
    rerender(<>
      <p id="retention-help">Older versions only</p>
      <SettingsField label="Retention" type="number" unit="Days" error="Enter a positive number" aria-describedby="retention-help" />
    </>);
    const field = screen.getByRole("spinbutton", { name: "Retention" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Days Enter a positive number Older versions only");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a positive number");
  });
});
