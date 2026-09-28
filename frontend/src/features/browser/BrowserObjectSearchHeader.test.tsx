import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserObjectSearchHeader from "./BrowserObjectSearchHeader";

const buildProps = (
  overrides: Partial<ComponentProps<typeof BrowserObjectSearchHeader>> = {},
): ComponentProps<typeof BrowserObjectSearchHeader> => ({
  rootRef: createRef<HTMLDivElement>(),
  optionsButtonRef: createRef<HTMLButtonElement>(),
  optionsMenuRef: createRef<HTMLDivElement>(),
  advancedOptionsEnabled: true,
  optionsOpen: false,
  filter: "",
  objectNounPlural: "objects",
  nameSortActive: true,
  sortDirection: "asc",
  advancedOptionsActive: false,
  hasSearchQuery: false,
  searchScope: "prefix",
  recursive: false,
  exactMatch: false,
  caseSensitive: false,
  typeFilter: "all",
  storageFilter: "all",
  storageClasses: ["STANDARD", "GLACIER"],
  canReset: false,
  onSortName: vi.fn(),
  onFilterChange: vi.fn(),
  onToggleOptions: vi.fn(),
  onScopeChange: vi.fn(),
  onRecursiveChange: vi.fn(),
  onExactMatchChange: vi.fn(),
  onCaseSensitiveChange: vi.fn(),
  onTypeFilterChange: vi.fn(),
  onStorageFilterChange: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe("BrowserObjectSearchHeader", () => {
  it("applies a draft atomically and returns focus to the options trigger", () => {
    const props = buildProps({ optionsOpen: true, filter: "invoice", onFileFiltersChange: vi.fn() });
    render(<BrowserObjectSearchHeader {...props} />);
    fireEvent.click(screen.getByText("Matching options"));
    fireEvent.change(screen.getByRole("combobox", { name: "Search scope" }), { target: { value: "recursive" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Use exact match" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Storage class filter" }), { target: { value: "GLACIER" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum bytes" }), { target: { value: "42" } });
    expect(props.onScopeChange).not.toHaveBeenCalled();
    expect(props.onFileFiltersChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(props.onScopeChange).toHaveBeenCalledWith("prefix");
    expect(props.onRecursiveChange).toHaveBeenCalledWith(true);
    expect(props.onExactMatchChange).toHaveBeenCalledWith(true);
    expect(props.onStorageFilterChange).toHaveBeenCalledWith("GLACIER");
    expect(props.onFileFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ minSize: "42" }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Search options" })).toHaveFocus();
  });

  it("allows filters without a query and resets only the draft before Apply", () => {
    const props = buildProps({ optionsOpen: true, searchScope: "bucket", onFileFiltersChange: vi.fn() });
    render(<BrowserObjectSearchHeader {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Extensions, separated by commas" }), { target: { value: "csv" } });
    fireEvent.click(screen.getByText("Matching options"));
    expect(screen.getByRole("option", { name: "Folders" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("combobox", { name: "Search scope" })).toHaveValue("prefix");
    expect(props.onFileFiltersChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onFileFiltersChange).not.toHaveBeenCalled();
  });

  it("can hide optional advanced controls when requested", () => {
    render(
      <BrowserObjectSearchHeader
        {...buildProps({ advancedOptionsEnabled: false, optionsOpen: true })}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Search objects" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Search options" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Search scope" }),
    ).not.toBeInTheDocument();
  });
});
