import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import IamCursorPaginationControls from "./IamCursorPaginationControls";

describe("IamCursorPaginationControls", () => {
  it("labels cursor navigation and page size consistently with shared pagination", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onPageSizeChange = vi.fn();

    render(
      <IamCursorPaginationControls
        page={2}
        pageSize={25}
        canPrevious
        canNext
        onPrevious={onPrevious}
        onNext={onNext}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    expect(screen.getByText("Page 2")).toBeInTheDocument();
    const pageSize = screen.getByRole("combobox", { name: "Page size" });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(pageSize, { target: { value: "50" } });

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});
