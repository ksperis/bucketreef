import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PaginationControls from "./PaginationControls";

describe("PaginationControls", () => {
  it("uses shared listing controls for navigation and page size", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();

    render(
      <PaginationControls
        page={2}
        pageSize={25}
        total={80}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    const pageSize = screen.getByRole("combobox", { name: "Page size" });
    expect(pageSize).toHaveClass("ui-control", "ui-control-compact", "ui-list-control");

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.change(pageSize, { target: { value: "50" } });

    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});
