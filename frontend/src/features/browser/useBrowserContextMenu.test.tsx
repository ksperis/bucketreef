import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserContextMenu } from "./useBrowserContextMenu";
import type { BrowserItem } from "./browserTypes";

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

describe("useBrowserContextMenu", () => {
  beforeEach(() => setViewport(1000, 800));

  const options = () => ({
    headerConfigurationEnabled: true,
    prepareItemActionsMenu: vi.fn(),
    prepareItemContextMenu: vi.fn((item: BrowserItem) => ({
      kind: "item" as const,
      item,
      items: [item],
    })),
  });

  afterEach(() => {
    setViewport(originalInnerWidth, originalInnerHeight);
    document
      .querySelectorAll("[data-context-menu-hook-test]")
      .forEach((node) => node.remove());
  });

  it("clamps point and end-aligned anchors within the viewport", () => {
    setViewport(300, 220);
    const { result } = renderHook(() => useBrowserContextMenu(options()));

    act(() => {
      result.current.openContextMenu(
        { kind: "path" },
        { x: 280, y: 190 },
      );
    });
    expect(result.current.contextMenu).toMatchObject({
      kind: "path",
      x: 52,
      y: 8,
    });

    setViewport(1000, 800);
    act(() => {
      result.current.openContextMenu(
        { kind: "headerConfig" },
        { x: 500, y: 200, horizontalAlignment: "end" },
      );
    });
    expect(result.current.contextMenu).toMatchObject({
      kind: "headerConfig",
      x: 260,
      y: 200,
    });
  });

  it("repositions the rendered menu and closes it on outside interactions", async () => {
    const { result } = renderHook(() => useBrowserContextMenu(options()));
    const menu = document.createElement("div");
    menu.dataset.contextMenuHookTest = "true";
    const menuChild = document.createElement("button");
    menu.append(menuChild);
    document.body.append(menu);
    Object.defineProperty(menu, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 580,
        height: 80,
        left: 700,
        right: 800,
        top: 500,
        width: 100,
        x: 700,
        y: 500,
        toJSON: () => ({}),
      }),
    });
    act(() => {
      result.current.contextMenuRef.current = menu;
      result.current.openContextMenu(
        { kind: "path" },
        { x: 700, y: 500 },
      );
    });

    setViewport(600, 400);
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() =>
      expect(result.current.contextMenu).toMatchObject({ x: 492, y: 312 }),
    );

    fireEvent.mouseDown(menuChild);
    expect(result.current.contextMenu).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(result.current.contextMenu).toBeNull();

    act(() => {
      result.current.openContextMenu(
        { kind: "headerConfig" },
        { x: 40, y: 40 },
      );
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(result.current.contextMenu).toBeNull();
  });

  it("owns Browser menu opening semantics", () => {
    const item: BrowserItem = {
      id: "item-1",
      key: "report.csv",
      name: "report.csv",
      type: "file",
      size: "1 KB",
      modified: "now",
      owner: "owner",
    };
    const config = options();
    const { result } = renderHook(() => useBrowserContextMenu(config));
    const view = render(
      <div>
        <button
          data-testid="item-actions"
          onClick={(event) => result.current.handleItemActionsButtonClick(event, item)}
        >
          Actions
        </button>
        <div
          data-testid="path"
          onContextMenu={result.current.handlePathContextMenu}
        >
          Path
          <button type="button">Child control</button>
        </div>
        <div
          data-testid="header"
          onContextMenu={result.current.handleHeaderContextMenu}
        >
          Header
        </div>
        <div
          data-testid="item"
          onContextMenu={(event) => result.current.handleItemContextMenu(event, item)}
        >
          Item
        </div>
      </div>,
    );

    Object.defineProperty(view.getByTestId("item-actions"), "getBoundingClientRect", {
      configurable: true,
      value: () => ({ right: 500, bottom: 200 }),
    });
    fireEvent.click(view.getByTestId("item-actions"));
    expect(config.prepareItemActionsMenu).toHaveBeenCalledWith(item);
    expect(result.current.contextMenu).toMatchObject({ kind: "item", item });

    fireEvent.contextMenu(view.getByTestId("item"), { clientX: 100, clientY: 120 });
    expect(config.prepareItemContextMenu).toHaveBeenCalledWith(item);
    expect(result.current.contextMenu).toMatchObject({ kind: "item", x: 100, y: 120 });

    fireEvent.contextMenu(view.getByRole("button", { name: "Child control" }), {
      clientX: 140,
      clientY: 160,
    });
    expect(result.current.contextMenu).toMatchObject({ kind: "item" });

    fireEvent.contextMenu(view.getByTestId("path"), { clientX: 140, clientY: 160 });
    expect(result.current.contextMenu).toMatchObject({ kind: "path", x: 140, y: 160 });

    fireEvent.contextMenu(view.getByTestId("header"), { clientX: 180, clientY: 200 });
    expect(result.current.contextMenu).toMatchObject({ kind: "headerConfig", x: 180, y: 200 });
  });
});
