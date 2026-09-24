import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolbarAdvancedFilterButton, ToolbarMatchModeButton } from "./ToolbarFilterControls";

describe("ToolbarFilterControls", () => {
  it("shares match-mode state, symbol and locked behavior", () => {
    const onClick = vi.fn();
    const { rerender } = render(<ToolbarMatchModeButton mode="contains" pending onClick={onClick} />);

    let button = screen.getByRole("button", { name: "Toggle filter match mode" });
    expect(button).toHaveTextContent("~");
    expect(button).toHaveClass("ui-list-action-icon", "ui-list-action-warning");
    expect(button).toHaveAttribute("title", "Quick filter mode: contains");

    rerender(<ToolbarMatchModeButton mode="exact" locked onClick={onClick} />);
    button = screen.getByRole("button", { name: "Toggle filter match mode" });
    expect(button).toHaveTextContent("=");
    expect(button).toHaveClass("ui-list-action-active");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Quick filter mode: exact (locked by list input)");
  });

  it("shares advanced-filter action styling while preserving content", () => {
    const onClick = vi.fn();
    render(
      <ToolbarAdvancedFilterButton active onClick={onClick}>
        Advanced filter · Active
      </ToolbarAdvancedFilterButton>,
    );

    const button = screen.getByRole("button", { name: "Advanced filter · Active" });
    expect(button).toHaveClass("ui-list-action", "ui-list-action-active");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
