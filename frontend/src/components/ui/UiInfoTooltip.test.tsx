import { fireEvent, render, screen } from "@testing-library/react";
import UiInfoTooltip from "./UiInfoTooltip";

describe("UiInfoTooltip", () => {
  it("uses the shared dismissible layer for pointer and Escape dismissal", () => {
    render(
      <UiInfoTooltip label="Retention information">
        Retention details
      </UiInfoTooltip>,
    );

    const trigger = screen.getByRole("button", { name: "Retention information" });
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip", { name: "Retention information" })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip", { name: "Retention information" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip", { name: "Retention information" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip", { name: "Retention information" })).not.toBeInTheDocument();
  });
});
