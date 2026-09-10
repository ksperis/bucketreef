import { render, screen } from "@testing-library/react";

import UiField from "./UiField";
import UiInput from "./UiInput";
import UiSelect from "./UiSelect";
import UiTextarea from "./UiTextarea";

describe("UiField", () => {
  it("wires labels, hints, and errors to custom controls", () => {
    render(
      <UiField label="Endpoint" hint="Use the public S3 endpoint." error="Endpoint is required">
        {({ id, describedBy, invalid }) => (
          <input id={id} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </UiField>
    );

    const input = screen.getByLabelText("Endpoint");
    expect(input).toHaveAccessibleDescription("Use the public S3 endpoint. Endpoint is required");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("renders standard form controls with shared ui-control styling", () => {
    render(
      <>
        <UiInput label="Endpoint" defaultValue="https://s3.example.test" />
        <UiSelect label="Provider" defaultValue="ceph">
          <option value="ceph">Ceph</option>
        </UiSelect>
        <UiTextarea label="Policy" defaultValue="{}" />
      </>
    );

    expect(screen.getByLabelText("Endpoint")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Provider")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Policy")).toHaveClass("ui-control");
  });

  it.each([
    { name: "input", Control: UiInput },
    { name: "select", Control: UiSelect },
    { name: "textarea", Control: UiTextarea },
  ])("preserves all descriptions and validation for $name with explicit ARIA attributes", ({ Control }) => {
    const renderField = (error?: string) => <>
      <p id="scope-help">Only this bucket.</p>
      <Control label="Configuration" hint="Review before saving." error={error}
        aria-describedby="scope-help" aria-invalid={false} />
    </>;
    const { rerender } = render(renderField("A value is required."));
    const input = screen.getByLabelText("Configuration");
    expect(input).toHaveAccessibleDescription("Review before saving. A value is required. Only this bucket.");
    expect(input).toHaveAttribute("aria-invalid", "true");

    rerender(renderField());
    expect(input).toHaveAccessibleDescription("Review before saving. Only this bucket.");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });
});
