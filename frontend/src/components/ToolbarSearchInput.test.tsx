import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ToolbarSearchInput, { ToolbarSearchTextarea } from "./ToolbarSearchInput";

describe("ToolbarSearchInput", () => {
  it("supports compact contextual search with a leading adornment", () => {
    const onChange = vi.fn();

    render(
      <ToolbarSearchInput
        label="Search buckets"
        labelClassName="sr-only"
        value="archive"
        onChange={onChange}
        placeholder="Search buckets"
        leadingControl={<span data-testid="search-adornment">?</span>}
        inputClassName="w-full"
        spellCheck={false}
      />,
    );

    const input = screen.getByRole("searchbox", { name: "Search buckets" });
    expect(input).toHaveClass("ui-control", "ui-list-control", "ui-list-control-with-icon", "w-full");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(screen.getByTestId("search-adornment").parentElement).toHaveAttribute("aria-hidden", "true");

    fireEvent.change(input, { target: { value: "logs" } });
    expect(onChange).toHaveBeenCalledWith("logs");
  });
});

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
