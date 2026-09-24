import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsField, SettingsInput, SettingsSelect } from "./SettingsControls";

describe("Settings controls", () => {
  it("applies the shared settings field contract to labelled inputs and selects", () => {
    render(
      <>
        <SettingsInput label="Bucket name" defaultValue="logs" />
        <SettingsSelect label="Mode" defaultValue="enabled">
          <option value="enabled">Enabled</option>
        </SettingsSelect>
      </>,
    );

    expect(screen.getByRole("textbox", { name: "Bucket name" })).toHaveClass("ui-control", "settings-control");
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveClass("ui-control", "settings-control");
    expect(screen.getByText("Bucket name")).toHaveClass("settings-label");
    expect(screen.getByText("Mode")).toHaveClass("settings-label");
  });
});

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
