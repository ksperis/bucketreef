import { act, render, screen } from "@testing-library/react";
import { useWorkspaceDrawerAnchor } from "./useWorkspaceDrawerAnchor";

function Harness() {
  const ref = useWorkspaceDrawerAnchor();
  return <div ref={ref} data-testid="content" />;
}

describe("workspace drawer anchor", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("tracks the actual content boundary as shell and demo toolbars resize", () => {
    let top = 56;
    let notifyResize = () => undefined;
    let frame: FrameRequestCallback = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => undefined) { notifyResize = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, top, 1200, 720 - top));
    const { unmount } = render(<Harness />);
    const content = screen.getByTestId("content");
    expect(content.style.getPropertyValue("--workspace-content-top")).toBe("56px");
    top = 99;
    act(() => { notifyResize(); frame(0); });
    expect(content.style.getPropertyValue("--workspace-content-top")).toBe("99px");
    top = 142;
    act(() => { notifyResize(); frame(1); });
    expect(content.style.getPropertyValue("--workspace-content-top")).toBe("142px");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
