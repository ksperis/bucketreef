import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolbarSearchTextarea } from "./ToolbarSearchInput";

describe("ToolbarSearchTextarea", () => {
  it("shares listing search geometry while preserving multiline input behavior", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <ToolbarSearchTextarea
        label="Quick filter"
        value="archive"
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Bucket name(s)"
        inputClassName="pending-filter"
        trailingControl={<button type="button">=</button>}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: "Quick filter" });
    expect(textarea).toHaveClass("ui-control", "ui-list-control", "ui-list-search", "pending-filter");
    expect(textarea).toHaveAttribute("rows", "1");

    fireEvent.change(textarea, { target: { value: "logs\narchive" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("logs\narchive");
    expect(onKeyDown).toHaveBeenCalledOnce();
  });
});
