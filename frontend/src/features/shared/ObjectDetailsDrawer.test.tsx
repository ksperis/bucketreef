import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ObjectDetailsDrawer from "./ObjectDetailsDrawer";

describe("ObjectDetailsDrawer", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("uses the shared floating menu and lets Escape dismiss it before the drawer", () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();

    render(
      <ObjectDetailsDrawer
        name="report.csv"
        path="reports/2026/report.csv"
        copyPathLabel="Copy path"
        moreLabel="More"
        onCopyPath={vi.fn()}
        onClose={onClose}
        secondaryActions={[
          {
            id: "delete",
            label: "Delete",
            tone: "danger",
            onSelect: onDelete,
          },
        ]}
      >
        Drawer content
      </ObjectDetailsDrawer>,
    );

    const moreButton = screen.getByRole("button", { name: "More" });
    fireEvent.click(moreButton);
    expect(screen.getByRole("menu", { name: "More" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "More" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(moreButton);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "More" })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("exposes previous and next only within the loaded list", () => {
    const next = vi.fn();
    render(<ObjectDetailsDrawer name="one.txt" path="one.txt" copyPathLabel="Copy" moreLabel="More" onCopyPath={vi.fn()} onClose={vi.fn()} navigation={{ next, position: "1 / 2" }} activeTab="preview" tabs={[{ id: "preview", label: "Preview" }, { id: "details", label: "Details" }]} onTabChange={vi.fn()} primaryAction={{ label: "Download", onSelect: vi.fn() }}>Text</ObjectDetailsDrawer>);
    const navigation = screen.getByRole("group", { name: "Loaded files" });
    const tabList = screen.getByRole("tablist", { name: "Details views" });
    expect(tabList.parentElement).toContainElement(navigation);
    expect(tabList.parentElement).not.toContainElement(screen.getByRole("button", { name: "Download" }));
    expect(within(navigation).getByRole("button", { name: "Previous object" })).toBeDisabled();
    fireEvent.click(within(navigation).getByRole("button", { name: "Next object" }));
    expect(next).toHaveBeenCalledOnce();
    expect(navigation).toHaveTextContent("1 / 2");
  });

  it("keeps object navigation accessible without tabs", () => {
    const previous = vi.fn();
    render(<ObjectDetailsDrawer name="one.txt" path="one.txt" moreLabel="More" onClose={vi.fn()} navigation={{ previous, position: "2 / 2" }}>Text</ObjectDetailsDrawer>);
    fireEvent.click(screen.getByRole("button", { name: "Previous object" }));
    expect(previous).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Next object" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "Loaded files" })).toHaveTextContent("2 / 2");
  });

  it("closes object actions when the drawer switches to another path", () => {
    const commonProps = {
      copyPathLabel: "Copy path",
      moreLabel: "More",
      onCopyPath: vi.fn(),
      onClose: vi.fn(),
      secondaryActions: [
        {
          id: "delete",
          label: "Delete",
          onSelect: vi.fn(),
        },
      ],
    };
    const view = render(
      <ObjectDetailsDrawer {...commonProps} name="first.csv" path="reports/first.csv">
        First
      </ObjectDetailsDrawer>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menu", { name: "More" })).toBeInTheDocument();

    view.rerender(
      <ObjectDetailsDrawer {...commonProps} name="second.csv" path="reports/second.csv">
        Second
      </ObjectDetailsDrawer>,
    );

    expect(screen.queryByRole("menu", { name: "More" })).not.toBeInTheDocument();
  });
});
