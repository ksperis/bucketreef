/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import AnchoredPortalMenu from "./AnchoredPortalMenu";

function Harness() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={anchorRef}>Anchor</button>
    <AnchoredPortalMenu open anchorRef={anchorRef} className="test-menu">
      <span>Panel</span>
    </AnchoredPortalMenu>
  </>;
}

describe("AnchoredPortalMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clamps an oversized anchor and repositions after content grows", () => {
    let frame: FrameRequestCallback = () => undefined;
    let notifyResize = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => undefined) { notifyResize = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);
    let menuHeight = 200;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "BUTTON"
        ? new DOMRect(900, 680, 1200, 28)
        : new DOMRect(0, 0, 384, menuHeight);
    });

    const { unmount } = render(<Harness />);
    act(() => frame(0));
    const menu = screen.getByText("Panel").parentElement!;
    expect(menu.style.minWidth).toBe("1008px");
    expect(menu.style.left).toBe("8px");
    expect(menu.style.top).toBe("472px");

    menuHeight = 700;
    act(() => { notifyResize(); frame(1); });
    expect(menu.style.top).toBe("60px");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
